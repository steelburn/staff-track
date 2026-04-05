# Skill Search & Matching - Orchestration & Governance

## Project Governance

### Decision-Making Authority

```
Product Manager (Business Requirements)
    + Tech Lead (Technical Architecture)
    ↓
Orchestrator (Search Feature Lead)
    ↓
├─ Backend Lead (MySQL FTS, APIs)
├─ Frontend Lead (Search UI, Results display)
├─ Data Lead (Skill canonicalization, taxonomysetup)
└─ QA Lead (Search quality, relevance testing)
```

### Role Responsibilities

| Role | Responsibilities | Success Metric |
|------|------------------|-----------------|
| **Orchestrator** | Feature delivery, search quality, user satisfaction | Search live in 3 weeks |
| **Backend Lead** | MySQL FTS setup, search APIs, ranking logic | Queries < 100ms |
| **Frontend Lead** | Search UI, autocomplete, results display | UX intuitive, no confusion |
| **Data Lead** | Canonical skill list, aliases, deduplication | Zero duplicate skills |
| **QA Lead** | Search quality tests, relevance ranking, edge cases | ~90% relevant results |

### Communication Cadence

| Frequency | Meeting | Attendees | Purpose |
|-----------|---------|-----------|---------|
| **3x/week** | Search quality review | Data + Orchestrator | Skill canonicalization, search results review |
| **Weekly** | Status + metrics | All leads | Progress, search quality metrics |
| **Bi-weekly** | User feedback | Product + Orchestrator | How users searching? What missing? |

---

## Project Timeline

**Duration:** 3 weeks  
**Team Size:** 2-3 FTE  
**Criticality:** MEDIUM-HIGH (powerful feature, but not blocking)

### Phase 1: Skill Taxonomy & Canonicalization (Days 1-4)
- ✅ Extract current skills from submissions (deduplication)
- ✅ Create canonical skill list (unique names)
- ✅ Define skill categories (Backend, Frontend, DevOps, Data, etc.)
- ✅ Add aliases (fuzzy match suggestions)

**Deliverable:** Skill taxonomy complete (~200-300 skills)

### Phase 2: MySQL FTS Setup (Days 4-8)
- ✅ Create full-text index on skill names
- ✅ Implement search API (GET /api/skills/search)
- ✅ Implement autocomplete API
- ✅ Test search relevance (top results are relevant)

**Deliverable:** Search APIs working, sub-100ms queries

### Phase 3: Frontend Implementation (Days 8-12)
- ✅ Search input + autocomplete UI
- ✅ Results display (list of matching staff)
- ✅ Faceted navigation (filters by category, proficiency)
- ✅ Staff matching (show skill + rating)

**Deliverable:** Search UI complete, integrated with backend

### Phase 4: Quality Assurance (Days 12-16)
- ✅ Search quality testing (90% of results relevant)
- ✅ Edge case testing (typos, special characters)
- ✅ Performance testing (100+ concurrent searches)
- ✅ Skill deduplication validation

**Deliverable:** Search quality acceptable, no critical bugs

### Phase 5: Deployment (Days 16-21)
- ✅ Staging dry-run
- ✅ Production deployment
- ✅ Monitoring active
- ✅ Analytics captured (search logs)

**Deliverable:** Search feature live to all users

---

## Risk Management

### Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **Search too slow (> 200ms)** | Low (10%) | High | MySQL FTS optimized; plan Elasticsearch migration |
| **Skill duplicates confuse deduplication** | Medium (25%) | Low | Curate canonical list; admin tool for merging |
| **Fuzzy matching suggests wrong skills** | Low (10%) | Low | Test frequently-misspelled skills; curate aliases |
| **No results for valid queries** | Medium (20%) | Medium | Implement spell-check; expand query synonyms |
| **Search degrades with 10K+ skills** | Low (5%) | High | Monitor index size; migrate to Elasticsearch if needed |
| **Users can't find skills by category** | Low (8%) | Medium | Faceted navigation helps; category filter clear |
| **Relevance ranking feels arbitrary** | Low (10%) | Medium | BM25 good enough; user testing validates |

---

## Stakeholder Communication

### User Communication

| Phase | Audience | Message |
|-------|----------|---------|
| **Week 1** | Internal (marketing) | "Skill search launching Week 3; helps managers find experts" |
| **Week 2** | Beta testers (10 managers) | "Try new skill search; tell us what works/doesn't" |
| **Week 3** | All staff | "New skill search available; find experts in any skill" |

### Manager Communication

**Feature announcement:**
```
NEW: Skill Search

Find experts in specific skills:
  "Search: Python + AWS Cloud"
  → Shows all staff with Python + AWS skills
  → Sorted by proficiency (experts first)

Perfect for:
  - Cross-team hiring
  - Project staffing
  - Mentorship matching
  
Try it: Search box in top navigation
```

---

## Search Quality Metrics

### How We Measure Quality

**Metric 1: Relevance (90% target)**
- Users search "Python"
- Results show staff with Python listed
- Misses show staff without Python (false positives)
- Precision = relevant results / total results
- Target: 90% of shown results are relevant

**Metric 2: Recall (70% target)**
- Users search "Python"
- Some staff with Python don't appear (false negatives)
- Recall = found / all relevant
- Target: Find 70% of staff with skill

**Metric 3: Latency (< 100ms)**
- Query execution time measured
- Target: < 100ms for typical search

**Metric 4: User Satisfaction**
- Click-through rate (did user click a result?)
- Search refinement rate (did user rewrite search?)
- Target: 30%+ CTR

### Monitoring

```sql
-- Log searches for analysis
CREATE TABLE search_analytics (
  id UUID PRIMARY KEY,
  query VARCHAR(255),
  results_count INT,
  clicked_result_id UUID,        -- Did user click?
  clicked_at DATETIME,
  user_id UUID,
  created_at DATETIME,
  INDEX (query, created_at)
);

Daily report:
  - Top 10 searches
  - Abandoned searches (no clicks)
  - Search success rate (had relevant results)
```

---

## Skill Canonicalization Process

### Pre-Launch Deduplication

```
Step 1: Extract all current skills
  SELECT DISTINCT skill FROM submission_skills;
  → Result: 500+ skill definitions (with variants)

Step 2: Manual deduplication
  - "Python" + "python" + "PYTHON" → "Python"
  - "ReactJS" + "React.js" + "React" → "React"
  - "AWS Cloud" + "Amazon Web Services" → "AWS Cloud"
  
Step 3: Create canonical list
  INSERT INTO skills_catalog (name, category, aliases)
  VALUES ('Python', 'Backend', '["Py", "Python3"]');
  
Step 4: Migrate old data
  UPDATE submission_skills
  SET skill = 'Python'
  WHERE skill IN ('python', 'PYTHON', 'Py');
```

### Post-Launch Admin Tool

```
Admin sees duplicates: "ReactJS" (5 refs) + "React" (20 refs)

Admin action: Merge "ReactJS" → "React"
  - All skill references updated
  - Audit logged
  - Staff notified? (optional)
  
Result: Single "React" skill (25 refs total)
```

---

## Orchestrator Checklist

### Before Launch

- [ ] **Skill Taxonomy**
  - [ ] Canonical list created (~200-300 skills)
  - [ ] Categories assigned (Backend, Frontend, etc.)
  - [ ] Aliases created (for typo/fuzzy matching)
  - [ ] Deduplication complete (no "Python" + "python")
  
- [ ] **Database**
  - [ ] Full-text index created on skill_name
  - [ ] Search queries < 100ms (verified)
  - [ ] Indexes optimized (explain plan good)
  
- [ ] **APIs**
  - [ ] Search endpoint implemented (GET /api/skills/search)
  - [ ] Autocomplete endpoint implemented
  - [ ] Staff matching endpoint implemented
  - [ ] All return correct results + ranking
  
- [ ] **Frontend**
  - [ ] Search input with autocomplete
  - [ ] Results displayed clearly
  - [ ] Filters (category, proficiency) working
  - [ ] Responsive design (mobile friendly)
  
- [ ] **Quality**
  - [ ] Search quality tests passed (90% relevant)
  - [ ] Edge cases tested (typos, special chars)
  - [ ] Performance verified (< 100ms)
  - [ ] Concurrent load tested (100+ simultaneous)
  
- [ ] **Monitoring**
  - [ ] Search analytics logging enabled
  - [ ] Dashboard showing search metrics
  - [ ] Alerts set (slow queries, high error rate)
  
- [ ] **Documentation**
  - [ ] User guide written
  - [ ] Search tips & tricks documented
  - [ ] Admin guide (skill merging) written

### Launch Day

**T-4 hours:**
- [ ] Staging validation (search working)
- [ ] Canonical list complete
- [ ] Monitoring dashboard open

**T-2 hours:**
- [ ] Feature flag ready (disabled by default)
- [ ] On-call engineer aware

**T (Deploy):**
- [ ] Feature flag: SKILL_SEARCH_ENABLED=true
- [ ] Monitor error rate (should be 0)
- [ ] Monitor latency (should be < 100ms)
- [ ] Monitor search success (relevant results showing)

**T+1 hour:**
- [ ] Spot-check: Search "Python" → find Python staff?
- [ ] Spot-check: Autocomplete shows suggestions
- [ ] Spot-check: Filters work

**T+24 hours:**
- [ ] Review search analytics (how many searches? success rate?)
- [ ] Declare launch successful

---

## Contingency Plans

### If Search Too Slow (> 200ms)

1. Check MySQL slow log (which query is slow?)
2. Verify full-text index exists + is used
3. **Options:**
   - Increase MySQL sort buffer
   - Implement query caching (Redis)
   - Migrate to Elasticsearch (longer-term)

### If Skill Duplicates Confuse Results

1. Review deduplication (are skills properly merged?)
2. Admin use merge tool to consolidate
3. Re-run search (should find consolidated skill)
4. Improve alias list (prevent future duplicates)

### If Fuzzy Matching Suggests Wrong Skills

1. Review Levenshtein distance threshold
2. Reduce complexity (be more conservative)
3. Test manually: "Pyton" should suggest "Python" (1 char difference)
4. "Pyton" shouldn't suggest "C++" (too different)

### If No Results for Valid Query

1. User searched "Python" but no results
2. Check if skill in canonical list (might be misspelled "Pyton")
3. Expand query (search by alias): "Py" → "Python"
4. Add to spell-checker suggestions: "Did you mean: Python?"

### If Performance Degrades Over Time

1. Monitor index size (MySQL FTS index growing)
2. If > 100MB: Plan migration to Elasticsearch
3. Until migration: Optimize queries, add caching
4. Monitor at 5K+ skills (trigger for migration planning)

