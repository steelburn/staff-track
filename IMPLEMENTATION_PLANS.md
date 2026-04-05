# StaffTrack - Implementation Plans

**Version:** 1.0.0  
**Date:** 2026-04-04  
**Status:** Active Development

---

## Current Status

✅ **Completed Features:**

| Feature | Status | Notes |
|--------|--------|------|
| Core Authentication | ✅ | JWT tokens with refresh |
| Staff Submissions | ✅ | CRUD operations |
| Role Management | ✅ | 6 roles with permissions |
| Skill Consolidation | ✅ | Merge, rename, split skills |
| Project Catalog | ✅ | Import and manage projects |
| CV Profile Editing | ✅ | Multi-section profile |
| CV Template System | ✅ | White-labeled templates |
| CV Generation | ✅ | Markdown-to-HTML rendering |
| Backup/Restore Tools | ✅ | JSON export/import |
| Audit Logging | ✅ | Authentication events |
| Reports System | ✅ | Staff, skills, projects |
| File Uploads | ✅ | Photos and proofs |

---

## Active Work Items

### 🔴 Phase 1: Production Readiness (This Week)

#### 1. Fix JWT Secret Management

**Current Issue:**
```javascript
// backend/src/routes/auth.js:11
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
```

**Problem:** If environment variable not set, secret regenerated on every restart.

**Action:**
```javascript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production');
}
```

**Files:** `backend/src/routes/auth.js`

#### 2. Add Database Indexes

**Action:** Add index creation after schema initialization
```javascript
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_submissions_staff_email ON submissions(staff_email);
  CREATE INDEX IF NOT EXISTS idx_submissions_updated_at ON submissions(updated_at);
  CREATE INDEX IF NOT EXISTS idx_submission_skills_skill ON submission_skills(skill);
  CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_email ON auth_tokens(user_email);
`);
```

**Files:** `backend/src/db.js`

#### 3. Implement CORS Configuration

**Action:** Add CORS middleware to Express app
```javascript
const cors = require('cors');

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];

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

**Files:** `backend/src/index.js`

#### 4. Add Rate Limiting

**Action:** Add rate limiting to auth endpoints
```javascript
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many authentication attempts, please try again later'
});

app.use('/auth/login', authLimiter);
app.use('/auth/refresh', authLimiter);
```

**Files:** `backend/src/index.js`

#### 5. Enhance Error Handling

**Action:** Improve error handling to avoid leaking sensitive information
```javascript
app.use((err, _req, res, _next) => {
  console.error('Error:', err.stack);
  
  const isDev = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Internal server error',
    ...(isDev && { stack: err.stack })
  });
});
```

**Files:** `backend/src/index.js`

#### 6. Add Health Check Endpoint

**Action:** Implement `/health` endpoint
```javascript
app.get('/health', (_req, res) => {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: err.message
    });
  }
});
```

**Files:** `backend/src/index.js`

---

### 🟡 Phase 2: Testing Infrastructure (Week 2)

#### 7. Add Unit Tests

**Create test structure:**
```
test/
├── unit/
│   ├── db.test.js
│   ├── auth.test.js
│   └── utils.test.js
├── integration/
│   └── api/
│       ├── auth.test.js
│       ├── submissions.test.js
│       └── admin.test.js
└── e2e/
    └── smoke.test.js
```

**Example test:**
```javascript
// test/unit/auth.test.js
const { generateAccessToken } = require('../../backend/src/routes/auth');

describe('Auth Utilities', () => {
  test('generates JWT token with correct payload', () => {
    const user = { email: 'test@example.com', role: 'staff' };
    const token = generateAccessToken(user);
    // Verify token structure
  });
});
```

#### 8. Add CI/CD Pipeline

**Create GitHub Actions workflow:**
```
.github/workflows/ci-cd.yml
```

**Workflow stages:**
1. Test (lint, unit tests)
2. Build (Docker images)
3. Deploy (Kubernetes)

---

### 🟡 Phase 3: Database Migration (Week 3)

#### 9. Prepare PostgreSQL Migration

**Migration script:**
```javascript
// scripts/migrate-to-postgres.js
import sqlite3 from 'better-sqlite3';
import pg from 'pg';

const sqlite = new sqlite3('data/submissions.db');
const pgPool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });

const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();

for (const { name } of tables) {
  const rows = sqlite.prepare(`SELECT * FROM ${name}`).all();
  // Insert to PostgreSQL
}
```

**Update `compose.yaml`:**
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
```

---

### 🟢 Phase 4: Kubernetes Deployment (Week 4)

#### 10. Create Kubernetes Manifests

```
k8s/
├── staging/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── ingress.yaml
└── production/
    ├── deployment.yaml
    ├── service.yaml
    └── ingress.yaml
```

**Deployment manifest:**
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
        image: ghcr.io/stafftrack/backend:latest
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
```

---

### 🟢 Phase 5: Monitoring & Logging (Week 5)

#### 11. Add Prometheus Metrics

**Create metrics endpoint:**
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

#### 12. Set Up Monitoring Stack

**Components:**
- Prometheus (metrics collection)
- Grafana (visualization)
- ELK (logging)

---

## Implementation Timeline

| Week | Focus | Deliverables |
|------|-------|-------------|
| 1 | Production Readiness | JWT fix, CORS, rate limiting, health endpoint |
| 2 | Testing | Unit tests, CI/CD pipeline |
| 3 | Database | PostgreSQL migration, testing |
| 4 | Kubernetes | K8s manifests, staging deployment |
| 5 | Monitoring | Prometheus, Grafana, logging |
| 6+ | Optimization | Caching, indexing, performance tuning |

---

## Known Issues

| Issue | Severity | Status |
|------|---------|--------|
| JWT secret regenerated on restart | 🔴 Critical | Fix needed |
| No database indexes | 🟡 High | Fix needed |
| No CORS configuration | 🟡 High | Fix needed |
| No rate limiting | 🟡 High | Fix needed |
| No health endpoint | 🟡 High | Fix needed |
| No automated testing | 🟡 High | Fix needed |
| SQLite not scalable | 🟡 High | Migration needed |

---

## Quick Start Commands

```bash
# Start development
docker compose up -d

# View logs
docker compose logs -f

# Backup database
docker compose exec backend npm run dump

# Restore database
curl -X POST http://localhost:3000/data-tools/restore \
  -H "Content-Type: application/json" \
  -d @backup.json

# Run tests
docker compose exec backend npm test
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---------|---------|---------|-------------|
| `PORT` | No | 3000 | Backend port |
| `JWT_SECRET` | Yes | (required) | JWT signing secret |
| `ALLOWED_ORIGINS` | No | * | CORS allowed origins |
| `DATABASE_URL` | Yes | - | PostgreSQL connection (future) |

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-04-04  
**Next Review:** 2026-04-11
