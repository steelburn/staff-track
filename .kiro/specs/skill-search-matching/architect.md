# Skill Search & Matching - Architecture & Decisions

## Executive Summary

StaffTrack enables intelligent searching and matching of staff based on skill requirements. This feature powers use cases like "Find experts in Python who work on cloud projects" and "Match job openings with qualified staff". This document captures architectural decisions for full-text search, relevance ranking, and skill matching algorithms.

---

## Part 1: Architecture Decision Records (ADRs)

### ADR-001: Search Engine (SQL LIKE vs. Elasticsearch vs. Meilisearch vs. MySQL FTS)

**Status:** Accepted  
**Decision:** MySQL Full-Text Search (FTS) for MVP, plan Elasticsearch migration for scale

**Rationale:**
| Engine | Latency | Index Size | Relevance | Operations | Cost | MVP? |
|--------|---------|-----------|-----------|-----------|------|------|
| **SQL LIKE** | 300ms+ | None | Poor | Very simple | None | No |
| **MySQL FTS** | 50-100ms | 20% data | Good | Simple | None | ✓ |
| **Meilisearch** | 10-50ms | 50% data | Excellent | Medium | $10/mo | Maybe |
| **Elasticsearch** | 10-50ms | 100% data | Excellent | Complex | $100+/mo | No (overkill) |

**Decision:** MySQL FTS for MVP (zero additional cost, good enough for 1000-5000 skills).
Plan: Migrate to Elasticsearch if queries exceed 200ms (threshold for "feels slow").

**Why MySQL FTS?**
- No new infrastructure
- Natural index maintenance (auto-indexed on INSERT/UPDATE)
- Sufficient relevance (can fine-tune with weighting)
- Trivial to migrate later (no logic changes)

---

### ADR-002: Relevance Ranking (BM25 vs. TF-IDF vs. Learning-to-Rank)

**Status:** Accepted  
**Decision:** BM25 (built into MySQL FTS) for MVP, no custom ranking

**Rationale:**
```
Query: "Python expert"
Results in StaffTrack (should rank this way):

1. ✓ Staff with "Python" skill (exact match) rated 5/5
2. ✓ Staff with "Python" in project description
3. ✓ Staff with "Python" in CV summary
4. ❌ Staff with no mention (shouldn't rank)

BM25 algorithm (MySQL default):
  - Considers term frequency (how many times "Python" appears)
  - Considers inverse document frequency (how rare is "Python")
  - Naturally deprioritizes common words
  - Works well without tuning
```

**Not chosen:**
- ❌ Learning-to-rank: Too complex for MVP (needs labeled training data)
- ❌ Custom scoring: Hard to maintain, easy to break

---

### ADR-003: Skill Canonicalization (Fuzzy Matching vs. Taxonomy)

**Status:** Accepted  
**Decision:** Canonical skill taxonomy (predefined list) + fuzzy matching for user input

**Model:**
```
Canonical Skills (Curated List in DB):
  - Python
  - JavaScript (not "JS", not "Node.js script language")
  - AWS Cloud (not just "AWS", not "Amazon")
  - Docker/Containers
  - [... etc]

When staff submits skills, they pick from canonical list:
  ✓ Staff: "I have Python"       → Stored as "Python" (exact match)
  ✓ Staff: "I have JS"            → Matched to "JavaScript" (fuzzy)
  ✓ Staff: "I have Kubernetes"    → Matched to "Docker/Containers" (autocomplete suggestion)

Fuzzy match logic:
  - Levenshtein distance < 2 → Suggest canonical skill
  - e.g., "Pyton" ~ "Python" (1 char difference)
  - e.g., "Node" ~ "JavaScript" (not similar; don't suggest)
```

**Benefits:**
- Prevents skill fragmentation ("Python" vs "python" vs "PYTHON")
- Searches work reliably (user searches "Python", finds all staff with "Python")
- Reporting accurate (can't segment by variant names)

---

### ADR-004: Skill Proficiency Levels (Binary vs. Numeric)

**Status:** Accepted  
**Decision:** Numeric levels (1-5) for granular matching

**Model:**
```sql
Rating Scale:
  1 = Familiar (tried once, know basics)
  2 = Novice (small projects, needs support)
  3 = Intermediate (regular use, independent)
  4 = Advanced (deep knowledge, mentors others)
  5 = Expert (recognized authority)

When hiring manager searches: "Find Python expert"
  Query: skill = 'Python' AND rating >= 4
  Results: Only staff with 4-5 ratings
```

**Why numeric?**
- Enables filtering (show only experts, not novices)
- Enables sorting (rank by proficiency)
- Binary (yes/no) too coarse; candidate with "some Python" wouldn't appear

---

### ADR-005: Matching Algorithm (Exact vs. Token-based vs. Graph-based)

**Status:** Accepted  
**Decision:** Query expansion + token-based matching (not graph algorithms)

**Example:**
```
Manager searches: "I need Python + AWS"

Step 1: Expand query
  - "Python" → stays as is
  - "AWS" → expands to ["AWS", "Amazon Web Services", "Cloud"]
  
Step 2: Token search (MySQL FTS)
  SELECT * FROM staff s
  JOIN submission_skills ss ON s.id = ss.submission_id
  WHERE MATCH(ss.skill) AGAINST ('Python AWS' IN BOOLEAN MODE)
  ORDER BY rating DESC

Step 3: Score results
  - Staff with Python + AWS: score = 10
  - Staff with Python + Cloud: score = 8
  - Staff with Python only: score = 5
  
Step 4: Rank
  Results sorted by score (descending)
```

**Why token-based (not graph)?**
- Graph algorithms (find similar skills transitively) too complex
- Token search sufficient for most use cases
- Trivial to expand queries (curated synonym list)

**Graph approach rejected:**
- Over-engineering for MVP
- Would need skill relationships defined (extra maintenance)
- Most queries don't need "find skills similar to Python"

---

### ADR-006: Search Scope (Full-Text vs. Faceted vs. Semantic)

**Status:** Accepted  
**Decision:** Full-text search (find skills) + faceted navigation (filter by category)

**Implementation:**
```
Full-Text Search Box:
  "Search for staff by skill..."
  User types: "Python"
  Results: Staff with "Python" skill

Faceted Navigation (Filters):
  ✓ Skill Category: Backend, Frontend, DevOps, Data
  ✓ Proficiency: Any, Intermediate+, Advanced+, Expert
  ✓ Years Experience: Any, 1y+, 3y+, 5y+
  
Result: Staff matching all selected filters

Not chosen:
  ❌ Semantic search: Requires ML model; MVP doesn't need "find Python-like languages"
  ❌ Vector search: Overkill for structured skill data
```

---

### ADR-007: Performance Optimization (Indexing Strategy)

**Status:** Accepted  
**Decision:** Full-text index on skills + filtered indexes on proficiency/category

**MySQL Index Strategy:**
```sql
-- Full-text index on skill names
CREATE FULLTEXT INDEX ft_skill_name ON submission_skills(skill);

-- Regular indexes on filtered queries
CREATE INDEX idx_proficiency ON submission_skills(rating);
CREATE INDEX idx_skill_category ON skills_catalog(category);
CREATE INDEX idx_staff_department ON staff(department);

-- Composite index for common query pattern
CREATE INDEX idx_skill_rating_category 
  ON submission_skills(skill, rating, category);
```

**Query Optimization:**
```sql
-- Slow (full table scan)
SELECT * FROM submission_skills WHERE skill LIKE '%Python%';

-- Fast (uses full-text index, < 50ms)
SELECT * FROM submission_skills 
WHERE MATCH(skill) AGAINST ('Python' IN BOOLEAN MODE);
```

---

### ADR-008: Skill Merge & Deduplication

**Status:** Accepted  
**Decision:** Admin merge functionality (combine duplicate skills)

**Process:**
```
Admin observes: Staff submitted both "ReactJS" and "React"
  → Admin merges "ReactJS" into "React"
  → All submissions tagged "ReactJS" re-tagged to "React"
  → Log merge action in audit table

Implementation:
  POST /api/admin/skills/merge
  { from_skill: "ReactJS", to_skill: "React" }
  → Update all records
  → Log merge in skill_merge_log table
  → Notify affected staff? (Optional, could be noise)
```

**Prevents:** Skill fragmentation over time (gradual consolidation).

---

## Part 2: System Integration Points

### 2.1 Data Model

```sql
-- Canonical skill taxonomy
CREATE TABLE skills_catalog (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  category VARCHAR(100),        -- "Backend", "Frontend", "DevOps", "Data"
  aliases JSON DEFAULT '[]',    -- ["ReactJS", "React.js"] (for fuzzy matching)
  is_active TINYINT DEFAULT 1,
  created_at DATETIME,
  updated_at DATETIME,
  FULLTEXT INDEX ft_name (name)
);

-- Staff skill proficiency
CREATE TABLE submission_skills (
  id VARCHAR(36) PRIMARY KEY,
  submission_id VARCHAR(36),
  skill VARCHAR(255),           -- Foreign key to skills_catalog.name
  rating INT DEFAULT 3,         -- 1-5 proficiency
  years_experience INT,         -- Optional: how many years
  last_used_date DATE,          -- Optional: when last used
  FOREIGN KEY (submission_id) REFERENCES submissions(id),
  FOREIGN KEY (skill) REFERENCES skills_catalog(name),
  FULLTEXT INDEX ft_skill (skill),
  INDEX idx_rating (rating)
);

-- Search audit (what users searched for)
CREATE TABLE skill_search_log (
  id VARCHAR(36) PRIMARY KEY,
  query VARCHAR(255),
  user_id VARCHAR(36),
  results_count INT,
  clicked_result_id VARCHAR(36),  -- Did user click a result?
  created_at DATETIME
);
```

### 2.2 Backend API Endpoints

**New Routes (in `src/routes/skill-search.js`):**
```javascript
GET /api/skills/search
  Query params: { q: "Python", category: "Backend", rating_min: 3 }
  Response: [ { skill, rating, staff_count } ]

GET /api/skills/catalog
  Response: All canonical skills (for autocomplete)

GET /api/skills/autocomplete?q=Pyt
  Response: ["Python", "Pytest"] (fuzzy match suggestions)

GET /api/staff/match
  Query params: { skills: ["Python", "AWS"], rating: 4 }
  Response: [ { staff_id, name, matching_skills, score } ]
  
POST /api/admin/skills/merge
  Body: { from_skill: "ReactJS", to_skill: "React" }
  Response: { merged_count: 45 }  (45 submissions updated)
```

### 2.3 Frontend Components

```javascript
// Components/SkillSearch/
├─ SkillInput.jsx              (search + autocomplete)
├─ SkillFilters.jsx            (category, proficiency, experience)
├─ SkillResults.jsx            (list of matching staff)
├─ SkillAlliances.jsx          (recommended skill combos)
└─ SkillTrending.jsx           (most common skills)

// hooks/
├─ useSkillSearch.js           (search API call)
├─ useSkillAutocomplete.js     (typeahead suggestions)
└─ useSkillFilters.js          (manage filter state)
```

### 2.4 Search Flow

```
User searches "Python developer wanted"
   ↓
Frontend makes request:
   GET /api/staff/match?skills=["Python"]&rating=3
   ↓
Backend:
   1. Expand "Python" (no synonyms, exact match)
   2. Query MySQL FTS:
      SELECT staff.* FROM staff
      JOIN submission_skills ON staff.id = submission_skills.submission_id
      WHERE MATCH(submission_skills.skill) AGAINST ('Python')
      AND submission_skills.rating >= 3
   3. Score & rank results
   4. Return top 20
   ↓
Frontend displays matching staff + skill details
```

---

## Part 3: Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **Search too slow (> 200ms)** | Low (10%) | Medium | MySQL FTS indexes; migrate to Elasticsearch if needed |
| **Skill duplicates confuse users** | Medium (25%) | Low | Admin merge tool; fuzzy matching; search quality metrics |
| **Fuzzy matching suggests wrong skills** | Low (5%) | Low | Curate alias list; test frequently-misspelled skills |
| **No results for valid query** | Low (10%) | Medium | Implement "did you mean?" suggestions; expand synonyms |
| **Performance degrades with 10K+ skills** | Low (5%) | High | Migrate to Elasticsearch at 5K skills; set alerting |
| **Typos prevent finding staff** | Medium (20%) | Low | Autocomplete suggestions; fuzzy match; spell-check |

---

## Part 4: Success Criteria & Acceptance

### 4.1 Functional Requirements
- ✅ Search staff by single skill (e.g., "Python")
- ✅ Search staff by multiple skills (e.g., "Python + AWS")
- ✅ Filter by proficiency level (e.g., expert only)
- ✅ Filter by skill category (e.g., "Backend" skills only)
- ✅ Autocomplete suggestions as user types
- ✅ Fuzzy matching (handle typos)
- ✅ Canonical skill list prevents duplicates
- ✅ Admin can merge duplicate skills

### 4.2 Non-Functional Requirements
- ✅ Search response time < 100ms (for 1000+ staff)
- ✅ Autocomplete response time < 50ms
- ✅ Full-text index < 50MB (skill names + staff profile data)
- ✅ Handles concurrent searches (10 simultaneous users)
- ✅ Search quality metrics tracked (clicks, usage patterns)

### 4.3 Quality Requirements
- ✅ No SQL injection vulnerabilities
- ✅ Results don't leak private data (respect permissions)
- ✅ Skill names consistent (no "Python" vs "PYTHON")
- ✅ Search results ranked by relevance
- ✅ "No results" message helpful (suggests alternatives)

---

## Part 5: Architecture Validation Checklist

**Architect Review (Before implementation):**
- [ ] MySQL FTS approach approved (scalability until 5K+ skills)
- [ ] Skill canonicalization model reviewed
- [ ] Search algorithm (token-based) understood by team
- [ ] Fuzzy matching thresholds defined and tested
- [ ] Admin merge workflow documented
- [ ] Performance targets achievable (< 100ms)
- [ ] Search audit logging approved (for improvement)
- [ ] Migration plan to Elasticsearch documented (if needed)

**Go/No-Go Approval:** _Pending Tech Lead sign-off_

