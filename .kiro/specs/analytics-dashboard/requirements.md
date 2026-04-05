# Analytics Dashboard — Requirements

## Feature Overview
Add a visual analytics dashboard to the Staff View page displaying key statistics about skills, certifications, projects, and departmental composition using ApexCharts for interactive visualizations.

---

## User Stories

### 1. Skills Distribution Chart
**As an** HR or Admin user  
**I want** to see a visual chart showing which skills are most common among staff  
**So that** I can identify skill gaps and plan training or hiring accordingly.

**Acceptance Criteria (EARS):**
- Given I access the Staff View page, When the page loads, Then a \"Top Skills\" bar chart displays showing the 10 most common skills
- Given the skills chart loads, When I view it, Then each skill shows the count of staff who have that skill
- Given I hover over a skill bar, When the chart shows a tooltip, Then it displays: Skill Name, Staff Count, Percentage of total staff
- Given new staff skills are submitted, When the page refreshes, Then the chart updates to reflect latest skill counts

### 2. Certification Status Overview
**As an** HR manager  
**I want** to see a pie chart showing the breakdown of certified vs. non-certified staff  
**So that** I can assess the overall certification status of the team.

**Acceptance Criteria (EARS):**
- Given I view the dashboard, When the page loads, Then a \"Certification Status\" pie chart appears showing: Certified, Not Certified, and No Certifications
- Given the pie chart displays, When I hover over a slice, Then I see: Status Type, Staff Count, Percentage
- Given certification data changes, When I refresh the page, Then the pie chart updates with new percentages
- Given I want to filter by department, When certification data is available, Then I can see drill-down capability (future enhancement)

### 3. Department Headcount Distribution
**As an** organizational leader  
**I want** to see a breakdown of staff count by department  
**So that** I can understand team sizes and resource allocation.

**Acceptance Criteria (EARS):**
- Given I access Staff View, When the dashboard loads, Then a \"Staff by Department\" chart displays showing department names and headcount
- Given department data is displayed, When I view the chart, Then sorting is possible by: Headcount (descending), Department name (A-Z)
- Given I hover over a department bar, When tooltip shows, Then it displays: Department Name, Staff Count, Percentage of total
- Given staff are added to new departments, When the page refreshes, Then new departments appear in the chart

### 4. Project Assignment Status
**As a** Coordinator  
**I want** to see a visual breakdown of staff project assignments (Assigned vs. Unassigned)  
**So that** I can identify available staff for upcoming projects.

**Acceptance Criteria (EARS):**
- Given I view the dashboard, When it loads, Then a \"Project Assignment Status\" chart shows: Assigned to Projects, Unassigned
- Given assignment data displays, When I hover over chart elements, Then tooltip shows: Status, Staff Count, Percentage
- Given projects are added/removed, When the page refreshes, Then chart updates to reflect current assignments
- Given I want trend analysis, When historical data is tracked, Then I can see monthly trends (future enhancement)

### 5. Dashboard Layout & Responsiveness
**As a** user on desktop or mobile  
**I want** the dashboard charts to be responsive and readable  
**So that** I can view analytics on any device.

**Acceptance Criteria (EARS):**
- Given I view the dashboard on desktop (1920x1080), When charts load, Then they are displayed in a 2x2 grid layout
- Given I view the dashboard on tablet (768px width), When the page loads, Then charts stack to 2 columns
- Given I view on mobile (320px width), When charts display, Then they stack to 1 column and are vertically scrollable
- Given charts are displayed, When I interact (hover/click), Then touch interactions work on mobile devices

### 6. Dashboard Data Loading State
**As a** user viewing the dashboard  
**I want** to see loading indicators while data is fetched  
**So that** I know the dashboard is working and not frozen.

**Acceptance Criteria (EARS):**
- Given I access Staff View page, When data is fetching, Then a loading spinner or skeleton appears
- Given the spinner displays, When data loading completes, Then spinner disappears and charts render
- Given an error occurs fetching data, When the error is handled, Then an error message displays (optional: \"Unable to load analytics\")
- Given the page loads, When all data arrives, Then no jank or layout shift occurs

---

## Detailed Requirements

### Charts & Metrics

| Chart | Type | Data Source | Segments/Bars | Refresh Interval |
|-------|------|-------------|---|---|
| Top Skills | Bar Chart (Horizontal) | skill_submissions | 10 most common skills | On page load |
| Certification Status | Pie Chart | staff + certifications | Certified / Not Certified | On page load |
| Staff by Department | Bar Chart (Vertical) | staff table | All departments | On page load |
| Project Assignment | Pie/Donut Chart | staff_projects + staff | Assigned / Unassigned | On page load |

### Layout Grid
- **Desktop (>1024px)**: 2 columns × 2 rows (4 charts)
- **Tablet (768px-1024px)**: 2 columns × 2 rows (responsive)
- **Mobile (<768px)**: 1 column (stack vertically)
- **Chart Height**: 300-400px (adjustable based on content)

### Color Scheme
- Primary Skill Color: #0d47a1 (blue)
- Certification Certified: #1b5e20 (green)
- Certification Not Certified: #d32f2f (red)
- Department Colors: Auto-generated from palette (10+ colors for distinct departments)
- Chart Background: Transparent (inherit page background)

### Data Aggregation
- Skills: Count distinct staff per skill (from skill_submissions GROUP BY)
- Certifications: Count staff with >0 certifications vs. none
- Departments: Count distinct staff per department (from staff table)
- Projects: Count staff with >= 1 project vs. none

---

## Non-Functional Requirements

- **Performance**: Dashboard data loads in <1 second (cached or optimized queries)
- **Browser Support**: Chrome, Firefox, Safari, Edge (latest 2 versions)
- **Accessibility**: Charts have ARIA labels, color choices WCAG AA contrast compliant
- **Responsiveness**: No horizontal scrolling on mobile; vertical scroll only
- **Chart Library**: ApexCharts v3.x (lightweight, responsive, no jQuery dependency)
- **Data Freshness**: Updated on page load; no live real-time updates in v1.0

---

## Assumptions & Constraints

- Charts display summary data (no drill-down in initial release)
- Historical trend analysis deferred to future release
- No export charts as image functionality in v1.0
- Dashboard visible to Admin, HR, Coordinator roles only (Staff/Sales/SA see summary only or N/A)
- Single database snapshot per page load (not real-time updates)
- No user role customization of dashboard layout (fixed for all admins/HR)
