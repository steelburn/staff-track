# Implementation Playbooks: Step-by-Step Developer Guide

**Purpose:** Detailed, code-level procedures for implementing each of the 5 StaffTrack features.  
**Audience:** Backend, Frontend, Data engineers  
**Format:** Copy-paste ready commands + file structure + test cases + deployment checklist

---

## Table of Contents

1. [Role Model Expansion (RBAC)](#role-model)
2. [beeSuite Staff Catalog Integration](#beesuite)
3. [Analytics Dashboard](#analytics)
4. [CV Export (PDF/DOCX)](#cv-export)
5. [Skill Search & Matching](#skill-search)

---

## 1. Role Model Expansion (RBAC) {#role-model}

### Phase 1: Database Schema & Migrations

**File:** `backend/migrations/0010_role_model_schema.sql`

```sql
-- Users table (new columns)
ALTER TABLE users ADD COLUMN roles JSON DEFAULT NULL;
ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- New tables
CREATE TABLE roles (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE permissions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) UNIQUE NOT NULL,
  resource VARCHAR(50),           -- 'analytics', 'cv', 'reports', 'staff'
  action VARCHAR(50),             -- 'view', 'manage', 'export'
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_resource_action (resource, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE role_permissions (
  role_id INT NOT NULL,
  permission_id INT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  action VARCHAR(100),            -- 'role_assigned', 'role_revoked', 'permission_granted'
  subject_user_id INT,            -- user whose role changed
  old_value JSON,
  new_value JSON,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  KEY idx_subject_user_id (subject_user_id),
  KEY idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default roles
INSERT INTO roles (name, description) VALUES
  ('admin', 'Full system access'),
  ('manager', 'Team management + reporting'),
  ('staff', 'Personal data access'),
  ('recruiter', 'Recruitment + candidate access'),
  ('finance', 'Payroll + reports');

-- Seed core permissions
INSERT INTO permissions (resource, action, name, description) VALUES
  ('analytics', 'view', 'view_analytics', 'View dashboard'),
  ('analytics', 'manage', 'manage_analytics', 'Configure analytics'),
  ('staff', 'view_own', 'view_own_staff', 'View own profile'),
  ('staff', 'view_team', 'view_team_staff', 'View team profiles'),
  ('staff', 'manage_all', 'manage_all_staff', 'Manage all staff'),
  ('cv', 'export', 'export_cv', 'Export CV in any format'),
  ('reports', 'view', 'view_reports', 'View reports');

-- Assign permissions to roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin';  -- Admin gets all permissions

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'manager' AND p.name IN ('view_team_staff', 'view_analytics', 'export_cv');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'staff' AND p.name IN ('view_own_staff', 'export_cv');
```

**Run migration:**
```bash
cd backend
mysql -h $DB_HOST -u $DB_USER -p$DB_PASS < migrations/0010_role_model_schema.sql
```

**Seed default user → role assignments:**
```sql
-- Migrate old system (example: map old_role_id to new roles)
UPDATE users SET roles = JSON_ARRAY(
  CASE old_role_id
    WHEN 1 THEN 'admin'
    WHEN 2 THEN 'manager'
    ELSE 'staff'
  END
) WHERE roles IS NULL;
```

### Phase 2: Backend Implementation

**File:** `backend/src/middleware/authorize.js`

```javascript
const jwt = require('jsonwebtoken');

// Middleware to extract user roles from JWT
function extractUserRoles(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: decoded.sub,
      roles: decoded.roles || [],     // Array: ['admin', 'manager']
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Middleware to check if user has required permissions
function authorizePermission(requiredPermission) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const db = req.app.get('db');

    // Query: does user's roles have this permission?
    const query = `
      SELECT COUNT(*) as count
      FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      JOIN roles r ON rp.role_id = r.id
      WHERE r.name IN (${req.user.roles.map(() => '?').join(',')})
      AND p.name = ?
    `;

    const [result] = await db.execute(query, [...req.user.roles, requiredPermission]);

    if (result[0].count === 0) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: requiredPermission,
        userRoles: req.user.roles,
      });
    }

    next();
  };
}

// Middleware to enforce row-level security (e.g., staff can only view own data)
function authorizeRowAccess(resourceType = 'staff') {
  return async (req, res, next) => {
    const db = req.app.get('db');
    const resourceId = req.params.staffId || req.params.id;
    const userId = req.user.id;

    // Case 1: Admin can access anything
    if (req.user.roles.includes('admin')) {
      return next();
    }

    // Case 2: Manager can access own team
    if (req.user.roles.includes('manager') && resourceType === 'staff') {
      const [rows] = await db.execute(
        'SELECT manager_id FROM users WHERE id = ?',
        [resourceId]
      );
      if (rows[0]?.manager_id === userId) {
        return next();
      }
    }

    // Case 3: User can access own data
    if (resourceId === String(userId)) {
      return next();
    }

    return res.status(403).json({ error: 'Access denied' });
  };
}

module.exports = {
  extractUserRoles,
  authorizePermission,
  authorizeRowAccess,
};
```

**File:** `backend/src/routes/admin.js` (update for role management)

```javascript
const express = require('express');
const router = express.Router();
const { extractUserRoles, authorizePermission } = require('../middleware/authorize');

// POST /api/admin/users/:userId/roles
router.post('/users/:userId/roles', extractUserRoles, authorizePermission('manage_all_staff'), async (req, res) => {
  const { roles } = req.body;  // Array: ['manager', 'recruiter']
  const db = req.app.get('db');
  const userId = req.params.userId;

  try {
    // Validate roles exist
    const [validRoles] = await db.execute('SELECT id, name FROM roles WHERE name IN (?)', [roles]);
    if (validRoles.length !== roles.length) {
      return res.status(400).json({ error: 'Invalid role(s)' });
    }

    // Get old roles for audit log
    const [oldUser] = await db.execute('SELECT roles FROM users WHERE id = ?', [userId]);
    const oldRoles = oldUser[0]?.roles || [];

    // Update user roles
    await db.execute(
      'UPDATE users SET roles = ? WHERE id = ?',
      [JSON.stringify(roles), userId]
    );

    // Audit log
    await db.execute(
      `INSERT INTO audit_log (user_id, action, subject_user_id, old_value, new_value)
       VALUES (?, ?, ?, ?, ?)`,
      [
        req.user.id,
        'roles_updated',
        userId,
        JSON.stringify(oldRoles),
        JSON.stringify(roles),
      ]
    );

    // Regenerate JWT with new roles (user's next request will pick up new token)
    res.json({ success: true, userId, roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/audit-log
router.get('/audit-log', extractUserRoles, authorizePermission('manage_all_staff'), async (req, res) => {
  const db = req.app.get('db');
  const [rows] = await db.execute(
    `SELECT al.*, u.email
     FROM audit_log al
     JOIN users u ON al.user_id = u.id
     ORDER BY al.timestamp DESC
     LIMIT 1000`
  );
  res.json(rows);
});

module.exports = router;
```

**File:** `backend/src/index.js` (update JWT generation)

```javascript
// When user logs in, include roles in JWT
function generateToken(user) {
  const token = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      roles: user.roles || ['staff'],  // Default to 'staff' if no roles
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  return token;
}
```

### Phase 3: Frontend Implementation

**File:** `frontend/src/utils/permissions.js`

```javascript
// Helper to check if user has permission
export function userCanAccess(permission, userRoles = []) {
  const permissionMap = {
    view_analytics: ['admin', 'manager'],
    manage_analytics: ['admin'],
    view_own_staff: ['admin', 'manager', 'staff'],
    view_team_staff: ['admin', 'manager'],
    manage_all_staff: ['admin'],
    export_cv: ['admin', 'manager', 'staff'],
    view_reports: ['admin', 'manager'],
  };

  const requiredRoles = permissionMap[permission] || [];
  return userRoles.some(role => requiredRoles.includes(role));
}

// Component-level helper
export function RoleGate({ permission, roles, children, fallback = null }) {
  if (!userCanAccess(permission, roles)) {
    return fallback;
  }
  return children;
}
```

**File:** `frontend/src/components/AdminUsers.jsx` (role assignment UI)

```jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { RoleGate } from '../utils/permissions';

export default function AdminUsers({ userRoles }) {
  const [users, setUsers] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState({});

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    const res = await axios.get('/api/admin/users', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    setUsers(res.data);
  }

  async function updateUserRoles(userId, roles) {
    try {
      await axios.post(`/api/admin/users/${userId}/roles`, { roles }, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      alert('Roles updated');
      fetchUsers();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  }

  return (
    <RoleGate
      permission="manage_all_staff"
      roles={userRoles}
      fallback={<p>You do not have permission to manage users.</p>}
    >
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Current Roles</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <tr key={user.id}>
              <td>{user.email}</td>
              <td>{user.roles?.join(', ')}</td>
              <td>
                <select
                  multiple
                  onChange={(e) => {
                    const newRoles = Array.from(e.target.selectedOptions, o => o.value);
                    setSelectedRoles(prev => ({ ...prev, [user.id]: newRoles }));
                  }}
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="staff">Staff</option>
                  <option value="recruiter">Recruiter</option>
                  <option value="finance">Finance</option>
                </select>
                <button onClick={() => updateUserRoles(user.id, selectedRoles[user.id])}>
                  Update
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </RoleGate>
  );
}
```

### Phase 4: Testing Checklist

**File:** `backend/test/unit/role-model.test.js`

```javascript
const request = require('supertest');
const app = require('../../src/index');
const jwt = require('jsonwebtoken');

describe('Role Model (RBAC)', () => {
  let adminToken, staffToken, managerId, staffId;

  beforeAll(async () => {
    // Create test users
    // adminToken = JWT for admin user
    // staffToken = JWT for staff user
  });

  test('Admin can access analytics', async () => {
    const res = await request(app)
      .get('/api/analytics/utilization')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('Staff CANNOT access analytics', async () => {
    const res = await request(app)
      .get('/api/analytics/utilization')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  test('Manager can view team staff', async () => {
    const res = await request(app)
      .get(`/api/staff/${staffId}`)  // staff reports to manager
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
  });

  test('Staff cannot view other staff', async () => {
    const otherStaffId = 9999;
    const res = await request(app)
      .get(`/api/staff/${otherStaffId}`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  test('Staff can export own CV', async () => {
    const res = await request(app)
      .post(`/api/cv/export`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ format: 'pdf' });
    expect(res.status).toBe(200);
  });

  test('Admin can modify user roles', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${staffId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roles: ['manager', 'recruiter'] });
    expect(res.status).toBe(200);
  });

  test('Audit log records role changes', async () => {
    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.some(log => log.action === 'roles_updated')).toBe(true);
  });

  test('Cannot escalate own privileges', async () => {
    // Try to self-grant admin role
    const staffId = 5;
    const res = await request(app)
      .post(`/api/admin/users/${staffId}/roles`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ roles: ['admin'] });
    expect(res.status).toBe(403);
  });
});
```

### Phase 5: Deployment Checklist

- [ ] Database migrations applied (0010_role_model_schema.sql)
- [ ] Default roles seeded (admin, manager, staff, recruiter, finance)
- [ ] Existing users assigned default roles (migration script)
- [ ] JWT generation updated (embeds roles)
- [ ] authorize.js middleware applied to all protected routes
- [ ] AdminUsers.jsx frontend deployed
- [ ] All 100+ role tests passing
- [ ] Penetration testing completed (Security Officer sign-off)
- [ ] Feature flag at 0% (ready for gradual rollout)
- [ ] Go/No-Go gate: JWT verification working, permissions enforced

---

## 2. beeSuite Staff Catalog Integration {#beesuite}

### Phase 1: Environment & Credentials Setup

**File:** `.env.local` (add credentials)

```bash
BEESUITE_API_KEY=<from Vault>
BEESUITE_API_SECRET=<from Vault>
BEESUITE_API_BASE_URL=https://api.beesuite.io/v2
BEESUITE_SYNC_SCHEDULE=0 2 * * *  # 2am daily
```

**File:** `backend/src/utils/vault.js` (fetch from HashiCorp Vault)

```javascript
const axios = require('axios');

async function getBeesuiteCreds() {
  const response = await axios.get(
    `${process.env.VAULT_ADDR}/v1/secret/data/beesuite`,
    {
      headers: { 'X-Vault-Token': process.env.VAULT_TOKEN },
    }
  );
  return response.data.data.data;
}

module.exports = { getBeesuiteCreds };
```

### Phase 2: Database Schema

**File:** `backend/migrations/0020_beesuite_schema.sql`

```sql
-- Extend staff table
ALTER TABLE users ADD COLUMN beesuite_id VARCHAR(100) UNIQUE;
ALTER TABLE users ADD COLUMN department VARCHAR(100);
ALTER TABLE users ADD COLUMN job_title VARCHAR(100);
ALTER TABLE users ADD COLUMN manager_id INT;
ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1;
ALTER TABLE users ADD COLUMN last_sync TIMESTAMP;

-- org_hierarchy table (materialized view of manager → reports structure)
CREATE TABLE org_hierarchy (
  id INT PRIMARY KEY AUTO_INCREMENT,
  employee_id INT NOT NULL,
  manager_id INT,
  department VARCHAR(100),
  level INT,               -- 0 = C-level, 1 = managers, 2 = staff
  path VARCHAR(500),       -- breadcrumb: "CEO > COO > VP Engineering"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_employee_id (employee_id),
  KEY idx_manager_id (manager_id),
  FOREIGN KEY (employee_id) REFERENCES users(id),
  FOREIGN KEY (manager_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sync log (audit trail of all syncs)
CREATE TABLE beesuite_sync_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  status ENUM('success', 'partial', 'failed'),
  total_records INT,
  created_records INT,
  updated_records INT,
  deleted_records INT,
  conflicts_detected INT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Conflict log (tracks data divergence issues)
CREATE TABLE beesuite_conflict_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  field_name VARCHAR(50),   -- 'email', 'job_title', 'manager_id'
  beesuite_value VARCHAR(500),
  stafftrack_value VARCHAR(500),
  resolution ENUM('prefer_beesuite', 'prefer_stafftrack', 'manual_review'),
  resolved_by INT,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Phase 3: Sync Job Implementation

**File:** `backend/scripts/sync-beesuite-staff.js`

```javascript
#!/usr/bin/env node
const mysql = require('mysql2/promise');
const axios = require('axios');
const { getBeesuiteCreds } = require('../src/utils/vault');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

async function syncBeesuitStaff() {
  const startTime = new Date();
  const conn = await pool.getConnection();
  let syncStatus = 'success';
  let stats = { created: 0, updated: 0, deleted: 0, conflicts: 0 };

  try {
    console.log('[SYNC START]', startTime.toISOString());

    // Step 1: Fetch all staff from beeSuite
    const creds = await getBeesuiteCreds();
    const beesuitStaff = await fetchBeesuitStaff(creds);
    console.log(`[FETCH] Retrieved ${beesuitStaff.length} staff from beeSuite`);

    // Step 2: Iterate through beeSuite staff
    for (const beeStaff of beesuitStaff) {
      const [existing] = await conn.execute(
        'SELECT * FROM users WHERE beesuite_id = ?',
        [beeStaff.id]
      );

      if (existing.length === 0) {
        // New staff: CREATE
        await conn.execute(
          `INSERT INTO users (email, name, beesuite_id, department, job_title, manager_id, is_active, last_sync)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            beeStaff.email,
            beeStaff.full_name,
            beeStaff.id,
            beeStaff.department,
            beeStaff.job_title,
            beeStaff.manager_beesuite_id ? await resolveManagerId(conn, beeStaff.manager_beesuite_id) : null,
            beeStaff.is_active ? 1 : 0,
          ]
        );
        stats.created++;
      } else {
        // Existing staff: UPDATE or CONFLICT
        const current = existing[0];
        const conflicts = detectConflicts(current, beeStaff);

        if (conflicts.length === 0) {
          // No conflicts: update
          await conn.execute(
            `UPDATE users SET
             department = ?, job_title = ?, is_active = ?, last_sync = NOW()
             WHERE beesuite_id = ?`,
            [beeStaff.department, beeStaff.job_title, beeStaff.is_active ? 1 : 0, beeStaff.id]
          );
          stats.updated++;
        } else {
          // Conflicts: log and prefer beeSuite (source-of-truth)
          for (const conflict of conflicts) {
            await conn.execute(
              `INSERT INTO beesuite_conflict_log
               (user_id, field_name, beesuite_value, stafftrack_value, resolution)
               VALUES (?, ?, ?, ?, 'prefer_beesuite')`,
              [current.id, conflict.field, conflict.beesuite, conflict.current]
            );
          }
          // Apply beeSuite values
          await conn.execute(
            `UPDATE users SET
             department = ?, job_title = ?, is_active = ?, last_sync = NOW()
             WHERE beesuite_id = ?`,
            [beeStaff.department, beeStaff.job_title, beeStaff.is_active ? 1 : 0, beeStaff.id]
          );
          stats.conflicts += conflicts.length;
        }
      }
    }

    // Step 3: Refresh org_hierarchy materialized view
    await refreshOrgHierarchy(conn);

    // Step 4: Log sync success
    const endTime = new Date();
    await conn.execute(
      `INSERT INTO beesuite_sync_log
       (start_time, end_time, status, total_records, created_records, updated_records, conflicts_detected)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [startTime, endTime, syncStatus, beesuitStaff.length, stats.created, stats.updated, stats.conflicts]
    );

    console.log('[SYNC COMPLETE]', stats);
  } catch (err) {
    syncStatus = 'failed';
    console.error('[SYNC ERROR]', err.message);
    // Log error to database
    await conn.execute(
      `INSERT INTO beesuite_sync_log
       (start_time, end_time, status, error_message)
       VALUES (?, NOW(), 'failed', ?)`,
      [startTime, err.message]
    );
  } finally {
    conn.release();
  }
}

async function fetchBeesuitStaff(creds) {
  const response = await axios.get(
    `${process.env.BEESUITE_API_BASE_URL}/employees`,
    {
      headers: {
        'X-API-Key': creds.api_key,
        'X-API-Secret': creds.api_secret,
      },
      params: { limit: 1000, include_inactive: true },
    }
  );
  return response.data.employees;
}

function detectConflicts(current, beesuite) {
  const conflicts = [];
  if (current.email !== beesuite.email) {
    conflicts.push({ field: 'email', current: current.email, beesuite: beesuite.email });
  }
  if (current.job_title !== beesuite.job_title) {
    conflicts.push({ field: 'job_title', current: current.job_title, beesuite: beesuite.job_title });
  }
  // Add more conflict detection as needed
  return conflicts;
}

async function resolveManagerId(conn, managerBeesuitId) {
  const [rows] = await conn.execute(
    'SELECT id FROM users WHERE beesuite_id = ?',
    [managerBeesuitId]
  );
  return rows[0]?.id || null;
}

async function refreshOrgHierarchy(conn) {
  // Rebuild manager → reports tree
  await conn.execute('TRUNCATE org_hierarchy');
  await conn.execute(`
    INSERT INTO org_hierarchy (employee_id, manager_id, department, level)
    SELECT id, manager_id, department, 0 FROM users WHERE manager_id IS NULL
    UNION ALL
    SELECT id, manager_id, department, 1 FROM users WHERE manager_id IS NOT NULL
  `);
}

// Run sync
syncBeesuitStaff().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
```

**File:** `docker-compose.yaml` (add cron job)

```yaml
services:
  beesuite-sync:
    image: mcr.microsoft.com/cron:latest
    environment:
      SCHEDULE: "0 2 * * *"  # 2am daily
      COMMAND: "node /app/backend/scripts/sync-beesuite-staff.js"
    volumes:
      - ./backend:/app/backend
    depends_on:
      - backend
```

### Phase 4: API Endpoints

**File:** `backend/src/routes/beesuite-staff.js`

```javascript
const express = require('express');
const router = express.Router();
const { authorizePermission } = require('../middleware/authorize');

// GET /api/beesuite/sync-status
router.get('/sync-status', authorizePermission('view_reports'), async (req, res) => {
  const db = req.app.get('db');
  const [lastSync] = await db.execute(
    `SELECT * FROM beesuite_sync_log
     ORDER BY created_at DESC
     LIMIT 1`
  );
  res.json(lastSync[0] || { status: 'never_synced' });
});

// GET /api/beesuite/org-hierarchy
router.get('/org-hierarchy', authorizePermission('view_team_staff'), async (req, res) => {
  const db = req.app.get('db');
  const [rows] = await db.execute(
    `SELECT oh.*, u.name, u.email, u.job_title
     FROM org_hierarchy oh
     JOIN users u ON oh.employee_id = u.id
     ORDER BY oh.level, u.name`
  );
  res.json(rows);
});

// GET /api/beesuite/conflicts
router.get('/conflicts', authorizePermission('manage_all_staff'), async (req, res) => {
  const db = req.app.get('db');
  const [conflicts] = await db.execute(
    `SELECT bc.*, u.email, u.name
     FROM beesuite_conflict_log bc
     JOIN users u ON bc.user_id = u.id
     WHERE bc.resolved_at IS NULL
     ORDER BY bc.created_at DESC`
  );
  res.json(conflicts);
});

// POST /api/beesuite/conflicts/:id/resolve
router.post('/conflicts/:id/resolve', authorizePermission('manage_all_staff'), async (req, res) => {
  const { resolution } = req.body;  // 'prefer_beesuite' or 'prefer_stafftrack'
  const db = req.app.get('db');

  await db.execute(
    `UPDATE beesuite_conflict_log
     SET resolution = ?, resolved_by = ?, resolved_at = NOW()
     WHERE id = ?`,
    [resolution, req.user.id, req.params.id]
  );

  res.json({ success: true });
});

module.exports = router;
```

### Phase 5: Testing & Deployment

**File:** `backend/test/integration/beesuite-sync.test.js`

```javascript
describe('beeSuite Sync', () => {
  test('Sync creates new staff from beeSuite', async () => {
    // Mock beeSuite API
    // Run sync script
    // Verify record created in users table
  });

  test('Sync detects conflicts and logs them', async () => {
    // Create conflict scenario
    // Run sync
    // Verify conflict_log has entry
  });

  test('Org hierarchy refreshes after sync', async () => {
    // Run sync
    // Query org_hierarchy
    // Verify hierarchy is correct
  });

  test('Sync completes in < 30 seconds', async () => {
    const start = Date.now();
    await syncBeesuitStaff();
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(30000);
  });
});
```

---

## 3. Analytics Dashboard {#analytics}

### Phase 1: Materialized Views

**File:** `backend/migrations/0030_analytics_views.sql`

```sql
-- Materialized view: team utilization (refreshed every 5 minutes)
CREATE TABLE analytics_team_utilization (
  id INT PRIMARY KEY AUTO_INCREMENT,
  department VARCHAR(100),
  total_staff INT,
  allocated_staff INT,
  utilization_pct DECIMAL(5,2),
  refreshed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_department (department)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Daily refresh job
CREATE EVENT IF NOT EXISTS refresh_analytics_utilization
ON SCHEDULE EVERY 5 MINUTE
DO
  BEGIN
    TRUNCATE analytics_team_utilization;
    INSERT INTO analytics_team_utilization (department, total_staff, allocated_staff, utilization_pct)
    SELECT
      u.department,
      COUNT(DISTINCT u.id) as total_staff,
      COUNT(DISTINCT CASE WHEN mp.user_id IS NOT NULL THEN u.id END) as allocated_staff,
      ROUND(
        COUNT(DISTINCT CASE WHEN mp.user_id IS NOT NULL THEN u.id END) /
        COUNT(DISTINCT u.id) * 100, 2
      ) as utilization_pct
    FROM users u
    LEFT JOIN managed_projects mp ON u.id = mp.user_id AND mp.end_date >= CURDATE()
    WHERE u.is_active = 1
    GROUP BY u.department;
  END;
```

### Phase 2: Backend API

**File:** `backend/src/routes/analytics.js`

```javascript
const express = require('express');
const router = express.Router();
const { extractUserRoles, authorizePermission, authorizeRowAccess } = require('../middleware/authorize');

// GET /api/analytics/utilization
router.get('/utilization', extractUserRoles, authorizePermission('view_analytics'), async (req, res) => {
  const db = req.app.get('db');
  const [rows] = await db.execute(
    'SELECT * FROM analytics_team_utilization ORDER BY department'
  );
  res.json(rows);
});

// GET /api/analytics/utilization/:department
router.get(
  '/utilization/:department',
  extractUserRoles,
  authorizePermission('view_analytics'),
  async (req, res) => {
    const db = req.app.get('db');
    const [rows] = await db.execute(
      'SELECT * FROM analytics_team_utilization WHERE department = ?',
      [req.params.department]
    );
    res.json(rows[0] || { error: 'Not found' });
  }
);

// GET /api/analytics/project-status
router.get('/project-status', extractUserRoles, authorizePermission('view_analytics'), async (req, res) => {
  const db = req.app.get('db');
  const [rows] = await db.execute(`
    SELECT
      p.id,
      p.name,
      COUNT(mp.user_id) as staff_count,
      p.start_date,
      p.end_date,
      DATEDIFF(p.end_date, CURDATE()) as days_remaining,
      CASE
        WHEN DATEDIFF(p.end_date, CURDATE()) < 0 THEN 'Completed'
        WHEN DATEDIFF(p.end_date, CURDATE()) < 7 THEN 'Due Soon'
        ELSE 'On Track'
      END as status
    FROM projects p
    LEFT JOIN managed_projects mp ON p.id = mp.project_id
    GROUP BY p.id
  `);
  res.json(rows);
});

module.exports = router;
```

### Phase 3: Frontend Components

**File:** `frontend/src/components/DashboardLayout.jsx`

```jsx
import React, { useState, useEffect } from 'react';
import UtilizationChart from './UtilizationChart';
import ProjectStatus from './ProjectStatus';
import { useAuth } from '../context/AuthContext';

export default function DashboardLayout() {
  const { user } = useAuth();
  const [utilization, setUtilization] = useState([]);
  const [projects, setProjects] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [utilRes, projRes] = await Promise.all([
          fetch('/api/analytics/utilization', {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          }),
          fetch('/api/analytics/project-status', {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          }),
        ]);

        setUtilization(await utilRes.json());
        setProjects(await projRes.json());
        setLastRefresh(new Date());
      } catch (err) {
        console.error('Error fetching analytics:', err);
      }
    };

    // Initial fetch
    fetchData();

    // Poll every 5 minutes
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: '20px' }}>
      <h1>Analytics Dashboard</h1>
      <p style={{ color: '#666', fontSize: '12px' }}>
        Last updated: {lastRefresh.toLocaleTimeString()} (refreshes every 5 minutes)
      </p>

      <div style={{ marginTop: '20px' }}>
        <h2>Team Utilization</h2>
        <UtilizationChart data={utilization} />
      </div>

      <div style={{ marginTop: '40px' }}>
        <h2>Project Status</h2>
        <ProjectStatus data={projects} />
      </div>
    </div>
  );
}
```

**File:** `frontend/src/components/UtilizationChart.jsx`

```jsx
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function UtilizationChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="department" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar dataKey="utilization_pct" fill="#8884d8" name="Utilization (%)" />
        <Bar dataKey="allocated_staff" fill="#82ca9d" name="Allocated Staff" />
        <Bar dataKey="total_staff" fill="#ffc658" name="Total Staff" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

---

## 4. CV Export (PDF/DOCX) {#cv-export}

### Phase 1: Backend Setup

**File:** `backend/package.json` (add dependencies)

```json
{
  "dependencies": {
    "puppeteer": "^21.0.0",
    "docx": "^8.0.0"
  }
}
```

**File:** `backend/src/services/cvExporter.js`

```javascript
const puppeteer = require('puppeteer');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const fs = require('fs').promises;
const path = require('path');

async function exportCVAsPDF(cvHtml, filename) {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setContent(cvHtml, { waitUntil: 'networkidle0' });

    const pdfPath = path.join('/tmp', `${filename}.pdf`);
    await page.pdf({ path: pdfPath, format: 'A4' });

    return {
      path: pdfPath,
      filename: `${filename}.pdf`,
      contentType: 'application/pdf',
    };
  } finally {
    if (browser) await browser.close();
  }
}

async function exportCVAsDOCX(cvData, filename) {
  const sections = [
    new Paragraph({
      text: cvData.name,
      style: 'Heading1',
    }),
    new Paragraph({
      text: cvData.email,
      style: 'Normal',
    }),
    // Add more paragraphs for experience, skills, etc.
  ];

  const doc = new Document({
    sections: [{
      children: sections,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const docPath = path.join('/tmp', `${filename}.docx`);
  await fs.writeFile(docPath, buffer);

  return {
    path: docPath,
    filename: `${filename}.docx`,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

module.exports = { exportCVAsPDF, exportCVAsDOCX };
```

### Phase 2: API Endpoint

**File:** `backend/src/routes/cv-export.js`

```javascript
const express = require('express');
const router = express.Router();
const { authorizePermission, authorizeRowAccess } = require('../middleware/authorize');
const { exportCVAsPDF, exportCVAsDOCX } = require('../services/cvExporter');

// POST /api/cv/export/:userId
router.post(
  '/export/:userId',
  authorizePermission('export_cv'),
  authorizeRowAccess('cv'),
  async (req, res) => {
    const { format } = req.body;  // 'pdf' or 'docx'
    const userId = req.params.userId;
    const db = req.app.get('db');

    try {
      // Fetch CV data
      const [userData] = await db.execute(
        'SELECT id, name, email, phone FROM users WHERE id = ?',
        [userId]
      );

      if (!userData.length) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userData[0];
      const cvHtml = renderCVTemplate(user);
      const filename = `${user.name.replace(/\s+/g, '_')}_CV`;

      let result;
      if (format === 'pdf') {
        result = await exportCVAsPDF(cvHtml, filename);
      } else if (format === 'docx') {
        result = await exportCVAsDOCX(user, filename);
      } else {
        return res.status(400).json({ error: 'Invalid format' });
      }

      // Send file
      res.download(result.path, result.filename);

      // Cleanup temp file after sending
      setTimeout(() => {
        require('fs').unlink(result.path, () => {});
      }, 5000);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

function renderCVTemplate(user) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        h2 { color: #666; border-bottom: 2px solid #333; }
      </style>
    </head>
    <body>
      <h1>${user.name}</h1>
      <p>${user.email} | ${user.phone}</p>
      <!-- Add more sections as needed -->
    </body>
    </html>
  `;
}

module.exports = router;
```

### Phase 3: Frontend Component

**File:** `frontend/src/components/CVExporter.jsx`

```jsx
import React, { useState } from 'react';
import axios from 'axios';

export default function CVExporter({ userId }) {
  const [format, setFormat] = useState('pdf');
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const response = await axios.post(
        `/api/cv/export/${userId}`,
        { format },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          responseType: 'blob',
        }
      );

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `CV.${format}`);
      document.body.appendChild(link);
      link.click();
      link.parentElement.removeChild(link);
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <select value={format} onChange={(e) => setFormat(e.target.value)}>
        <option value="pdf">PDF</option>
        <option value="docx">Word Document</option>
      </select>
      <button onClick={handleExport} disabled={loading}>
        {loading ? 'Exporting...' : 'Export CV'}
      </button>
    </div>
  );
}
```

---

## 5. Skill Search & Matching {#skill-search}

### Phase 1: Skill Taxonomy & Canonicalization

**File:** `backend/scripts/skill-canonicalization.js`

```javascript
#!/usr/bin/env node
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

async function canonicalizeSkills() {
  const conn = await pool.getConnection();

  try {
    // Step 1: Extract unique skills from submission_skills
    const [skills] = await conn.execute(`
      SELECT DISTINCT LOWER(TRIM(skill)) as skill
      FROM submission_skills
      WHERE skill IS NOT NULL AND skill != ''
      ORDER BY skill
    `);

    // Step 2: Create canonical skill list (remove duplicates, standardize)
    const canonicalSkills = new Set();
    const skillAliases = {};

    for (const { skill } of skills) {
      // Normalize: remove extra spaces, standardize case
      const canonical = skill.toLowerCase().trim();

      // Check if similar skill already exists (fuzzy matching)
      let found = false;
      for (const existing of canonicalSkills) {
        if (similarity(canonical, existing) > 0.8) {
          skillAliases[skill] = existing;
          found = true;
          break;
        }
      }

      if (!found) {
        canonicalSkills.add(canonical);
      }
    }

    // Step 3: Populate canonical_skills table
    await conn.execute('TRUNCATE canonical_skills');
    for (const skill of canonicalSkills) {
      await conn.execute(
        'INSERT INTO canonical_skills (name, category) VALUES (?, ?)',
        [skill, detectCategory(skill)]
      );
    }

    // Step 4: Update submission_skills to use canonical names
    for (const [original, canonical] of Object.entries(skillAliases)) {
      await conn.execute(
        'UPDATE submission_skills SET skill = ? WHERE skill = ?',
        [canonical, original]
      );
    }

    console.log(`[COMPLETE] Created ${canonicalSkills.size} canonical skills`);
  } finally {
    conn.release();
  }
}

function similarity(a, b) {
  // Simple Levenshtein distance-based similarity
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  
  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(a, b) {
  const costs = [];
  for (let i = 0; i <= a.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= b.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (a.charAt(i - 1) !== b.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[b.length] = lastValue;
  }
  return costs[b.length];
}

function detectCategory(skill) {
  const categories = {
    backend: ['node', 'python', 'java', 'golang', 'rust'],
    frontend: ['react', 'vue', 'angular', 'javascript', 'css', 'html'],
    devops: ['docker', 'kubernetes', 'aws', 'gcp', 'terraform'],
    data: ['sql', 'python', 'tableau', 'snowflake', 'spark'],
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(kw => skill.includes(kw))) {
      return category;
    }
  }

  return 'other';
}

canonicalizeSkills().catch(console.error);
```

### Phase 2: Database Schema

**File:** `backend/migrations/0040_ft_index_skills.sql`

```sql
CREATE TABLE canonical_skills (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) UNIQUE NOT NULL,
  category VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FULLTEXT INDEX ft_skill_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE submission_skills ADD FULLTEXT INDEX ft_skill (skill);

CREATE TABLE skill_search_analytics (
  id INT PRIMARY KEY AUTO_INCREMENT,
  query VARCHAR(200),
  results_count INT,
  user_id INT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_query (query),
  KEY idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Phase 3: Backend API

**File:** `backend/src/routes/skill-search.js`

```javascript
const express = require('express');
const router = express.Router();
const { authorizePermission } = require('../middleware/authorize');

// GET /api/skills/search?q=react
router.get('/search', authorizePermission('view_analytics'), async (req, res) => {
  const { q } = req.query;
  const db = req.app.get('db');

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Query must be >= 2 characters' });
  }

  try {
    // Full-text search against canonical_skills
    const [skills] = await db.execute(
      `SELECT * FROM canonical_skills
       WHERE MATCH(name) AGAINST(? IN BOOLEAN MODE)
       LIMIT 20`,
      [`${q}*`]  // BM25 ranking with wildcard
    );

    // Log search for analytics
    await db.execute(
      'INSERT INTO skill_search_analytics (query, results_count, user_id) VALUES (?, ?, ?)',
      [q, skills.length, req.user?.id || null]
    );

    // Enrich with staff who have this skill
    const enriched = await Promise.all(
      skills.map(async (skill) => {
        const [staff] = await db.execute(
          `SELECT u.id, u.name, u.email, ss.proficiency
           FROM submission_skills ss
           JOIN submissions s ON ss.submission_id = s.id
           JOIN users u ON s.user_id = u.id
           WHERE LOWER(ss.skill) = LOWER(?)
           LIMIT 10`,
          [skill.name]
        );
        return { ...skill, staff };
      })
    );

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/skills/autocomplete?q=r
router.get('/autocomplete', authorizePermission('view_analytics'), async (req, res) => {
  const { q } = req.query;
  const db = req.app.get('db');

  if (!q || q.length < 1) {
    return res.json([]);
  }

  const [skills] = await db.execute(
    'SELECT name FROM canonical_skills WHERE name LIKE ? LIMIT 10',
    [`${q}%`]
  );

  res.json(skills.map(s => s.name));
});

module.exports = router;
```

### Phase 4: Frontend Component

**File:** `frontend/src/components/SkillSearch.jsx`

```jsx
import React, { useState } from 'react';
import axios from 'axios';

export default function SkillSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [autocomplete, setAutocomplete] = useState([]);

  const handleSearch = async (e) => {
    const value = e.target.value;
    setQuery(value);

    if (value.length < 2) {
      setResults([]);
      return;
    }

    // Autocomplete
    const autoRes = await axios.get('/api/skills/autocomplete', {
      params: { q: value },
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    setAutocomplete(autoRes.data);

    // Search
    const searchRes = await axios.get('/api/skills/search', {
      params: { q: value },
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    setResults(searchRes.data);
  };

  return (
    <div>
      <input
        type="text"
        placeholder="Search skills..."
        value={query}
        onChange={handleSearch}
        list="autocomplete"
      />
      <datalist id="autocomplete">
        {autocomplete.map(skill => (
          <option key={skill} value={skill} />
        ))}
      </datalist>

      <div>
        {results.map(skill => (
          <div key={skill.id} style={{ marginTop: '10px', padding: '10px', border: '1px solid #ddd' }}>
            <h3>{skill.name}</h3>
            <p>Category: {skill.category}</p>
            <h4>Staff with this skill:</h4>
            <ul>
              {skill.staff.map(person => (
                <li key={person.id}>
                  {person.name} ({person.email}) - {person.proficiency}/5
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Testing & Deployment Quick Checklist

### Pre-Deployment (All Features)

- [ ] Unit tests passing (90%+ coverage)
- [ ] Integration tests passing
- [ ] Load testing completed (acceptable performance)
- [ ] Security testing:
  - [ ] No SQL injection vulnerabilities
  - [ ] JWT properly validated
  - [ ] Permissions enforced
  - [ ] No credential leaks in logs
- [ ] Database migrations tested on staging
- [ ] Feature flags configured (0% rollout initially)
- [ ] Monitoring dashboards set up
- [ ] Alerting configured
- [ ] Runbooks written
- [ ] On-call rotation scheduled

### Deployment Steps

1. **Pre-flight checks** (30 min before)
   - [ ] All tests passing
   - [ ] No recent error spikes
   - [ ] Team ready

2. **Staging deployment** (1 hour)
   - [ ] Deploy to staging
   - [ ] Run smoke tests
   - [ ] Get stakeholder approval

3. **Production rollout** (with feature flags)
   - [ ] Deploy code (feature flag at 0%)
   - [ ] Enable for 10% of users
   - [ ] Monitor for 30 min (no errors?)
   - [ ] Expand to 50%
   - [ ] Monitor for 1 hour
   - [ ] Expand to 100%
   - [ ] Enable on-call monitoring (24h)

4. **Post-launch**
   - [ ] Monitor key metrics
   - [ ] Collect user feedback
   - [ ] Log lessons learned

---

## Appendix: File Structure Summary

```
backend/
├── migrations/
│   ├── 0010_role_model_schema.sql
│   ├── 0020_beesuite_schema.sql
│   ├── 0030_analytics_views.sql
│   └── 0040_ft_index_skills.sql
├── scripts/
│   ├── sync-beesuite-staff.js
│   └── skill-canonicalization.js
├── src/
│   ├── middleware/
│   │   └── authorize.js
│   ├── routes/
│   │   ├── admin.js (role management)
│   │   ├── beesuite-staff.js
│   │   ├── analytics.js
│   │   ├── cv-export.js
│   │   └── skill-search.js
│   ├── services/
│   │   └── cvExporter.js
│   └── utils/
│       └── vault.js
└── test/
    ├── unit/
    │   └── role-model.test.js
    └── integration/
        └── beesuite-sync.test.js

frontend/
├── src/
│   ├── components/
│   │   ├── DashboardLayout.jsx
│   │   ├── UtilizationChart.jsx
│   │   ├── AdminUsers.jsx
│   │   ├── CVExporter.jsx
│   │   └── SkillSearch.jsx
│   └── utils/
│       └── permissions.js
```
