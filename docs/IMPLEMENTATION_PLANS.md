# StaffTrack Implementation Plans

This document provides technical blueprints for upcoming features, ensuring consistency with the project's architecture.

## 1. Gantt Chart Optimization — ✅ COMPLETED

### Objective
Resolve performance issues with the Gantt Chart, specifically addressing rendering latency for large datasets.

### Technical Implementation
- **Canvas Virtualization**: Implemented a virtualized rendering system that only draws bars within the visible viewport.
- **Efficient Recalculations**: Optimized date-to-pixel calculations and rendering loops.
- **Viewport Fixes**: Ensured the Gantt chart scales correctly with large numbers of users.

---

## 2. CV Template Editor UI Enhancements — ✅ COMPLETED

### Objective
Optimize the UI for CV Template editing by allowing more space for live preview.

### Technical Implementation
- **Column Toggling**: Added "Show/Hide" buttons for Markdown and CSS sections.
- **Full-Width Preview**: The Live Preview pane expands when editor columns are hidden.

---

## 3. Staff & CV Management Fixes — ✅ COMPLETED

### Objective
Address several functional issues in staff and CV workflows.

### Technical Implementation
- **Staff Removal**: Added functionality to remove staff members in the staff view.
- **Contextual CV Generation**: Fixed CV generation to use the selected user's profile instead of the logged-in user's.
- **Project Editing**: Enabled project information editing for coordinators and admins.
- **Filtered Gantt Views**: Allowed coordinators to view filtered Gantt charts of their projects.

---

## 4. ApexCharts Integration for Visual Analytics (Future)

### Objective
Provide a visual dashboard on the `staff-view.html` page using ApexCharts.

### Technical Implementation
- **Frontend**: Include `<script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>` in `staff-view.html`.
- **API Endpoint**: Create `GET /api/reports/skill-stats` in `backend/src/routes/reports.js`.
  - Should return JSON: `{ categories: ['React', 'Node'], counts: [45, 32] }`.
- **UI Component**: Add a `#skills-chart` container and initialize it in `staff-view.js`.

---

## 5. Server-Side Pagination (Future)

### Objective
Improve performance for the Skills and Staff View pages.

### Technical Implementation
- **Database Layer**: Update queries in `backend/src/routes/reports.js` and `backend/src/routes/submissions.js` to accept `limit` and `offset`.
- **Frontend Layer**: Implement a pagination component in `utils.js` (shared) that renders "Prev / Next" and page numbers.
- **API Response**: Standardize response to:
  ```json
  {
    "data": [...],
    "total": 1250,
    "page": 1,
    "limit": 50
  }
  ```

---

## 6. Skill Autocomplete Enhancement (Future)

### Objective
Standardize skill naming by suggesting values from the `skills_catalog`.

### Technical Implementation
- **Backend**: Ensure `GET /api/skills/catalog` returns a sorted list of names.
- **Frontend**:
  - Update `skills.js` and `app.js` to fetch the catalog on page load.
  - Implement a datalist or custom dropdown for skill input fields.
  - Apply "Fuzzy Search" logic to match aliases.

---

## 4. BeeSuite Auto-Sync on Login — ✅ COMPLETED

### Objective
Automatically sync user profile data from BeeSuite when a valid user signs in for the first time, eliminating the need for manual admin imports.

### Technical Implementation

#### Backend (`backend/src/routes/auth.js`)
- Added `syncUserFromBeeSuite(db, email, beesuiteToken)` helper function.
- After BeeSuite authentication succeeds, if `user_roles` lookup returns empty:
  1. Fetches staff list from BeeSuite `/api/users/staff` using the login token.
  2. Finds the matching user by email.
  3. Fetches employment detail from `/api/admin/user-info-details/employment-detail/:id` for manager name.
  4. Creates `staff` record (email, name, title, department, manager_name).
  5. Creates `user_roles` record with default `staff` role (is_hr=0, is_coordinator=0).
  6. Re-queries roles and proceeds with login.
- Login response now includes `name` field from the `staff` table.

#### Frontend
- `login.js`: Stores `name` from backend response in `st_user` session data.
- `auth.js`: `setTokens()` merges existing user data (like `name`) when refreshing tokens, preserving user info across refreshes.

---

## 5. Skill Search & Consolidation (Features 6 & 8) - ✅ COMPLETED

### Objective
Improve the accuracy of skill reporting and provide powerful search capabilities for Pre-Sales/Sales teams.

### Technical Implementation

#### 1. Skill Consolidation (Backend & Frontend) — System page

- **`backend/src/utils/skillMatching.js`**: pure-function similarity engine.
  - `skillCharNorm()` — grouping key (lowercase, keep a-z0-9#+, strip the rest): "Node.js" / "Nodejs" / "Node JS" collapse into one group.
  - `pairScore()` — Levenshtein ratio on char-norm keys + token overlap (max-denominator; min-denominator lets single-word skills like ".NET"/"Database" chain unrelated skills into one giant component). Guards: digit-only diffs (SharePoint Designer 2010/2013, ESXi 7.0/8.0, HTML/HTML5), negation pairs (Spatial/Non-Spatial), ≤2-char names (C/C#/C++).
  - `buildProposals()` — union-find components → proposal groups; recommended target = generic fewest-token name for subset relations, else most-used name.
- **Backend API (`backend/src/routes/admin.js`)**:
  - **GET `/api/admin/skills`** → `{skills, proposals}`: skills grouped by normalized spelling (`name` = most common variant, `variants[]`, `count` = distinct submissions, `instances` = rows) + machine-suggested duplicate groups for human review.
  - **POST `/api/admin/skills/preview`**: dry-run merge — affected staff rows + dedupe collisions (submissions holding both a source and the target).
  - **POST `/api/admin/skills/merge`**: 1+ sources (target auto-excluded, case-insensitive); updates rows, then dedupes same-submission duplicates (keep highest rating, tie = lowest id).
  - **POST `/api/admin/skills/rename`**: guards "target already exists" → suggests merge instead.
  - **POST `/api/admin/skills/split`**: round-robin distribution across the new names.
  - **DELETE `/api/admin/skills`**: removes every instance of one skill.
  - **GET/POST `/api/admin/skills/undo`**: every op snapshots affected rows (`id, submission_id, skill, rating`) into `skill_undo_log` (migration 0009) before writing; undo restores by id (re-INSERTs deleted rows). One undo level per actor, survives restart.
  - All ops write `profile_audit_log` rows (section `skills_admin`, action = op or undo).
- **Frontend UI (`system.html` & `system.js`)**:
  - Skills table: spelling variants inline, instance counts, 🔁 badge on skills that appear in proposal groups.
  - **Find Duplicates** panel: suggestion cards (members with counts + similarity %, recommended merge target, "Merge group" button).
  - Merge modal with live preview of affected staff (dedupe rows flagged ⚠), target autocomplete; Rename/Split/Delete modals; **↩️ Undo** button (state persisted per actor, survives reload).
  - Toolbar: Merge requires ≥2 selections; Rename/Split/Delete exactly 1.

#### 2. Skill Search/Sort (Backend & Frontend)
- **Backend API (`backend/src/routes/reports.js`):**
  - **GET `/api/reports/skills`**: groups case- and whitespace-insensitively (label = most common spelling, staff lists merged).
  - **GET `/api/reports/staff-search`**: Multi-criteria skill matching (e.g., "Python ≥ 4 AND AWS ≥ 3").
- **Frontend UI (`skills.html` & `skills.js`):**
  - Redesign Skills dashboard with an **Advanced Skill Filter**.
  - Multi-view modes: **View by Skill** and **View by Staff** (staff cards).
  - Smart view switching: Automatically switches to Staff view when adding advanced filter chips.

---

## 6. CV Certification Enhancements - ✅ COMPLETED

### Objective
Enhance CV profiles with certification proof attachments and bundle download capabilities.

### Technical Implementation

#### 1. Database Schema
- **Certifications table**: Added `proof_path` column for storing attached proof document paths.
- **Education table**: Added `proof_path` column for storing attached proof document paths.

#### 2. Backend API (`backend/src/routes/cv_profiles.js`)
- **POST `/:email/certifications/:id/proof`**: Upload certification proof document (PDF/image).
- **DELETE `/:email/certifications/:id/proof`**: Remove certification proof document.
- **GET `/:email/certifications/bundle`**: Download all certification proofs as a ZIP file with manifest.
- **CV Generation**: Updated to include `proof_path` in certification data and convert to absolute URLs.
- **Markdown to HTML**: Added link conversion `[text](url)` → `<a href="url" target="_blank">text</a>`.

#### 3. Template System
- **Default Templates**: Updated Classic, Modern, and Minimal templates to include Certifications section with proof links.
- **Template Variables**: Added `{{#proof_path}}` conditional block for showing certificate links.
- **Database Update**: All existing templates updated with certifications section.

#### 4. Frontend (`public/cv-profile.html` & `public/cv-profile.js`)
- **Certification Form**: Added proof upload section (visible in edit mode).
- **Education Form**: Added proof upload section (visible in edit mode).
- **Generate CV Tab**: Added "Download Certificates" button for ZIP bundle download.
- **Card Views**: Added "View Proof" links for certifications and education entries.

#### 5. CV Template Editor (`public/cv-template-editor.html` & `public/cv-template-editor.js`)
- **Variable Chips**: Added `{{proof_path}}` to certifications and education loop variables.
- **Sample Data**: Added sample proof paths for live preview.

#### 6. Dependencies
- Added `archiver` package for ZIP file creation.

---
*Follow the Clean Host rule: Always use containerized development environment for implementation.*
