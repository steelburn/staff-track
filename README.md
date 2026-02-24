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
| **Admin** | Full | User Role Management, All Submissions, Global Catalog |
| **Coordinator** | Management | Create/Edit Projects, Manage Staff Assignments |
| **Staff** | Individual | Submit/Update Personal Skills & Project History |

## 🛠️ Key Features

- **Relational Backend**: Fully normalized SQLite schema with SQL Transactions.
- **Auto-Sync Catalog**: Submissions automatically pull Title/Department/Manager data from the company catalog.
- **Smart Autocomplete**: Dynamic search for Staff and Projects.
- **Export Ready**: One-click staff list export.
- **Responsive Layout**: Mobile-friendly dark UI.

## 📁 Repository Structure

- `/backend`: Node.js API source code.
- `/data`: SQLite database persistence.
- `/nginx`: Proxy configuration.
- `app.js`, `projects.js`, `staff-view.js`: Frontend logic.
- `index.html`, `projects.html`, `staff-view.html`: Frontend pages.

---
*Built with Antigravity*
