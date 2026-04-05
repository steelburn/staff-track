# Analytics Dashboard — Implementation Tasks

---

## Task 1: Backend Analytics API Routes
- [ ] 1.1 Create `backend/src/routes/analytics.js`
  - [ ] Implement GET /api/analytics/top-skills endpoint
    - [ ] Query skill_submissions grouped by skill_name
    - [ ] Count distinct staff_id per skill
    - [ ] Return top 10 (configurable limit)
    - [ ] Apply requireRole middleware ('admin', 'hr', 'coordinator')
  
  - [ ] Implement GET /api/analytics/certifications endpoint
    - [ ] Query staff left joined with certifications
    - [ ] Count staff with certifications vs. without
    - [ ] Return status and count
    - [ ] Group into \"Certified\" and \"No Certification\"
  
  - [ ] Implement GET /api/analytics/departments endpoint
    - [ ] Query staff table grouped by department
    - [ ] Count staff per department
    - [ ] Return all departments with counts
    - [ ] Order by count descending
  
  - [ ] Implement GET /api/analytics/project-status endpoint
    - [ ] Query staff with left join to staff_projects
    - [ ] Count assigned (has project) vs. unassigned
    - [ ] Return status and count for each

- [ ] 1.2 Add error handling to all endpoints
  - [ ] Return 500 with error message on query failure
  - [ ] Return 403 if user role not permitted
  - [ ] Handle NULL/empty data gracefully

- [ ] 1.3 Register analytics routes in backend/src/index.js
  - [ ] Import analytics router
  - [ ] Mount at /api/analytics

**Acceptance Criteria:**
- _Requirements: 1, 2, 3, 4_
- All 4 endpoints return correct JSON format
- Data accuracy verified (counts match submissions)
- Role-based access control enforced
- Error handling works for invalid queries

---

## Task 2: Database Index Optimization (Analytics)
- [ ] 2.1 Create or verify indexes for analytics queries
  - [ ] Index on skill_submissions(skill_name) for skills query
  - [ ] Index on staff(department) for department grouping
  - [ ] Index on staff_projects(staff_id) for assignment grouping
  - [ ] Index on certifications(staff_id) for certification counts
  
- [ ] 2.2 Verify query performance
  - [ ] Run EXPLAIN QUERY PLAN on all 4 analytics queries
  - [ ] Confirm queries use indexes
  - [ ] Test with realistic data (1000+ staff)
  - [ ] Measure response time <500ms per endpoint

**Acceptance Criteria:**
- _Requirements: Non-Functional_
- Indexes created and active
- Analytics endpoints respond in <500ms
- No full table scans in query plans

---

## Task 3: ApexCharts Integration & Setup
- [ ] 3.1 Add ApexCharts to project
  - [ ] Option A: Include CDN link in public/index.html or public/staff-view.html
    - [ ] Add: `<script src=\"https://cdn.jsdelivr.net/npm/apexcharts\"></script>`
  - [ ] Option B: Install via npm: `npm install apexcharts`
    - [ ] Import in staff-view.js: `import ApexCharts from 'apexcharts'`

- [ ] 3.2 Create dashboard container in staff-view.html
  - [ ] Add div#analyticsDashboard (initially hidden)
  - [ ] Add 4 child divs: #skillsChart, #certificationChart, #departmentChart, #projectStatusChart
  - [ ] Apply CSS grid layout (2x2 on desktop, responsive)

- [ ] 3.3 Add CSS styling for dashboard
  - [ ] Chart container styling (background, border, padding, height)
  - [ ] Grid layout (desktop: 2 columns; tablet: 2; mobile: 1)
  - [ ] Match Dark Premium theme colors
  - [ ] Responsive media queries

**Acceptance Criteria:**
- _Requirements: 5, 6_
- ApexCharts library loaded
- Dashboard container rendered
- Layout responsive on all breakpoints

---

## Task 4: Frontend Dashboard Initialization
- [ ] 4.1 Create `initializeAnalyticsDashboard()` function in staff-view.js
  - [ ] Check user role from localStorage
  - [ ] Hide dashboard if user is staff/sales/sa_presales/coordinator
  - [ ] Show dashboard if user is admin/hr
  - [ ] Fetch all 4 analytics endpoints in parallel with Promise.all()
  - [ ] Handle fetch errors gracefully

- [ ] 4.2 Add role-based visibility
  - [ ] Dashboard visible for: admin, hr, coordinator roles only
  - [ ] Dashboard hidden for: staff, sales, sa_presales roles
  - [ ] Log visibility decision to console (optional)

- [ ] 4.3 Call initializeAnalyticsDashboard on page load
  - [ ] Add to DOMContentLoaded event listener
  - [ ] Or call after existing staff-view initialization
  - [ ] Ensure dashboard initializes before staff list rendering

**Acceptance Criteria:**
- _Requirements: 6_
- Dashboard shows for permitted roles
- Dashboard hides for non-permitted roles
- All 4 API calls complete successfully

---

## Task 5: Skills Chart Implementation
- [ ] 5.1 Create `renderSkillsChart(skills)` function in staff-view.js
  - [ ] Accept array of {name, count} objects from API
  - [ ] Configure ApexCharts bar chart (horizontal orientation)
  - [ ] Set series data from skills array
  - [ ] Set xaxis categories to skill names
  - [ ] Render in #skillsChart container

- [ ] 5.2 Configure chart styling
  - [ ] Set colors: primary skill color #0d47a1
  - [ ] Configure tooltip: show skill name and staff count
  - [ ] Set theme: dark mode
  - [ ] Disable data labels on bars
  - [ ] Customize x/y axis label colors (#999)

- [ ] 5.3 Handle data edge cases
  - [ ] If no skills: show empty state
  - [ ] If <10 skills: display all available
  - [ ] Ensure chart responsive (adapts to container size)

**Acceptance Criteria:**
- _Requirements: 1_
- Top skills chart displays correctly
- Bars labeled with skill names
- Tooltip shows skill and staff count
- Responsive on all screen sizes

---

## Task 6: Certification Status Chart Implementation
- [ ] 6.1 Create `renderCertificationChart(certifications)` function
  - [ ] Accept array of {status, count} objects from API
  - [ ] Configure ApexCharts pie chart
  - [ ] Set series data from counts
  - [ ] Set labels to status values

- [ ] 6.2 Configure chart styling
  - [ ] Certified color: #1b5e20 (green)
  - [ ] Not Certified color: #d32f2f (red)
  - [ ] Configure legend: position right, dark theme
  - [ ] Tooltip shows status and count
  - [ ] Responsive on mobile

**Acceptance Criteria:**
- _Requirements: 2_
- Pie chart shows certified vs. not certified breakdown
- Colors distinguish status clearly
- Legend displays status labels
- Tooltip accurate

---

## Task 7: Department Chart Implementation
- [ ] 7.1 Create `renderDepartmentChart(departments)` function
  - [ ] Accept array of {department, count} objects
  - [ ] Configure ApexCharts bar chart (vertical)
  - [ ] Set series data from counts
  - [ ] Set xaxis categories to department names

- [ ] 7.2 Configure chart styling
  - [ ] Distributed colors: use 10-color palette for variety
  - [ ] Rotate x-axis labels -45 degrees for readability
  - [ ] Tooltip shows department and count
  - [ ] Dark theme
  - [ ] Responsive: adjust label rotation on mobile

- [ ] 7.3 Handle edge cases
  - [ ] If no departments: show unknown/empty
  - [ ] If >10 departments: display all with auto-coloring
  - [ ] Handle long department names (abbreviate if needed)

**Acceptance Criteria:**
- _Requirements: 3_
- Bar chart shows all departments with counts
- Colors distinguish departments
- X-axis labels readable
- Responsive layout

---

## Task 8: Project Assignment Chart Implementation
- [ ] 8.1 Create `renderProjectChart(assignments)` function
  - [ ] Accept array of {status, count} objects
  - [ ] Configure ApexCharts donut chart
  - [ ] Set series data from counts
  - [ ] Set labels to status values

- [ ] 8.2 Configure chart styling
  - [ ] Assigned color: #0d47a1 (blue)
  - [ ] Unassigned color: #9e9e9e (gray)
  - [ ] Legend position: right
  - [ ] Tooltip shows status and count
  - [ ] Dark theme

**Acceptance Criteria:**
- _Requirements: 4_
- Donut chart shows assigned vs. unassigned breakdown
- Colors intuitive (assigned=blue, unassigned=gray)
- Legend clear
- Tooltip accurate

---

## Task 9: Loading States & Error Handling
- [ ] 9.1 Add loading indicator to dashboard
  - [ ] Show spinner/skeleton while fetching data
  - [ ] Hide spinner when all data loaded
  - [ ] Style: Dark theme, center-aligned

- [ ] 9.2 Add error handling
  - [ ] Catch fetch errors for each endpoint
  - [ ] Log errors to console
  - [ ] Show error message: \"Unable to load analytics\" (optional)
  - [ ] Don't crash page if analytics fails

- [ ] 9.3 Handle slow networks
  - [ ] Set reasonable timeout (5 seconds)
  - [ ] Show partial data if one endpoint fails
  - [ ] Don't block staff list rendering

**Acceptance Criteria:**
- _Requirements: 6_
- Loading spinner appears during data fetch
- Spinner disappears when charts render
- Errors don't block page functionality

---

## Task 10: Responsive Design & Mobile Testing
- [ ] 10.1 Verify responsive grid layout
  - [ ] Desktop (>1024px): 2x2 grid layout
  - [ ] Tablet (768px-1024px): 2x2 grid (responsive width)
  - [ ] Mobile (<768px): 1 column (vertical stack)
  - [ ] No horizontal scrolling on mobile

- [ ] 10.2 Test on actual devices/browsers
  - [ ] Desktop: Chrome, Firefox, Safari, Edge
  - [ ] Tablet: iPad, Android tablet
  - [ ] Mobile: iPhone, Android phone
  - [ ] Verify charts render correctly at all sizes
  - [ ] Verify touch interactions work (hover → tap on mobile)

- [ ] 10.3 Chart responsiveness
  - [ ] Reduce chart height on mobile (300px vs 400px)
  - [ ] Adjust font sizes for readability on small screens
  - [ ] Rotate axis labels only when needed

**Acceptance Criteria:**
- _Requirements: 5_
- Grid layout responsive across breakpoints
- No horizontal scrolling on any device
- Charts readable on mobile (appropriate font sizes)
- Touch interactions work on mobile

---

## Task 11: Role-Based Access Control
- [ ] 11.1 Apply middleware to analytics endpoints
  - [ ] GET /api/analytics/top-skills: requireRole('admin', 'hr', 'coordinator')
  - [ ] GET /api/analytics/certifications: requireRole('admin', 'hr', 'coordinator')
  - [ ] GET /api/analytics/departments: requireRole('admin', 'hr', 'coordinator')
  - [ ] GET /api/analytics/project-status: requireRole('admin', 'hr', 'coordinator')

- [ ] 11.2 Frontend role check
  - [ ] Check user role before initializing dashboard
  - [ ] Only fetch analytics if role permitted
  - [ ] Hide dashboard UI for non-permitted users

**Acceptance Criteria:**
- _Requirements: Non-Functional (Security)_
- Unauthorized users get 403 on API
- Dashboard hidden for unauthorized roles
- Console logs show visibility decision

---

## Task 12: Testing & Validation
- [ ] 12.1 Unit test: API endpoints
  - [ ] /api/analytics/top-skills returns correct skill counts
  - [ ] /api/analytics/certifications returns correct status breakdown
  - [ ] /api/analytics/departments returns correct department counts
  - [ ] /api/analytics/project-status returns correct assignment counts

- [ ] 12.2 Integration test: Dashboard rendering
  - [ ] Admin user accesses staff-view, dashboard renders
  - [ ] HR user accesses staff-view, all 4 charts render
  - [ ] Coordinator user accesses staff-view, dashboard visible
  - [ ] All charts render with correct data

- [ ] 12.3 E2E test: Full workflow
  - [ ] Admin logs in, navigates to Staff View
  - [ ] Dashboard loads with all 4 charts
  - [ ] Hover over chart elements shows tooltips
  - [ ] Staff user logs in, dashboard hidden
  - [ ] Responsive test: Resize window, layout adjusts

**Acceptance Criteria:**
- _Requirements: 1, 2, 3, 4, 5_
- All unit tests pass
- Integration tests pass
- E2E workflow completes without errors

---

## Task 13: Documentation & Polish
- [ ] 13.1 Document analytics API endpoints
  - [ ] Add to API documentation (README or separate doc)
  - [ ] Document query parameters and response format
  - [ ] Include example responses

- [ ] 13.2 Add code comments
  - [ ] Comment analytics.js route handlers
  - [ ] Document chart rendering functions in staff-view.js
  - [ ] Add function docstrings

**Acceptance Criteria:**
- _Requirements: 1_
- API endpoints documented
- Code well-commented
- Examples provided for each endpoint

---

## Dependencies
- Task 1 (API) must complete before Task 4 (Frontend)
- Task 3 (ApexCharts) must complete before Tasks 5-8 (Chart rendering)
- Task 9 (Error handling) should integrate with Task 4
- Task 10 (Responsive) should integrate with Task 3
- Task 11 (RBAC) should integrate with Task 1

## Traceability
- _Requirements: 1 (Skills chart), 2 (Certification chart), 3 (Department chart), 4 (Project assignment), 5 (Responsive), 6 (Loading states)_
