# StaffTrack Codebase Analysis
**Generated: April 4, 2026**

---

## 1. Database Schema Summary

### Core Tables

#### `submissions` (Staff submission records)
- **id** (TEXT, PK): Unique identifier (UUID)
- **staff_email** (TEXT): Staff member's email
- **staff_name** (TEXT): Staff member's name
- **title** (TEXT): Job title (nullable)
- **department** (TEXT): Department (nullable)
- **manager_name** (TEXT): Manager name (nullable)
- **edited_fields** (TEXT JSON): Array of edited field names for audit
- **created_at** (TEXT): ISO timestamp
- **updated_at** (TEXT): ISO timestamp
- **updated_by_staff** (INTEGER): Flag indicating if updated by staff vs. admin
- **Relationships**: `submission_skills`, `submission_projects` (CASCADE delete)

#### `submission_skills` (Individual skill ratings)
- **id** (TEXT, PK): UUID
- **submission_id** (TEXT, FK): References `submissions`
- **skill** (TEXT): Skill name
- **rating** (INTEGER): 1-5 proficiency rating
- **Index**: submission_id (implicit via FK)

#### `submission_projects` (Project assignments)
- **id** (TEXT, PK): UUID
- **submission_id** (TEXT, FK): References `submissions`
- **soc** (TEXT): Statement of Capability / Project code
- **project_name** (TEXT): Project name
- **customer** (TEXT): Customer name
- **role** (TEXT): Staff role on project
- **start_date** (TEXT ISO): Project start date
- **end_date** (TEXT ISO): Staff's expected end date
- **description** (TEXT): Role description
- **key_contributions** (TEXT): Contributions narrative
- **technologies_used** (TEXT): CSV or JSON list of techs
- **is_active** (INTEGER): Boolean flag

#### `staff` (Global staff identity catalog)
- **email** (TEXT, PK): Email address (lowercase)
- **name** (TEXT): Full name
- **title** (TEXT): Job title
- **department** (TEXT): Department
- **manager_name** (TEXT): Manager name
- **Source**: Imported from CSV; baseline reference data

#### `projects_catalog` (Global project master list)
- **id** (TEXT, PK): UUID
- **soc** (TEXT): SOC code
- **project_name** (TEXT): Project name
- **customer** (TEXT): Customer name
- **end_date** (TEXT ISO): Project end date (when marked as closed)
- **Source**: Imported from CSV; baseline reference data

#### `managed_projects` (Coordinator-created projects)
- **id** (TEXT, PK): UUID
- **soc** (TEXT, nullable): Project code
- **project_name** (TEXT): Name
- **customer** (TEXT): Customer name
- **type_infra** (INTEGER): Boolean flags for project type
- **type_software** (INTEGER): 
- **type_infra_support** (INTEGER): 
- **type_software_support** (INTEGER): 
- **start_date** (TEXT ISO): Start date
- **end_date** (TEXT ISO): End date
- **technologies** (TEXT): JSON list of technologies
- **description** (TEXT): Project description
- **coordinator_email** (TEXT): Coordinator who created it
- **created_at** (TEXT): Timestamp

#### `skills_catalog` (Canonical skills master data)
- **id** (TEXT, PK): UUID
- **name** (TEXT UNIQUE): Skill name
- **category** (TEXT): Category (e.g., "Database", "Frontend")
- **aliases** (TEXT JSON): Alternative names for skill merge
- **is_active** (INTEGER): Deactivation flag

#### `skill_merge_log` (Audit trail for skill merges)
- **id** (TEXT, PK): UUID
- **from_name** (TEXT): Original skill name
- **to_name** (TEXT): Merged-to skill name
- **affected_count** (INTEGER): Number of submissions affected
- **merged_by** (TEXT): Admin email
- **merged_at** (TEXT ISO): Timestamp

#### `user_roles` (Role-based access control - 6 roles)
- **email** (TEXT, PK): Unique identifier
- **role** (TEXT): One of: `admin`, `hr`, `coordinator`, `sa` (solutions architect), `sales`, `staff`
- **is_active** (INTEGER): Boolean deactivation flag
- **created_at** (TEXT ISO): Creation timestamp
- **updated_at** (TEXT ISO): Last update timestamp
- **Legacy fields** (deprecated but kept for compatibility):
  - **is_hr** (INTEGER): Derived from role
  - **is_coordinator** (INTEGER): Derived from role
- **Notes**: 
  - `admin`: Full system access + user management
  - `hr`: View all submissions, generate reports, bulk imports
  - `coordinator`: Manage projects, view project roster, assigned projects only
  - `sa`, `sales`, `staff`: View own profile, limited features

#### `auth_tokens` (JWT session management)
- **id** (TEXT, PK): UUID
- **user_email** (TEXT, FK): References `user_roles`
- **token_hash** (TEXT): SHA256 hash of JWT token
- **refresh_token_hash** (TEXT): Hash of refresh token
- **expires_at** (TEXT ISO): Expiration time (typically 8 hours)
- **created_at** (TEXT ISO): Issue time
- **revoked** (INTEGER): Boolean revocation flag (logout)

#### `auth_audit_log` (Authentication event tracking)
- **id** (TEXT, PK): UUID
- **email** (TEXT): User attempting login
- **action** (TEXT): "login", "logout", "token_refresh", etc.
- **ip_address** (TEXT): Client IP
- **user_agent** (TEXT): Browser/client identifier
- **success** (INTEGER): Boolean success flag
- **created_at** (TEXT ISO): Event timestamp

#### `cv_profiles` (CV/Profile visibility & templates)
- **id** (TEXT, PK): UUID
- **staff_email** (TEXT, FK): Staff member email
- **template_id** (TEXT, FK optional): Selected CV template
- **is_visible** (INTEGER): Boolean visibility to external viewers
- **created_at** (TEXT ISO)
- **updated_at** (TEXT ISO)

#### `cv_templates` (Seeded CV templates)
- **id** (TEXT, PK): UUID
- **name** (TEXT): Template name (e.g., "Classic Markdown")
- **markdown** (TEXT): Mustache template for markdown generation
- **css** (TEXT): Inline CSS for rendering
- **is_active** (INTEGER): Can use this template?
- **created_at** (TEXT ISO)
- **Seeded Templates**:
  1. **Classic Markdown**: Professional 2-column markdown
  2. **Modern Markdown**: Contemporary design
  3. Additional templates extensible via API

### Database Configuration
- **Path**: `/data/submissions.db` (Docker volume: `db_data`)
- **Pragma**: `journal_mode = WAL` (Write-Ahead Logging for concurrency)
- **Foreign Keys**: Enabled (`PRAGMA foreign_keys = ON`)
- **Migration System**: Basic `runMigrations()` function in `db.js` (currently minimal)
- **Seed System**: CSV-based seeding via `/home/steelburn/staff-track/backend/src/seed.js`

---

## 2. Existing API Routes & Endpoints

### Base URL: `http://localhost:3000` (Backend API)

### Health & Utilities
- **GET** `/health` — Service health check
- **GET** `/data-tools/status` — Database statistics and table counts

### Authentication Routes (`/auth`)
- **POST** `/auth/login` — User login (JWT + refresh token)
  - **Params**: `email`, `password` (base64 encoded for non-admin)
  - **Returns**: `{ accessToken, refreshToken, user, expiresIn }`
  - **Auth Service**: Delegates to external `${AUTH_SERVICE_URL}/api/auth/login`
  - **Fallback**: Admin-only fallback login if external service unavailable
  - **Behavior**: Auto-creates `user_roles` and `cv_profiles` on first admin login
  
- **POST** `/auth/refresh` — Refresh expired JWT token
  - **Headers**: `Authorization: Bearer <refreshToken>`
  - **Returns**: New `accessToken`
  
- **POST** `/auth/logout` — Revoke token (sets `revoked = 1` in `auth_tokens`)
  - **Headers**: `Authorization: Bearer <token>`

### Submissions Routes (`/submissions`)
- **GET** `/submissions` 
  - **Auth**: `verifyToken` + `requireRole('admin', 'hr', 'coordinator')`
  - **Returns**: List of all submissions (id, email, name, timestamps)
  - **Ordered by**: `updated_at DESC`

- **GET** `/submissions/me`
  - **Auth**: `verifyToken` (all authenticated users)
  - **Returns**: Current user's latest submission with skills and projects
  - **Response**: `{ id, createdAt, updatedAt, staffName, staffData, editedFields, skills, projects }`

- **GET** `/submissions/email/:email`
  - **Auth**: `verifyToken`
  - **Access Control**: Staff can only view own; elevated roles can view any
  - **Returns**: Submission details for specified email

- **POST** `/submissions`
  - **Auth**: `verifyToken`
  - **Body**: `{ staffName, staffData, editedFields[], skills[], projects[] }`
  - **Returns**: Created submission with ID
  - **Auto-save**: Called every 1.5 seconds from frontend

- **PUT** `/submissions/:id`
  - **Auth**: `verifyToken`
  - **Behavior**: Updates existing submission
  - **Body**: Same as POST

- **DELETE** `/submissions/:id`
  - **Auth**: Admin only
  - **Behavior**: Soft-delete or hard-delete (implementation detail)

### Admin Routes (`/admin`)
- **GET** `/admin/roles`
  - **Auth**: Admin only
  - **Returns**: All users and their roles
  - **Response**: `[{ email, role, is_active, created_at, updated_at }, ...]`

- **POST** `/admin/roles`
  - **Auth**: Admin only
  - **Body**: `{ email, role, is_active }`
  - **Validation**: Role must be one of: `admin`, `hr`, `coordinator`, `sa`, `sales`, `staff`
  - **Behavior**: Creates or updates user role; auto-derives `is_hr` and `is_coordinator` flags

- **DELETE** `/admin/roles/:email`
  - **Auth**: Admin only
  - **Behavior**: Deactivates user (sets `is_active = 0`); prevents admin deletion
  - **Returns**: `{ success: true }`

- **POST** `/admin/import-staff`
  - **Auth**: Admin only
  - **Body**: `{ csv: "CSV content string" }`
  - **Behavior**: Bulk imports staff records into `staff` table
  - **Format Support**: Handles multiple CSV formats (AD export, generic)
  - **Fields**: email, name, title, department, manager_name
  - **Returns**: `{ added, skipped, updated }`

- **POST** `/admin/import-projects`
  - **Auth**: Admin only
  - **Body**: `{ csv: "CSV content string" }`
  - **Behavior**: Bulk imports projects into `projects_catalog`
  - **Returns**: Import statistics

### Catalog Routes (`/catalog`)
- **GET** `/catalog/staff`
  - **Auth**: `verifyToken` (all authenticated users)
  - **Returns**: All staff records from `staff` table (baseline)
  - **Fields**: email, name, title, department, manager_name
  - **Ordered by**: name ASC

- **GET** `/catalog/projects`
  - **Auth**: `verifyToken`
  - **Returns**: All projects from `projects_catalog`
  - **Fields**: id, soc, project_name, customer, end_date
  - **Ordered by**: project_name ASC

- **PUT** `/catalog/projects/:id`
  - **Auth**: `verifyToken` + Coordinator/Admin
  - **Body**: `{ end_date }`
  - **Behavior**: Updates project end date
  - **Returns**: `{ success, id, end_date }`

### Managed Projects Routes (`/managed-projects`)
- **GET** `/managed-projects`
  - **Auth**: Coordinator/Admin only
  - **Filter**: Coordinators see only their own projects (via email match in `coordinator_email`)
  - **Returns**: Array of managed projects

- **POST** `/managed-projects`
  - **Auth**: Coordinator/Admin only
  - **Body**: `{ soc, project_name, customer, type_infra, type_software, ..., technologies, description }`
  - **Validation**: Prevents duplicate projects
  - **Returns**: Created project with ID

- **PUT** `/managed-projects/:id`
  - **Auth**: Coordinator/Admin only
  - **Body**: Any updatable fields
  - **Returns**: Updated project

- **DELETE** `/managed-projects/:id`
  - **Auth**: Coordinator/Admin only
  - **Behavior**: Hard delete

### Reports Routes (`/reports`)
- **GET** `/reports/projects`
  - **Auth**: HR, Coordinator, or Admin
  - **Returns**: Projects grouped by SOC/name with staff assigned
  - **Response**: `[{ soc, projectName, customer, type_*, staff: [{ assignmentId, name, email, role, endDate }] }, ...]`
  - **Filter**: Coordinators see only their assigned projects

- **GET** `/reports/staff`
  - **Auth**: HR, Coordinator, or Admin
  - **Returns**: Staff with their submissions and project counts
  - **Filter**: Coordinators see only staff on their projects

- **GET** `/reports/skills`
  - **Auth**: HR only (typically)
  - **Returns**: Aggregated skill matrix (which skills, who has them, ratings)
  - **Implementation**: Likely groups by skill then staff

### CV Profiles Routes (`/cv-profiles`)
- **GET** `/cv-profiles`
  - **Auth**: Elevated roles only
  - **Returns**: All visible CV profiles (paginated optional)

- **GET** `/cv-profiles/:email`
  - **Auth**: `verifyToken`
  - **Access Control**: Own profile always accessible; elevated roles can view any
  - **Returns**: CV profile metadata + rendered CV HTML (Mustache template applied)

- **POST** `/cv-profiles/:email/template`
  - **Auth**: Own profile or elevated roles
  - **Body**: `{ template_id }`
  - **Behavior**: Switch CV template

- **PUT** `/cv-profiles/:email`
  - **Auth**: Own profile or elevated roles
  - **Body**: `{ is_visible, ... }`
  - **Behavior**: Update visibility or other profile metadata

- **POST** `/cv-profiles/:email/photo`
  - **Auth**: Own profile or elevated roles
  - **Headers**: `multipart/form-data`
  - **File Field**: `photo` (max 5MB, image only)
  - **Behavior**: Upload and store in `/data/uploads/photos`
  - **Returns**: `{ url: "/uploads/photos/..." }`

### Data Tools Routes (`/data-tools`)
- **GET** `/data-tools/dump`
  - **Auth**: Admin only (typically)
  - **Returns**: Entire database as JSON download
  - **Filename**: `submissions-dump-${timestamp}.json`
  - **Format**: All tables with all records

- **POST** `/data-tools/restore`
  - **Auth**: Admin only
  - **Body**: JSON dump object (from `/data-tools/dump`)
  - **Behavior**: Wipes and restores entire database from dump
  - **Returns**: `{ success, results: { table: count, ... } }`

- **POST** `/data-tools/restore-file` (stub)
  - **Auth**: Admin only
  - **Body**: Multipart form-data (file not yet implemented)

### Error Handling
- **401 Unauthorized**: Missing or invalid token
- **403 Forbidden**: Token valid but insufficient permissions
- **404 Not Found**: Resource doesn't exist
- **500 Internal Server Error**: Unhandled exception
- **Response Format**: `{ error: "message" }` or `{ success: boolean, ... }`

---

## 3. Middleware in Place

### Middleware Stack (Express)

#### Security
- **helmet()**: Sets security HTTP headers (HSTS, X-Frame-Options, etc.)

#### Request Processing
- **express.json({ limit: '1mb' })**: Parse JSON payloads up to 1MB
- **Custom request logger**: Logs all requests with method, URL, and body

#### Static File Serving
- **express.static('/data/uploads')**: Serve uploaded files (photos, proofs)

### Authentication Middleware

#### `verifyToken(req, res, next)`
- **Location**: [backend/src/routes/auth.js](backend/src/routes/auth.js#L46)
- **Behavior**:
  1. Expects `Authorization: Bearer <token>` header
  2. Hashes the token and checks `auth_tokens` table
  3. Verifies JWT signature with `JWT_SECRET`
  4. Fetches user role from `user_roles` and validates `is_active`
  5. Populates `req.user = { email, role }`
- **Error Responses**: 
  - 401 if no token provided
  - 401 if token not found, revoked, or expired
  - 401 if signature invalid
  - 401 if user inactive

#### `requireRole(...allowedRoles)`
- **Location**: [backend/src/routes/auth.js](backend/src/routes/auth.js#L85)
- **Factory Function**: Returns middleware that checks if `req.user.role` is in allowed list
- **Usage**: `requireRole('admin', 'hr')` creates middleware
- **Error**: 403 if role not allowed

### Logging Middleware

#### Request Logger
- **Location**: [backend/src/index.js](backend/src/index.js#L19)
- **Format**: `${timestamp} ${method} ${url}` with request body
- **Level**: Console.log (development only, no log framework)

#### Auth Event Logger
- **Function**: `logAuthEvent(db, email, action, success, req)`
- **Location**: [backend/src/routes/auth.js](backend/src/routes/auth.js#L38)
- **Records**: email, action, IP address, user agent, success flag, timestamp
- **Table**: `auth_audit_log`
- **Invoke Points**: login, logout, token refresh failures

### Error Handling Middleware
- **404 Handler**: Generic "Not found" response
- **Global Error Handler**: Catches unhandled errors, logs to console, returns 500

### Missing/Absent Middleware
- ❌ **Rate limiting**: No request throttling
- ❌ **CORS**: Not configured (may rely on nginx proxy)
- ❌ **Request validation**: No schema validation (body, params checking is manual)
- ❌ **Compression**: No gzip middleware
- ❌ **Request ID tracking**: No trace ID for complex requests
- ❌ **Structured logging**: No Winston, Bunyan, or similar
- ❌ **Authorization by resource**: No per-resource permission checks (all-or-none by role)

### Database Transaction Middleware
- **Pattern Used**: Manual `db.transaction()` in specific operations (e.g., bulk staff import)
- **No automatic transaction wrapping**

---

## 4. Frontend Component Structure

### Architecture
- **Framework**: Vanilla JavaScript (no Vue, React, Angular, Svelte)
- **HTML**: Semantic HTML5
- **CSS**: Custom CSS3 with dark theme, responsive design
- **State Management**: Simple object-based AppState (no Redux, Vuex, Pinia)
- **SPA Pattern**: Single HTML file with dynamic sections show/hide

### Structure

#### Main Entry Point
- **File**: [public/index.html](public/index.html)
- **Template**: Single-page application with sections for each feature
- **Sections**:
  1. **Staff Identity** (Section 1): Basic staff info (name, title, department, manager)
  2. **Skills** (Section 2): Add/rate skills with 1-5 proficiency
  3. **Active Projects** (Section 3): Assign to projects with role and end date
  4. **Past Projects** (Section 4): Historical project assignments

#### Frontend Scripts (in `/public/`)
| File | Purpose |
|------|---------|
| `index.html` | Main SPA template |
| `app.js` | Core app state, form handling, auto-save logic |
| `auth.js` | JWT token management, authentication flow |
| `login.html` | Login page redirect template |
| `login.js` | Login form handler |
| `menu.js` | Navigation and role-based menu rendering |
| `catalog.html` | Staff & project catalog viewer |
| `catalog.js` | Catalog API calls and UI |
| `admin.html` | Admin panel template |
| `admin.js` | Admin functions (import staff, manage roles, etc.) |
| `projects.html` | Project roster/assignments view |
| `projects.js` | Project API calls |
| `staff-view.html` | View staff profiles (read-only) |
| `staff-view.js` | Staff viewer |
| `cv-profile.html` | CV profile editor |
| `cv-profile.js` | CV profile management |
| `cv-template-editor.html` | CV template designer |
| `cv-template-editor.js` | Mustache template editor |
| `reports.html` | Reports dashboard |
| `reports.js` | Report generation/fetching |
| `skills.html` | Skills management (canonicalize, merge) |
| `skills.js` | Skill master data operations |
| `gantt.html` | Gantt chart view |
| `gantt.js` | Gantt chart renderer |
| `orgchart.html` | Organizational chart |
| `orgchart.js` | Org structure visualization |
| `system.html` | System settings |
| `system.js` | System configuration |
| `style.css` | Global styles (dark theme, responsive) |

### Application State (AppState)

**Location**: [public/app.js](public/app.js#L6)

```javascript
const AppState = {
    submissionId: null,           // UUID stored in sessionStorage
    originalStaff: {},            // Snapshot for detecting edits
    staff: {
        name: '', title: '', department: '', 
        managerName: '', email: ''
    },
    editedFields: new Set(),      // Tracks which fields were changed
    skills: [],                   // [{ id, skill, rating }]
    projects: []                  // [{ id, soc, projectName, customer, role, endDate }]
};
```

### Token & Authentication Flow

**File**: [public/auth.js](public/auth.js)

**Global Object**: `window.StaffTrackAuth`

**Functions**:
- `getToken()` — Retrieves JWT from localStorage
- `setToken(token, refreshToken)` — Saves tokens
- `apiFetch(url, options)` — Wrapper around fetch() that auto-includes `Authorization: Bearer <token>` header
- `logout()` — Clears tokens and revokes on server

### Frontend Features Implemented

#### User Submission Form (`app.js`)
1. **Load baseline staff data** from `/api/catalog/staff`
2. **Auto-load user's submission** from `/api/submissions/me` or `/api/submissions/email/:email`
3. **Edit tracking**: Detects field changes vs. original CSV data
4. **Auto-save** every 1500ms to `/api/submissions` (POST for new, PUT for existing)
5. **Skill management**: Add/remove skills with 1-5 star rating
6. **Project assignment**: Search & assign staff to projects from catalog
7. **Form validation**: Client-side only (no server validation shown)
8. **Error handling**: Shows "Save error" toast UI

#### Admin Panel (`admin.js`)
- **Bulk import staff** from CSV via `/api/admin/import-staff`
- **Bulk import projects** via `/api/admin/import-projects`
- **Manage user roles** via `/api/admin/roles` (CRUD)
- **Data dump/restore** via `/api/data-tools/dump` and `/api/data-tools/restore`

#### Reports (`reports.js`)
- **Projects report**: Lists all projects with assigned staff
- **Staff report**: Lists all staff with submission status
- **Skills matrix**: Aggregated skills data (if available)

#### CV Profiles (`cv-profile.js`)
- **Template selection**: Switch between CV templates
- **Visibility toggle**: Mark profile as publicly visible
- **Photo upload**: Upload headshot/profile photo
- **CV rendering**: Applies Mustache template to submission data

#### Catalog Views (`catalog.js`)
- **Staff listing**: Browse all staff in system
- **Project listing**: Browse all projects in system
- **Pagination**: Optional (not seen in code review)

### State Persistence
- **Session Storage**: Submission ID stored in `sessionStorage.stafftrack_id`
- **Local Storage**: JWT tokens stored
- **Backend Storage**: Full submission data persisted to SQLite via auto-save

### Frontend Styling

**File**: [public/style.css](public/style.css)

**Theme**: Dark mode, professional blue/gray color scheme
- **Header**: Branding, logo, navigation
- **Cards**: Section cards with numbered blue/green/amber indicators
- **Forms**: Input fields with labels, form groups
- **Tables**: Grid tables for skills/projects with add/remove columns
- **Buttons**: CTA buttons (blue), delete buttons (red), neutral buttons
- **Responsive**: Mobile-first (media queries for print)

### No Component Library
- No Material-UI, Bootstrap, Tailwind, shadcn/ui
- Pure CSS for styling
- Raw HTML elements (buttons, inputs, tables)
- Inline form validation for UX (show/hide elements)

---

## 5. Existing Services & Utilities

### Services (Empty Directory)
- **Location**: `backend/src/services/`
- **Status**: No services implemented yet
- **Practice**: Business logic currently in route handlers

### Utilities

#### CSV Parser (`backend/src/utils.js`)
- **Function**: `parseCSV(text)` 
- **Location**: [backend/src/utils.js](backend/src/utils.js)
- **Behavior**: Parses CSV with quoted strings, handles BOM, strips quotes
- **Used for**: Staff and project imports
- **Returns**: Array of objects with headers as keys

#### Database Module (`backend/src/db.js`)
- **Exports**: `getDb()` — Singleton connection
- **Features**:
  - Lazy initialization of SQLite database
  - Schema creation with `initSchema(db)`
  - Seed execution with `runSeed(db)` (CSV-based)
  - Pragma configuration (WAL, foreign keys)
  - Migration function `runMigrations(db)` (stub or minimal)

#### Seed Module (`backend/src/seed.js`)
- **Purpose**: Load initial data from CSV files
- **Behavior**: Runs if tables are empty
- **Source Data**: 
  - `backend/public/files/active_staff_list.csv` (staff baseline)
  - Other project/skills CSVs as available
- **Exports**: `runSeed(db)` function

#### Authentication Helpers (`backend/src/routes/auth.js`)
- **Functions**:
  - `generateAccessToken(user)` — Creates 8-hour JWT
  - `generateRefreshToken()` — 64-byte random hex
  - `hashToken(token)` — SHA256 hash for database storage
  - `logAuthEvent(db, email, action, success, req)` — Audit logging

#### Dump/Restore (`backend/src/dump.js`, `backend/src/restore.js`)
- **dump.js**: Exports `dumpDatabaseAsJson()` — Entire database as JSON
- **restore.js**: Exports `restoreDatabaseFromJson(data)` — Wipes and restores
- **Use Case**: Data backup/recovery, migration

#### Frontend Utilities (`public/*.js`)
- **menu.js**: Role-based menu generation (shows/hides menu items)
- **auth.js**: Token management, `apiFetch()` wrapper
- Each page has corresponding JS (no shared utilities library)

### Missing Utility Modules
- ❌ **Email sending**: No nodemailer or mail service
- ❌ **PDF generation**: No pdfkit or similar (CV export to PDF not implemented)
- ❌ **Rich text editor**: Skills/project descriptions are plain text
- ❌ **File upload validation**: Basic checks only (size, extension)
- ❌ **Template engine**: Using Mustache templating inline (no pre-compilation)

---

## 6. Package Dependencies

### Backend (`backend/package.json`)

| Package | Version | Purpose |
|---------|---------|---------|
| **express** | ^4.18.3 | Web framework, routing, middleware |
| **better-sqlite3** | ^12.8.0 | High-performance SQLite driver, synchronous |
| **helmet** | ^7.1.0 | Security HTTP headers middleware |
| **jsonwebtoken** | ^9.0.2 | JWT creation/verification |
| **bcryptjs** | ^2.4.3 | Password hashing (not yet used in auth) |
| **multer** | ^1.4.5-lts.1 | File upload handling (photo, proof uploads) |
| **uuid** | ^9.0.1 | UUID v4 generation for record IDs |

### Frontend
- **No build tools**: No webpack, Vite, or Rollup
- **No package.json**: Vanilla JS, all scripts loaded via HTML `<script>` tags
- **No dependencies**: All frontend code is hand-written

### Runtime Environment
- **Node.js**: v20+ required (per `engines.node`)
- **Docker**: Multi-container setup (nginx, backend, SQLite)
- **Nginx**: Alpine-based, reverse proxy, static file serving

### Missing Packages
- ❌ **Typescript**: Not used (plain JavaScript)
- ❌ **Testing frameworks**: No Jest, Mocha, Vitest
- ❌ **Linters/Formatters**: No ESLint, Prettier
- ❌ **Validation**: No joi, yup, zod (manual validation)
- ❌ **Logging**: No Winston, Pino, Bunyan
- ❌ **Environment variables**: No dotenv (uses `process.env` directly)
- ❌ **ORM/Query builder**: Direct better-sqlite3 SQL (no sequelize, typeorm, knex)

---

## 7. Configuration & Environment Setup

### Environment Variables

**File**: `compose.yaml` environment section

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | `development` | App environment |
| `DB_PATH` | `/data/submissions.db` | SQLite database file path |
| `PORT` | `3000` | Express server port |
| `JWT_SECRET` | `dev_secret_change_me_in_prod` | JWT signing key (⚠️ CHANGE IN PROD) |
| `JWT_EXPIRY` | `8h` | Access token TTL (8 hours) |
| `AUTH_SERVICE_URL` | `https://appcore.beesuite.app` | External credential validation service |
| `AUTH_SERVICE_ENDPOINT` | `/api/auth/login` | Auth service login endpoint |
| `AUTH_ALLOW_FALLBACK` | `true` | Allow login if auth service unavailable |
| `REFRESH_TOKEN_EXPIRY_DAYS` | `30` | Refresh token validity period |

### Docker Compose Setup (`compose.yaml`)

**Services**:

#### nginx (reverse proxy)
- **Image**: `nginx:alpine`
- **Port**: `6082:80` (mapped to localhost)
- **Config**: `/nginx/default.conf` (custom)
- **Serves**: Static files from `./public` volume
- **Proxies**: Routes to backend service

#### backend (Node.js API)
- **Build**: `./backend/Dockerfile`
- **Volumes**:
  - `./backend:/app` (code mount)
  - `/app/node_modules` (anonymous volume to isolate)
  - `./public:/app/public:ro` (read-only static files)
  - `db_data:/data` (persistent database volume)
- **Command**: `node src/index.js`
- **Port**: `3000:3000` (mapped to localhost)
- **Depends on**: `db` service
- **Restart**: `unless-stopped`
- **User**: `root` (runs as root in container)

#### db (SQLite)
- **Image**: `alpine/sqlite:latest` (utility-only, no service)
- **Volume**: `db_data:/data` (persistent storage)
- **Purpose**: Provides SQLite CLI (not a running service)

### Docker Volumes
- **db_data**: Persistent database storage (SQLite file, backups)
- **node_modules** (anonymous): Backend dependencies (no host mount)

### Dockerfile (backend)

**Location**: `backend/Dockerfile`

**Base**: Node.js 20 (Alpine presumed for size)

**Setup**:
1. Install dependencies (`npm install`)
2. Expose port 3000
3. Run `npm start` (which runs `node src/index.js`)

### Frontend Configuration

**HTML Pages**: Served as static files via nginx

**Base URL**: `http://localhost:6082` (public Nginx port)

**API Endpoint**: `http://localhost:3000` (backend, proxied by nginx)

**Session Storage**:
- Submission ID: `sessionStorage.stafftrack_id`
- Tokens: `localStorage` (via `window.StaffTrackAuth`)

### Database Initialization

**On Startup**:
1. `getDb()` creates database if missing
2. `initSchema(db)` creates all tables (IF NOT EXISTS)
3. `runMigrations(db)` runs any pending migrations
4. `runSeed(db)` loads CSV data into empty tables

**CSV Seed Files**:
- `backend/public/files/active_staff_list.csv` (staff)
- `backend/public/files/extracted_projects.csv` (projects)
- Other `*.csv` in `backend/public/files/` as available

### Production Considerations

⚠️ **Current Setup is Development-Only**:
- **JWT_SECRET**: Hardcoded default (MUST change)
- **No HTTPS**: HTTP only
- **No rate limiting**: Vulnerable to brute-force & DoS
- **No request validation**: Schema validation missing
- **Logging**: Console-only, no persistent logs
- **Database**: SQLite (single-file, not suitable for multi-server)
- **No backup strategy**: Data relies on Docker volume (manual backup needed)
- **No monitoring**: No health checks, metrics, APM
- **No secrets management**: Env vars in compose.yaml (plaintext)

---

## 8. Authentication & Authorization Summary

### Authentication Flow

1. **User submits login form** → `POST /auth/login` with email & password
2. **Backend validates**:
   - Admin special case: accepts token-only login
   - Other users: delegates to external `AUTH_SERVICE_URL`
3. **On success**:
   - Creates JWT (signed with `JWT_SECRET`, expires in 8 hours)
   - Creates refresh token (64-byte hex)
   - Stores both as hashes in `auth_tokens` table
   - Auto-creates user in `user_roles` if missing
   - Returns tokens + user info to frontend
4. **Frontend stores tokens**:
   - `localStorage` for persistence across sessions
   - `sessionStorage` for submission ID
5. **Subsequent requests**:
   - Include `Authorization: Bearer <token>` header
   - `verifyToken` middleware validates token hash and JWT signature

### Authorization Model

**Role-Based Access Control (RBAC)**:

| Role | Capabilities | Routes |
|------|--------------|--------|
| **admin** | Full system access + user mgmt | `/admin`, `/data-tools`, all `/api` |
| **hr** | View all submissions, bulk import, reports | `/submissions`, `/admin/import-*`, `/reports` |
| **coordinator** | Manage assigned projects, project roster | `/managed-projects`, `/reports` (filtered) |
| **sa** (Solutions Architect) | View own profile, limited reporting | Own submission, own CV |
| **sales** | View staff/project catalogs, own CV | `/catalog`, own submission |
| **staff** | Create own submission, view own profile | Own submission only, own CV |

**Enforcement**:
- `verifyToken` middleware checks JWT
- `requireRole()` factory checks `req.user.role` against allowed list
- **No resource-level checks**: If authorized to view submissions, can view all

### Session Management

**Token Storage**:
- Access token: `auth_tokens.token_hash` (SHA256)
- Refresh token: `auth_tokens.refresh_token_hash` (SHA256)
- Expiration: `auth_tokens.expires_at` (ISO timestamp)
- Revocation: `auth_tokens.revoked` (integer flag)

**Token Lifecycle**:
- **Issue**: 8-hour validity
- **Refresh**: `POST /auth/refresh` with refresh token
- **Revoke**: `POST /auth/logout` sets `revoked = 1`
- **Clean-up**: Old tokens remain in table (no expiration job)

### Security Observations

✅ **Strengths**:
- JWT tokens validated both via signature and database lookup
- Tokens hashed before storage (SHA256, not plaintext)
- Passwords validated by external service (not stored locally)
- Role-based access control on routes
- HTTP-only not enforced on frontend (potential XSS risk)

⚠️ **Weaknesses**:
- **Hardcoded JWT_SECRET**: Same for all users, instances
- **No HTTPS**: Tokens transmitted in clear on production
- **No rate limiting**: Brute-force attacks not throttled
- **Cookie-less**: Token in localStorage (vulnerable to XSS)
- **No CSRF protection**: No CSRF tokens or SameSite cookies
- **bcryptjs imported but unused**: Password hashing not implemented
- **Admin hardcoded fallback**: Bypasses external auth service
- **Audit log not enforced**: Auth events logged but not monitored

---

## 9. API Error Handling Patterns

### HTTP Status Codes

- **200 OK**: Successful GET, PUT, DELETE
- **201 Created**: POST creates resource (not consistently used)
- **400 Bad Request**: Invalid input (missing required fields)
- **401 Unauthorized**: Missing or invalid token
- **403 Forbidden**: Valid token but insufficient role
- **404 Not Found**: Resource doesn't exist
- **500 Internal Server Error**: Unhandled exception

### Response Format

**Success** (typical):
```json
{
  "id": "uuid",
  "staffName": "John Doe",
  "createdAt": "2026-04-04T10:00:00.000Z"
}
```

**Error** (standard):
```json
{
  "error": "Invalid role. Must be one of: admin, hr, coordinator, sa, sales, staff"
}
```

**Batch operations** (admin import):
```json
{
  "added": 25,
  "skipped": 3,
  "updated": 0
}
```

### Error Logging

- **Console.error()**: Unhandled exceptions logged to stdout
- **No structured logging**: Plain text, no JSON formatting
- **Request logging**: Basic `${timestamp} ${method} ${url}` format
- **Audit logging**: Auth events stored in `auth_audit_log` table

---

## Implementation Checklist for 5 New Features

Based on this analysis, here's a template for tracking 5 new features:

### Feature Template
```
[ ] Feature Name
   [ ] Database schema changes (new tables/columns)
   [ ] API endpoints (GET/POST/PUT/DELETE)
   [ ] Authentication/Authorization middleware
   [ ] Frontend form/view components
   [ ] Data validation (backend)
   [ ] Error handling
   [ ] Audit logging (if needed)
   [ ] Tests (if applicable)
   [ ] Documentation
   [ ] Deployment considerations
```

### Next Steps
1. **Define 5 features** (business requirements)
2. **Map to schema changes** (which tables/fields)
3. **Design API contracts** (endpoints, request/response)
4. **Implement backend routes** (add to `src/routes/`)
5. **Build frontend pages** (add `.html` and `.js`)
6. **Test authentication flow** (verify RBAC)
7. **Deploy via Docker Compose** (rebuild & restart)

---

## Quick Reference: Key Files

| Task | Files |
|------|-------|
| **Add new API endpoint** | `backend/src/routes/*.js`, `backend/src/index.js` |
| **Create new frontend page** | `public/*.html`, `public/*.js` |
| **Modify database schema** | `backend/src/db.js` (initSchema) |
| **Add admin feature** | `backend/src/routes/admin.js`, `public/admin.js` |
| **Implement authentication** | `backend/src/routes/auth.js` |
| **Configure environment** | `compose.yaml` |
| **Deploy changes** | `docker compose build && docker compose up` |

