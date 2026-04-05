# Skill Search & Staff Matching — Implementation Tasks

---

## Task 1: Backend Skill Search API Route
- [ ] 1.1 Create `backend/src/routes/skill-search.js`
  - [ ] Implement GET /api/skills/search endpoint with query params (q, department, manager, certification, limit, offset)
  - [ ] Build SQL query with WHERE clause for skill matching (LIKE with LOWER)
  - [ ] Join staff and skill_submissions tables
  - [ ] Return paginated results with matched skills for each staff member
  - [ ] Include department and manager in response
  - [ ] Handle missing/null skill data gracefully
- [ ] 1.2 Add error handling
  - [ ] Validate q parameter is not empty
  - [ ] Return 400 if skill query missing
  - [ ] Return 500 with error message on database failure
  - [ ] Implement try-catch blocks around db.prepare().all()
- [ ] 1.3 Register route in `backend/src/index.js`
  - [ ] Import skill-search.js router
  - [ ] Mount at /api/skills

**Acceptance Criteria:**
- _Requirements: 1_
- Endpoint returns correct staff records matching skill
- Partial skill matching works (\"React\" matches \"React Native\")
- Filters (department, manager, certification) reduce results correctly
- Response completes in <500ms for large datasets

---

## Task 2: Skill Autocomplete API Endpoint
- [ ] 2.1 Create GET /api/skills/list endpoint in skill-search.js
  - [ ] Query skill_submissions table
  - [ ] GROUP BY skill_name and COUNT occurrences
  - [ ] Order by count DESC (most popular first)
  - [ ] LIMIT to top N skills (default 10)
  - [ ] Return skill name and count
- [ ] 2.2 Add caching (optional optimization)
  - [ ] Cache top skills list with 1-hour TTL
  - [ ] Invalidate cache when new skills are submitted
  - [ ] Return cached list if available

**Acceptance Criteria:**
- _Requirements: 1_
- Endpoint returns top skills with occurrence counts
- Response time <100ms for autocomplete
- Results sorted by popularity

---

## Task 3: Staff Profile Preview API
- [ ] 3.1 Add GET /api/staff/:id/profile-card endpoint (or update existing staff endpoint)
  - [ ] Return full name, email, department, title, manager
  - [ ] List all skills with years and certification status
  - [ ] Include last 3 projects with dates
  - [ ] Return CV access link
  - [ ] Exclude sensitive fields (salary, internal notes)
- [ ] 3.2 Add role-based field filtering
  - [ ] Admin/HR: return all fields
  - [ ] SA/Pre-Sales/Sales: return public fields only (exclude internal notes)
  - [ ] Staff: only allow access to own profile

**Acceptance Criteria:**
- _Requirements: 4_
- Profile card returns all needed display fields
- Role-based filtering works correctly
- Staff cannot access other staff profiles

---

## Task 4: CSV Export Functionality
- [ ] 4.1 Create GET /api/skills/export endpoint
  - [ ] Accept skill query from request body or query params
  - [ ] Execute same search query with no pagination limit
  - [ ] Build CSV format with headers: Name, Email, Department, Manager, Skills, Certifications
  - [ ] Set Content-Type: text/csv
  - [ ] Set Content-Disposition: attachment filename
  - [ ] Return file stream for download
- [ ] 4.2 Implement CSV formatting utility
  - [ ] Escape quotes and commas in values
  - [ ] Join multiple skills with semicolon separator
  - [ ] Include timestamp in filename (e.g., skill-search_React_2026-04-04.csv)
- [ ] 4.3 Add limits and validation
  - [ ] Max 10,000 rows per export
  - [ ] Return 400 if trying to export more
  - [ ] Validate user has export permissions

**Acceptance Criteria:**
- _Requirements: 5_
- CSV file downloads with correct headers
- Filename includes search criteria and date
- All staff data properly formatted in CSV
- Non-HR users cannot export

---

## Task 5: Frontend Skill Search Page
- [ ] 5.1 Create `public/skills.html` UI
  - [ ] Search input field with placeholder (e.g., \"Search skill\")
  - [ ] Department dropdown filter fetched from backend
  - [ ] Manager dropdown filter fetched from backend
  - [ ] Certification status filter (All / Certified / Not Certified)
  - [ ] Search, Clear Filters, and Export CSV buttons
  - [ ] Results table with columns: Name, Department, Manager, Skills, Certs, Actions
  - [ ] Style matching Dark Premium theme from existing CSS

- [ ] 5.2 Implement responsive grid layout
  - [ ] Filters in 4-column grid on desktop
  - [ ] Stack to 1 column on mobile
  - [ ] Search input spans full width
  - [ ] Results table scrollable on mobile

- [ ] 5.3 Add accessibility features
  - [ ] ARIA labels on form fields
  - [ ] Keyboard navigation through results
  - [ ] Focus management in modals
  - [ ] Color contrast passed WCAG AA

**Acceptance Criteria:**
- _Requirements: 1, 2, 3_
- Page layout matches StaffTrack Dark Premium theme
- All filters functional and visually clear
- Mobile-responsive design
- Accessible (keyboard nav, screen reader compatible)

---

## Task 6: Frontend Search & Filtering Logic
- [ ] 6.1 Create `public/skills.js` search script
  - [ ] Fetch available departments on page load
  - [ ] Fetch available managers on page load
  - [ ] Implement performSearch() function (call /api/skills/search with params)
  - [ ] Format and display results in table
  - [ ] Update result count summary
  - [ ] Handle no results case with helpful message
  
- [ ] 6.2 Implement filter functionality
  - [ ] Department filter reduces results
  - [ ] Manager filter reduces results
  - [ ] Certification filter reduces results
  - [ ] Implement clearFilters() to reset all inputs and hide table
  - [ ] Disable Search button if skill query empty

- [ ] 6.3 Implement result interactions
  - [ ] Click staff name to show profile preview modal
  - [ ] \"View Full Profile\" button navigates to staff-view with ID
  - [ ] \"Export CV\" button downloads CV in PDF/DOCX (integrate with existing CV export)
  - [ ] Skill names appear as styled badges in table

**Acceptance Criteria:**
- _Requirements: 1, 2, 3, 4_
- Search button disabled until skill entered
- Filters update results correctly
- Profile preview modal shows all necessary fields
- CV export initiates download

---

## Task 7: Autocomplete Search Feature
- [ ] 7.1 Implement input listener on skill search field in skills.js
  - [ ] Fetch /api/skills/list on input change after 2+ characters
  - [ ] Display dropdown with matching skills and occurrence counts
  - [ ] Sort by popularity (count)
  - [ ] Show max 10 suggestions

- [ ] 7.2 Implement dropdown interaction
  - [ ] Click suggestion fills in search field
  - [ ] Collapse dropdown when suggestion selected
  - [ ] Close dropdown when clicking outside
  - [ ] Keyboard up/down arrow navigation through suggestions
  - [ ] Enter key selects highlighted suggestion

**Acceptance Criteria:**
- _Requirements: 1_
- Autocomplete appears after 2 characters typed
- Suggestions match typed text (case-insensitive)
- Dropdown closes on selection
- Keyboard navigation works

---

## Task 8: Role-Based Access Control
- [ ] 8.1 Apply middleware to skill-search.js endpoints
  - [ ] GET /api/skills/search: requireRole('admin', 'hr', 'coordinator', 'sa_presales', 'sales')
  - [ ] GET /api/skills/list: Same roles
  - [ ] GET /api/staff/:id/profile-card: Same roles

- [ ] 8.2 Add route guards to skills.html
  - [ ] Check user role on page load (from localStorage or /api/auth/me)
  - [ ] Redirect staff users to submission.html if they try to access
  - [ ] Show 403 error message for unauthorized access

- [ ] 8.3 Update menu.js
  - [ ] Ensure skills.html only appears in menu for permitted roles
  - [ ] Hide \"Skill Search\" menu item for staff and coordinator users

**Acceptance Criteria:**
- _Requirements: 1, 2_
- Admin, HR, SA/Pre-Sales, Sales users can access /api/skills/search
- Staff users get 403 Forbidden on api endpoint
- Staff users redirected from skills.html to own pages
- Menu correctly shows/hides Skill Search based on role

---

## Task 9: Database Indexing for Performance
- [ ] 9.1 Create migration script or add to db.js initialization
  - [ ] Create index on skill_submissions(LOWER(skill_name))
  - [ ] Create index on staff(department)
  - [ ] Create index on staff(manager)
  - [ ] Create index on skill_submissions(certification_status)

- [ ] 9.2 Verify query performance
  - [ ] Run EXPLAIN QUERY PLAN on main search query
  - [ ] Confirm <500ms response for 5000+ staff records
  - [ ] Test with realistic data volume in local environment

**Acceptance Criteria:**
- _Requirements: Non-Functional_
- Indexes created and active
- Search response <500ms for large datasets
- Autocomplete response <100ms

---

## Task 10: Testing & Validation
- [ ] 10.1 Unit test skill matching logic
  - [ ] Exact match test (\"React\" = \"React\")
  - [ ] Partial match test (\"Java\" matches \"JavaScript\")
  - [ ] Case-insensitive test (\"react\" = \"REACT\")
  - [ ] Filter logic test (department AND manager)

- [ ] 10.2 Integration test API endpoints
  - [ ] GET /api/skills/search returns correct results
  - [ ] GET /api/skills/list returns top popular skills
  - [ ] GET /api/staff/:id/profile-card returns correct profile
  - [ ] CSV export endpoint returns downloadable file
  - [ ] 403 Forbidden for unauthorized users

- [ ] 10.3 Manual E2E test
  - [ ] Login as SA/Pre-Sales, access Skill Search
  - [ ] Enter skill \"React\", see matching results
  - [ ] Filter by Department \"Engineering\", results narrow
  - [ ] Click staff name, see profile preview
  - [ ] Click \"Export CSV\", file downloads
  - [ ] Verify CSV contains all columns with data

**Acceptance Criteria:**
- _Requirements: 1, 2, 3_
- All unit tests pass
- API endpoints return correct data structures
- E2E workflow completes without errors
- CSV export data is complete and properly formatted

---

## Task 11: Documentation & Polish
- [ ] 11.1 Document new API endpoints in README or API docs
  - [ ] GET /api/skills/search with query params
  - [ ] GET /api/skills/list
  - [ ] GET /api/staff/:id/profile-card
  - [ ] GET /api/skills/export

- [ ] 11.2 Add user guide for Skill Search feature
  - [ ] How to search by skill
  - [ ] How to apply filters
  - [ ] How to generate CVs in bulk
  - [ ] CSV export usage

**Acceptance Criteria:**
- _Requirements: 1_
- API documentation complete
- User guide covers all search features
- Examples provided for filter combinations

---

## Dependencies
- Task 1 (API) must complete before Task 5 (Frontend)
- Task 2 (Autocomplete) should complete by Task 7
- Task 8 (RBAC) should be integrated with Task 1
- Database indexing (Task 9) can run in parallel

## Traceability
- _Requirements: 1 (Skill search), 2 (Multi-skill filtering), 3 (Advanced filters), 4 (Profile preview), 5 (CSV export)_
