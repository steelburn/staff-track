# Role Model Expansion — Requirements

## Feature Overview
Extend StaffTrack's user role system to support Solution Architect (SA/Pre-Sales) and Sales personas, enabling better tender/proposal workflows and staff matching capabilities.

---

## User Stories

### 1. SA/Pre-Sales Role Access
**As a** Solution Architect (SA/Pre-Sales)  
**I want** to search, filter, and view staff profiles by skills  
**So that** I can quickly identify qualified candidates for tender requirements and RFP responses.

**Acceptance Criteria (EARS):**
- Given I am logged in as SA/Pre-Sales, When I access the Staff Search page, Then I see a filtered view showing only staff profiles (not admin tools)
- Given I have SA/Pre-Sales role, When I search for staff by skill criteria, Then results display full staff information including manager, department, and CV capabilities
- Given I am SA/Pre-Sales, When I view a staff member's profile, Then I can generate and export their CV for proposals

### 2. Sales Role Access
**As a** Sales/Business Development user  
**I want** to search for staff and generate CVs for proposals  
**So that** I can quickly prepare submission materials for client tenders.

**Acceptance Criteria (EARS):**
- Given I am logged in as Sales, When I access the Staff Search page, Then I see a filtered view optimized for proposal generation
- Given I am Sales, When I search staff by skills/projects, Then I can view staff profiles and past project experience
- Given I am Sales, When I use the Org Chart, Then I see the current organizational structure with read-only access
- Given I am Sales, When I export a staff CV, Then I can download it in PDF or DOCX format

### 3. Permission Matrix Enforcement
**As an** Admin  
**I want** to assign users to SA/Pre-Sales or Sales roles  
**So that** different business personas can access the system with appropriate permissions.

**Acceptance Criteria (EARS):**
- Given I am Admin, When I access User Role Management, Then I can assign users to: Admin, HR, Coordinator, SA/Pre-Sales, Sales, or Staff
- Given I assign a user to SA/Pre-Sales role, When they next login, Then they see only skill-search and CV-generation pages
- Given I assign a user to Sales role, When they next login, Then they see skill-search, cv-generation, and org-chart pages
- Given non-Admin users access restricted pages, When they lack permission, Then they see a 403 Forbidden error with redirect to permitted pages

### 4. Role Visibility in Header
**As a** user with any role  
**I want** to see my current role displayed in the UI  
**So that** I know what permissions I have in the system.

**Acceptance Criteria (EARS):**
- Given I am logged in, When I view the header/menu bar, Then my role (Admin/HR/Coordinator/SA-PreSales/Sales/Staff) is displayed
- Given my role is SA/Pre-Sales, When I view the role label, Then it displays as "Solution Architect" or "SA/Pre-Sales"
- Given my role is Sales, When I view the role label, Then it displays as "Sales / BD"

---

## Detailed Requirements

### Navigation & Access Control

| Feature | Admin | HR | Coordinator | SA/Pre-Sales | Sales | Staff |
|---------|-------|----|----|---------|-------|-------|
| My Submission (own) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| My CV Profile (own) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Skill Search / Filter | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| View Staff Profiles | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| View/Generate CV (any) | ✅ | ✅ | — | ✅ | ✅ | Own only |
| Export CV (PDF/DOCX) | ✅ | ✅ | — | ✅ | ✅ | Own only |
| Org Chart (read) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Projects Management | ✅ | — | ✅ | — (read) | — (read) | — |
| Export HR Reports | ✅ | ✅ | — | — | — | — |
| User/Role Management | ✅ | — | — | — | — | — |
| Catalog Management | ✅ | — | — | — | — | — |

### Backend Role Storage
- **Database Column**: `user_roles.role` ENUM('admin', 'hr', 'coordinator', 'sa_presales', 'sales', 'staff')
- **In-Memory Token**: Store role alongside email in token map for quick permission checks
- **Default on Signup**: New users default to 'staff' role (admin must assign higher permissions)

### Frontend Menu Routing
- **Admin Dashboard**: Full menu (all pages)
- **HR Dashboard**: My Submission, Staff View, My CV, Org Chart, Reports Export
- **Coordinator Dashboard**: My Submission, My CV, Projects, Staff View, Org Chart
- **SA/Pre-Sales Dashboard**: My Submission, My CV, **Skill Search**, **Org Chart**
- **Sales Dashboard**: My Submission, My CV, **Skill Search**, **Org Chart**
- **Staff Dashboard**: My Submission, My CV, Org Chart

---

## Non-Functional Requirements

- **Performance**: Page load <2s even with 5000+ staff records
- **Security**: Role-based access control (RBAC) enforced on every API endpoint
- **API Versioning**: No new endpoints; leverage existing `/api/` paths with role-based response filtering
- **Database Consistency**: All role validations must happen server-side, never trust client role claims
- **Backward Compatibility**: Existing 4-role system (Admin, HR, Coordinator, Staff) must remain functional

---

## Assumptions & Constraints

- Users cannot self-assign roles (admin-only capability)
- In-memory role token storage remains in place; no persistent role storage beyond DB
- Login flow remains email-only (no password changes)
- Existing CVs remain accessible; new roles inherit CV visibility rules
