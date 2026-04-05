# Skill Search & Staff Matching — Requirements

## Feature Overview
Provide advanced skill-based search and filtering capabilities for HR, SA/Pre-Sales, and Sales personas to quickly identify qualified staff for specific requirements or project needs.

---

## User Stories

### 1. Skill-Based Staff Search
**As an** SA/Pre-Sales or Sales user  
**I want** to search for staff members by entering specific skill names or keywords  
**So that** I can quickly identify who can fulfill tender requirements or client requests.

**Acceptance Criteria (EARS):**
- Given I access the Skill Search page, When I enter a skill name (e.g., "React"), Then I see all staff who have that skill
- Given I search for a skill, When results are returned, Then each result shows: Staff Name, Department, Manager, Years of Experience (in skill), Certification Status
- Given I search for "Java", When results display, Then partially matching skills also appear (e.g., "Java Spring", "JavaScript")
- Given I search from Skill Search page, When no staff match the skill, Then I see "No results" message with suggestion to search different skills
- Given I perform a search, When results display, Then result count is shown (e.g., "12 staff members found")

### 2. Multi-Skill Filtering
**As an** HR user  
**I want** to filter staff by multiple skills simultaneously with AND/OR logic  
**So that** I can find staff who match complex project requirements.

**Acceptance Criteria (EARS):**
- Given I access Skill Search, When I add multiple skills using filter dropdowns, Then I can choose AND (all skills) or OR (any skill) logic
- Given I select skills: React AND Node.js, When I apply filters, Then only staff with BOTH skills are shown
- Given I select skills: "Python" OR "Java", When I apply filters, Then staff with EITHER skill are displayed
- Given I apply multiple filters, When I click "Clear Filters", Then all filters reset and full staff list reappears
- Given I have complex filters applied, When I click "Save Search", Then filters are saved as a named search (optional)

### 3. Advanced Filter Options
**As an** HR or SA/Pre-Sales user  
**I want** to filter staff by department, manager, and certification status  
**So that** I can narrow results to specific organizational units or quality levels.

**Acceptance Criteria (EARS):**
- Given I open the Skill Search page, When I use the Department dropdown, Then I see a list of all departments with staff counts
- Given I filter by Department = "Engineering", When results update, Then only engineering staff matching the skill appear
- Given I filter by Manager, When I select a specific manager, Then only staff under that manager are shown
- Given I filter by Certification = "Certified", When results update, Then only staff with verified certifications display
- Given I apply multiple filters (skill + department + manager), When I click "View Results", Then final count reflects all filters combined

### 4. Staff Profile Preview
**As a** Sales user  
**I want** to click a staff member's name to see a quick preview of their full profile  
**So that** I can evaluate their background before including them in a proposal.

**Acceptance Criteria (EARS):**
- Given search results are displayed, When I click a staff member's name, Then a modal or side panel opens showing: Full name, Email, Department, Manager, All skills with years, Project history (last 3 projects), CV link
- Given I view staff profile preview, When I click "View Full Profile", Then I navigate to their full staff-view.html profile
- Given I view the preview, When I click "Generate CV", Then I can download their CV in PDF or DOCX format
- Given I close the preview modal, When preview closes, Then focus returns to the original search results

### 5. Search Result Export
**As an** HR user  
**I want** to export skill search results to CSV  
**So that** I can share staff lists with managers or include in reports.

**Acceptance Criteria (EARS):**
- Given I have search results displayed, When I click "Export to CSV", Then results are downloaded as a CSV file
- Given I export results, When the CSV opens, Then it includes: Staff Name, Email, Department, Manager, All Matched Skills, Years per Skill, Certification Status
- Given I export filtered results, When the file downloads, Then filename includes search criteria (e.g., `skill-search_React_2026-04-04.csv`)

---

## Detailed Requirements

### Search Algorithm

**Skill Matching Logic:**
- Exact match: "React" matches skill "React"
- Partial match: "Java" matches "Java Spring", "JavaScript", "Java Backend"
- Case-insensitive: "react", "React", "REACT" all match
- Stop-word filtering: Ignore common words if applicable

**Performance Target:**
- Search should return results within 500ms for 5000+ staff
- Autocomplete suggestions within 100ms

### UI Components

**Search Input:**
- Text field with autocomplete dropdown showing popular skills
- Placeholder: "Search by skill (e.g., React, Python, Scrum)"

**Filter Sidebar:**
- Multi-select dropdowns: Department, Manager, Certification Status
- AND/OR toggle for multiple skill selection
- "Clear Filters" button
- "Apply Filters" action button

**Results Table:**
- Columns: Staff Name (clickable), Department, Manager, Primary Skill, Yrs, Certification, Actions
- Actions: View Profile, Generate CV, Export (CSV of individual record)
- Sortable by: Name, Department, Years Exp
- Pagination: Show 25 results per page

---

## Non-Functional Requirements

- **Search Performance**: <500ms response time for up to 5000 staff records
- **Autocomplete**: Show 10 most common skills within 100ms
- **Accessibility**: WCAG 2.1 AA compliant (labels, ARIA, keyboard nav)
- **Responsive**: Mobile-friendly skill search interface
- **Data Privacy**: Search results exclude sensitive fields (salary, internal notes)
- **Browser Support**: Chrome, Firefox, Safari, Edge (latest 2 versions)

---

## Assumptions & Constraints

- Skill data is already normalized in the database (see staff-track schema)
- Staff submissions include timestamped skill entries with proficiency/years
- Manager and Department data is auto-synced from company catalog
- No real-time collaborative filtering or recommendation engine (basic search only)
- CSV export limited to 10,000 rows max
