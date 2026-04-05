# Analytics Dashboard — Technical Design

## Architecture Overview

The Analytics Dashboard integrates ApexCharts into the Staff View page, displaying pre-aggregated statistics from the database via API endpoints. Charts are rendered client-side with data fetched on page load.

### System Layers

```
┌──────────────────────────────────────────┐
│     Frontend: ApexCharts Visualization    │  Renders charts from data
├──────────────────────────────────────────┤
│   Chart Service: Data Formatting          │  Transforms API data to chart format
├──────────────────────────────────────────┤
│    API Layer: Analytics Endpoints         │  /api/analytics/* endpoints
├──────────────────────────────────────────┤
│       Database: Aggregation Queries       │  GROUP BY, COUNT operations
└──────────────────────────────────────────┘
```

---

## Technology Stack

### Frontend
- **Chart Library**: ApexCharts v3.x
- **Installation**: `npm install apexcharts` (or CDN link)
- **Integration**: Script in `public/index.html` and `public/staff-view.js`

### Backend
- **Framework**: Existing Express.js setup
- **Routes**: New `backend/src/routes/analytics.js`
- **Database**: SQLite queries with GROUP BY aggregation

---

## Database Queries

### Query 1: Top 10 Skills

```sql
SELECT 
  skill_name,
  COUNT(DISTINCT staff_id) as count
FROM skill_submissions
WHERE skill_name IS NOT NULL AND skill_name != ''
GROUP BY skill_name
ORDER BY count DESC
LIMIT 10;
```

### Query 2: Certification Status

```sql
SELECT 
  CASE 
    WHEN COUNT(*) = 0 THEN 'No Certification'
    WHEN COUNT(*) > 0 THEN 'Certified'
  END as status,
  COUNT(DISTINCT s.id) as count
FROM staff s
LEFT JOIN certifications c ON s.id = c.staff_id
GROUP BY (CASE WHEN c.id IS NULL THEN 'No' ELSE 'Yes' END)
ORDER BY count DESC;
```

### Query 3: Staff by Department

```sql
SELECT 
  COALESCE(department, 'Unknown') as department,
  COUNT(*) as count
FROM staff
GROUP BY department
ORDER BY count DESC;
```

### Query 4: Project Assignment Status

```sql
SELECT 
  CASE 
    WHEN sp.staff_id IS NOT NULL THEN 'Assigned'
    ELSE 'Unassigned'
  END as status,
  COUNT(DISTINCT s.id) as count
FROM staff s
LEFT JOIN staff_projects sp ON s.id = sp.staff_id
GROUP BY (sp.staff_id IS NOT NULL)
ORDER BY count DESC;
```

---

## API Design

### Endpoint: Analytics - Top Skills

**GET /api/analytics/top-skills?limit=10**

**Response (200 OK):**
```json
{
  "skills": [
    { "name": "React", "count": 47 },
    { "name": "JavaScript", "count": 42 },
    { "name": "Node.js", "count": 38 },
    { "name": "Python", "count": 35 },
    { "name": "Java", "count": 33 },
    { "name": "SQL", "count": 30 },
    { "name": "AWS", "count": 28 },
    { "name": "Docker", "count": 25 },
    { "name": "TypeScript", "count": 23 },
    { "name": "GraphQL", "count": 20 }
  ]
}
```

### Endpoint: Analytics - Certification Status

**GET /api/analytics/certifications**

**Response (200 OK):**
```json
{
  "certifications": [
    { "status": "Certified", "count": 145 },
    { "status": "Not Certified", "count": 85 },
    { "status": "No Certification", "count": 70 }
  ]
}
```

### Endpoint: Analytics - Staff by Department

**GET /api/analytics/departments**

**Response (200 OK):**
```json
{
  "departments": [
    { "department": "Engineering", "count": 95 },
    { "department": "Product", "count": 42 },
    { "department": "Sales", "count": 38 },
    { "department": "Marketing", "count": 28 },
    { "department": "Operations", "count": 22 },
    { "department": "HR", "count": 15 }
  ]
}
```

### Endpoint: Analytics - Project Assignment

**GET /api/analytics/project-status**

**Response (200 OK):**
```json
{
  "assignments": [
    { "status": "Assigned", "count": 220 },
    { "status": "Unassigned", "count": 60 }
  ]
}
```

---

## Backend Implementation

### File: `backend/src/routes/analytics.js`

```javascript
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/authMiddleware');

// GET /api/analytics/top-skills
router.get('/top-skills',
  requireRole('admin', 'hr', 'coordinator'),
  (req, res) => {
    const { limit = 10 } = req.query;

    try {
      const skills = db.prepare(`
        SELECT 
          skill_name as name,
          COUNT(DISTINCT staff_id) as count
        FROM skill_submissions
        WHERE skill_name IS NOT NULL AND skill_name != ''
        GROUP BY skill_name
        ORDER BY count DESC
        LIMIT ?
      `).all(limit);

      res.json({ skills });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/analytics/certifications
router.get('/certifications',
  requireRole('admin', 'hr', 'coordinator'),
  (req, res) => {
    try {
      const query = `
        SELECT 
          CASE 
            WHEN cert_count > 0 THEN 'Certified'
            ELSE 'No Certification'
          END as status,
          COUNT(*) as count
        FROM (
          SELECT s.id, COUNT(c.id) as cert_count
          FROM staff s
          LEFT JOIN certifications c ON s.id = c.staff_id
          GROUP BY s.id
        ) grouped
        GROUP BY (cert_count > 0)
        ORDER BY count DESC
      `;

      const certifications = db.prepare(query).all();

      res.json({ certifications });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/analytics/departments
router.get('/departments',
  requireRole('admin', 'hr', 'coordinator'),
  (req, res) => {
    try {
      const departments = db.prepare(`
        SELECT 
          COALESCE(department, 'Unknown') as department,
          COUNT(*) as count
        FROM staff
        GROUP BY department
        ORDER BY count DESC
      `).all();

      res.json({ departments });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/analytics/project-status
router.get('/project-status',
  requireRole('admin', 'hr', 'coordinator'),
  (req, res) => {
    try {
      const assignments = db.prepare(`
        SELECT 
          CASE 
            WHEN sp.staff_id IS NOT NULL THEN 'Assigned'
            ELSE 'Unassigned'
          END as status,
          COUNT(DISTINCT s.id) as count
        FROM staff s
        LEFT JOIN staff_projects sp ON s.id = sp.staff_id
        GROUP BY (sp.staff_id IS NOT NULL)
        ORDER BY count DESC
      `).all();

      res.json({ assignments });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
```

### File: `backend/src/index.js` (Update)

```javascript
const analyticsRoutes = require('./routes/analytics');
app.use('/api/analytics', analyticsRoutes);
```

---

## Frontend Implementation

### File: `public/staff-view.html` (Update)

```html
<!-- Add ApexCharts CDN in <head> -->
<script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>

<!-- Add dashboard container in <body>, before existing staff list -->
<div id="analyticsDashboard" style="display: none;">
  <h2>Analytics Dashboard</h2>
  <div class="charts-grid">
    <div id="skillsChart" class="chart-container"></div>
    <div id="certificationChart" class="chart-container"></div>
    <div id="departmentChart" class="chart-container"></div>
    <div id="projectStatusChart" class="chart-container"></div>
  </div>
</div>

<style>
  .charts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 30px;
  }

  .chart-container {
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 15px;
    height: 400px;
  }

  @media (max-width: 1024px) {
    .charts-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 768px) {
    .chart-container {
      height: 300px;
    }
  }

  #analyticsDashboard h2 {
    color: #fff;
    margin-bottom: 20px;
  }
</style>
```

### File: `public/staff-view.js` (Update)

```javascript
let analyticsCharts = {};

// Initialize dashboard on page load
async function initializeAnalyticsDashboard() {
  const userRole = localStorage.getItem('userRole');
  
  // Only show dashboard to admin/hr/coordinator
  if (!['admin', 'hr', 'coordinator'].includes(userRole)) {
    document.getElementById('analyticsDashboard').style.display = 'none';
    return;
  }

  document.getElementById('analyticsDashboard').style.display = 'block';

  try {
    // Fetch all analytics data in parallel
    const [skillsData, certData, deptData, projectData] = await Promise.all([
      fetch('/api/analytics/top-skills').then(r => r.json()),
      fetch('/api/analytics/certifications').then(r => r.json()),
      fetch('/api/analytics/departments').then(r => r.json()),
      fetch('/api/analytics/project-status').then(r => r.json())
    ]);

    // Render charts
    renderSkillsChart(skillsData.skills);
    renderCertificationChart(certData.certifications);
    renderDepartmentChart(deptData.departments);
    renderProjectChart(projectData.assignments);
  } catch (err) {
    console.error('Failed to load analytics:', err);
    // Show error message (optional)
  }
}

function renderSkillsChart(skills) {
  const options = {
    series: [{
      data: skills.map(s => s.count)
    }],
    chart: {
      type: 'bar',
      height: '100%',
      background: 'transparent'
    },
    plotOptions: {
      bar: {
        horizontal: true,
        dataLabels: { enabled: false }
      }
    },
    xaxis: {
      categories: skills.map(s => s.name),
      labels: { style: { colors: '#999', fontSize: '12px' } }
    },
    yaxis: {
      labels: { style: { colors: '#999', fontSize: '11px' } }
    },
    tooltip: {
      enabled: true,
      theme: 'dark',
      x: { formatter: (val) => val },
      y: { formatter: (val) => `${val} staff` }
    }
  };

  const chart = new ApexCharts(document.querySelector('#skillsChart'), options);
  analyticsCharts.skills = chart;
  chart.render();
}

function renderCertificationChart(certifications) {
  const options = {
    series: certifications.map(c => c.count),
    chart: {
      type: 'pie',
      height: '100%',
      background: 'transparent'
    },
    labels: certifications.map(c => c.status),
    colors: ['#1b5e20', '#d32f2f', '#f57c00'],
    legend: {
      labels: { colors: '#999' },
      position: 'right'
    },
    tooltip: {
      enabled: true,
      theme: 'dark',
      y: { formatter: (val) => `${val} staff` }
    }
  };

  const chart = new ApexCharts(document.querySelector('#certificationChart'), options);
  analyticsCharts.certification = chart;
  chart.render();
}

function renderDepartmentChart(departments) {
  const colors = [
    '#0d47a1', '#1565c0', '#1976d2', '#1e88e5', '#2196f3',
    '#42a5f5', '#64b5f6', '#90caf9', '#bbdefb', '#e3f2fd'
  ];

  const options = {
    series: [{
      data: departments.map(d => d.count)
    }],
    chart: {
      type: 'bar',
      height: '100%',
      background: 'transparent'
    },
    plotOptions: {
      bar: {
        dataLabels: { enabled: false },
        distributed: true
      }
    },
    xaxis: {
      categories: departments.map(d => d.department),
      labels: { style: { colors: '#999', fontSize: '11px' }, rotate: -45 }
    },
    yaxis: {
      labels: { style: { colors: '#999', fontSize: '11px' } }
    },
    colors: colors.slice(0, departments.length),
    tooltip: {
      enabled: true,
      theme: 'dark',
      x: { formatter: (val) => val },
      y: { formatter: (val) => `${val} staff` }
    }
  };

  const chart = new ApexCharts(document.querySelector('#departmentChart'), options);
  analyticsCharts.department = chart;
  chart.render();
}

function renderProjectChart(assignments) {
  const options = {
    series: assignments.map(a => a.count),
    chart: {
      type: 'donut',
      height: '100%',
      background: 'transparent'
    },
    labels: assignments.map(a => a.status),
    colors: ['#0d47a1', '#9e9e9e'],
    legend: {
      labels: { colors: '#999' },
      position: 'right'
    },
    tooltip: {
      enabled: true,
      theme: 'dark',
      y: { formatter: (val) => `${val} staff` }
    }
  };

  const chart = new ApexCharts(document.querySelector('#projectStatusChart'), options);
  analyticsCharts.projectStatus = chart;
  chart.render();
}

// Call on page load
document.addEventListener('DOMContentLoaded', () => {
  initializeAnalyticsDashboard();
  // ... existing staff view initialization
});
```

---

## Performance Optimization

- **Query Caching** (optional): Cache aggregation queries with 5-minute TTL
- **Lazy Loading**: Load charts only if user role permits (check before fetching)
- **API Optimization**: Use indexed columns for GROUP BY queries (skill_name, department)
- **Client-Side Rendering**: Charts render after data arrives (no server-side rendering)

---

## Testing Strategy

### Unit Tests
- API endpoints return correct data structure
- Aggregation queries produce correct counts
- Role-based access control enforced

### Integration Tests
- Dashboard renders when admin/hr/coordinator access staff-view
- Charts initialize with sample data
- API endpoints return data for all 4 endpoints

### E2E Tests
- Admin user accesses staff-view, dashboard displays
- Charts render and are interactive (hover shows tooltips)
- Staff user accesses staff-view, dashboard hidden
- Responsive: Dashboard readable on desktop, tablet, mobile
