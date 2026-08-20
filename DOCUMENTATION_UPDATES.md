# Documentation Updates Summary

## Changes Made

### 1. README.md
- Added information about CV Profiles feature
- Added Skill Consolidation and Staff Search to key features
- Updated repository structure with cv-profile.html
- Added details about system.html including skill consolidation
- Updated Quick Start section to include database seed details
- Added architecture details for better clarity
- Enhanced Key Features section with relational backend and modern UI details

### 2. docs/ROADMAP.md
- Updated CV Generation (MVP) status to ✅ Completed
- Updated Access Control status to ✅ Completed (JWT, refresh tokens, audit log, 6 roles)
- Expanded Role Model to include SA/Pre-Sales and Sales roles
- Updated Permission Matrix to reflect new roles

### 3. docs/IMPLEMENTATION_PLANS.md
- Marked Skill Search & Consolidation (Features 6 & 8) as ✅ COMPLETED

### 4. Recent Updates (March 17, 2026)
- **Database Schema Migration**:
  - Renamed `name` to `project_name` in `managed_projects` table.
  - Renamed `project_brief` to `description` in `managed_projects` table.
- **Frontend & API Synchronization**:
  - Updated `managed_projects.js` and `projects.js` to support renamed fields.
  - Ensured consistent fallback logic for `project_name` and `description` in the UI.
- **CV Template Enhancements**:
  - Improved template inheritance logic in `cv_profiles.js` to correctly prioritize `description` from project assignments, falling back to the project catalog description.
- **Session & Auth Fixes**:
  - Resolved `authUser` ReferenceError in `app.js`.
  - Implemented consistent session redirection for unauthenticated users.

## Recent Updates (April 18, 2026)
- **BeeSuite Auto-Sync on Login**:
  - When a valid BeeSuite user signs in but the app doesn't have their profile yet, the backend automatically syncs their data from BeeSuite.
  - Creates `staff` record with name, title, department, and manager info.
  - Creates `user_roles` record with default `staff` role.
  - Frontend now stores the user's name in session for display purposes.
  - Token refresh preserves existing user data (like name) via merge logic.
- **Documentation Updates**:
  - Updated README, PROJECT_STRUCTURE, COPILOT_SPECS, CODEBASE_ANALYSIS to reflect auto-sync and MySQL migration.

### Completed Features
- ✅ CV Profiles: Full implementation including personal info, education, certifications, work history, and past projects
- ✅ Skill Search & Consolidation: Advanced search and skill governance tools
- ✅ Access Control: JWT authentication, refresh tokens, audit logging, 6 roles (admin, hr, coordinator, sa, sales, staff)
- ✅ Staff Search: Multi-criteria skill matching

## Recent Updates (August 21, 2026)
- **Newline Preservation in Text Display**:
  - Added `.preserve-newlines` CSS class with `white-space: pre-line` to honor newlines in text content.
  - Updated `cv-profile.js` to apply the class to education, certification, work history, and past project descriptions.
  - Skills and descriptions now display line breaks correctly instead of as continuous text.
- **Skill Badge Styling**:
  - Added `.skill-badges` and `.skill-badge` CSS classes in `components.css` for proper skill display.
  - Skills now render as styled, wrapping badges instead of inline spans.
  - Added `escapeHtml()` function in `staff-view.js` to prevent XSS in skill names.
- **CSP Fix for Generated CV Images**:
  - Fixed Content Security Policy in `index.js` to allow images from `http:` and `https:` origins.
  - Previously, `img-src 'self'` blocked photos and certificate links when page origin port differed from image URL port.
  - Generated CVs now correctly display profile photos and certificate proof links.
- **File Upload Path Fixes**:
  - Migrated old photo and proof files from `backend/files/photos/` and `backend/files/proofs/` to `backend/files/uploads/`.
  - Server correctly serves uploaded files via Docker volume mount at `/data/uploads`.

### Running the Application
```bash
# Application is already running
# Access at http://localhost:6082

# Check health
curl http://localhost:6082/api/health

# Stop the application
docker compose down
```