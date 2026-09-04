# StaffTrack

A premium, containerized Skill & Project Tracking application for staff management.

## 🚀 Quick Start

Ensure you have **Docker** and **Docker Compose** installed.

```bash
# Start the application
docker compose up -d

# Initial Database Seed (Automatically runs on first startup)
# Access the web interface at:
# http://localhost:8080
```

## 🏗️ Architecture

- **Frontend**: Vanilla JS + HTML5 + CSS3 (Premium Dark Theme)
- **Backend**: Node.js 20 (Express)
- **Database**: MySQL 8.0 (Relational Schema)
- **Auth Provider**: BeeSuite AppCore (external authentication)
- **Proxy**: Nginx (Handles static files & reverse proxy)
- **Orchestration**: Docker Compose

## 🔑 Roles & Access

| Role | Access Level | Permissions |
| :--- | :--- | :--- |
| **Admin** | Full | User Role Management, System Imports (CSV), Catalog Data Management |
| **HR** | Reporting | View/Search All Staff Submissions, Export CSV Reports |
| **Coordinator** | Management | Create/Edit Projects, Manage Staff Assignments |
| **Staff** | Individual | Submit/Update Personal Skills & Project History |

## 🛠️ Key Features

- **Relational Backend**: Fully normalized MySQL schema with SQL Transactions.
- **Auto-Sync on Login**: When a valid BeeSuite user signs in but their profile doesn't exist locally yet, the app automatically syncs their staff and role data from BeeSuite — no manual import needed.
- **Auto-Sync Catalog**: Submissions automatically pull Title/Department/Manager data from the company catalog.
- **Smart Autocomplete**: Dynamic search for Staff and Projects.
- **Modern UI**: Segmented tab designs, smooth transitions, and a premium dark aesthetic.
- **Mobile Responsive**: Optimized for various screen sizes with responsive grids and scrollable table containers.
 - **Self-Service Administration**: Dedicated pages for permission management, catalog maintenance, and bulk data imports.
- **CV Profiles**: Individual staff CV management with sections for personal info, education, certifications, work history, and past projects.
  - **Certification Proof Attachments**: Upload and attach PDF/image proof documents to certifications and education entries.
  - **Certificate Bundle Download**: Download all certification proofs as a ZIP file with a manifest.
  - **Clickable Certificate Links**: Generated CVs include clickable links to view attached certification proofs.
- **Gantt Chart Optimization**: High-performance rendering using canvas virtualization, supporting thousands of task bars with smooth 60fps scrolling and zooming.
- **CV Editor Enhancements**: Distraction-free editing with toggleable Markdown and CSS columns for the CV Template Editor.
- **Project coordination**: Enhanced project management for coordinators, including filtered Gantt views and project assignment tools.
- **Skill Consolidation**: Admin tools for skill governance including merge, split, and rename operations.
- **Staff Search**: Advanced search functionality for finding staff by multiple skill criteria.
- **Certification Catalog**: Organization-wide certification tracking with expiry monitoring (Expired / Expiring ≤ 90 days), By Certification / By Staff views, and proof links — Admin/HR only.
- **BeeSuite Staff Sync**: One-click manual sync from the System page pulls all staff from BeeSuite AppCore — name, title/designation, department, manager, and active/resigned status — and upserts the local `staff` + `user_roles` tables. Manager + resignation data comes from a single ZCS DreamFactory bulk query (~0.3s) with a per-staff AppCore fallback; full 300+ staff sync ≈ 5s (see docs/ROADMAP.md §3).

## 📁 Repository Structure

- `/backend`: Node.js API source code.
- `/data`: MySQL data persistence (via Docker volume).
- `/nginx`: Proxy configuration.
- `/files`: Location for CSV import templates.
- **Management Pages**:
  - `admin.html`: User permission and role management.
  - `catalog.html`: Global staff and project record maintenance.
  - `system.html`: BeeSuite staff/project sync cards, skill consolidation, and system stats.
  - `reporting.html`: Management reporting dashboard — org KPIs (headcount, team structure, profile completeness, skills, projects, certs, activity). Full org for Admin/HR/coordinator; subordinates (direct + indirect) for managers; 403 otherwise.
- **Standard Pages**:
  - `index.html`: My Submission / Home.
  - `cv-profile.html`: CV profile management.
  - `projects.html`: Project-centric view with assignment tools.
  - `staff-view.html`: Organization-wide staff reporting.
  - `skills.html`: Skill aggregation and search.
  - `certifications.html`: Organization-wide certification catalog (Admin/HR).
  - `api-access.html`: Personal API tokens, Data Feeds, and an API console (all roles).

---
## 📑 Documentation
- [Feature Roadmap](docs/ROADMAP.md)
- [Implementation Plans](docs/IMPLEMENTATION_PLANS.md)

---
*Built with Antigravity*
