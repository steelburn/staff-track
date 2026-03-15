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

## 4. Skill Search & Consolidation (Features 6 & 8) - ✅ COMPLETED

### Objective
Improve the accuracy of skill reporting and provide powerful search capabilities for Pre-Sales/Sales teams.

### Technical Implementation

#### 1. Database Schema Changes (`backend/src/db.js`)
- **Add new tables for Skill Consolidation (Data Governance):**
  - `skills_catalog`: Canonical list of skills (`id`, `name` (UNIQUE), `category`, `aliases`, `is_active`).
  - `skill_merge_log`: Audit trail for merge, split, and rename operations (`id`, `from_name`, `to_name`, `affected_count`, `merged_by`, `merged_at`).

#### 2. Skill Consolidation (Backend & Frontend)
- **Backend API (`backend/src/routes/admin.js`):**
  - **GET `/api/admin/skills`**: Returns aggregated skill usage statistics.
  - **POST `/api/admin/skills/merge`**: Merges duplicate/variant skills into a target canonical skill.
  - **POST `/api/admin/skills/split`**: Splits a single skill into multiple distinct skills for all affected staff.
  - **POST `/api/admin/skills/rename`**: Bulk renames a specific skill.
- **Frontend UI (`system.html` & `system.js`):**
  - Add "Skill Consolidation" section in System Management.
  - table-based management with bulk actions: **Merge**, **Split**, **Rename**, and **Delete**.

#### 3. Skill Search/Sort (Backend & Frontend)
- **Backend API (`backend/src/routes/reports.js`):**
  - **GET `/api/reports/staff-search`**: Multi-criteria skill matching (e.g., "Python ≥ 4 AND AWS ≥ 3").
- **Frontend UI (`skills.html` & `skills.js`):**
  - Redesign Skills dashboard with an **Advanced Skill Filter**.
  - Multi-view modes: **View by Skill** and **View by Staff** (staff cards).
  - Smart view switching: Automatically switches to Staff view when adding advanced filter chips.

---
*Follow the Clean Host rule: Always use containerized development environment for implementation.*
