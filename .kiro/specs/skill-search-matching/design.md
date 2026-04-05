# Skill Search & Staff Matching — Technical Design

## Architecture Overview

The Skill Search feature provides an advanced search and filtering system for locating staff by skills, departments, and experience levels. It leverages the existing normalized skill data and submission structure.

### System Layers

```
┌──────────────────────────────────────────┐
│    Frontend: Skill Search UI (HTML/CSS)   │  Input filters, result display
├──────────────────────────────────────────┤
│     Search Service Layer (JavaScript)     │  Query building, result formatting
├──────────────────────────────────────────┤
│    Backend API Routes (skill-search.js)   │  Query execution, pagination
├──────────────────────────────────────────┤
│    Database Query Layer (SQLite)          │  Optimized SELECT with JOINs
└──────────────────────────────────────────┘
```

---

## Database Query Design

### Query: Search Staff by Skill with Filters

```sql
SELECT DISTINCT
  s.id,
  s.email,
  s.fullName,
  s.department,
  s.manager,
  GROUP_CONCAT(sk.skill_name || ' (' || COALESCE(sk.years_experience, 0) || 'yrs)', ', ') as skills,
  COUNT(CASE WHEN sk.certification_status = 'certified' THEN 1 END) as certifications_count
FROM staff s
LEFT JOIN skill_submissions sk ON s.id = sk.staff_id
WHERE 
  (LOWER(sk.skill_name) LIKE LOWER('%' || ? || '%'))
  AND (? IS NULL OR s.department = ?)
  AND (? IS NULL OR s.manager = ?)
  AND (? IS NULL OR sk.certification_status = ?)
GROUP BY s.id, s.email, s.fullName, s.department, s.manager
ORDER BY s.fullName
LIMIT ? OFFSET ?;
```

### Index Strategy

```sql
CREATE INDEX idx_skill_name_lower ON skill_submissions(LOWER(skill_name));
CREATE INDEX idx_staff_department ON staff(department);
CREATE INDEX idx_staff_manager ON staff(manager);
CREATE INDEX idx_skill_cert_status ON skill_submissions(certification_status);
```

---

## API Design

### Endpoint: Search Staff by Skills

**GET /api/skills/search?q=react&department=Engineering&manager=John%20Smith&logic=AND**

**Query Parameters:**
- `q` (string, required): Skill name or keyword
- `department` (string, optional): Filter by department
- `manager` (string, optional): Filter by manager name
- `certification` (string, optional): "certified" | "not-certified" | "all"
- `skillLogic` (string, optional): "AND" | "OR" (default: "OR" for single skill)
- `limit` (number, default: 25): Results per page
- `offset` (number, default: 0): Pagination offset
- `sort` (string, optional): "name" | "department" | "experience"

**Response (200 OK):**
```json
{
  "query": "react",
  "total": 47,
  "results": [
    {
      "id": 1,
      "email": "alice.johnson@company.com",
      "fullName": "Alice Johnson",
      "department": "Engineering",
      "manager": "Mark Singh",
      "matchedSkills": [
        { "skill": "React", "years": 5, "certified": true },
        { "skill": "JavaScript", "years": 7, "certified": true }
      ],
      "allSkills": 12,
      "certifications": 5
    },
    {
      "id": 2,
      "email": "bob.martinez@company.com",
      "fullName": "Bob Martinez",
      "department": "Engineering",
      "manager": "Sarah Chen",
      "matchedSkills": [
        { "skill": "React Native", "years": 3, "certified": false }
      ],
      "allSkills": 8,
      "certifications": 2
    }
  ],
  "filters": {
    "applied": ["skill:react", "department:Engineering"],
    "available": {
      "departments": ["Engineering", "Product", "UX", "Sales"],
      "managers": ["Mark Singh", "Sarah Chen", "John Smith"],
      "certifications": ["certified", "not-certified"]
    }
  }
}
```

### Endpoint: Get Available Skills (Autocomplete)

**GET /api/skills/list?limit=10**

**Response (200 OK):**
```json
{
  "skills": [
    { "name": "React", "count": 47 },
    { "name": "JavaScript", "count": 42 },
    { "name": "Node.js", "count": 38 },
    { "name": "Python", "count": 35 },
    { "name": "Java", "count": 33 }
  ]
}
```

### Endpoint: Staff Profile Preview

**GET /api/staff/:id/profile-card**

**Response (200 OK):**
```json
{
  "id": 1,
  "fullName": "Alice Johnson",
  "email": "alice.johnson@company.com",
  "department": "Engineering",
  "title": "Senior Software Engineer",
  "manager": "Mark Singh",
  "skills": [
    { "skill": "React", "years": 5, "certified": true },
    { "skill": "JavaScript", "years": 7, "certified": true },
    { "skill": "Node.js", "years": 4, "certified": true }
  ],
  "recentProjects": [
    { "name": "Mobile App Redesign", "role": "Lead Developer", "end_date": "2025-12-01" },
    { "name": "API Migration", "role": "Developer", "end_date": "2025-09-15" }
  ],
  "cvUrl": "/api/cv/1/view"
}
```

### Endpoint: Export Search Results to CSV

**POST /api/skills/export**

**Request Body:**
```json
{
  "q": "react",
  "department": "Engineering",
  "format": "csv"
}
```

**Response:** CSV file download with Content-Type: text/csv

---

## Backend Implementation

### File: `backend/src/routes/skill-search.js`

```javascript
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/authMiddleware');

// Search staff by skill with filters
router.get('/search', 
  requireRole('admin', 'hr', 'coordinator', 'sa_presales', 'sales'),
  (req, res) => {
    const { q, department, manager, certification, limit = 25, offset = 0, sort = 'name' } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: 'Skill query required' });
    }

    const query = `
      SELECT DISTINCT
        s.id,
        s.email,
        s.fullName,
        s.department,
        s.manager,
        GROUP_CONCAT(DISTINCT sk.skill_name || '|' || COALESCE(sk.years_experience, 0) || '|' || COALESCE(sk.certification_status, 'not-certified')) as skills_data,
        COUNT(DISTINCT CASE WHEN sk.certification_status = 'certified' THEN sk.id END) as certifications_count
      FROM staff s
      LEFT JOIN skill_submissions sk ON s.id = sk.staff_id
      WHERE LOWER(sk.skill_name) LIKE LOWER(?)
        ${department ? 'AND s.department = ?' : ''}
        ${manager ? 'AND s.manager = ?' : ''}
        ${certification ? 'AND sk.certification_status = ?' : ''}
      GROUP BY s.id
      ORDER BY ${sort === 'department' ? 's.department, s.fullName' : 's.fullName'}
      LIMIT ? OFFSET ?
    `;

    const params = [`%${q}%`];
    if (department) params.push(department);
    if (manager) params.push(manager);
    if (certification) params.push(certification);
    params.push(limit, offset);

    try {
      const results = db.prepare(query).all(...params);

      // Format skills data
      const formattedResults = results.map(r => ({
        id: r.id,
        email: r.email,
        fullName: r.fullName,
        department: r.department,
        manager: r.manager,
        matchedSkills: r.skills_data ? r.skills_data.split(',').map(s => {
          const [skill, years, certified] = s.trim().split('|');
          return { skill, years: parseInt(years), certified: certified === 'certified' };
        }) : [],
        certifications: r.certifications_count
      }));

      res.json({
        query: q,
        total: results.length,
        results: formattedResults,
        filters: {
          applied: [
            `skill:${q}`,
            ...(department ? [`department:${department}`] : []),
            ...(manager ? [`manager:${manager}`] : [])
          ]
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Get available skills for autocomplete
router.get('/list', 
  requireRole('admin', 'hr', 'coordinator', 'sa_presales', 'sales'),
  (req, res) => {
    const { limit = 10 } = req.query;

    const query = `
      SELECT skill_name, COUNT(*) as count
      FROM skill_submissions
      WHERE skill_name IS NOT NULL AND skill_name != ''
      GROUP BY skill_name
      ORDER BY count DESC
      LIMIT ?
    `;

    try {
      const skills = db.prepare(query).all(limit);
      res.json({ skills });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
```

---

## Frontend Implementation

### File: `public/skills.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Skill Search - StaffTrack</title>
  <link rel="stylesheet" href="style.css">
  <style>
    .skill-search-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    .search-filters {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr;
      gap: 15px;
      margin-bottom: 20px;
      padding: 15px;
      background: #1e1e1e;
      border-radius: 4px;
    }
    .search-input {
      grid-column: 1 / -1;
    }
    .filter-group {
      display: flex;
      flex-direction: column;
    }
    .filter-group label {
      font-weight: bold;
      margin-bottom: 5px;
    }
    .filter-group input,
    .filter-group select {
      padding: 8px;
      border: 1px solid #444;
      border-radius: 4px;
      background: #2a2a2a;
      color: #fff;
    }
    .results-table {
      width: 100%;
      border-collapse: collapse;
      background: #1e1e1e;
    }
    .results-table th {
      background: #2a2a2a;
      padding: 12px;
      text-align: left;
      font-weight: bold;
      border-bottom: 2px solid #444;
    }
    .results-table td {
      padding: 12px;
      border-bottom: 1px solid #333;
    }
    .results-table tr:hover {
      background: #252525;
    }
    .skill-badge {
      display: inline-block;
      background: #0d47a1;
      color: #fff;
      padding: 3px 8px;
      border-radius: 3px;
      margin-right: 5px;
      font-size: 0.85em;
    }
  </style>
</head>
<body>
  <header>
    <h1>Skill Search</h1>
    <div id="userInfo">
      <span id="userEmail"></span> <span id="userRole"></span>
      <button onclick="logout()">Logout</button>
    </div>
  </header>

  <div class="skill-search-container">
    <div class="search-filters">
      <div class="filter-group search-input">
        <label for="skillInput">Search Skill</label>
        <input type="text" id="skillInput" placeholder="e.g., React, Python, Agile" autocomplete="off">
        <div id="autocompleteDropdown" style="display: none; background: #2a2a2a; border: 1px solid #444; border-top: none;"></div>
      </div>
      <div class="filter-group">
        <label for="departmentFilter">Department</label>
        <select id="departmentFilter">
          <option value="">All Departments</option>
        </select>
      </div>
      <div class="filter-group">
        <label for="managerFilter">Manager</label>
        <select id="managerFilter">
          <option value="">All Managers</option>
        </select>
      </div>
      <div class="filter-group">
        <label for="certificationFilter">Certification</label>
        <select id="certificationFilter">
          <option value="">All</option>
          <option value="certified">Certified Only</option>
          <option value="not-certified">Not Certified</option>
        </select>
      </div>
      <div style="grid-column: 1 / -1; display: flex; gap: 10px;">
        <button id="searchBtn" onclick="performSearch()" style="flex: 1; padding: 10px; background: #0d47a1; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Search</button>
        <button id="clearBtn" onclick="clearFilters()" style="flex: 1; padding: 10px; background: #424242; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Clear Filters</button>
        <button id="exportBtn" onclick="exportResults()" style="flex: 1; padding: 10px; background: #1b5e20; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Export CSV</button>
      </div>
    </div>

    <div id="resultsSummary" style="margin-bottom: 15px;"></div>
    <table id="resultsTable" class="results-table" style="display: none;">
      <thead>
        <tr>
          <th>Name</th>
          <th>Department</th>
          <th>Manager</th>
          <th>Skills</th>
          <th>Certs</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="resultsBody"></tbody>
    </table>
  </div>

  <script src="app.js"></script>
  <script src="skills.js"></script>
</body>
</html>
```

### File: `public/skills.js`

```javascript
let currentResults = [];
let currentQuery = {};

async function performSearch() {
  const skill = document.getElementById('skillInput').value.trim();
  const department = document.getElementById('departmentFilter').value;
  const manager = document.getElementById('managerFilter').value;
  const certification = document.getElementById('certificationFilter').value;

  if (!skill) {
    alert('Please enter a skill to search');
    return;
  }

  const params = new URLSearchParams({
    q: skill,
    ...(department && { department }),
    ...(manager && { manager }),
    ...(certification && { certification }),
    limit: 50
  });

  try {
    const response = await fetch(`/api/skills/search?${params}`);
    const data = await response.json();

    currentResults = data.results;
    currentQuery = { skill, department, manager, certification };

    displayResults(data);
  } catch (err) {
    console.error('Search error:', err);
    alert('Search failed. Please try again.');
  }
}

function displayResults(data) {
  document.getElementById('resultsSummary').textContent = 
    data.total > 0 ? `${data.total} staff member${data.total !== 1 ? 's' : ''} found` : 'No results found';

  if (data.results.length === 0) {
    document.getElementById('resultsTable').style.display = 'none';
    return;
  }

  const tbody = document.getElementById('resultsBody');
  tbody.innerHTML = data.results.map(staff => `
    <tr>
      <td><a href="javascript:showProfilePreview(${staff.id})" style="cursor: pointer; color: #0d47a1;">${staff.fullName}</a></td>
      <td>${staff.department}</td>
      <td>${staff.manager || '-'}</td>
      <td>${staff.matchedSkills.map(s => `<span class="skill-badge">${s.skill}</span>`).join('')}</td>
      <td>${staff.certifications}</td>
      <td>
        <button onclick="generateCV(${staff.id})" style="padding: 5px 10px; background: #0d47a1; color: #fff; border: none; border-radius: 3px; cursor: pointer;">Export CV</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('resultsTable').style.display = 'table';
}

async function showProfilePreview(staffId) {
  const response = await fetch(`/api/staff/${staffId}/profile-card`);
  const profile = await response.json();
  // Show modal with profile details
  alert(`${profile.fullName}\n${profile.department}\n${profile.manager}\n\nSkills: ${profile.skills.map(s => s.skill).join(', ')}`);
}

async function generateCV(staffId) {
  window.location.href = `/api/cv/${staffId}/export?format=pdf`;
}

async function exportResults() {
  if (currentResults.length === 0) {
    alert('No results to export. Please perform a search first.');
    return;
  }

  const csv = [
    ['Name', 'Email', 'Department', 'Manager', 'Skills', 'Certifications'],
    ...currentResults.map(r => [
      r.fullName,
      r.email,
      r.department,
      r.manager || '-',
      r.matchedSkills.map(s => s.skill).join('; '),
      r.certifications
    ])
  ];

  downloadCSV(csv, `skill-search_${currentQuery.skill}_${new Date().toISOString().split('T')[0]}.csv`);
}

function downloadCSV(data, filename) {
  const csv = data.map(row => row.map(cell => `"${cell}"`).join(',')).join('\\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

function clearFilters() {
  document.getElementById('skillInput').value = '';
  document.getElementById('departmentFilter').value = '';
  document.getElementById('managerFilter').value = '';
  document.getElementById('certificationFilter').value = '';
  document.getElementById('resultsTable').style.display = 'none';
  document.getElementById('resultsSummary').textContent = '';
}

// Autocomplete
document.getElementById('skillInput').addEventListener('input', async (e) => {
  if (e.target.value.length < 2) return;

  const response = await fetch(`/api/skills/list?limit=10`);
  const data = await response.json();
  const dropdown = document.getElementById('autocompleteDropdown');
  dropdown.innerHTML = data.skills
    .filter(s => s.name.toLowerCase().includes(e.target.value.toLowerCase()))
    .map(s => `<div style="padding: 8px; cursor: pointer; hover: background #333;" onclick="selectSkill('${s.name}')">${s.name} (${s.count})</div>`)
    .join('');
  dropdown.style.display = dropdown.innerHTML ? 'block' : 'none';
});

function selectSkill(skill) {
  document.getElementById('skillInput').value = skill;
  document.getElementById('autocompleteDropdown').style.display = 'none';
}
```

---

## Security & Performance

- **Prepared Statements**: All SQL queries use parameterized statements to prevent injection
- **Role-Based Access**: All endpoints enforce admin/hr/coordinator/sa_presales/sales roles
- **Data Redaction**: Search results exclude sensitive fields (SSN, salary, internal notes)
- **Query Optimization**: Indexed columns on skill_name, department, manager for <500ms response
- **Result Pagination**: Max 50 results per page to manage memory

---

## Testing Strategy

### Unit Tests
- Skill name matching (exact, partial, case-insensitive)
- Filter logic (AND/OR for multiple skills)
- CSV export formatting

### Integration Tests
- API endpoint returns correct filtered results
- Role-based access control on /api/skills/search
- Autocomplete endpoint returns top 10 skills

### E2E Tests
- User searches for skill, sees results
- User filters by department and exports CSV
- Non-hr/sa-presales users get 403 on skills endpoint
