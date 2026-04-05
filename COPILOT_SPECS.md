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

### Current Status

- **Production Ready**: Yes (v1.0)
- **Database**: SQLite
- **Deployment**: Docker Compose (local development)
- **Kubernetes**: Pending implementation

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────┐     ┌──────────┐     ┌──────────┐     ┌─────────┐
│   Browser   │────▶│  Nginx   │────▶│ Backend  │────▶│  SQLite │
│   (SPA)     │     │  (Proxy) │     │  (API)   │     │  (DB)   │
└─────────────┘     └──────────┘     └──────────┘     └─────────┘
```

### Technology Stack

| Layer | Technology | Version | Notes |
|-------|------------|---------|-------|
| Frontend | Vanilla JS | ES2020 | SPA patterns |
| Backend | Node.js | 20 LTS | Express framework |
| Database | MySQL | 8.0 | mysql2/promise, prepared statements |
| Authentication | JWT | 9.x | HS256 signing |
| Proxy | Nginx | Alpine | Reverse proxy + static files |
| Containerization | Docker | 24.x | Multi-stage builds |

---

## System Architecture

### Container Topology

```
┌─────────────────────────────────────────────┐
│      Docker Compose Environment             │
├─────────────────────────────────────────────┤
│                                             │
│  ┌───────────────┐      ┌───────────────┐  │
│  │    nginx      │      │   backend     │  │
│  │  Port 80      │      │   Port 3000   │  │
│  │  Static files │─────▶│   API routes    │  │
│  │  Proxy /api   │      │   File uploads│  │
│  └───────────────┘      └───────────────┘  │
│                                         │  │
│                                         ▼  │
│                                   ┌───────────┐  │
│                                   │   SQLite  │  │
│                                   │  Volume   │  │
│                                   └───────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

### Data Flow

1. **User Authentication Flow**
   ```
   Browser → /api/auth/login → Backend → External Auth Service → SQLite
                                                   ↓
                                        Response (JWT Token)
   ```

2. **Staff Submission Flow**
   ```
   Browser → POST /submissions/me → Backend → SQLite (submissions, skills, projects)
   ```

3. **Report Generation Flow**
   ```
   Browser → GET /reports/staff → Backend → Query DB → Return JSON
   ```

4. **CV Generation Flow**
   ```
   Browser → POST /cv-profiles/generate → Backend → Collect data → Render HTML → Save snapshot
   ```

---

## Component Details

### Backend Components

| File | Purpose | Lines |
|------|---------|-------|
| `index.js` | Express app entry, middleware, routing | 60 |
| `db.js` | Database initialization, migrations | 783 |
| `utils.js` | CSV parsing utilities | 40 |
| `auth.js` | JWT generation, token refresh | 399 |
| `submissions.js` | CRUD operations, project assignment | 339 |
| `admin.js` | User management, CSV imports | 469 |
| `cv_profiles.js` | CV profile CRUD, template management | 1,159 |
| `reports.js` | Staff, projects, skills reports | 266 |
| `managed_projects.js` | Coordinator project management | 135 |
| `data-tools.js` | Backup/restore endpoints | 104 |

### Frontend Components

| File | Purpose | Key Features |
|------|---------|----------|
| `index.html` | Staff submission form | Auto-populated, skill/project management |
| `login.html` | Authentication page | Email/password |
| `admin.html` | User role management | Role CRUD, CSV import UI |
| `dashboard.html` | Main dashboard | Overview statistics |
| `catalog.html` | Global catalog maintenance | Staff and project editing |
| `system.html` | System operations | Backup/restore, skill consolidation |
| `cv-profile.html` | CV profile editing | Photo upload, tabs |
| `cv-template-editor.html` | Template management | Markdown/CSS editing |
| `gantt.html` | Project timeline | Gantt chart visualization |
| `projects.html` | Project-centric view | Assigned projects |

---

## Database Schema

### Entity Relationship Diagram

```
staff (catalog) ── 1─n ── submissions ── 1─n ── submission_skills
                                    │
                                    └─ 1─n ── submission_projects ── n─1 ── managed_projects

user_roles ── 1─n ── auth_tokens ── auth_audit_log

cv_profiles ── 1─n ── education
            └─ 1─n ── certifications
            ├─ 1─n ── work_history
            ├─ 1─n ── cv_past_projects
            └─ 1─n ── cv_snapshots

cv_templates ── 1─n ── cv_snapshots
```

### Tables (18 total)

| Table | Purpose | Records |
|-------|--|||-------|
| `staff` | Global staff catalog | 243 |
| `submissions` | Staff submissions | 162 |
| `submission_skills` | Staff skills | 1,000+ |
| `submission_projects` | Project assignments | 500+ |
| `user_roles` | User permissions | 30 |
| `auth_tokens` | JWT tokens | Active sessions |
| `auth_audit_log` | Authentication events | All logins |
| `projects_catalog` | Project database | 327 |
| `skills_catalog` | Canonical skill list | Deduplication |
| `managed_projects` | Coordinator projects | Managed |
| `cv_profiles` | CV profile summary | Staff profiles |
| `education` | Academic qualifications | Education |
| `certifications` | Certifications | Certifications |
| `work_history` | Employment history | Work history |
| `cv_past_projects` | Extra projects | Projects |
| `cv_templates` | CV templates | Templates |
| `cv_snapshots` | CV snapshot history | Snapshots |
| `skill_merge_log` | Skill merge tracking | Merge log |

---

## API Specification

### Authentication (`/auth/*`)

#### POST `/auth/login`
**Request:**
```json
{"email": "user@example.com", "password": "base64_string"}
```

**Response (200):**
```json
{
  "accessToken": "jwt_token",
  "refreshToken": "refresh_token",
  "user": {"email": "user@example.com", "role": "staff"},
  "expiresIn": 28800
}
```

### Submissions (`/submissions/*`)

#### GET `/submissions/me`
Returns current staff's submissions with skills and projects.

#### POST `/submissions/assign-project`
Assigns staff to a project.

### Admin (`/admin/*`)

#### GET `/admin/roles`
Returns all users with roles.

#### POST `/admin/import-staff`
Imports staff from CSV.

### Reports (`/reports/*`)

#### GET `/reports/staff`
Returns all staff with skills and projects.

#### GET `/reports/skills`
Returns skills and proficiency ratings.

### CV Profile (`/cv-profiles/*`)

#### GET `/cv-profiles/:email`
Returns CV profile data.

#### POST `/cv-profiles/:email/generate`
Generates CV from profile data.

### Data Tools (`/data-tools/*`)

#### GET `/data-tools/dump`
Returns database dump as JSON.

#### POST `/data-tools/restore`
Restores database from JSON dump.

---

## Security Architecture

### Authentication Flow

```
Browser → POST /auth/login → Backend → Validate → Generate JWT → Store token → Response
```

### Role-Based Access Control

| Role | Permissions |
|------|-------------|
| Admin | Full system control |
| HR | View all, export reports |
| Coordinator | Project management |
| SA/Pre-Sales | Skill search, CV generation |
| Sales | Skill search, CV generation |
| Staff | Self-service only |

### Security Best Practices

- ✅ Helmet.js security headers
- ✅ Parameterized SQL queries
- ✅ JWT token expiration
- ✅ Token revocation on logout
- ❌ JWT secret from environment variable
- ❌ Rate limiting on auth endpoints
- ❌ CORS configuration
- ❌ File upload virus scanning
- ❌ Error message sanitization

---

## Performance Analysis

### Response Time Benchmarks (Estimated)

| Endpoint | Method | Estimated Latency |
|----------|--------|------------------|
| `/auth/login` | POST | 300-500ms |
| `/submissions/me` | GET | 50-100ms |
| `/reports/staff` | GET | 200-400ms |
| `/reports/skills` | GET | 150-300ms |
| `/cv-profiles/generate` | POST | 500-800ms |
| `/data-tools/dump` | GET | 5-10s |
| `/data-tools/restore` | POST | 10-15s |

### Scaling Considerations

| Metric | Current Limit | With Optimization | With PostgreSQL + Redis |
|--------|---------------|-------------------|------------------------|
| Concurrent Users | ~50 | ~500 | ~5,000 |
| Max Rows in Table | ~10,000 | ~50,000 | ~1M+ |
| Response Time | 200ms | 100ms | 50ms |

---

## Deployment Architecture

### Current: Docker Compose

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "6082:80"
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
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stafftrack-backend
spec:
  replicas: 3
  template:
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
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
        resources:
          limits:
            memory: "512Mi"
            cpu: "500m"
```

---

## CI/CD Pipeline

### GitHub Actions Workflow

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
        tags: ghcr.io/stafftrack/backend:${{ github.sha }}

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
    - run: kubectl apply -f k8s/production/
```

---

## Data Management Strategy

### Backup

```bash
curl http://localhost:3000/data-tools/dump -o backup-$(date +%s).json
```

### Restore

```bash
curl -X POST http://localhost:3000/data-tools/restore \
  -H "Content-Type: application/json" \
  -d @backup-file.json
```

### Data Retention Policy

| Table | Retention |
|-------|-----------|
| `submissions` | 7 years |
| `auth_tokens` | 90 days |
| `auth_audit_log` | 1 year |
| `cv_snapshots` | 5 years |

---

## Refactoring Recommendations

### 🔴 Critical

1. **JWT Secret Management**
   - Current: Hardcoded
   - Fix: Use environment variable

2. **Password Handling**
   - Current: Base64 encoding
   - Fix: Use bcrypt or external auth service

3. **SQL Injection Prevention**
   - ✅ Already implemented

### 🟡 High Priority

4. **CORS Configuration**
   - Add CORS middleware

5. **Rate Limiting**
   - Add rate limiting on auth endpoints

6. **Database Indexes**
   - Add indexes on frequently queried columns

7. **Error Handling**
   - Improve error messages

### 🟢 Medium Priority

8. **Code Organization**
   - Organize by feature

9. **Environment Variables**
   - Create config module

10. **Module Export**
    - Convert to ES6 modules

---

## Migration Roadmap

### Phase 1: Database Migration

1. Create MySQL migration script
2. Update Docker Compose with MySQL
3. Update backend database configuration
4. Implement proper migration framework
5. Migrate from SQLite to MySQL with data preservation

### Phase 2: Frontend Improvements

1. Add build system (Vite)
2. Add frontend tests

### Phase 3: Kubernetes Deployment

1. Create Kubernetes manifests
2. Deploy staging environment
3. Deploy production environment

### Phase 4: CI/CD Implementation

1. Create GitHub Actions workflow
2. Set up environment variables
3. Test pipeline

---

## Implementation Checklist

### Immediate

- [ ] Fix JWT secret handling
- [ ] Add database indexes
- [ ] Implement CORS configuration
- [ ] Add rate limiting
- [ ] Enhance error handling
- [ ] Create backup automation
- [ ] Add health check endpoint

### Short-term

- [ ] Add database tests
- [ ] Implement frontend virtualization
- [ ] Add Redis caching layer
- [ ] Set up staging Kubernetes cluster

### MeImplement CI/CD pipeline
- [ ] Deploy production Kubernetes
- [ ] Set up monitoring stack
- [ ] Add Redis caching layere
- [ ] Deploy production Kubernetes
- [ ] Set up monitoring stack

---

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `PORT` | No | 3000 |
| `DB_PATH` | No | /data/submissions.db |
| `JWT_SECRET` | Yes | (required) |
| `JWT_EXPIRY` | No | 8h |
| `AUTH_SERVICE_URL` | No | - |
| `ALLOWED_ORIGINS` | No | * |

---

**Document Version:** 2.0.0  
**Last Updated:** 2026-04-04  
**Next Review:** 2026-05-04
