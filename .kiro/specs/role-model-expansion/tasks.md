# Role Model Expansion — Implementation Tasks

---

## Task 1: Database Schema Migration
- [ ] 1.1 Create migration script `backend/scripts/migrate-role-model.js`
  - [ ] Add role CHECK constraint (admin | hr | coordinator | sa_presales | sales | staff)
  - [ ] Create user_roles_new table with updated schema
  - [ ] Backfill existing roles maintaining current values
  - [ ] Drop old table and rename new
  - [ ] Verify all users have valid role values
- [ ] 1.2 Create `role_audit_log` table for tracking role changes
  - [ ] Columns: id, user_email, old_role, new_role, changed_by, changed_at
  - [ ] Add primary key and timestamp with UTC default
- [ ] 1.3 Add seed data for test users with new roles
  - [ ] Create admin test user (role: admin)
  - [ ] Create hr user (role: hr)
  - [ ] Create sa_presales user (role: sa_presales)
  - [ ] Create sales user (role: sales)

**Acceptance Criteria:**
- _Requirements: 1, 3_
- All role values are valid ENUM-like constraint
- Audit log captures all role changes with admin name
- Seed users are created and accessible in dev environment

---

## Task 2: Backend RBAC Middleware & Utils
- [ ] 2.1 Create `backend/src/middleware/authMiddleware.js`
  - [ ] Implement `requireRole(...allowedRoles)` middleware
  - [ ] Extract role from req.session.user
  - [ ] Return 403 Forbidden if role not in allowedRoles
  - [ ] Add error response with required role names
- [ ] 2.2 Create `backend/src/utils/rolePermissions.js`
  - [ ] Define ROLE_PERMISSIONS constant with all 6 roles
  - [ ] Implement `hasPermission(role, permission)` function
  - [ ] Export permission matrix for API docs
- [ ] 2.3 Update `backend/src/middleware/index.js`
  - [ ] Export requireRole middleware
  - [ ] Document how to use in route guards

**Acceptance Criteria:**
- _Requirements: 3, 4_
- requireRole correctly allows/denies based on assigned role
- All 6 roles have complete permission lists
- hasPermission checks work for all permission types

---

## Task 3: Admin API Endpoint (User Role Assignment)
- [ ] 3.1 Add POST /api/admin/user-roles endpoint in `backend/src/routes/admin.js`
  - [ ] Validate requesting user is admin
  - [ ] Accept JSON: { email, role }
  - [ ] Validate email Format, role is valid enum
  - [ ] Check user exists in user_roles table
  - [ ] Update user role in database
  - [ ] Log change to role_audit_log
  - [ ] Invalidate in-memory token for changed user
  - [ ] Return 200 with updated user data
- [ ] 3.2 Add GET /api/admin/user-roles endpoint (list all users)
  - [ ] Return all users with their current roles
  - [ ] Support pagination (limit, offset)
  - [ ] Filter by role if query param provided
- [ ] 3.3 Add error handling
  - [ ] 400 Bad Request if invalid role/email
  - [ ] 403 Forbidden if user not admin
  - [ ] 404 Not Found if user doesn't exist

**Acceptance Criteria:**
- _Requirements: 1, 3_
- Admin can assign roles via API
- Role changes are logged to audit_log table
- Invalid role values are rejected
- Non-admin users cannot access endpoint

---

## Task 4: Frontend Auth & Role Integration
- [ ] 4.1 Update `public/app.js`
  - [ ] Call GET /api/auth/me on app init
  - [ ] Extract user.role from response
  - [ ] Store role in localStorage
  - [ ] Display formatted role label in header
  - [ ] Redirect to login if unauthorized
- [ ] 4.2 Update `public/index.html`
  - [ ] Add #userRole span to header
  - [ ] Add CSS class for role badge styling
  - [ ] Display role alongside email in user info section
- [ ] 4.3 Create role formatting utility
  - [ ] Map internal roles to display labels (admin → Administrator, etc)
  - [ ] Export formatRoleLabel function for reuse

**Acceptance Criteria:**
- _Requirements: 4_
- Header displays user's assigned role
- Role labels are user-friendly (Solution Architect, Sales / BD)
- Auth flow includes role in response

---

## Task 5: Role-Based Menu Navigation
- [ ] 5.1 Update `public/menu.js`
  - [ ] Create MENU_BY_ROLE object with all 6 roles
  - [ ] Define allowed pages for each role per permission matrix
  - [ ] Implement buildMenuForRole function
  - [ ] Generate menu dynamically based on user role
  - [ ] Hide unauthorized menu items
- [ ] 5.2 Add route guards in core pages
  - [ ] admin.html: Require admin role, else redirect
  - [ ] catalog.html: Require admin role, else redirect
  - [ ] staff-view.html: Require admin|hr|coordinator|sa_presales|sales
  - [ ] projects.html: Require admin|coordinator role
  - [ ] submission.html: Allow all authenticated users
- [ ] 5.3 Create permission check utility in `public/utils/permissions.js`
  - [ ] Implement canAccess(pageName, userRole) function
  - [ ] Return boolean for route guards
  - [ ] Export redirection logic

**Acceptance Criteria:**
- _Requirements: 1, 2, 3_
- Menu shows only permitted pages for user role
- Unauthorized page access redirects to allowed page
- All 6 roles have correct menu per permission matrix

---

## Task 6: API Endpoint RBAC Guards
- [ ] 6.1 Apply middleware to existing endpoints in admin.js
  - [ ] POST /api/admin/user-roles: requireRole('admin')
  - [ ] GET /api/admin/user-roles: requireRole('admin')
- [ ] 6.2 Apply middleware to staff endpoints in staff-view.js
  - [ ] GET /api/staff: requireRole('admin', 'hr', 'coordinator', 'sa_presales', 'sales')
  - [ ] Restrict sensitive fields for non-admin users
- [ ] 6.3 Apply middleware to CV endpoints in cv-profile.js
  - [ ] GET /api/cv/:userId: requireRole('admin', 'hr', 'sa_presales', 'sales')
  - [ ] POST /api/cv/export: requireRole('admin', 'hr', 'sa_presales', 'sales')
  - [ ] Allow staff to only access own CV
- [ ] 6.4 Apply middleware to project endpoints in projects.js
  - [ ] POST/PUT /api/projects: requireRole('admin', 'coordinator')
  - [ ] GET /api/projects: requireRole('admin', 'coordinator', 'sa_presales', 'sales') (read-only for SA/Sales)

**Acceptance Criteria:**
- _Requirements: 1, 3_
- All API endpoints enforce correct roles
- Requests from unauthorized users return 403
- Staff can only access own data unless admin/hr

---

## Task 7: Skill Search Page Enhancement (SA/Sales)
- [ ] 7.1 Verify/enhance skills.html for SA/Pre-Sales and Sales roles
  - [ ] Confirm page is accessible to sa_presales and sales roles
  - [ ] Ensure skill search filters work
  - [ ] Display staff results with manager, department, skills
  - [ ] Add "Generate CV" button in results
- [ ] 7.2 Update skills.js
  - [ ] Check user role, restrict features if staff
  - [ ] Add client-side role check before showing CV export button
  - [ ] Log skill search analytics (optional)
- [ ] 7.3 Create/update Skill Search route guard
  - [ ] Require admin|hr|coordinator|sa_presales|sales roles
  - [ ] Redirect staff users to own submission page

**Acceptance Criteria:**
- _Requirements: 1, 2_
- SA/Pre-Sales can access skill search
- Sales can access skill search
- Staff users cannot access skill search

---

## Task 8: Testing & Validation
- [ ] 8.1 Unit test: Role permission matrix (test/unit/rolePermissions.test.js)
  - [ ] Test hasPermission returns true for valid role-permission pairs
  - [ ] Test hasPermission returns false for invalid/missing permissions
  - [ ] Test all 6 roles have correct permission lists
- [ ] 8.2 Integration test: API endpoint RBAC
  - [ ] POST /api/admin/user-roles with admin user → 200
  - [ ] POST /api/admin/user-roles with non-admin user → 403
  - [ ] GET /api/staff with sa_presales → 200 (read-only)
  - [ ] GET /api/admin pages with staff user → 403
- [ ] 8.3 Manual E2E test: Full workflows
  - [ ] Login as admin, confirm admin menu
  - [ ] Login as sa_presales, confirm skill-search accessible
  - [ ] Login as sales, confirm cv-export accessible
  - [ ] Assign new role via admin panel
  - [ ] Verify next login reflects new role and permissions

**Acceptance Criteria:**
- _Requirements: 1, 2, 3_
- All unit tests pass (100% role matrix coverage)
- All API endpoints respect RBAC
- E2E test confirms role-based access control works end-to-end

---

## Task 9: Documentation & Deployment
- [ ] 9.1 Update API documentation
  - [ ] Document new POST /api/admin/user-roles endpoint
  - [ ] Document GET /api/auth/me response includes role
  - [ ] Add role/permission reference table to docs
- [ ] 9.2 Create deployment guide
  - [ ] Document database migration steps
  - [ ] Provide rollback procedure
  - [ ] Note role assignment for existing users (must be manual)
- [ ] 9.3 Update README
  - [ ] Add new roles to Roles & Access section
  - [ ] Update permission matrix table
  - [ ] Add SA/Pre-Sales and Sales to feature descriptions

**Acceptance Criteria:**
- _Requirements: 3_
- API docs include new role assignment endpoints
- Deployment guide covers schema migration
- README reflects 6-role permission matrix

---

## Dependencies
- Task 1 must complete before Task 2 (schema required for migrations)
- Task 2 must complete before Task 3 (RBAC middleware required for endpoints)
- Task 3 must complete before Task 5 (admin endpoint required for menu testing)
- Task 4 can run in parallel with Tasks 2-3

## Traceability
- _Requirements: 1 (SA/Pre-Sales access), 2 (Sales access), 3 (Permission matrix), 4 (Role visibility)_
