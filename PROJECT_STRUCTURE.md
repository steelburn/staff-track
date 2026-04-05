# StaffTrack - Project Structure

```
staff-track/
│
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.js          # JWT authentication, token management
│   │   │   ├── submissions.js   # Staff submissions CRUD
│   │   │   ├── admin.js         # Admin operations, user management
│   │   │   ├── catalog.js       # Read-only catalog endpoints
│   │   │   ├── cv_profiles.js   # CV profile management, templates
│   │   │   ├── reports.js       # Reports API (staff, skills, projects)
│   │   │   ├── managed_projects.js # Coordinator project management
│   │   │   └── data-tools.js    # Backup/restore endpoints
│   │   │
│   │   ├── db.js                # Database initialization, migrations
│   │   ├── utils.js             # CSV parsing utilities
│   │   ├── index.js             # Express app entry point
│   │   ├── dump.js              # Database export utilities
│   │   ├── restore.js           # Database import utilities
│   │   └── seed.js              # Initial data seeding
│   │
│   ├── scripts/
│   │   ├── dump-cli.js          # CLI backup tool
│   │   └── restore-cli.js       # CLI restore tool
│   │
│   ├── Dockerfile               # Backend container build
│   ├── package.json             # Backend dependencies
│   └── package-lock.json
│
├── public/
│   ├── index.html               # Staff submission form
│   ├── login.html               # Authentication page
│   ├── admin.html               # Admin role management
│   ├── catalog.html             # Catalog maintenance
│   ├── system.html              # System operations
│   ├── cv-profile.html          # CV profile editing
│   ├── cv-template-editor.html  # Template management
│   ├── gantt.html               # Project timeline
│   ├── projects.html            # Project-centric view
│   ├── staff-view.html          # Organization view
│   ├── skills.html              # Skill search and consolidation
│   ├── style.css                # Main stylesheet (1,832 lines)
│   ├── app.js                   # Core application logic
│   ├── auth.js                  # Authentication utilities
│   ├── menu.js                  # Navigation menu
│   ├── admin.js                 # Admin UI
│   ├── catalog.js               # Catalog UI
│   ├── system.js                # System operations UI
│   ├── cv-profile.js            # CV profile UI
│   ├── gantt.js                 # Gantt chart visualization
│   ├── projects.js              # Project management UI
│   ├── staff-view.js            # Staff listing UI
│   ├── skills.js                # Skill search UI
│   └── files/                   # Static data files
│       ├── AD_Reporting_Structure_Detailed.csv
│       └── extracted_projects.csv
│
├── nginx/
│   └── default.conf             # Nginx reverse proxy config
│
├── docs/
│   ├── ROADMAP.md               # Feature roadmap
│   ├── IMPLEMENTATION_PLANS.md  # Active development plans
│   └── COPILOT_SPECS.md         # Technical specifications
│
├── .github/
│   └── workflows/
│       └── ci-cd.yml            # CI/CD pipeline (to be created)
│
├── k8s/                         # Kubernetes manifests (to be created)
│   ├── staging/
│   └── production/
│
├── .dockerignore                # Docker ignore patterns
├── .gitignore                   # Git ignore patterns
├── compose.yaml                 # Docker Compose configuration
├── package.json                 # Root package.json
└── README.md                    # Project documentation
```

---

## Key Files Reference

### Backend Routes (2,935 total lines)

| File | Lines | Purpose |
|------|-------|---------|
| auth.js | 399 | JWT authentication, token management |
| cv_profiles.js | 1,159 | CV profile management, template rendering |
| admin.js | 469 | User management, CSV imports, skill consolidation |
| submissions.js | 339 | Staff submission CRUD operations |
| reports.js | 266 | Reports API (staff, skills, projects) |
| managed_projects.js | 135 | Coordinator project management |
| catalog.js | 64 | Read-only catalog endpoints |
| data-tools.js | 104 | Backup/restore endpoints |

### Frontend Files

| File | Purpose |
|------|---------|
| app.js | Core navigation and utilities |
| auth.js | Token refresh and session management |
| style.css | Main stylesheet (dark theme, 1,832 lines) |

### Database Schema (18 tables)

**Core:**
- `staff` - Global staff catalog
- `submissions` - Staff submissions
- `submission_skills` - Staff skills
- `submission_projects` - Project assignments

**Security:**
- `user_roles` - User permissions (6 roles)
- `auth_tokens` - JWT tokens
- `auth_audit_log` - Authentication events

**CV Profile:**
- `cv_profiles` - Profile summary
- `education` - Academic qualifications
- `certifications` - Certifications
- `work_history` - Employment history
- `cv_past_projects` - Extra project entries
- `cv_templates` - White-labeled templates
- `cv_snapshots` - Generated CV history

**Data Governance:**
- `skills_catalog` - Canonical skill list
- `skill_merge_log` - Merge tracking
- `managed_projects` - Coordinator projects

---

## API Endpoints Overview

### Authentication (`/auth/*`)
- `POST /auth/login` - Login with email/password
- `POST /auth/refresh` - Refresh access token
- `POST /auth/logout` - Logout (revoke token)
- `GET /auth/audit` - Get audit logs (admin/HR)

### Submissions (`/submissions/*`)
- `GET /submissions` - All submissions (admin/HR)
- `GET /submissions/me` - Current staff's submissions
- `POST /submissions/me` - Create/update current submission
- `POST /submissions/assign-project` - Assign staff to project (admin/HR/coordinator)
- `DELETE /submissions/:id` - Delete submission (admin)
- `GET /submissions/search` - Search by skills (admin/HR/SA/Sales)

### Admin (`/admin/*`)
- `GET /admin/roles` - List all roles (admin)
- `POST /admin/roles` - Create/update role (admin)
- `GET /admin/audit` - Get audit logs (admin/HR)
- `POST /admin/import-staff` - Import staff from CSV (admin)
- `GET /admin/import-staff/preview` - Preview CSV before import (admin)
- `POST /admin/skills/merge` - Merge skills (admin/HR)
- `GET /admin/skills/consolidation` - Get skills for consolidation (admin/HR)

### Catalog (`/catalog/*`)
- `GET /catalog/staff` - List all staff
- `GET /catalog/staff/:email` - Get staff by email
- `GET /catalog/projects` - List all projects
- `GET /catalog/projects/:id` - Get project by ID

### CV Profiles (`/cv-profiles/*`)
- `GET /cv-profiles/:email` - Get CV profile
- `POST /cv-profiles/:email` - Create/update CV profile
- `GET /cv-profiles/:email/generate` - Generate CV (admin/HR/SA/Sales)
- `GET /cv-profiles/:email/snapshot/:id` - Get CV snapshot
- `GET /cv-profiles/templates` - List templates
- `GET /cv-profiles/templates/:id` - Get template
- `POST /cv-profiles/templates/:id` - Update template

### Reports (`/reports/*`)
- `GET /reports/staff` - Staff report (admin/HR/SA/Sales)
- `GET /reports/skills` - Skills matrix (admin/HR/SA/Sales)
- `GET /reports/staff-search` - Search staff by skills (admin/HR/SA/Sales)

### Managed Projects (`/managed-projects/*`)
- `GET /managed-projects` - List managed projects (coordinator)
- `POST /managed-projects` - Create managed project (coordinator)
- `PUT /managed-projects/:id` - Update managed project (coordinator)

### Data Tools (`/data-tools/*`)
- `GET /data-tools/dump` - Export database as JSON
- `POST /data-tools/restore` - Restore database from JSON

---

## Technology Stack Summary

| Component | Technology | Version |
|---------|--------------|---------|
| Frontend | Vanilla JS | ES2020 |
| Backend | Node.js | 20 LTS |
| Framework | Express | 4.x |
| Database | SQLite | 3.45 |
| ORM/DB Layer | better-sqlite3 | 9.x |
| Authentication | JWT | 9.x |
| Templates | Mustache | 4.x |
| Markdown | marked | 12.x |
| File Upload | Multer | 1.x |

---

## Database Directory Structure

```
/data/
├── submissions.db           # SQLite database
├── uploads/
│   ├── photos/              # Staff photos
│   └── proofs/              # Proof files
└── backups/                 # Database backups
```

---

## Deployment Environment

### Local (Docker Compose)
- Backend: `localhost:3000`
- Frontend: `localhost:6082`

### Kubernetes
- Backend: `stafftrack-backend:3000`
- Frontend: `stafftrack-nginx:80`

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-04-04
