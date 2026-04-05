# Role Model Expansion - Orchestration & Governance

## Project Governance

### Decision-Making Authority

```
Tech Lead + Security Officer (Joint Authority)
    ↓
Orchestrator (RBAC Product Owner)
    ↓
├─ Backend Lead (RBAC implementation, JWT)
├─ Security Officer (Permission model, vulnerability testing)
├─ Frontend Lead (Role-based UI rendering)
└─ QA Lead (Permission testing, edge cases)
```

### Role Responsibilities

| Role | Responsibilities | Success Metric |
|------|------------------|-----------------|
| **Orchestrator** | Timeline, role definitions, permission conflicts | RBAC live in 3 weeks |
| **Backend Lead** | Role tables, JWT embedding, authorization middleware | API enforces permissions |
| **Security Officer** | ADR review, permission model audit, pen testing | Zero permission vulnerabilities |
| **Frontend Lead** | Role-based UI rendering, conditional features | UI respects permissions |
| **QA Lead** | Permission tests, edge cases, privilege escalation attempts | 100+ tests passing |

### Communication Cadence

| Frequency | Meeting | Attendees | Purpose |
|-----------|---------|-----------|---------|
| **3x/week** | Permission design review | Sec + Backend + Orchestrator | Role definitions, edge cases |
| **Weekly** | Status + risk review | All leads | Progress, permission conflicts discovered |
| **Pre-launch** | Security audit | Security Officer + Orchestrator | Vulnerability assessment |

---

## Project Timeline

**Duration:** 3 weeks  
**Team Size:** 3 FTE  
**Criticality:** HIGH (security-critical)

### Phase 1: Permission Model Design (Days 1-3)
- ✅ Document all roles (Staff, Manager, Admin, Recruiter, Finance)
- ✅ Document all permissions (view_own, view_team, manage_all, etc.)
- ✅ Design matrix: Role → Permissions
- ✅ Security review (catch privilege escalation attempts)

**Deliverable:** Approved permission matrix + ADR documentation

### Phase 2: Database Schema & APIs (Days 3-8)
- ✅ Schema migration (new users, user_roles, permissions tables)
- ✅ Backward compatibility (migrate old role → new roles)
- ✅ Authorization middleware (check permissions)
- ✅ JWT structure (roles embedded)

**Deliverable:** Schema ready, APIs authorize correctly

### Phase 3: Role Assignment & Defaults (Days 8-11)
- ✅ Auto-assign default roles (new staff → "Staff" role)
- ✅ Assign existing staff roles (migrate from old system)
- ✅ Admin tool for granting/revoking roles
- ✅ Audit trail (log role changes)

**Deliverable:** All staff have roles assigned

### Phase 4: Testing & Audit (Days 11-17)
- ✅ Permission tests (100+ test cases)
- ✅ Edge case testing (conflicting roles, temporary roles)
- ✅ Privilege escalation testing (can user self-grant roles?)
- ✅ Penetration testing (external security consultant?)

**Deliverable:** Zero security vulnerabilities found

### Phase 5: Deployment (Days 17-21)
- ✅ Staging dry-run (all tests pass)
- ✅ Production deployment
- ✅ Feature flag (gradual rollout)
- ✅ Monitoring & alerting

**Deliverable:** RBAC live to all users

---

## Risk Management

### Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **Permission bug grants unauthorized access** | Medium (20%) | Critical | Comprehensive tests; code review; pen testing |
| **Role assignment incomplete (staff missing roles)** | Medium (20%) | Medium | Reconciliation script (verify all staff have roles) |
| **Default roles too restrictive (staff can't see needed data)** | Medium (25%) | Medium | User testing; easy to add permissions; rapid fix |
| **Default roles too permissive (staff see too much)** | Low (10%) | High | Security review before launch; principle of least privilege |
| **JWT role claim spoofing (user changes token)** | Very Low (1%) | Critical | Sign JWT; verify signature on every request |
| **Permission table corrupt / unreadable** | Very Low (2%) | High | Backup & restore; cache permissions in memory |
| **migrating old roles to new system loses data** | Low (8%) | Medium | Backup old data; test migration; manual review |

---

## Stakeholder Communication

### Manager Communication

| Phase | Audience | Message |
|-------|----------|---------|
| **Week 1** | Managers | "New role system coming; you'll be assigned 'Manager' role" |
| **Week 2** | Managers | "Role system live; you can now see your team dashboard" |

### Admin Communication

| Phase | Message |
|-------|---------|
| **Week 1** | "Admins: You'll have access to role management console" |
| **Week 2** | "Admin console live; grant roles to new staff here" |

### Security Communication

| Phase | Message |
|-------|---------|
| **Pre-launch** | "Security: Comprehensive testing planned; pen testing scheduled" |
| **Post-launch** | "Zero vulnerabilities found; monitoring permission errors" |

---

## Permission Enforcement Points

### Backend Enforcement

```javascript
// Middleware: Check permission before API access
router.get('/api/team/staff',
  requireRole(['Manager', 'Admin']),
  getTeamStaff
);

// Inside handler: Apply data filtering
async function getTeamStaff(req, res) {
  const managerId = req.user.id;
  const team = await db.query(
    'SELECT * FROM staff WHERE manager_id = ?',
    [managerId]
  );
  return res.json(team);
}
```

### Frontend Enforcement

```javascript
// Conditionally render features based on role
function ManagerPanel({ user }) {
  if (!user.roles.includes('Manager')) {
    return null;  // Don't render manager controls
  }
  return <div>Manager-specific features</div>;
}
```

### Database Enforcement

```sql
-- Application-level filters (MySQL doesn't support RLS)
-- Enforce in code: "Managers can only see direct reports"
SELECT * FROM staff WHERE manager_id = ?
```

---

## Orchestrator Checklist

### Before Launch

- [ ] **Permission Model**
  - [ ] All roles defined (Staff, Manager, Admin, etc.)
  - [ ] All permissions defined (view_own, view_team, etc.)
  - [ ] Role → Permission matrix documented + approved
  - [ ] Edge cases handled (what if Manager + Admin?)
  
- [ ] **Development**
  - [ ] Schema migration written and tested
  - [ ] JWT role embedding working
  - [ ] Authorization middleware enforcing permissions
  - [ ] All APIs check permissions
  
- [ ] **Role Assignment**
  - [ ] Default role assignment logic implemented
  - [ ] Existing staff migrated to new role system
  - [ ] Migration validation (all staff have roles?)
  - [ ] Audit trail showing who got which roles
  
- [ ] **Testing**
  - [ ] 100+ permission tests written + passing
  - [ ] Edge cases tested (conflicting roles, etc.)
  - [ ] Privilege escalation tests passed
  - [ ] JWT signature validation tested
  
- [ ] **Security**
  - [ ] Security review completed + approved
  - [ ] Penetration testing done (or scheduled)
  - [ ] No vulnerabilities found in permission logic
  
- [ ] **UI**
  - [ ] Role-based UI rendering conditional on role
  - [ ] Managers see manager-only controls
  - [ ] Staff see staff-only data
  - [ ] Admins see admin panel
  
- [ ] **Documentation**
  - [ ] Permission matrix documented
  - [ ] Role assignment guide written
  - [ ] Admin console documented
  - [ ] Troubleshooting guide (permission denied errors)

### Launch Day

**T-4 hours:**
- [ ] Final security review (no issues)
- [ ] Staging validation (all tests passing)
- [ ] Feature flag ready (disabled by default)

**T-2 hours:**
- [ ] Monitoring dashboard open
- [ ] On-call engineer aware (be ready for permission errors)

**T (Deploy):**
- [ ] Feature flag: RBAC_ENABLED=true
- [ ] Monitor error rate (should be 0)
- [ ] Monitor permission denial errors (should be few, expected)

**T+1 hour:**
- [ ] Spot-check: Can managers see their teams?
- [ ] Spot-check: Can staff see their profiles?
- [ ] Spot-check: Can admins access admin panel?

**T+24 hours:**
- [ ] Review permission denial logs (expected edge cases?)
- [ ] Declare launch successful

---

## Contingency Plans

### If Permission Bug Found (Data Leak)

1. Immediately: Rollback (feature flag = false)
2. Investigate: Which permission is missing?
3. Fix + test thoroughly
4. Security review before re-enabling
5. Re-launch with targeted fix

### If Role Assignment Incomplete

1. Check reconciliation script (did all staff get roles?)
2. If some staff missing roles: Assign default role + audit
3. Send notification to affected staff
4. HR review (should these staff have different roles?)

### If Default Roles Too Restrictive

1. User reports: "I can't see X, but I should be able to"
2. Easy fix: Add permission to their role + grant role to user
3. OR: Change default role for that user type
4. No rollback needed (backwards compatible)

### If Permission Test Failures

1. Review failing test (what permission not working?)
2. Investigate code (why not enforced?)
3. Fix permission check + re-test
4. Add to regression test suite

