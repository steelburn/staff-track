# StaffTrack - Technical Specification Document

**Version:** 2.0.0  
**Date:** 2026-04-04  
**Maintainer:** StaffTrack Team  
**License:** Proprietary  

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [System Architecture](#system-architecture)
4. [Component Details](#component-details)
5. [Database Schema](#database-schema)
6. [API Specification](#api-specification)
7. [Security Architecture](#security-architecture)
8. [Performance Analysis](#performance-analysis)
9. [Deployment Architecture](#deployment-architecture)
10. [CI/CD Pipeline](#cicd-pipeline)
11. [Data Management Strategy](#data-management-strategy)
12. [Refactoring Recommendations](#refactoring-recommendations)
13. [Migration Roadmap](#migration-roadmap)

---

## Executive Summary

StaffTrack is a containerized Staff & Project Tracking application designed for enterprise environments. The application enables staff to update their skills and project involvements, while administrators, HR personnel, and project coordinators can manage roles, generate reports, and view organizational data.

### Key Capabilities

- **Staff Self-Service**: Employees update their own profiles, skills, and project assignments
- **Role-Based Access**: 6 distinct roles with granular permissions
- **Data Governance**: Skill consolidation, catalog management, CSV imports
- **CV Generation**: White-labeled CV templates with photo uploads and document export
- **Project Management**: Managed projects with coordinator assignment

### Current Status

- **Production Ready**: Yes (v1.0)
- **Database**: SQLite
- **Deployment**: Docker Compose (local development)
- **Kubernetes**: Pending implementation

---

## Architecture Overview

### High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                        │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┬─────────────────┐ │
│  │   Login UI   │  My Submission │  CV Profile  │  Admin UI   │   Reports UI   │ │
│  │   (SPA)      │    (SPA)     │    (SPA)     │    (SPA)    │     (SPA)      │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┴─────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                             PROXY LAYER                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │                            NGINX Reverse Proxy                             │ │
│  │  • Static file serving                                                     │ │
│  │  • Request routing (/api → backend)                                        │ │
│  │  • SSL termination (when enabled)                                          │ │
│  │  │                                                                          │ │
│  ▼│ ┌──────────────┐  ┌──────────────┐                                         │ │
│   └─┤ Frontend     │  │ Backend API  │                                         │ │
│     └──────────────┘  └──────────────┘                                         │ │
└───────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                            APPLICATION LAYER                                     │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┬─────────────────┐ │
│  │   Auth       │  Submissions │   Admin      │  CV Profiles │   Reports       │ │
│  │   Service    │   Service    │   Service    │   Service    │   Service       │ │
│  │              │              │              │              │                 │ │
│  │ • JWT        │ • CRUD       │ • User Mgmt  │ • CV Gen     │ • Staff Report  │ │
│  │ • Session    │ • Project UI │ • Roles      │ • Templates  │ • Skills Matrix │ │
│  │ • OAuth2     │ • Skills     │ • Imports    │ • Export     │ • Search        │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┴─────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                            DATA LAYER                                            │
│  ┌──────────────────┬──────────────────┬──────────────────┬───────────────────┐ │
│  │   SQLite DB      │  File Storage    │  Cache (Future)  │   External APIs   │ │
│  │  (Primary)       │  (Files/Photos)  │  (Redis)         │   (Future)        │ │
│  │                  │                  │                  │                   │ │
│  │ • Tables         │ • Photos         │ • Sessions       │ • AD Directory    │ │
│  │ • Transactions   │ • Proofs         │ • Rate limiting  │ • Project Systems │ │
│  │ • WAL mode       │ • CV templates   │ • Caching        │ • HR Systems      │ │
│  └──────────────────┴──────────────────┴──────────────────┴───────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Version | Notes |
|-------|-------|---------|---|
| **Frontend** | Vanilla JS | ES2020 | No build step, SPA patterns |
| **Backend** | Node.js | 20 LTS | Express framework |
| **Database** | SQLite | 3.45 | better-sqlite3, WAL mode |
| **Authentication** | JWT | 9.x | HS256 signing |
| **Proxy** | Nginx | Alpine | Reverse proxy + static files |
| **Containerization** | Docker | 24.x | Multi-stage builds |
| **Orchestration** | Docker Compose | 2.x | Development only |

---

## System Architecture

### Container Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Docker Compose Environment                     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────┐         ┌──────────────────┐                    │
│  │     nginx        │ ←───────┤     backend      │                    │
│  │  - Port 80       │    80   │  - Port 3000     │                    │
│  │  - Static files  │         │  - API routes    │                    │
│  │  - Proxy /api    │         │  - File uploads  │                    │
│  └──────────────────┘         └──────────────────┘                    │
│                                        │                                │
│                                        ▼                                │
│                              ┌──────────────────┐                      │
│                              │      db          │                      │
│                              │   SQLite Volume  │                      │
│                              └──────────────────┘                      │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User Authentication Flow**
   ```
   Browser → /api/auth/login → Backend → External Auth Service
                                               ↓
                                        SQLite (jwt_tokens)
                                               ↓
                                       Signed JWT → Response
   ```

2. **Staff Submission Flow**
   ```
   Browser → POST /submissions/me → Backend → Validate JWT
                                                   ↓
                                            SQLite (submissions)
                                                   ↓
                                            SQLite (skills, projects)
                                                   ↓
                                             Response (201)
   ```

3. **Report Generation Flow**
   ```
   Browser → GET /reports/staff → Backend → Query DB
                                                   ↓
                                           Aggregate data
                                                   ↓
                                      Join submissions, skills, projects
                                                   ↓
                                             Response (JSON)
   ```

4. **CV Generation Flow**
   ```
   Browser → POST /cv-profiles/:email/generate → Backend
                                                   ↓
                                             Collect CV data
                                                   ↓
                                       Render template (Mustache)
                                                   ↓
                                        Convert markdown to HTML
                                                   ↓
                                      Save snapshot to DB
                                                   ↓
                                        Return HTML blob
   ```

---

## Component Details

### Backend Components (`/home/steelburn/staff-track/backend/src/`)

#### Core Modules

| File | Purpose | Lines | Security Focus |
|------|---------|-------|---|
| `index.js` | Express app entry, middleware, routing | 60 | Helmet, JSON parsing |
| `db.js` | Database initialization, migrations | 783 | WAL mode, foreign keys |
| `utils.js` | CSV parsing utilities | 40 | Input validation |

#### Route Handlers (8 files, 2,935 lines total)

| Route File | Endpoints | Key Features |
|------|--|--|
| `auth.js` | 6 | JWT generation, token refresh, audit logging |
| `submissions.js` | 8 | CRUD operations, project assignment |
| `admin.js` | 12 | User management, CSV imports, skill consolidation |
| `catalog.js` | 4 | Read-only staff and project catalog |
| `cv_profiles.js` | 17 | CV profile CRUD, template management |
| `reports.js` | 4 | Staff, projects, skills reports |
| `managed_projects.js` | 4 | Coordinator project management |
| `data-tools.js` | 4 | Backup/restore endpoints |

#### Data Tools Modules

| File | Purpose |
|------|---|
| `dump.js` | Database export to JSON |
| `restore.js` | Database import from JSON |

### Frontend Components (`/home/steelburn/staff-track/public/`)

#### Page Components (10 HTML files)

| File | Purpose | Key Features |
|------|---|---|
| `index.html` | Staff submission form | Auto-populated, skill/project management |
| `login.html` | Authentication page | Email/password, OAuth2 fallback |
| `admin.html` | User role management | Role CRUD, CSV import UI |
| `catalog.html` | Global catalog maintenance | Staff and project editing |
| `system.html` | System operations | Backup/restore, skill consolidation |
| `cv-profile.html` | CV profile editing | Photo upload, tabs (education, work history) |
| `cv-template-editor.html` | Template management | Markdown/CSS editing |
| `projects.html` | Project-centric view | Assigned projects, Gantt chart |
| `staff-view.html` | Organization view | Staff listing with filters |
| `skills.html` | Skill search and consolidation | Filter by proficiency, merge tools |

#### JavaScript Modules (10 files)

| File | Purpose | Key Features |
|------|---|---|
| `app.js` | Core application logic | Navigation, shared utilities |
| `auth.js` | Authentication | Token refresh, session management |
| `menu.js` | Navigation menu | Role-based menu display |
| `admin.js` | Admin UI | Role management, CSV import |
| `catalog.js` | Catalog management | Staff/project CRUD |
| `system.js` | System operations | Backup/restore UI |
| `cv-profile.js` | CV profile management | Tabbed interface, template rendering |
| `gantt.js` | Project timeline visualization | Canvas virtualization, 60fps scroll |

#### Styling

| File | Purpose | Lines | Status |
|------|---|---|---|
| `style.css` | Main stylesheet | 1,832 | complete |

**CSS Architecture:**
- CSS Custom Properties (variables) for theming
- Dark theme: `--bg-base: #0d1117`
- Consistent spacing and border radius (16px for cards)
- Focus states: blue ring `#4f8ef7`
- Responsive: flexbox + media queries

---

## Database Schema

### Entity Relationship Diagram

```
┌────────────────┐     ┌─────────────┐     ┌─────────────┐
│   staff        │1───n│submissions  │1───n│submission_skills│
│(catalog)       │     │             │     │             │
└────────────────┘     └─────────────┘     └─────────────┘
        │                      │                   │
        │                      │                   │
        ▼                      ▼                   ▼
┌────────────────┐     ┌─────────────┐     ┌─────────────┐
│user_roles      │1───n│submission_projects│n───1│managed_projects│
│              │     │             │     │             │
└────────────────┘     └─────────────┘     └─────────────┘
        │
        ▼
┌────────────────┐
│auth_tokens     │
│              │
│auth_audit_log│
└────────────────┘

CV Profile Tables:
┌────────────────┐     ┌─────────────┐
│cv_profiles     │1───n│education    │
│              │1───n│certifications│
│              │1───n│work_history │
│              │1───n│cv_past_projects│
│              │1───n│cv_snapshots  │
└────────────────┘     └─────────────┘

Template System:
┌────────────────┐
│cv_templates    │1───n│cv_snapshots│
└────────────────┘     └─────────────┘
```

### Tables (18 total)

#### Core Tables

| Table | Purpose | Records | Key Fields |
|-------|-------|---------|---|
| `staff` | Global staff catalog | 243 | email, name, title, department, manager |
| `projects_catalog` | Project database | 327 | id, soc, project_name, customer, end_date |
| `submissions` | Staff submissions | 162 | id, staff_email, staff_name, title, department |
| `submission_skills` | Staff skills | 1,000+ | skill, rating (0-5) |
| `submission_projects` | Project assignments | 500+ | soc, project_name, role, start_date, end_date |

#### Security Tables

| Table | Purpose | Records |
|-------|-------|
| `user_roles` | User permissions | 30 |
| `auth_tokens` | JWT tokens + refresh tokens | Active sessions |
| `auth_audit_log` | Authentication events | All logins |

#### Data Governance Tables

| Table | Purpose |
|-------|---|
| `skills_catalog` | Canonical skill list (deduplication) |
| `skill_merge_log` | Track skill merge operations |
| `managed_projects` | Projects created by coordinators |

#### CV Profile Tables

| Table | Purpose |
|-------|---|
| `cv_profiles` | User CV profile summary |
| `education` | Academic qualifications |
| `certifications` | Professional certifications |
| `work_history` | Employment history |
| `cv_past_projects` | Extra project entries |
| `cv_templates` | White-labeled CV templates |
| `cv_snapshots` | Generated CV history |

### Schema Design Decisions

**1. SQLite vs PostgreSQL**
- **Current**: SQLite (single file, WAL mode)
- **Trade-offs**: Simplicity, zero config, file-based
- **Limitations**: Concurrency, scalability
- **Migration**: Ready (see Migration Roadmap)

**2. Foreign Keys**
- Enabled: `ON DELETE CASCADE` for skills/projects
- Protected: `ON DELETE SET NULL` for optional relationships

**3. Data Integrity**
- `PRAGMA foreign_keys = ON`
- Transactions for all mutations
- UPSERT (`ON CONFLICT`) for idempotency

**4. Full-Text Search**
- Not implemented (low priority)
- Can be added via FTS5 extension

---

## API Specification

### Authentication Endpoints (`/auth/*`)

#### POST `/auth/login`
**Request:**
```json
{
  "email": "user@example.com",
  "password": "base64_encoded_password"
}
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "a1b2c3d4e5f6...",
  "user": {
    "email": "user@example.com",
    "role": "staff"
  },
  "expiresIn": 28800
}
```

**Security:**
- Password: Base64-encoded (NOT encrypted)
- JWT: HS256, 8-hour expiry
- Refresh token: Stored in database (sha256 hash)

#### POST `/auth/refresh`
**Request:**
```json
{
  "refreshToken": "a1b2c3d4e5f6..."
}
```

**Response (200):**
```json
{
  "accessToken": "new_jwt_token...",
  "user": {...},
  "expiresIn": 28800
}
```

#### POST `/auth/logout`
**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "success": true
}
```

**Implementation:** Mark token as `revoked = 1` in database

---

### Submission Endpoints (`/submissions/*`)

#### GET `/submissions/me`
**Response (200):**
```json
{
  "id": "uuid",
  "staffName": "John Doe",
  "staffData": {
    "email": "john@example.com",
    "title": "Senior Engineer",
    "department": "IT",
    "managerName": "Jane Smith"
  },
  "editedFields": ["title", "department"],
  "skills": [
    {"skill": "JavaScript", "rating": 5},
    {"skill": "Python", "rating": 4}
  ],
  "projects": [
    {
      "soc": "PROJ001",
      "projectName": "Enterprise Platform",
      "customer": "Acme Corp",
      "role": "Tech Lead",
      "startDate": "2023-01-01",
      "endDate": "2024-12-31",
      "description": "Platform modernization",
      "technologies": "React, Node.js, PostgreSQL"
    }
  ]
}
```

#### POST `/submissions/assign-project`
**Request:**
```json
{
  "staffName": "John Doe",
  "staffData": {
    "email": "john@example.com"
  },
  "project": {
    "soc": "PROJ001",
    "projectName": "Enterprise Platform",
    "customer": "Acme Corp",
    "startDate": "2023-01-01"
  }
}
```

**Response (201):**
```json
{
  "id": "assignment_id",
  "action": "updated"
}
```

---

### Admin Endpoints (`/admin/*`)

#### GET `/admin/roles`
**Response (200):**
```json
[
  {
    "email": "user1@example.com",
    "role": "staff",
    "is_hr": 0,
    "is_coordinator": 0,
    "is_active": 1
  },
  {
    "email": "hr@example.com",
    "role": "hr",
    "is_hr": 1,
    "is_coordinator": 0,
    "is_active": 1
  }
]
```

#### POST `/admin/roles`
**Request:**
```json
{
  "email": "user@example.com",
  "role": "coordinator",
  "is_active": true
}
```

#### POST `/admin/import-staff`
**Request:**
```json
{
  "csv": "EmailAddress,Name,Title,Department,ManagerName\njohn@example.com,John Doe,Engineer,IT,Jane Smith"
}
```

#### POST `/admin/skills/merge`
**Request:**
```json
{
  "targetSkill": "JavaScript",
  "sourceSkills": ["JS", "javascript", "JavaScript (JS)"]
}
```

**Response (200):**
```json
{
  "success": true,
  "affectedCount": 12
}
```

---

### Catalog Endpoints (`/catalog/*`)

#### GET `/catalog/staff`
**Response (200):**
```json
[
  {
    "email": "john@example.com",
    "name": "John Doe",
    "title": "Senior Engineer",
    "department": "IT",
    "manager_name": "Jane Smith"
  }
]
```

#### GET `/catalog/projects`
**Response (200):**
```json
[
  {
    "id": "uuid",
    "soc": "PROJ001",
    "project_name": "Enterprise Platform",
    "customer": "Acme Corp",
    "end_date": "2024-12-31"
  }
]
```

---

### CV Profile Endpoints (`/cv-profiles/*`)

#### GET `/cv-profiles/:email`
**Response (200):**
```json
{
  "profile": {
    "id": "uuid",
    "staff_email": "john@example.com",
    "summary": "Senior full-stack engineer",
    "phone": "+1-555-1234",
    "linkedin": "linkedin.com/in/johndoe",
    "location": "Kuala Lumpur",
    "photo_path": "/uploads/photos/john@example.com_1234567890.jpg",
    "is_visible": 1
  },
  "education": [
    {
      "id": "uuid",
      "institution": "University of Malaysia",
      "degree": "BSc Computer Science",
      "start_year": 2015,
      "end_year": 2019
    }
  ],
  "certifications": [...],
  "workHistory": [...],
  "pastProjects": [...]
}
```

#### POST `/cv-profiles/:email/generate`
**Request:**
```json
{
  "template_id": "modern"
}
```

**Response (200):**
```json
{
  "snapshot_id": "uuid",
  "html": "<!DOCTYPE html>...<html>",
  "template_name": "Modern Dark"
}
```

---

### Report Endpoints (`/reports/*`)

#### GET `/reports/staff`
**Query Params:**
```
?skills=[{"name":"JavaScript","minRating":3}]
```

**Response (200):**
```json
[
  {
    "id": "uuid",
    "staffName": "John Doe",
    "title": "Senior Engineer",
    "email": "john@example.com",
    "skills": [
      {"skill": "JavaScript", "rating": 5},
      {"skill": "TypeScript", "rating": 4}
    ],
    "projects": [...]
  }
]
```

---

### Data Tools Endpoints (`/data-tools/*`)

#### GET `/data-tools/dump`
**Response (200):** JSON file download

#### POST `/data-tools/restore`
**Request:**
```json
{
  "exported_at": "2026-04-04T01:00:00.000Z",
  "tables": {
    "staff": [...],
    "submissions": [...]
  }
}
```

---

## Security Architecture

### Authentication Flow

```
┌─────────────┐
│   Browser   │
└───────┬─────┘
        │ 1. POST /auth/login (email, password)
        ▼
┌───────────────────────┐
│   Backend: auth.js    │
│                       │
│ • Validate credentials│
│ • Call Auth Service   │
│ • Generate JWT        │
│ • Store tokens (DB)   │
└────────────┬──────────┘
           │ 2. JWT + Refresh Token (response)
           ▼
┌─────────────┐
│   Browser   │
│ • Store JWT │
│ • Store RT  │
└───────┬─────┘
        │ 3. Store in memory
        ▼
┌────────────────────────────────┐
│  API Calls                     │
│  Authorization: Bearer <JWT>   │
└──────────┬─────────────────────┘
           │
           ▼
┌───────────────────────┐
│  Auth Middleware      │
│ • Verify JWT          │
│ • Check revoked       │
│ • Set req.user        │
└────────────┬───────────┘
           │
           ▼
┌───────────────────────┐
│  Protected Route      │
└───────────────────────┘
```

### Role-Based Access Control

| Role | Permissions | Access Level |
|------|-------------|----------- |
| **Admin** | Full system control | All endpoints |
| **HR** | View all, export reports | `/reports/*`, `/admin/roles` |
| **Coordinator** | Project management | `/managed-projects/*`, filtered reports |
| **SA/Pre-Sales** | Skill search, CV generation | `/reports/staff-search`, `/cv-profiles/*` |
| **Sales** | Skill search, CV generation | `/reports/staff-search`, `/cv-profiles/*` |
| **Staff** | Self-service only | Own `/submissions/me`, own `/cv-profiles` |

### Security Best Practices Implemented

**1. Helmet.js**
```javascript
app.use(helmet());
```
- Content Security Policy
- X-Frame-Options
- X-Content-Type-Options
- HSTS (when HTTPS enabled)

**2. Input Validation**
- JSON body parser with size limit (`1mb`)
- SQL injection prevention (parameterized queries)
- SQL foreign key constraints

**3. Token Security**
- JWT with 8-hour expiry
- Refresh tokens stored in database (SHA256 hash)
- Token revocation on logout

**4. Audit Logging**
```javascript
audit_log.insert({
  email, action, ip_address, user_agent, success, created_at
});
```

### Security Concerns & Recommendations

#### 🔴 CRITICAL

1. **JWT Secret Management**
   - Current: `JWT_SECRET: "dev_secret_change_me_in_prod"` (hardcoded)
   - **Fix**: Use environment variable, require strong secret in production
   - **Action**: 
     ```bash
     export JWT_SECRET=$(openssl rand -base64 64)
     docker-compose up -d
     ```

2. **Password Encoding**
   - Current: Base64 encoding only (NOT encryption)
   - **Fix**: Use bcrypt for local passwords OR mandate external auth service
   - **Recommendation**: Always use external auth service in production

3. **Database Credentials**
   - Current: No explicit credentials (SQLite file)
   - **Risk**: File-based storage, no password protection
   - **Fix for migration to PostgreSQL**: 
     ```yaml
     POSTGRES_USER: ${DB_USER}
     POSTGRES_PASSWORD: ${DB_PASSWORD}
     ```

#### 🟡 HIGH

4. **SQL Injection Prevention**
   - ✅ Already implemented with parameterized queries
   - **Verify**: All queries use `?` placeholders
   - **Test**: SQLMap testing recommended

5. **CORS Configuration**
   - Current: No CORS middleware (assumes same-origin)
   - **Risk**: Cross-origin attacks if frontend is served from different domain
   - **Fix**: Add CORS middleware with allowed origins whitelist
     ```javascript
     app.use(cors({
       origin: process.env.ALLOWED_ORIGINS.split(','),
       credentials: true
     }));
     ```

6. **Rate Limiting**
   - Current: No rate limiting
   - **Fix**: Add express-rate-limit for auth endpoints
     ```javascript
     rateLimit({
       windowMs: 15 * 60 * 1000, // 15 minutes
       max: 100, // limit each IP to 100 requests per windowMs
       message: 'Too many requests, please try again later'
     })
     ```

#### 🟢 MEDIUM

7. **File Upload Security**
   - Current: Photo uploads to `/data/uploads/photos/`
   - **Checks**: MIME type validation (images only)
   - **Recommendations**:
     - Scan uploaded files for malware
     - Store files outside web root or use CDN
     - Generate unique filenames (already done with timestamps)

8. **Error Messages**
   - Current: Generic error messages exposed to users
   - **Risk**: Information leakage (stack traces, SQL queries)
   - **Fix**: Log full errors server-side, return generic messages

9. **CSRF Protection**
   - Current: No CSRF tokens
   - **Risk**: CSRF attacks on forms
   - **Fix**: Implement CSRF middleware for state-changing operations

### Security Checklist

- [x] Helmet.js for security headers
- [x] Parameterized SQL queries
- [x] JWT token expiration
- [x] Token revocation on logout
- [ ] JWT secret hardcoded → **Fix needed**
- [ ] Rate limiting on auth endpoints → **Fix needed**
- [ ] CORS configuration → **Fix needed**
- [ ] File upload virus scanning → **Recommendation**
- [ ] Error message sanitization → **Fix needed**
- [ ] CSRF protection → **Recommendation**

---

## Performance Analysis

### Current Performance Characteristics

#### Dataset Sizes
- **Staff records**: 243
- **Submissions**: 162
- **User roles**: 30
- **Projects**: 327
- **Skills entries**: 1,000+
- **Projects per submission**: 500+

#### Response Time Benchmarks (Estimated)

| Endpoint | Method | Estimated Latency | Notes |
|------|--|------|---|
| `/auth/login` | POST | 300-500ms | External auth service call |
| `/submissions/me` | GET | 50-100ms | Simple query |
| `/reports/staff` | GET | 200-400ms | Multiple joins |
| `/reports/skills` | GET | 150-300ms | Aggregation |
| `/cv-profiles/:email/generate` | POST | 500-800ms | Template rendering |
| `/data-tools/dump` | GET | 5-10s | Full DB scan |
| `/data-tools/restore` | POST | 10-15s | Batch insert |

### Performance Bottlenecks

#### 🔴 1. Database Queries (SQLite)

**Issue**: Sequential disk I/O, no connection pooling

**Impact**: 
- Multi-user concurrent access → locks
- large queries (>1000 rows) → slow response

**Mitigation Strategies**:

**Option A: SQLite Optimization**
- Enable `PRAGMA journal_mode = WAL` (already done)
- Increase `PRAGMA cache_size = -10000` (10MB cache)
- Add indexes on frequently queried columns

```sql
CREATE INDEX idx_submissions_staff_email ON submissions(staff_email);
CREATE INDEX idx_submissions_updated_at ON submissions(updated_at);
CREATE INDEX idx_skill_ratings ON submission_skills(skill, rating);
```

**Option B: PostgreSQL Migration** (Recommended)

```yaml
# docker-compose.yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: stafftrack
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: stafftrack
    volumes:
      - postgres_data:/var/lib/postgresql/data
  backend:
    environment:
      DATABASE_URL: postgresql://stafftrack:${DB_PASSWORD}@db:5432/stafftrack
```

**Migration Steps**: See Migration Roadmap

#### 🟡 2. Frontend Rendering

**Issue**: Large skill/project tables render slowly

**Current Implementation**:
- Vanilla JS DOM manipulation
- No virtualization

**Impact**: ~500ms for 100 rows

**Solution**:
- Implement virtual scrolling (list.js or react-window)
- Lazy loading of image assets
- Debounce search input

#### 🟡 3. CV Template Rendering

**Issue**: Markdown to HTML conversion on every request

**Current**: `markdownToHtml()` function in route handler

**Impact**: ~200ms per CV generation

**Solution**:
- Pre-compile templates
- Cache rendered output
- Use faster parser (marked.js)

#### 🟢 4. Cache Misses

**Current**: No caching layer

**Impact**: Full DB queries for every request

**Solution**: Redis cache for:
- Static data (staff catalog, project catalog)
- Aggregated reports
- CV templates

```javascript
// Example cache strategy
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key, fetchFn, ttl = CACHE_TTL) {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  const data = fetchFn();
  cache.set(key, {
    data,
    expires: Date.now() + ttl
  });
  return data;
}
```

### Performance Optimization Roadmap

**Phase 1 - Immediate (Week 1)**
1. Add database indexes
2. Enable SQLite cache
3. Implement caching layer (memory → Redis)

**Phase 2 - Short-term (Month 1)**
1. Frontend virtualization
2. Template caching
3. Image lazy loading

**Phase 3 - Medium-term (Month 2)**
1. CDN for static assets
2. API response compression (gzip/brotli)
3. Connection pooling (when migrating to PostgreSQL)

### Scaling Considerations

| Metric | Current Limit | With Optimization | With PostgreSQL + Redis |
|--------|-------|-------|------|
| Concurrent Users | ~50 | ~500 | ~5,000 |
| Max Rows in Table | ~10,000 | ~50,000 | ~1M+ |
| Response Time | 200ms | 100ms | 50ms |
| Memory Usage | ~100MB | ~200MB | ~500MB |

---

## Deployment Architecture

### Current: Docker Compose

#### compose.yaml
```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "6082:80"  # Exposed port
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - ./public:/usr/share/nginx/html:ro

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    volumes:
      - ./backend:/app
      - db_data:/data
    environment:
      DB_PATH: "/data/submissions.db"
      JWT_SECRET: "dev_secret"

  db:
    image: alpine/sqlite:latest
    volumes:
      - db_data:/data

volumes:
  db_data:
```

**Issues:**
- SQLite not designed for multi-container
- No health checks
- No restart policies
- No logging configuration

### Recommended: Kubernetes Deployment

#### k8s/backend-deployment.yaml
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stafftrack-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: stafftrack-backend
  template:
    metadata:
      labels:
        app: stafftrack-backend
    spec:
      containers:
      - name: backend
        image: ghcr.io/stafftrack/backend:${VERSION}
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: stafftrack-secrets
              key: database-url
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: stafftrack-secrets
              key: jwt-secret
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 15
          periodSeconds: 10
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

#### k8s/backend-service.yaml
```yaml
apiVersion: v1
kind: Service
metadata:
  name: stafftrack-backend
spec:
  selector:
    app: stafftrack-backend
  ports:
  - port: 3000
    targetPort: 3000
  type: ClusterIP
```

#### k8s/ingress.yaml
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: stafftrack-ingress
spec:
  rules:
  - host: stafftrack.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: stafftrack-nginx
            port:
              number: 80
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: stafftrack-backend
            port:
              number: 3000
```

### Database Deployment

#### SQLite → PostgreSQL Migration

**Current**: SQLite file in Docker volume

**Target**: PostgreSQL deployment

```yaml
# k8s/postgres-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stafftrack-postgres
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: postgres
        image: postgres:16-alpine
        env:
        - name: POSTGRES_USER: stafftrack
        - name: POSTGRES_PASSWORD: ${DB_PASSWORD}
        - name: POSTGRES_DB: stafftrack
        ports:
        - containerPort: 5432
        volumeMounts:
        - name: postgres-data
          mountPath: /var/lib/postgresql/data
        resources:
          requests:
            memory: "512Mi"
            cpu: "200m"
        livenessProbe:
          exec:
            command: ["pg_isready", "-U", "stafftrack"]
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  ports:
  - port: 5432
  selector:
    app: stafftrack-postgres
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 10Gi
```

#### Data Migration Procedure

```bash
# 1. Create dump from SQLite
docker compose exec backend npm run dump

# 2. Convert SQLite dump to PostgreSQL format
# Using custom script (see Migration Roadmap)

# 3. Load to PostgreSQL
psql -h postgres -U stafftrack -d stafftrack < converted-data.sql

# 4. Verify data integrity
docker compose exec backend npm run test:migration
```

### Container Security Hardening

#### Current Issues

1. **Running as root**
   ```yaml
   # Current
   user: root
   
   # Fixed
   user: "1000:1000"  # Non-root user
   ```

2. **No resource limits**
   ```yaml
   resources:
     limits:
       memory: "512Mi"
       cpu: "500m"
   ```

3. **No health checks**
   ```yaml
   healthcheck:
     test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
     interval: 30s
     timeout: 10s
     retries: 3
   ```

### Monitoring & Logging

#### Current: No monitoring

#### Recommended Stack

| Component | Purpose | Integration |
|------|---|-------------|
| **Prometheus** | Metrics collection | Backend `/metrics` endpoint |
| **Grafana** | Visualization | Dashboard for API metrics |
| **ELK** | Centralized logging | Log aggregation |
| **Sentry** | Error tracking | Sentry.init() |

**Metrics to Collect**
- Request rate (per endpoint)
- Response time (p50, p95, p99)
- Database query time
- Error rate (4xx, 5xx)
- Memory usage
- CPU usage

---

## CI/CD Pipeline

### Current State: No CI/CD

**Issues:**
- Manual deployments
- No automated testing
- No build verification
- No rollback capability

### Proposed GitHub Actions Workflow

```yaml
name: StaffTrack CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run linter
      run: npm run lint
    
    - name: Run tests
      run: npm run test
    
    - name: Run security audit
      run: npm audit --audit-level=moderate

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    
    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v3
    
    - name: Build backend
      uses: docker/build-push-action@v5
      with:
        context: ./backend
        push: false
        tags: stafftrack/backend:${{ github.sha }}
    
    - name: Build frontend
      uses: docker/build-push-action@v5
      with:
        context: .
        push: false
        tags: stafftrack/frontend:${{ github.sha }}

  deploy-staging:
    needs: build
    if: github.ref == 'refs/heads/develop'
    environment: staging
    steps:
    - uses: azure/k8s-set-context@v3
      with:
        kubeconfig: ${{ secrets.KUBECONFIG }}
    
    - name: Deploy to staging
      run: |
        kubectl apply -f k8s/staging/
        kubectl rollout status deployment/stafftrack-backend
    
    - name: Run smoke tests
      run: |
        curl -f http://stafftrack-staging/health

  deploy-production:
    needs: deploy-staging
    if: github.ref == 'refs/heads/main'
    environment: production
    steps:
    - uses: azure/k8s-set-context@v3
      with:
        kubeconfig: ${{ secrets.KUBECONFIG }}
    
    - name: Deploy to production
      run: |
        kubectl apply -f k8s/production/
        kubectl rollout status deployment/stafftrack-backend
    
    - name: Verify deployment
      run: |
        curl -f http://stafftrack/health
```

### Deployment Checklist

- [ ] Create `.github/workflows/ci-cd.yml`
- [ ] Set up GitHub secrets (KUBECONFIG, registry credentials)
- [ ] Create Kubernetes manifests (`k8s/staging/`, `k8s/production/`)
- [ ] Implement health check endpoint (`/health`)
- [ ] Configure container registry (GitHub Container Registry or Docker Hub)
- [ ] Set up environment variables in GitHub
- [ ] Test pipeline in staging
- [ ] Enable branch protection rules
- [ ] Configure automated rollback on failure

---

## Data Management Strategy

### Backup Strategy

#### Current: Manual

**Manual Backup:**
```bash
# Create dump
curl http://localhost:3000/data-tools/dump -o backup-$(date +%s).json

# Or via docker-compose
docker compose exec backend npm run dump
```

#### Recommended: Automated

**GitHub Actions Scheduled Backup:**
```yaml
name: Daily Backup

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    
    - name: Backup database
      run: |
        docker compose exec backend npm run dump
    
    - name: Upload backup to S3
      uses: aws-actions/aws-s3-sync@v1
      with:
        source: ./backend/
        destination: ${{ secrets.S3_BACKUP_BUCKET }}
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_KEY }}
    
    - name: Cleanup old backups
      run: |
        aws s3 rm s3://${{ secrets.S3_BACKUP_BUCKET }} \
          --exclude "*" \
          --include "submissions-dump-*.json" \
          --force \
          --delete \
          --before $(date -d '30 days ago' +%Y-%m-%dT00:00:00Z)
```

### Restore Strategy

**From JSON dump:**
```bash
curl -X POST http://localhost:3000/data-tools/restore \
  -H "Content-Type: application/json" \
  -d @backup-file.json
```

**From Docker volume:**
```bash
# Backup volume
docker run --rm \
  -v stafftrack_db_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/backup.tar.gz /data

# Restore
docker run --rm \
  -v stafftrack_db_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/backup.tar.gz
```

### Data Retention Policy

| Table | Retention | Notes |
|-------|-------|-------|
| `submissions` | 7 years | Legal requirement |
| `auth_tokens` | 90 days | Security best practice |
| `auth_audit_log` | 1 year | Audit trail |
| `cv_snapshots` | 5 years | CV history |
| `skill_merge_log` | Indefinite | Data governance |

### Data Purge Script

```javascript
// scripts/purge-old-data.js
const { getDb } = require('./src/db');

function purgeOldData() {
  const db = getDb();
  
  // Purge old auth tokens
  const oldTokens = db.prepare(`
    DELETE FROM auth_tokens 
    WHERE created_at < datetime('now', '-90 days')
  `).run();
  
  // Purge old audit log entries
  const oldLogs = db.prepare(`
    DELETE FROM auth_audit_log
    WHERE created_at < datetime('now', '-1 year')
  `).run();
  
  console.log(`Purged ${oldTokens.changes} old tokens`);
  console.log(`Purged ${oldLogs.changes} old audit entries`);
}

purgeOldData();
```

---

## Refactoring Recommendations

### 🔴 Critical Refactoring

#### 1. JWT Secret Hardcoded

**Location:** `backend/src/routes/auth.js:11`

**Issue:**
```javascript
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
```

**Problem:**
- If environment variable not set, secret regenerated on every restart
- Sessions become invalid

**Fix:**
```javascript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
```

#### 2. Password Handling

**Location:** `backend/src/routes/auth.js:133`

**Issue:**
```javascript
Buffer.from(password, 'base64').toString()  // Decodes to original password
```

**Problem:**
- Base64 is encoding, not encryption
- Password exposed in memory

**Fix Options:**

**Option A: Use bcrypt for local auth**
```javascript
const bcrypt = require('bcryptjs');

// Store hashed password
const hashedPassword = await bcrypt.hash(password, 10);

// Verify
const isValid = await bcrypt.compare(password, hashedPassword);
```

**Option B: Always use external auth service**
```javascript
if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SERVICE_URL) {
  throw new Error('AUTH_SERVICE_URL required in production');
}
```

#### 3. SQL Injection Prevention

**Location:** All route handlers

**Current:** ✅ Parameterized queries used (GOOD)

**Verification:**
```javascript
//Good
db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);

// Bad (never use)
db.prepare(`SELECT * FROM submissions WHERE id = ${req.params.id}`).get();
```

**Action:** Continue using parameterized queries, no changes needed

### 🟡 High Priority Refactoring

#### 4. CORS Configuration

**Add to `backend/src/index.js`:**
```javascript
const cors = require('cors');

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:6082'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
```

#### 5. Rate Limiting

**Add to `backend/src/index.js`:**
```javascript
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many authentication attempts, please try again later'
});

app.use('/auth/login', authLimiter);
app.use('/auth/refresh', authLimiter);
```

#### 6. Database Indexes

**Add to `backend/src/db.js` after schema initialization:**
```javascript
// Create indexes for frequently queried columns
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_submissions_staff_email ON submissions(staff_email);
  CREATE INDEX IF NOT EXISTS idx_submissions_updated_at ON submissions(updated_at);
  CREATE INDEX IF NOT EXISTS idx_submission_skills_submission_id ON submission_skills(submission_id);
  CREATE INDEX IF NOT EXISTS idx_submission_skills_skill ON submission_skills(skill);
  CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_email ON auth_tokens(user_email);
`);
```

#### 7. Error Handling Improvements

**Current:**
```javascript
res.status(500).json({ error: 'Internal server error' });
```

**Improved:**
```javascript
// Log full error internally
console.error('Detailed error:', err.stack);

// Return generic error to client
res.status(500).json({ error: 'An internal error occurred' });
```

**Exception:** Return detailed error only in development
```javascript
const isDev = process.env.NODE_ENV === 'development';

app.use((err, req, res, next) => {
  console.error(err.stack);
  
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Internal server error',
    ...(isDev && { stack: err.stack })
  });
});
```

### 🟢 Medium Priority Refactoring

#### 8. Code Organization

**Current:** All routes in `/routes/`

**Recommendation:** Organize by feature
```
src/
├── features/
│   ├── auth/
│   │   ├── routes.js
│   │   ├── auth-service.js
│   │   └── token-manager.js
│   ├── submissions/
│   │   ├── routes.js
│   │   └── submission-service.js
│   └── cv-profiles/
│       ├── routes.js
│       └── cv-generator.js
├── shared/
│   ├── middleware/
│   └── utils/
└── index.js
```

#### 9. Environment Variables Management

**Create `src/config/index.js`:**
```javascript
module.exports = {
  port: process.env.PORT || 3000,
  dbPath: process.env.DB_PATH || '/data/submissions.db',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiry: process.env.JWT_EXPIRY || '8h',
  authServiceUrl: process.env.AUTH_SERVICE_URL,
  authServiceEndpoint: process.env.AUTH_SERVICE_ENDPOINT || '/api/auth/login',
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  nodeEnv: process.env.NODE_ENV || 'distribution'
};
```

#### 10. Module Export Cleanup

**Current:** Mixed ES5 and CommonJS

**Recommendation:** Convert to ES6 modules
```bash
# package.json
{
  "type": "module"
}

# backend/src/routes/auth.js
import express from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db.js';
```

### 🟢 Low Priority Enhancements

#### 11. Type Safety (TypeScript Migration)

**Benefits:**
- Compile-time type checking
- Better IDE autocomplete
- Self-documenting code

**Migration Strategy:**
```bash
# 1. Install TypeScript
npm install --save-dev typescript @types/node @types/express

# 2. Convert files gradually
npx tsc --init
npx tsc --noEmit backend/src/routes/auth.js
```

#### 12. Testing Improvements

**Current:** Limited unit tests

**Recommended Test Structure:**
```
test/
├── unit/
│   ├── db.test.js
│   ├── auth.test.js
│   └── utils.test.js
├── integration/
│   ├── api/
│   │   ├── auth.test.js
│   │   └── submissions.test.js
│   └── database/
│       └── migration.test.js
└── e2e/
    └── smoke.test.js
```

#### 13. Monitoring Integration

**Add Prometheus metrics:**
```javascript
// backend/src/metrics.js
const metrics = {};

function recordRequest(method, path, duration, status) {
  const key = `${method}:${path}:${status}`;
  metrics[key] = {
    count: (metrics[key]?.count || 0) + 1,
    totalDuration: (metrics[key]?.totalDuration || 0) + duration
  };
}

// Add to middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    recordRequest(req.method, req.path, Date.now() - start, res.statusCode);
  });
  next();
});
```

---

## Migration Roadmap

### Phase 1: Database Migration (Week 3)

#### Step 1: Prepare Migration Script

**Create `scripts/migrate-to-postgres.js`:**
```javascript
import sqlite3 from 'better-sqlite3';
import pg from 'pg';

const sqlite = new sqlite3(process.env.SQLITE_PATH);
const pgPool = new pg.Pool({
  connectionString: process.env.POSTGRES_URL
});

// Export SQLite dumps
const dump = {};
const tables = sqlite.prepare(
  "SELECT name FROM sqlite_master WHERE type='table'"
).all();

for (const { name } of tables) {
  dump[name] = sqlite.prepare(`SELECT * FROM ${name}`).all();
}

// Import to PostgreSQL
const client = await pgPool.connect();

try {
  await client.query('BEGIN');
  
  for (const [table, rows] of Object.entries(dump)) {
    if (rows.length === 0) continue;
    
    const cols = Object.keys(rows[0]);
    const values = rows.map(row => cols.map(col => row[col]));
    
    const placeholders = cols.map(() => '?').join(',');
    const query = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`;
    
    for (const row of values) {
      await client.query(query, row);
    }
  }
  
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}

console.log('Migration completed successfully');
```

#### Step 2: Update Docker Compose

**Add PostgreSQL service:**
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: stafftrack
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: stafftrack
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  backend:
    environment:
      DATABASE_URL: postgresql://stafftrack:${DB_PASSWORD}@db:5432/stafftrack
    depends_on:
      - db
```

#### Step 3: Update Database Configuration

**Modify `backend/src/db.js`:**
```javascript
// Current
const Database = require('better-sqlite3');
const DB_PATH = process.env.DB_PATH || '/data/submissions.db';
let db = new Database(DB_PATH);

// Updated
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10  // Connection pool size
});

// Query function
async function query(text, params) {
  return pool.query(text, params);
}
```

### Phase 2: Frontend Improvements (Week 4)

#### Step 1: Add Build System

**Install dependencies:**
```bash
npm install --save-dev vite @vitejs/plugin-react
```

**Create `vite.config.js`:**
```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  server: {
    port: 3001,
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
});
```

### Phase 3: Kubernetes Deployment (Week 5)

#### Step 1: Create Kubernetes Manifests

**`k8s/staging/deployment.yaml`:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stafftrack-backend
  namespace: staging
spec:
  replicas: 2
  selector:
    matchLabels:
      app: stafftrack-backend
  template:
    metadata:
      labels:
        app: stafftrack-backend
    spec:
      containers:
      - name: backend
        image: ghcr.io/your-org/stafftrack-backend:staging
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: stafftrack-secrets
              key: database-url
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: stafftrack-secrets
              key: jwt-secret
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

**`k8s/staging/service.yaml`:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: stafftrack-backend
  namespace: staging
spec:
  selector:
    app: stafftrack-backend
  ports:
  - port: 3000
    targetPort: 3000
  type: ClusterIP
```

**`k8s/staging/ingress.yaml`:**
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: stafftrack-ingress
  namespace: staging
spec:
  rules:
  - host: stafftrack-staging.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: stafftrack-backend
            port:
              number: 3000
```

#### Step 2: Deploy

```bash
# Apply staging manifests
kubectl apply -f k8s/staging/

# Verify deployment
kubectl get pods -n staging
kubectl get services -n staging
kubectl get ingress -n staging

# Test endpoint
curl http://stafftrack-staging.example.com/health
```

### Phase 4: CI/CD Implementation (Week 6)

#### Step 1: Create GitHub Actions Workflow

**Create `.github/workflows/ci-cd.yml`:**
```yaml
name: StaffTrack CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    - run: npm ci
    - run: npm run lint
    - run: npm run test
    
  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: docker/setup-buildx-action@v3
    - uses: docker/build-push-action@v5
      with:
        context: ./backend
        push: true
        tags: |
          ghcr.io/${{ github.repository }}/backend:${{ github.sha }}
          ghcr.io/${{ github.repository }}/backend:latest
    
  deploy-staging:
    needs: build
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
    - uses: azure/k8s-set-context@v3
      with:
        kubeconfig: ${{ secrets.KUBECONFIG }}
    - run: kubectl apply -f k8s/staging/
    
  deploy-production:
    needs: deploy-staging
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
    - uses: azure/k8s-set-context@v3
      with:
        kubeconfig: ${{ secrets.KUBECONFIG }}
    - run: kubectl apply -f k8s/production/
```

---

## Implementation Checklist

### Immediate (This Week)

- [ ] Fix JWT secret handling (require env var)
- [ ] Add database indexes
- [ ] Implement CORS configuration
- [ ] Add rate limiting
- [ ] Enhance error handling
- [ ] Create backup automation (GitHub Actions)
- [ ] Add health check endpoint

### Short-term (This Month)

- [ ] Add database tests
- [ ] Implement frontend virtualization
- [ ] Add Redis caching layer
- [ ] Set up staging Kubernetes cluster
- [ ] Deploy staging environment

### Medium-term (Next 2 Months)

- [ ] Migrate to PostgreSQL
- [ ] Implement CI/CD pipeline
- [ ] Deploy production Kubernetes
- [ ] Set up monitoring stack
- [ ] Add TypeScript migration

### Long-term (Next Quarter)

- [ ] Feature flag system
- [ ] Multi-tenant architecture
- [ ] Mobile PWA support
- [ ] AI-powered recommendations
- [ ] Internationalization

---

## Appendices

### A. Command Reference

```bash
# Development
docker compose up -d
docker compose logs -f
docker compose exec backend npm run dev

# Testing
docker compose exec backend npm test

# Backup
docker compose exec backend npm run dump
curl http://localhost:3000/data-tools/dump -o backup.json

# Restore
curl -X POST http://localhost:3000/data-tools/restore \
  -H "Content-Type: application/json" \
  -d @backup.json

# Database inspection
docker compose exec db sqlite3 /data/submissions.db
```

### B. Environment Variables

| Variable | Required | Default | Description |
|------|------|---------|---|
| `PORT` | No | 3000 | Backend server port |
| `DB_PATH` | No | /data/submissions.db | SQLite database path |
| `JWT_SECRET` | Yes | (required) | Secret for JWT signing |
| `JWT_EXPIRY` | No | 8h | JWT token expiration |
| `AUTH_SERVICE_URL` | No | https://appcore.beesuite.app | External auth service |
| `AUTH_SERVICE_ENDPOINT` | No | /api/auth/login | Auth service endpoint |
| `ALLOWED_ORIGINS` | No | * | CORS allowed origins |
| `NODE_ENV` | No | development | Environment mode |

### C. File Structure

```
staff-track/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── submissions.js
│   │   │   ├── admin.js
│   │   │   └── ...
│   │   ├── dump.js
│   │   ├── restore.js
│   │   ├── db.js
│   │   └── index.js
│   ├── Dockerfile
│   └── package.json
├── public/
│   ├── *.html
│   ├── *.js
│   └── style.css
├── nginx/
│   └── default.conf
├── compose.yaml
└── docs/
    ├── ROADMAP.md
    └── IMPLEMENTATION_PLANS.md
```

### D. Security Checklist

- [x] Helmet.js security headers
- [x] Parameterized SQL queries
- [x] JWT token expiration
- [ ] JWT secret from environment variable (needs fix)
- [ ] Rate limiting on auth (needs implementation)
- [ ] CORS configuration (needs implementation)
- [ ] File upload validation (partial - needs scanning)
- [ ] Error message sanitization (needs improvement)
- [ ] CSRF protection (recommendation)
- [ ] Security scanning in CI (needs implementation)

### E. Performance Targets

| Metric | Target | Measurement |
|--------|--------|---------|
| API Response Time | < 200ms | p95 |
| Database Query Time | < 50ms | p95 |
| Concurrent Users | 100 | Simulated load |
| Deployment Time | < 5 min | New release |
| Backup Time | < 10 min | Full database |

---

**Document Version:** 2.0.0  
**Last Updated:** 2026-04-04  
**Next Review:** 2026-05-04
