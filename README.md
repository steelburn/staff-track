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
- **Database**: SQLite (Relational Schema)
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

- **Relational Backend**: Fully normalized SQLite schema with SQL Transactions.
- **Auto-Sync Catalog**: Submissions automatically pull Title/Department/Manager data from the company catalog.
- **Smart Autocomplete**: Dynamic search for Staff and Projects.
- **Modern UI**: Segmented tab designs, smooth transitions, and a premium dark aesthetic.
- **Mobile Responsive**: Optimized for various screen sizes with responsive grids and scrollable table containers.
- **Self-Service Administration**: Dedicated pages for permission management, catalog maintenance, and bulk data imports.

## 📁 Repository Structure

- `/backend`: Node.js API source code.
- `/data`: SQLite database persistence.
- `/nginx`: Proxy configuration.
- `/files`: Location for CSV import templates.
- **Management Pages**:
  - `admin.html`: User permission and role management.
  - `catalog.html`: Global staff and project record maintenance.
  - `system.html`: Bulk CSV data imports and system stats.
- **Standard Pages**:
  - `index.html`: My Submission / Home.
  - `projects.html`: Project-centric view with assignment tools.
  - `staff-view.html`: Organization-wide staff reporting.
  - `skills.html`: Skill aggregation and search.

---
*Built with Antigravity*
