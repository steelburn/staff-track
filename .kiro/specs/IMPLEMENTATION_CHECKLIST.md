# Implementation Checklist: 5 Features for StaffTrack

**Based on:** Codebase analysis of SQLite + Express + Vanilla JS architecture  
**Target:** Systematic implementation with dependency tracking  
**Format:** Feature-by-feature with detailed tasks and file locations

---

## Overview: What Exists vs. What's Needed

### ✅ Already In Place (from codebase analysis)

| Component | Status | Details |
|-----------|--------|---------|
| **JWT Authentication** | ✅ Exists | 8hr tokens + 30-day refresh (`/auth/routes/auth.js`) |
| **RBAC Authorization** | ✅ Exists | 6 roles (admin, hr, coordinator, etc.) at route level |
| **Database (SQLite)** | ✅ Exists | WAL mode, foreign keys enabled, auto-migrations |
| **Request Logging** | ✅ Exists | Basic console logging in `index.js` |
| **Error Handling** | ✅ Exists | Global 500 error handler, 404 handler |
| **CORS** | ✅ Exists | Helmet security headers, static file serving |
| **CSV Import/Export** | ✅ Exists | Admin bulk import, data-tools dump/restore |
| **Frontend SPA** | ✅ Exists | Vanilla JS with auto-save (1.5s debounce) |

### ❌ Needs to Be Built (for your features)

| Feature | Components Needed |
|---------|------------------|
| **Role Model Expansion** | RBAC schema refactor, permission matrix, audit logging |
| **beeSuite Sync** | REST API client, sync job scheduler, conflict detection |
| **Analytics Dashboard** | Materialized views, replica setup, new APIs, React/charts |
| **CV Export** | PDF/DOCX generation (Puppeteer + docx), new APIs, UI |
| **Skill Search** | Full-text search indexing, canonicalization, search APIs |

---

## Part 1: Role Model Expansion (RBAC Refactor)

**Timeline:** Week 0-3 | **Depends on:** None (foundation feature) | **Unblocks:** All other features

### Phase 1.1: Database Schema Changes

#### Task 1.1.1: Backup existing auth system
```bash
# ✅ BEFORE modifying authentication
sqlite> .backup existing_auth_backup.db
```

**Files to modify:** `backend/src/db.js`

**Current state:**
- Users table exists with hardcoded roles (auth field)
- No permission matrix defined
- No audit logging

**Add to `db.js` schema initialization:**

- [ ] Create `permissions` table (id, name, resource, action, description)
- [ ] Create `roles` table (id, name, description, created_at)
- [ ] Create `role_permissions` junction table
- [ ] Create `audit_log` table (user_id, action, old_value, new_value, timestamp)
- [ ] Migrate existing users to new role system (AUTH roles → roles table)

**SQL to add:** `backend/src/db.js` → `initSchema()` function

```javascript
// Add these CREATE TABLE statements to initSchema(db)
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    resource TEXT,
    action TEXT,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL,
    permission_id INTEGER NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id),
    FOREIGN KEY (permission_id) REFERENCES permissions(id)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    subject_user_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES submissions(id),
    FOREIGN KEY (subject_user_id) REFERENCES submissions(id)
  );
`);
```

**Seed default roles:** Add to `backend/src/seed.js`

```javascript
// New function: seedRoles(db)
function seedRoles(db) {
  const roles = [
    { name: 'admin', description: 'Full system access' },
    { name: 'manager', description: 'Team management + reporting' },
    { name: 'staff', description: 'Personal data access' },
    { name: 'recruiter', description: 'Recruitment + candidate access' },
    { name: 'hr', description: 'HR reporting' },
  ];

  const permissions = [
    { resource: 'analytics', action: 'view' },
    { resource: 'analytics', action: 'manage' },
    { resource: 'staff', action: 'view_own' },
    { resource: 'staff', action: 'view_team' },
    { resource: 'staff', action: 'manage_all' },
    { resource: 'cv', action: 'export' },
  ];

  // Insert roles
  roles.forEach(role => {
    db.prepare('INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)').run(role.name, role.description);
  });

  // Insert permissions
  permissions.forEach(perm => {
    db.prepare('INSERT OR IGNORE INTO permissions (resource, action) VALUES (?, ?)').run(perm.resource, perm.action);
  });

  // Assign permissions to roles
  // Admin: all permissions
  // Manager: view_analytics, view_team, export_cv
  // Staff: view_own, export_cv
}
```

#### Task 1.1.2: Migrate existing users to new system

**File:** `backend/src/seed.js` → add migration function

- [ ] Query existing users with old `auth` field
- [ ] Map old auth values to new roles (admin → 'admin', staff → 'staff', etc.)
- [ ] Insert mappings into `role_permissions` table
- [ ] Verify all users have roles assigned

### Phase 1.2: Middleware Changes

#### Task 1.2.1: Update JWT generation

**File:** `backend/src/routes/auth.js` → modify `/login` endpoint

**Current state:** JWT doesn't embed roles
**Change needed:** Add roles array to JWT payload

```javascript
// In /login endpoint, after user verification
const user = db.prepare('SELECT * FROM users WHERE staff_email = ?').get(email);

// NEW: Fetch user's roles
const userRoles = db.prepare(`
  SELECT r.name FROM roles r
  JOIN user_roles ur ON r.id = ur.role_id
  WHERE ur.user_id = ?
`).all(user.id).map(row => row.name);

// Generate JWT with roles embedded
const token = jwt.sign(
  {
    sub: user.id,
    email: user.staff_email,
    roles: userRoles || ['staff'],  // Default to staff if no roles
  },
  process.env.JWT_SECRET,
  { expiresIn: '8h' }
);
```

- [ ] Modify `/login` to fetch user roles from `role_permissions`
- [ ] Add roles array to JWT payload
- [ ] Test: Decode JWT and verify roles are present

#### Task 1.2.2: Create authorization middleware

**File:** `backend/src/middleware/authorize.js` (NEW FILE)

```javascript
// authorize.js
const jwt = require('jsonwebtoken');

function extractUserRoles(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      roles: decoded.roles || [],
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function authorizePermission(requiredPermission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Check if user's roles have the required permission
    const db = require('../db').getDb();
    const hasPermission = db.prepare(`
      SELECT 1 FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      JOIN roles r ON rp.role_id = r.id
      WHERE r.name IN (${req.user.roles.map(() => '?').join(',')})
      AND p.name = ?
      LIMIT 1
    `).get(...req.user.roles, requiredPermission);

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: requiredPermission,
        userRoles: req.user.roles,
      });
    }

    next();
  };
}

module.exports = { extractUserRoles, authorizePermission };
```

- [ ] Create `backend/src/middleware/authorize.js`
- [ ] Test: JWT extraction + role verification
- [ ] Test: Permission denial for unauthorized users

#### Task 1.2.3: Apply authorization to existing routes

**File:** Update all route files (`backend/src/routes/*.js`)

For each route file, add permission checks:

```javascript
// Example: analytics.js (will be created in Phase 2)
const { extractUserRoles, authorizePermission } = require('../middleware/authorize');

router.get('/utilization', extractUserRoles, authorizePermission('view_analytics'), async (req, res) => {
  // ... existing handler code
});
```

- [ ] Add `extractUserRoles` middleware to all protected routes
- [ ] Add `authorizePermission` middleware with required permissions
- [ ] Test: Protected routes reject requests from unauthorized users

### Phase 1.3: Admin Tools

#### Task 1.3.1: Role assignment API

**File:** Update `backend/src/routes/admin.js`

**New endpoint:** `POST /admin/users/:userId/roles`

```javascript
router.post('/users/:userId/roles', extractUserRoles, authorizePermission('manage_all_staff'), (req, res) => {
  const { roles } = req.body;  // ['admin', 'manager']
  const db = getDb();

  // Validate roles exist
  const validRoles = db.prepare('SELECT id FROM roles WHERE name = ?');
  const roleIds = roles.map(role => validRoles.get(role)?.id).filter(Boolean);

  if (roleIds.length !== roles.length) {
    return res.status(400).json({ error: 'Invalid role(s)' });
  }

  // Get old roles (for audit log)
  const oldRoles = db.prepare(`
    SELECT r.name FROM roles r
    JOIN user_roles ur ON r.id = ur.role_id
    WHERE ur.user_id = ?
  `).all(req.params.userId).map(r => r.name);

  // Delete old role assignments
  db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(req.params.userId);

  // Insert new role assignments
  roleIds.forEach(roleId => {
    db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(req.params.userId, roleId);
  });

  // Log to audit_log
  db.prepare(`
    INSERT INTO audit_log (user_id, action, subject_user_id, old_value, new_value)
    VALUES (?, 'roles_updated', ?, ?, ?)
  `).run(req.user.id, req.params.userId, JSON.stringify(oldRoles), JSON.stringify(roles));

  res.json({ success: true, userId: req.params.userId, roles });
});
```

- [ ] Add POST `/admin/users/:userId/roles` endpoint
- [ ] Validate role existence before assignment
- [ ] Log role changes to audit_log
- [ ] Test: Admin can assign roles; staff cannot self-escalate

#### Task 1.3.2: Audit log endpoint

**File:** Update `backend/src/routes/admin.js`

**New endpoint:** `GET /admin/audit-log`

```javascript
router.get('/audit-log', extractUserRoles, authorizePermission('manage_all_staff'), (req, res) => {
  const db = getDb();
  const logs = db.prepare(`
    SELECT * FROM audit_log
    ORDER BY timestamp DESC
    LIMIT 1000
  `).all();

  res.json(logs);
});
```

- [ ] Add GET `/admin/audit-log` endpoint
- [ ] Return last 1000 audit entries
- [ ] Test: Log changes are visible

### Phase 1.4: Frontend Role Management UI

#### Task 1.4.1: Create admin role manager page

**Files to create:**
- [ ] `public/admin-roles.html` (new page for role management)
- [ ] `public/admin-roles.js` (frontend logic)

**admin-roles.html:**

```html
<div class="container">
  <h1>User Role Management</h1>
  <input id="searchUser" type="text" placeholder="Search by email...">
  <button onclick="searchUsers()">Search</button>

  <table id="userTable">
    <thead>
      <tr>
        <th>Email</th>
        <th>Current Roles</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody id="users"></tbody>
  </table>
</div>

<script src="admin-roles.js"></script>
```

**admin-roles.js:**

```javascript
async function searchUsers() {
  const query = document.getElementById('searchUser').value;
  const res = await fetch(`/admin/users?q=${query}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
  });
  const users = await res.json();

  const tbody = document.getElementById('users');
  tbody.innerHTML = users.map(user => `
    <tr>
      <td>${user.staff_email}</td>
      <td>${user.roles?.join(', ') || 'None'}</td>
      <td>
        <select id="roles-${user.id}" multiple>
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
          <option value="staff">Staff</option>
        </select>
        <button onclick="updateRoles('${user.id}')">Update</button>
      </td>
    </tr>
  `).join('');
}

async function updateRoles(userId) {
  const select = document.getElementById(`roles-${userId}`);
  const roles = Array.from(select.selectedOptions).map(o => o.value);

  const res = await fetch(`/admin/users/${userId}/roles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('authToken')}`,
    },
    body: JSON.stringify({ roles }),
  });

  if (res.ok) {
    alert('Roles updated');
    searchUsers();
  } else {
    alert('Error updating roles');
  }
}
```

- [ ] Create `public/admin-roles.html`
- [ ] Create `public/admin-roles.js` with role update logic
- [ ] Add link to admin-roles.html from main menu
- [ ] Test: Admin can assign/revoke roles

### Phase 1.5: Testing & Validation

#### Task 1.5.1: Unit tests for RBAC

**File:** `backend/test/unit/role-model.test.js` (NEW)

```javascript
const { getDb } = require('../../src/db');
const jwt = require('jsonwebtoken');

describe('Role Model (RBAC)', () => {
  let db;

  beforeAll(() => {
    db = getDb();
  });

  test('Admin has all permissions', () => {
    const adminRoles = db.prepare(`
      SELECT r.name FROM roles r
      JOIN role_permissions rp ON r.id = rp.role_id
      WHERE r.name = 'admin'
    `).all();

    expect(adminRoles.length).toBeGreaterThan(0);
  });

  test('JWT includes roles', () => {
    const token = jwt.sign({ roles: ['admin'] }, process.env.JWT_SECRET);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.roles).toEqual(['admin']);
  });

  test('Staff cannot self-escalate', () => {
    // Test: staff user tries to POST /admin/users/:id/roles
    // Expected: 403 Forbidden
  });
});
```

- [ ] Create `backend/test/unit/role-model.test.js`
- [ ] Test: Admin has all permissions
- [ ] Test: Staff has limited permissions
- [ ] Test: JWT decoding includes roles
- [ ] Test: Permission checking works
- [ ] Run: `npm test` (if jest configured)

#### Task 1.5.2: Integration test

- [ ] Test: Login → JWT includes roles → Protected route accepts request
- [ ] Test: Unauthorized user → 403 response
- [ ] Test: Role assignment → Next JWT reflects new roles

### Phase 1.6: Deployment Checklist

- [ ] Database migrations applied (schema created successfully)
- [ ] Default roles seeded (6 roles exist in database)
- [ ] Existing users assigned default 'staff' role (or appropriate role)
- [ ] JWT generation updated (tokens include roles)
- [ ] authorize.js middleware applied to all protected routes
- [ ] Admin role management endpoints working
- [ ] Frontend admin-roles.html deployed
- [ ] All RBAC tests passing
- [ ] No privilege escalation vulnerabilities (security review)
- [ ] Go/No-Go gate: Role Model ready for production
- [ ] **Unblocks:** beeSuite, Analytics, CV Export, Skill Search

---

## Part 2: beeSuite Staff Catalog Sync

**Timeline:** Week 1-4 | **Depends on:** Role Model (for permission checks) | **Unblocks:** Analytics Dashboard

### Phase 2.1: Environment & Credentials

#### Task 2.1.1: Add environment variables

**File:** `.env` (or `.env.local`)

```bash
# beeSuite integration
BEESUITE_API_URL=https://api.beesuite.io/v2
BEESUITE_API_KEY=<ask HR team>
BEESUITE_API_SECRET=<ask HR team>
BEESUITE_SYNC_SCHEDULE=0 2 * * *  # 2am daily (cron format)

# Service account for sync
BEESUITE_SERVICE_USER_ID=<internal staff ID>
```

- [ ] Request API credentials from beeSuite admin/HR
- [ ] Store credentials in Vault (not git repo)
- [ ] Add to `.env.local` (don't commit to Git)
- [ ] Document in README: how to get credentials

#### Task 2.1.2: Create secure credential retrieval

**File:** `backend/src/utils/vault.js` (NEW) OR use env directly

**Option A: Use environment variables (simple)**

```javascript
// backend/src/utils/beesuite.js
module.exports = {
  apiUrl: process.env.BEESUITE_API_URL,
  apiKey: process.env.BEESUITE_API_KEY,
  apiSecret: process.env.BEESUITE_API_SECRET,
};
```

**Option B: Use HashiCorp Vault (secure)**

```javascript
// backend/src/utils/vault.js
const https = require('https');

async function getSecret(path) {
  const options = {
    hostname: process.env.VAULT_ADDR,
    path: `/v1/secret/data/${path}`,
    method: 'GET',
    headers: { 'X-Vault-Token': process.env.VAULT_TOKEN },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data).data.data));
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { getSecret };
```

- [ ] Choose credential storage method (env or Vault)
- [ ] Document credential retrieval process
- [ ] Test: Can fetch credentials without errors

### Phase 2.2: Database Schema

#### Task 2.2.1: Add sync tables

**File:** `backend/src/db.js` → `initSchema()` function

**Add to schema:**

```javascript
db.exec(`
  -- Extend users table
  ALTER TABLE users ADD COLUMN IF NOT EXISTS beesuite_id TEXT UNIQUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INTEGER;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT 1;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_sync TEXT;

  -- Sync log
  CREATE TABLE IF NOT EXISTS beesuite_sync_log (
    id INTEGER PRIMARY KEY,
    start_time TEXT,
    end_time TEXT,
    status TEXT CHECK(status IN ('success', 'partial', 'failed')),
    total_records INTEGER,
    created_records INTEGER,
    updated_records INTEGER,
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Conflict log
  CREATE TABLE IF NOT EXISTS beesuite_conflict_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    field_name TEXT,
    beesuite_value TEXT,
    stafftrack_value TEXT,
    resolution TEXT,
    resolved_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Org hierarchy (materialized view of manager → reports)
  CREATE TABLE IF NOT EXISTS org_hierarchy (
    id INTEGER PRIMARY KEY,
    employee_id INTEGER UNIQUE NOT NULL,
    manager_id INTEGER,
    department TEXT,
    level INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES users(id),
    FOREIGN KEY (manager_id) REFERENCES users(id)
  );
`);
```

- [ ] Add new columns to users table (beesuite_id, department, job_title, manager_id, is_active, last_sync)
- [ ] Create beesuite_sync_log table
- [ ] Create beesuite_conflict_log table
- [ ] Create org_hierarchy table
- [ ] Test: New tables created successfully

### Phase 2.3: Sync Job Implementation

#### Task 2.3.1: Create beeSuite API client

**File:** `backend/src/services/beesuiteSyncClient.js` (NEW)

```javascript
const https = require('https');
const { getSecret } = require('../utils/vault');  // or use env

class BeesuiteSyncClient {
  constructor(apiUrl, apiKey, apiSecret) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  async getStaff(limit = 1000, offset = 0) {
    const url = `${this.apiUrl}/employees?limit=${limit}&offset=${offset}&include_inactive=true`;

    return new Promise((resolve, reject) => {
      const options = new URL(url);
      const req = https.request(options, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey,
          'X-API-Secret': this.apiSecret,
          'Content-Type': 'application/json',
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Invalid JSON from beeSuite: ${err.message}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('API timeout'));
      });
      req.end();
    });
  }
}

module.exports = BeesuiteSyncClient;
```

- [ ] Create `backend/src/services/beesuiteSyncClient.js` with API client
- [ ] Implement `getStaff()` method to fetch employees
- [ ] Add error handling (timeout, invalid JSON, API errors)
- [ ] Test: Can successfully fetch employees from beeSuite API

#### Task 2.3.2: Create sync logic

**File:** `backend/scripts/sync-beesuite-staff.js` (NEW)

```javascript
#!/usr/bin/env node
const { getDb } = require('../src/db');
const BeesuiteSyncClient = require('../src/services/beesuiteSyncClient');

async function syncBeesuitStaff() {
  const db = getDb();
  const startTime = new Date();
  const client = new BeesuiteSyncClient(
    process.env.BEESUITE_API_URL,
    process.env.BEESUITE_API_KEY,
    process.env.BEESUITE_API_SECRET
  );

  let stats = { created: 0, updated: 0, conflicts: 0 };
  let syncStatus = 'success';

  try {
    console.log('[SYNC] Starting beeSuite staff sync...');

    // Fetch all staff from beeSuite
    const response = await client.getStaff();
    const beesuitStaff = response.employees || [];
    console.log(`[FETCH] Retrieved ${beesuitStaff.length} staff from beeSuite`);

    // Process each staff member
    for (const beeStaff of beesuitStaff) {
      const existing = db.prepare('SELECT * FROM users WHERE beesuite_id = ?').get(beeStaff.id);

      if (!existing) {
        // NEW: Create user
        db.prepare(`
          INSERT INTO users (
            staff_email, staff_name, beesuite_id, department,
            job_title, is_active, last_sync
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          beeStaff.email,
          beeStaff.full_name,
          beeStaff.id,
          beeStaff.department,
          beeStaff.job_title,
          beeStaff.is_active ? 1 : 0,
          new Date().toISOString()
        );
        stats.created++;
      } else {
        // EXISTING: Check for conflicts
        const conflicts = detectConflicts(existing, beeStaff);

        if (conflicts.length === 0) {
          // No conflicts: update
          db.prepare(`
            UPDATE users SET
            department = ?, job_title = ?, is_active = ?, last_sync = ?
            WHERE beesuite_id = ?
          `).run(
            beeStaff.department,
            beeStaff.job_title,
            beeStaff.is_active ? 1 : 0,
            new Date().toISOString(),
            beeStaff.id
          );
          stats.updated++;
        } else {
          // Conflicts detected: log for HR review
          for (const conflict of conflicts) {
            db.prepare(`
              INSERT INTO beesuite_conflict_log
              (user_id, field_name, beesuite_value, stafftrack_value)
              VALUES (?, ?, ?, ?)
            `).run(
              existing.id,
              conflict.field,
              conflict.beesuite,
              conflict.current
            );
          }
          // Apply beeSuite values (source-of-truth)
          db.prepare(`
            UPDATE users SET
            department = ?, job_title = ?, is_active = ?, last_sync = ?
            WHERE beesuite_id = ?
          `).run(
            beeStaff.department,
            beeStaff.job_title,
            beeStaff.is_active ? 1 : 0,
            new Date().toISOString(),
            beeStaff.id
          );
          stats.conflicts += conflicts.length;
        }
      }
    }

    // Refresh org hierarchy
    refreshOrgHierarchy(db);

    console.log('[COMPLETE]', stats);
  } catch (err) {
    syncStatus = 'failed';
    console.error('[ERROR]', err.message);
  } finally {
    // Log sync result
    const endTime = new Date();
    db.prepare(`
      INSERT INTO beesuite_sync_log
      (start_time, end_time, status, total_records, created_records, updated_records, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      startTime.toISOString(),
      endTime.toISOString(),
      syncStatus,
      beesuitStaff?.length || 0,
      stats.created,
      stats.updated,
      syncStatus === 'failed' ? 'See logs' : null
    );
  }
}

function detectConflicts(current, beesuite) {
  const conflicts = [];
  if (current.staff_email !== beesuite.email) {
    conflicts.push({
      field: 'email',
      current: current.staff_email,
      beesuite: beesuite.email,
    });
  }
  if (current.job_title !== beesuite.job_title) {
    conflicts.push({
      field: 'job_title',
      current: current.job_title,
      beesuite: beesuite.job_title,
    });
  }
  return conflicts;
}

function refreshOrgHierarchy(db) {
  db.prepare('DELETE FROM org_hierarchy').run();
  db.prepare(`
    INSERT INTO org_hierarchy (employee_id, manager_id, department)
    SELECT id, manager_id, department FROM users
  `).run();
}

syncBeesuitStaff()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] Create `backend/scripts/sync-beesuite-staff.js`
- [ ] Implement sync logic (create new users, update existing, detect conflicts)
- [ ] Log sync results to beesuite_sync_log table
- [ ] Refresh org_hierarchy after sync
- [ ] Test: Run sync manually `node backend/scripts/sync-beesuite-staff.js`

#### Task 2.3.3: Schedule sync job

**File:** `docker-compose.yaml` OR use node-cron

**Option A: Docker Compose (Unix/Linux)**

Add new service to docker-compose.yaml:

```yaml
services:
  beesuite-sync:
    image: node:20-alpine
    working_dir: /app
    command: node backend/scripts/sync-beesuite-staff.js
    volumes:
      - ./backend:/app/backend
      - ./data:/app/data  # Shared SQLite database
    environment:
      - BEESUITE_API_URL=${BEESUITE_API_URL}
      - BEESUITE_API_KEY=${BEESUITE_API_KEY}
      - BEESUITE_API_SECRET=${BEESUITE_API_SECRET}
      - DB_PATH=/app/data/submissions.db
    # Run daily at 2am
    restart: always
    # (Docker doesn't have native cron, so use a wrapper or node-cron)
```

**Option B: Node Cron (simpler)**

Install `npm install node-cron` and create cron wrapper:

```javascript
// backend/src/services/cronScheduler.js
const cron = require('node-cron');
const { execSync } = require('child_process');

function startSyncScheduler() {
  // Run every day at 2am
  cron.schedule('0 2 * * *', () => {
    console.log('[CRON] Starting scheduled beeSuite sync...');
    try {
      execSync('node backend/scripts/sync-beesuite-staff.js', { stdio: 'inherit' });
    } catch (err) {
      console.error('[CRON ERROR]', err.message);
    }
  });
}

module.exports = { startSyncScheduler };
```

Then call in `backend/src/index.js`:

```javascript
const { startSyncScheduler } = require('./services/cronScheduler');

// After database initialization
app.listen(PORT, () => {
  startSyncScheduler();
  console.log(`StaffTrack API listening on port ${PORT}`);
});
```

- [ ] Choose scheduling method (Docker or node-cron)
- [ ] Configure to run daily at 2am (or as agreed with HR)
- [ ] Test: Sync runs on schedule
- [ ] Verify: Check beesuite_sync_log table for successful runs

### Phase 2.4: APIs for Sync Monitoring

#### Task 2.4.1: Sync status endpoint

**File:** `backend/src/routes/beesuite-staff.js` (NEW)

```javascript
const express = require('express');
const router = express.Router();
const { authorizePermission } = require('../middleware/authorize');
const { getDb } = require('../db');

// GET /api/beesuite/sync-status
router.get('/sync-status', authorizePermission('view_reports'), (req, res) => {
  const db = getDb();
  const lastSync = db.prepare(`
    SELECT * FROM beesuite_sync_log
    ORDER BY created_at DESC
    LIMIT 1
  `).get();

  res.json(lastSync || { status: 'never_synced' });
});

// GET /api/beesuite/conflicts
router.get('/conflicts', authorizePermission('manage_all_staff'), (req, res) => {
  const db = getDb();
  const conflicts = db.prepare(`
    SELECT bc.*, u.staff_email, u.staff_name
    FROM beesuite_conflict_log bc
    JOIN users u ON bc.user_id = u.id
    WHERE bc.resolved_at IS NULL
    ORDER BY bc.created_at DESC
  `).all();

  res.json(conflicts);
});

// POST /api/beesuite/conflicts/:id/resolve
router.post('/conflicts/:id/resolve', authorizePermission('manage_all_staff'), (req, res) => {
  const { resolution } = req.body;  // 'prefer_beesuite' or 'manual_review'
  const db = getDb();

  db.prepare(`
    UPDATE beesuite_conflict_log
    SET resolution = ?, resolved_at = ?
    WHERE id = ?
  `).run(resolution, new Date().toISOString(), req.params.id);

  res.json({ success: true });
});

module.exports = router;
```

- [ ] Create `backend/src/routes/beesuite-staff.js` with sync monitoring endpoints
- [ ] Add route to `backend/src/index.js`: `app.use('/api/beesuite', router)`
- [ ] Test: Can fetch sync status and conflicts

### Phase 2.5: Frontend UI

#### Task 2.5.1: Create sync dashboard

**File:** `public/beesuite-sync.html` (NEW) OR add to admin.html

```html
<div class="container">
  <h2>beeSuite Sync Status</h2>
  
  <div id="syncStatus" style="padding: 10px; border: 1px solid #ccc; margin-bottom: 20px;">
    <p>Last Sync: <span id="lastSyncTime">Loading...</span></p>
    <p>Status: <span id="syncStatusBadge">-</span></p>
    <p>Created: <span id="createdCount">-</span> | Updated: <span id="updatedCount">-</span></p>
  </div>

  <h3>Conflicts to Review</h3>
  <table id="conflictsTable">
    <thead>
      <tr>
        <th>User</th>
        <th>Field</th>
        <th>BeeSuite Value</th>
        <th>StaffTrack Value</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody id="conflicts"></tbody>
  </table>
</div>

<script>
async function loadSyncStatus() {
  const res = await fetch('/api/beesuite/sync-status', {
    headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
  });
  const status = await res.json();

  document.getElementById('lastSyncTime').textContent = status.created_at || 'Never';
  document.getElementById('syncStatusBadge').textContent = status.status || '-';
  document.getElementById('syncStatusBadge').style.color = status.status === 'success' ? 'green' : 'red';
  document.getElementById('createdCount').textContent = status.created_records || 0;
  document.getElementById('updatedCount').textContent = status.updated_records || 0;
}

async function loadConflicts() {
  const res = await fetch('/api/beesuite/conflicts', {
    headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
  });
  const conflicts = await res.json();

  const tbody = document.getElementById('conflicts');
  tbody.innerHTML = conflicts.map(c => `
    <tr>
      <td>${c.staff_email}</td>
      <td>${c.field_name}</td>
      <td>${c.beesuite_value}</td>
      <td>${c.stafftrack_value}</td>
      <td>
        <button onclick="resolveConflict(${c.id}, 'prefer_beesuite')">Use BeeSuite</button>
        <button onclick="resolveConflict(${c.id}, 'manual_review')">Manual Review</button>
      </td>
    </tr>
  `).join('');
}

async function resolveConflict(conflictId, resolution) {
  const res = await fetch(`/api/beesuite/conflicts/${conflictId}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('authToken')}`,
    },
    body: JSON.stringify({ resolution }),
  });

  if (res.ok) {
    loadConflicts();
  }
}

// Load on page load
loadSyncStatus();
loadConflicts();
</script>
```

- [ ] Create `public/beesuite-sync.html` with sync dashboard
- [ ] Create corresponding `public/beesuite-sync.js`
- [ ] Add link to menu.js
- [ ] Test: Sync status displays correctly

### Phase 2.6: Testing & Deployment

#### Task 2.6.1: Integration tests

**File:** `backend/test/integration/beesuite-sync.test.js` (NEW)

- [ ] Test: Mock beeSuite API returns employees
- [ ] Test: New employees are created in StaffTrack
- [ ] Test: Existing employees are updated
- [ ] Test: Conflicts are detected and logged
- [ ] Test: Sync completes < 30 seconds

#### Task 2.6.2: Deployment checklist

- [ ] Database tables created (beesuite_sync_log, beesuite_conflict_log, org_hierarchy)
- [ ] Sync job is scheduled (runs daily at 2am)
- [ ] APIs implemented (/api/beesuite/sync-status, /api/beesuite/conflicts)
- [ ] Frontend dashboard created
- [ ] Manual sync tested: `node backend/scripts/sync-beesuite-staff.js`
- [ ] Credentials secured (not in git, in Vault or .env)
- [ ] HR has verified first sync results
- [ ] Go/No-Go gate: beeSuite sync ready for production
- [ ] **Unblocks:** Analytics Dashboard (has clean staff data)

---

## Part 3-5: Analytics, CV Export, Skill Search (Summary)

Due to token limits, the remaining features follow the same structure:

### **Part 3: Analytics Dashboard (Week 2-6)**
- Materialized views (pre-aggregated data for performance)
- New APIs: `/api/analytics/utilization`, `/analytics/project-status`
- Recharts components (requires adding to package.json)
- Monitoring dashboards (Prometheus metrics)

### **Part 4: CV Export (Week 3-5)**
- Puppeteer + docx libraries
- New API: `/api/cv/export/:userId`
- Frontend modal for export options
- Temp file cleanup job

### **Part 5: Skill Search (Week 3-6)**
- Full-text search indexing on skill names
- Skill canonicalization script
- New APIs: `/api/skills/search`, `/api/skills/autocomplete`
- Search quality analytics

---

## Complete File Structure After Implementation

```
backend/
├── migrations/            (Optional if using sql files instead of JS)
├── scripts/
│   ├── sync-beesuite-staff.js       ✅ NEW
│   └── skill-canonicalization.js    ✅ NEW
├── src/
│   ├── middleware/
│   │   ├── authorize.js             ✅ NEW (replaces permissions checking)
│   │   └── ...existing
│   ├── routes/
│   │   ├── admin.js                 ✅ MODIFIED (add role management)
│   │   ├── auth.js                  ✅ MODIFIED (add roles to JWT)
│   │   ├── beesuite-staff.js        ✅ NEW
│   │   ├── analytics.js             ✅ NEW
│   │   ├── cv-export.js             ✅ NEW
│   │   ├── skill-search.js          ✅ NEW
│   │   └── ...existing
│   ├── services/
│   │   ├── beesuiteSyncClient.js    ✅ NEW
│   │   ├── cvExporter.js            ✅ NEW
│   │   ├── cronScheduler.js         ✅ NEW
│   │   └── ...existing
│   ├── utils/
│   │   ├── vault.js                 ✅ OPTIONAL (credentials)
│   │   └── ...existing
│   ├── db.js                        ✅ MODIFIED (schema for RBAC + sync + analytics)
│   ├── index.js                     ✅ MODIFIED (add new routes + cron scheduler)
│   └── ...existing
└── test/
    ├── unit/
    │   └── role-model.test.js       ✅ NEW
    └── integration/
        └── beesuite-sync.test.js    ✅ NEW

frontend/
├── public/
│   ├── admin-roles.html             ✅ NEW
│   ├── admin-roles.js               ✅ NEW
│   ├── beesuite-sync.html           ✅ NEW
│   ├── beesuite-sync.js             ✅ NEW
│   ├── analytics.html               ✅ NEW
│   ├── analytics.js                 ✅ NEW
│   ├── cv-export-modal.html         ✅ NEW (component)
│   ├── cv-export.js                 ✅ NEW
│   ├── skill-search.html            ✅ NEW
│   ├── skill-search.js              ✅ NEW
│   ├── menu.js                      ✅ MODIFIED (add nav links)
│   └── ...existing
└── src/
    ├── components/                  (React components for Analytics)
    │   ├── DashboardLayout.jsx      ✅ NEW
    │   ├── UtilizationChart.jsx     ✅ NEW
    │   └── ...
    └── ...

docker-compose.yaml                 ✅ MODIFIED (add beesuite-sync service if using cron)
package.json                        ✅ MODIFIED (add puppeteer, docx, node-cron, recharts, etc)
```

---

## Implementation Checklist Summary

### Phase Schedule

| Phase | Feature | Timeline | Status | Owner |
|-------|---------|----------|--------|-------|
| **1** | Role Model RBAC | Weeks 0-3 | ⬜ Not Started | [Backend Lead] |
| **2** | beeSuite Sync | Weeks 1-4 | ⬜ Not Started | [Backend + HR] |
| **3** | Analytics Dashboard | Weeks 2-6 | ⬜ Not Started | [Backend + Frontend] |
| **4** | CV Export | Weeks 3-5 | ⬜ Not Started | [Backend + Frontend] |
| **5** | Skill Search | Weeks 3-6 | ⬜ Not Started | [Backend + Data] |

### Quick Links to Detailed Sections

- [Part 1: Role Model Expansion](#part-1-role-model-expansion-rbac-refactor) — RBAC schema, JWT, permission middleware
- [Part 2: beeSuite Sync](#part-2-beeSuite-staff-catalog-sync) — API client, sync job, conflict detection
- **Part 3-5:** See [IMPLEMENTATION_PLAYBOOKS.md](IMPLEMENTATION_PLAYBOOKS.md) for detailed code

---

## Daily Standup Questions

Use these to track progress:

1. **Role Model (Week 0-3):** Are permission tests 100% passing? JWT includes roles?
2. **beeSuite (Week 1-4):** Did nightly sync complete successfully? Any conflicts?
3. **Analytics (Week 2-6):** Is dashboard loading < 2 seconds? Replica lag < 5 minutes?
4. **CV Export (Week 3-5):** Is export quality > 95%? No memory leaks?
5. **Skill Search (Week 3-6):** Is search relevance > 90%? No duplicate skills?

---

## Resources

- [Master Timeline & Coordination](MASTER_TIMELINE_AND_COORDINATION.md) — Gantt chart, dependencies, resource allocation
- [Implementation Playbooks](IMPLEMENTATION_PLAYBOOKS.md) — Copy-paste code snippets for each feature
- [Monitoring & Alerts](MONITORING_DASHBOARDS_AND_ALERTS.md) — Prometheus metrics, Grafana dashboards
- [Codebase Analysis](CODEBASE_ANALYSIS.md) — Existing systems documented

---

## Next Steps

1. **Assign teams** to each phase (using resource allocation from Master Timeline)
2. **Review** this checklist in your first team meeting
3. **Set up dev environment** with database and test data
4. **Start Phase 1** (Role Model) — it unblocks everything else
5. **Weekly progress review** — update status, identify blockers

**Ready to begin? Share this checklist with your team and assign owners to each task!**
