# Role Model Expansion - Architecture & Decisions

## Executive Summary

StaffTrack evolves from tracking a single "Staff" role to supporting multiple professional roles (Manager, Admin, Recruiter, HR Partner, Finance Officer). This document captures architectural decisions for flexible, scalable role-based access control (RBAC) and permission management.

---

## Part 1: Architecture Decision Records (ADRs)

### ADR-001: RBAC Model (Role-Based vs. Attribute-Based vs. Policy-Based)

**Status:** Accepted  
**Decision:** Role-based (RBAC) for MVP, structure for ABAC migration later

**Model:**
```
┌──────────────┐
│   Roles      │
├──────────────┤
│ Staff        │ Can: View own profile, submit CV, view own projects
│ Manager      │ Can: View team, approve submissions, allocate staff
│ Admin        │ Can: Manage users, configure templates
│ Recruiter    │ Can: Create projects, pre-screen candidates
│ Finance Mgr  │ Can: Generate P&L reports, manage billing
└──────────────┘
       │
       ├─ Has Permissions (e.g., Manager has [view_team, approve_submission])
       │
       └─ Applied via Middleware (check permission before API access)
```

**Why RBAC not ABAC/Policy-based?**
| Approach | Simplicity | Flexibility | Suitable For |
|----------|-----------|------------|-------------|
| **RBAC** | Simple | Limited | Predefined, stable roles |
| **ABAC** | Complex | Very flexible | Dynamic attributes |
| **Policy** | Very complex | Maximum | Enterprise access control |

**Decision:** RBAC for MVP (staff has 6-8 roles, unlikely to change weekly).
Plan: If complex policies needed later (e.g., "Manager of Finance department"), migrate to ABAC.

---

### ADR-002: Role Inheritance (Flat vs. Hierarchical)

**Status:** Accepted  
**Decision:** Flat roles + role combinations (not hierarchical inheritance)

**Model:**
```
❌ Hierarchical (over-engineered):
   Admin
   ├─ Manager (inherits Admin permissions? No, wrong model)
   └─ Staff

✓ Flat roles + combinations:
   - Staff → Can view own data
   - Manager + Staff → Can also view team
   - Admin + Manager → Can also manage users
   - roles = ["Staff", "Manager"]  // User has both
```

**Why flat?**
- Roles not strictly hierarchical (Manager ∦ Admin)
- Some staff are both "Staff" + "Manager" (own projects + manage team)
- Simpler permission resolution (just check all roles' permissions)
- Easier to test (no inheritance chains)

---

### ADR-003: Data Isolation Model (Row-Level Security)

**Status:** Accepted  
**Decision:** Application-level filtering + database-level soft borders

**Implementation:**
```
When Manager requests: GET /api/team/staff
  Application code:
    1. Check role permission: "view_team" ✓
    2. Get manager_id from JWT
    3. Filter SQL: SELECT * FROM staff WHERE manager_id = {current_user_id}
    4. Return filtered results

Not using: MySQL row-level security (RLS)
  - Not available in MySQL 8.0 (PostgreSQL has it)
  - Application-level more portable
  - Easier to debug/audit
```

---

### ADR-004: Permission Granularity (Coarse vs. Fine)

**Status:** Accepted  
**Decision:** Coarse-grained permissions (bundles of related actions)

**Model:**
```
❌ Fine-grained (over-engineered):
  - view_submissions
  - create_submissions
  - edit_own_submissions
  - delete_submissions
  - view_other_submissions
  - export_submissions
  - ... (20+ permissions)

✓ Coarse-grained (pragmatic):
  - manage_own_profile
  - manage_team
  - manage_all_staff
  - manage_submissions
  - manage_projects
  - admin_access
  - ... (6-8 permission groups)

Logic resides in code:
  if (user has "manage_own_profile") {
    can view own profile ✓
    can edit own profile ✓
    cannot edit others' profiles ✗  // enforced in code
  }
```

**Why coarse?**
- Easier to grant (fewer permission combinations)
- Less buggy (fewer edge cases)
- Faster to enforce (fewer checks)

---

### ADR-005: Permanent Roles vs. Time-Bound Roles

**Status:** Accepted  
**Decision:** Permanent roles for MVP; structure for time-bound later

**Rationale:**
```
Scenario: Alice is temporary project manager (3 months)
  
Option 1 (Permanent):
  - Assign role: Manager
  - After 3 months: Manually remove role
  - Risk: Forgotten, Alice keeps access

Option 2 (Time-bound):
  - Assign role: Manager (expires 2026-07-01)
  - Auto-revoke on expiration
  - More complex: DB schema, cron job

Decision (MVP): Permanent
- Most staff roles don't change frequently
- Manual removal acceptable
- Can add auto-expiry later if needed
```

---

### ADR-006: Audit Trail (What Access a User Has)

**Status:** Accepted  
**Decision:** Log all role changes (who, what, when) in audit table

**Model:**
```sql
CREATE TABLE role_audit_log (
  id UUID PRIMARY KEY,
  user_email VARCHAR(255),
  action ENUM('role_granted', 'role_revoked'),
  role_name VARCHAR(100),
  granted_by VARCHAR(255),    -- Admin who made the change
  timestamp DATETIME,
  reason VARCHAR(500)          -- Why? (e.g., "Promotion", "Termination")
);

Example:
  - 2026-03-01 10:00 : role_granted    alice@example.com, Manager, granted_by:charlie@example.com, reason:"Promotion"
  - 2026-04-01 15:30 : role_revoked    alice@example.com, Manager, granted_by:charlie@example.com, reason:"Project end"
```

**Purpose:** Compliance + debugging (if user complains about lost access, check log).

---

### ADR-007: Default Roles (What does new staff start with?)

**Status:** Accepted  
**Decision:** New staff default to "Staff" role (read their own data only)

**Model:**
```
When new user created in beeSuite HRIS:
  1. StaffTrack syncs new staff
  2. Auto-create user with role: ["Staff"]
  3. If manager in HRIS: Also add ["Manager"] role
  4. If C-suite position: Manual admin assignment of other roles

Not auto-granting heavily privileged roles (security principle: least privilege)
```

---

### ADR-008: Missing Features for P1 (Documented as Future Work)

**Status:** Deferred  
**Decision:** These features planned for P2, not P1

| Feature | Why Defer |
|---------|-----------|
| **Department-based access** | Add later if needed (e.g., Finance dept sees budgets) |
| **Temporary role assignments** | Add later (too complex for P1) |
| **Delegation (Manager delegates authority)** | Add later |
| **Role templates (clone config)** | Add later (only 6 roles) |

---

## Part 2: System Integration Points

### 2.1 Data Model Changes

```sql
-- Current (Single "Staff" Role)
CREATE TABLE user_roles (
  email VARCHAR(255) PRIMARY KEY,
  role VARCHAR(50),          -- Single value: 'staff' or 'admin'
  is_active TINYINT
);

-- New (Multiple Roles)
DROP TABLE user_roles;

CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  is_active TINYINT,
  created_at DATETIME
);

CREATE TABLE user_roles (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) FOREIGN KEY,
  role_name VARCHAR(100),    -- 'Staff', 'Manager', 'Admin', etc.
  granted_at DATETIME,
  granted_by VARCHAR(255),
  UNIQUE (user_id, role_name)  -- Prevent duplicate roles
);

CREATE TABLE permissions (
  id VARCHAR(36) PRIMARY KEY,
  role_name VARCHAR(100),
  permission VARCHAR(100),   -- 'view_own_profile', 'manage_team', etc.
  FOREIGN KEY (role_name) REFERENCES roles(name)
);

CREATE TABLE roles (
  name VARCHAR(100) PRIMARY KEY,
  description VARCHAR(500),
  created_at DATETIME
);
```

### 2.2 Authentication & Authorization Flow

```
1. User logs in
   POST /auth/login { email, password }
   → Validate credentials
   → Check is_active
   → Fetch user's roles from DB

2. Generate JWT with roles embedded
   jwt = sign({
     email: alice@example.com,
     roles: ['Staff', 'Manager'],
     exp: now + 24h
   })

3. Return JWT to client
   { token: "eyJhbGc..." }

4. Client includes JWT in requests
   GET /api/team/staff
   Headers: Authorization: Bearer eyJhbGc...

5. Backend middleware extracts roles from JWT
   roles = jwt.decode().roles  // ['Staff', 'Manager']

6. Check permission
   if (roles includes 'Manager') {
     ✓ Authorized
     Execute request
   } else {
     ✗ Forbidden
     Return 403
   }
```

### 2.3 Authorization Middleware

```javascript
// middleware/authorize.js
exports.requireRole = (requiredRoles) => {
  return (req, res, next) => {
    const userRoles = req.user.roles;  // From JWT
    const hasRole = requiredRoles.some(r => userRoles.includes(r));
    
    if (!hasRole) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
};

// Usage in routes:
router.get('/api/team/staff',
  requireRole(['Manager', 'Admin']),
  getTeamStaff
);
```

### 2.4 UI Components (Frontend)

```javascript
// Conditionally render based on role
export const ManagerPanel = ({ user }) => {
  if (!user.roles.includes('Manager')) {
    return null;  // Don't show panel
  }
  return <div>Manager-only controls</div>;
};
```

---

## Part 3: Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **Permission bug allows unauthorized access** | Medium (20%) | Critical | Comprehensive permission tests; code review; penetration testing |
| **Staff still has Manager role after demotion** | Low (10%) | High | Audit trail + monthly verification script |
| **Default role too restrictive (staff can't see projects)** | Low (10%) | Medium | User testing; easy to add permissions |
| **Multiple roles cause performance issue** | Very Low (2%) | Medium | Role lookups cached in JWT; full re-fetch only on login |
| **Role complexity becomes unmaintainable** | Low (8%) | Medium | Document well; keep coarse-grained; migrate to ABAC if needed |

---

## Part 4: Success Criteria & Acceptance

### 4.1 Functional Requirements
- ✅ Staff can have multiple roles
- ✅ Different roles have different permissions
- ✅ Manager role grants access to team data
- ✅ Admin role grants access to system management
- ✅ New staff default to "Staff" role
- ✅ Roles persist across sessions
- ✅ Admin can grant/revoke roles

### 4.2 Non-Functional Requirements
- ✅ Role checks complete in < 1ms (cache in memory)
- ✅ No additional database query per request (roles in JWT)
- ✅ Audit log captures all role changes
- ✅ Permission changes take effect immediately (no delayed propagation)

### 4.3 Security Requirements
- ✅ Users cannot self-assign roles (only admins)
- ✅ Audit trail protected (only admins can view)
- ✅ Roles in JWT signed and tamper-proof
- ✅ Expired tokens force re-login (roles refreshed)

---

## Part 5: Architecture Validation Checklist

**Architect Review (Before implementation):**
- [ ] RBAC model approved by security team
- [ ] Permission matrix documented and approved
- [ ] JWT role embedding approach reviewed
- [ ] Audit trail retention policy approved
- [ ] Default role assignments reviewed
- [ ] Performance characteristics confirmed (sub-ms checks)
- [ ] Migration plan from old to new role model documented

**Go/No-Go Approval:** _Pending Tech Lead + Security Officer sign-off_

