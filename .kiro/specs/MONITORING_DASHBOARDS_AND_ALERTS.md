# Monitoring Dashboards & Alerting Rules

**Purpose:** Real-time health monitoring for all 5 features with automated alerting and dashboards.  
**Audience:** DevOps, Site Reliability Engineers (SREs)  
**Tools:** Prometheus, Grafana, AlertManager

---

## Table of Contents

1. [Monitoring Architecture](#architecture)
2. [Role Model Expansion Monitoring](#role-model-monitoring)
3. [beeSuite Sync Monitoring](#beesuite-monitoring)
4. [Analytics Dashboard Monitoring](#analytics-monitoring)
5. [CV Export Monitoring](#cv-export-monitoring)
6. [Skill Search Monitoring](#skill-search-monitoring)
7. [Grafana Dashboard JSON Configurations](#grafana-dashboards)
8. [AlertManager Rules & Templates](#alerting)

---

## Monitoring Architecture {#architecture}

### Stack

- **Metrics:** Prometheus (time-series database for metrics)
- **Dashboards:** Grafana (visualization + alerts)
- **Logs:** ELK Stack or Datadog (log aggregation)
- **Alerting:** AlertManager (with Slack/PagerDuty integrations)
- **Tracing:** OpenTelemetry (optional, for request tracing)

### Prometheus Scrape Configuration

**File:** `prometheus/prometheus.yml`

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'stafftrack-backend'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'mysql-exporter'
    static_configs:
      - targets: ['localhost:9104']

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['localhost:9100']

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['localhost:9093']
```

---

## 1. Role Model Expansion Monitoring {#role-model-monitoring}

### Key Metrics to Track

| Metric | Description | Alert Threshold | Criticality |
|--------|-------------|-----------------|-------------|
| **JWT_VALIDATION_FAILURES** | Counter: failed JWT validations | > 10 per minute | **High** |
| **PERMISSION_DENIALS** | Counter: requests rejected due to insufficient perms | > 50 per minute | **Medium** |
| **ROLE_ASSIGNMENT_LATENCY** | Latency: role assignment API call | > 500ms 95th | **Low** |
| **AUDIT_LOG_WRITE_TIME** | Latency: audit log insertion | > 100ms 95th | **Low** |
| **UNAUTHORIZED_ROLE_ATTEMPTS** | Counter: users trying to self-escalate | > 1 per hour | **Critical** |
| **PERMISSION_TABLE_SIZE** | Gauge: number of permissions in table | > 1000 | **Low** |

### Prometheus Metric Definitions

**File:** `backend/src/metrics/roleModel.js` (emit metrics)

```javascript
const prometheus = require('prom-client');

// Counters
const jwtValidationFailures = new prometheus.Counter({
  name: 'jwt_validation_failures_total',
  help: 'Total JWT validation failures',
  labelNames: ['error_type'],
});

const permissionDenials = new prometheus.Counter({
  name: 'permission_denials_total',
  help: 'Requests denied due to insufficient permissions',
  labelNames: ['resource', 'action'],
});

const unauthorizedRoleAttempts = new prometheus.Counter({
  name: 'unauthorized_role_attempts_total',
  help: 'Attempts to self-escalate privileges',
  labelNames: ['user_id'],
});

// Histograms (for latency)
const roleAssignmentLatency = new prometheus.Histogram({
  name: 'role_assignment_duration_seconds',
  help: 'Time to assign role to user',
  buckets: [0.01, 0.05, 0.1, 0.5, 1.0],
});

const auditLogWriteTime = new prometheus.Histogram({
  name: 'audit_log_write_duration_seconds',
  help: 'Time to write to audit log',
  buckets: [0.001, 0.01, 0.1],
});

// Gauge
const permissionTableSize = new prometheus.Gauge({
  name: 'permission_table_size',
  help: 'Current number of permissions in database',
});

module.exports = {
  jwtValidationFailures,
  permissionDenials,
  unauthorizedRoleAttempts,
  roleAssignmentLatency,
  auditLogWriteTime,
  permissionTableSize,
};
```

**File:** `backend/src/middleware/authorize.js` (instrumented)

```javascript
const metrics = require('../metrics/roleModel');

function extractUserRoles(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    metrics.jwtValidationFailures.inc({ error_type: 'missing_token' });
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.sub, roles: decoded.roles || [] };
    next();
  } catch (err) {
    metrics.jwtValidationFailures.inc({ error_type: err.name });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function authorizePermission(requiredPermission) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const db = req.app.get('db');
    const startTime = Date.now();

    const [result] = await db.execute(
      `SELECT COUNT(*) as count FROM role_permissions rp
       JOIN permissions p ON rp.permission_id = p.id
       JOIN roles r ON rp.role_id = r.id
       WHERE r.name IN (${req.user.roles.map(() => '?').join(',')})
       AND p.name = ?`,
      [...req.user.roles, requiredPermission]
    );

    const duration = (Date.now() - startTime) / 1000;
    metrics.roleAssignmentLatency.observe(duration);

    if (result[0].count === 0) {
      metrics.permissionDenials.inc({
        resource: requiredPermission.split('_')[0],
        action: requiredPermission.split('_')[1],
      });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

module.exports = { extractUserRoles, authorizePermission };
```

### Grafana Dashboard: Role Model Health

**Key Panels:**

1. **JWT Validation Failures (24h)**
   - Graph: `rate(jwt_validation_failures_total[5m])`
   - Alert: Red if > 10 failures/min

2. **Permission Denials by Resource**
   - Bar chart: `rate(permission_denials_total{job="backend"}[5m])` grouped by resource
   - Normal: < 50 denials/min

3. **Unauthorized Privilege Escalation Attempts**
   - Single stat: `rate(unauthorized_role_attempts_total[1h])`
   - Alert: Red if > 1 attempt

4. **Role Assignment Latency (p95)**
   - Line graph: `histogram_quantile(0.95, role_assignment_duration_seconds)`
   - Alert: Yellow if > 500ms

5. **Audit Log Volume**
   - Area chart: `rate(audit_log_writes_total[5m])`
   - Baseline: 10-50 writes/min during normal ops

---

## 2. beeSuite Sync Monitoring {#beesuite-monitoring}

### Key Metrics

| Metric | Description | Alert Threshold | Criticality |
|--------|-------------|-----------------|-------------|
| **BEESUITE_SYNC_DURATION** | Time to complete sync job | > 300sec (5 min) | **High** |
| **BEESUITE_SYNC_SUCCESS_RATE** | % of syncs that complete successfully | < 95% | **Critical** |
| **BEESUITE_API_LATENCY** | Response time from beeSuite API | > 5000ms | **High** |
| **SYNC_CONFLICTS_DETECTED** | Counter: conflicts found during sync | > 100 per sync | **Medium** |
| **STAFF_DATA_MATCH_RATE** | % of records matching HRIS (reconciliation) | < 99% | **Critical** |
| **ORG_HIERARCHY_STALENESS** | Time since last hierarchy refresh | > 30 min | **Medium** |

### Metrics Instrumentation

**File:** `backend/scripts/sync-beesuite-staff.js` (instrumented)

```javascript
const prometheus = require('prom-client');

const syncDuration = new prometheus.Histogram({
  name: 'beesuite_sync_duration_seconds',
  help: 'Time to complete beeSuite sync',
  buckets: [10, 30, 60, 120, 300],
});

const syncSuccessRate = new prometheus.Counter({
  name: 'beesuite_sync_total',
  help: 'Total sync attempts',
  labelNames: ['status'],  // 'success', 'failed', 'partial'
});

const syncConflicts = new prometheus.Counter({
  name: 'beesuite_sync_conflicts_total',
  help: 'Conflicts detected during sync',
  labelNames: ['field'],  // 'email', 'job_title', etc
});

const staffDataMatchRate = new prometheus.Gauge({
  name: 'beesuite_staff_match_rate',
  help: 'Percentage of staff matching HRIS',
});

async function syncBeesuitStaff() {
  const timer = syncDuration.startTimer();
  const startTime = Date.now();

  try {
    // ... sync logic ...
    syncSuccessRate.inc({ status: 'success' });
    
    // Emit match rate
    const [reconciliation] = await db.execute(`
      SELECT COUNT(*) as total, COUNT(CASE WHEN synced = 1 THEN 1 END) as matched
      FROM users
    `);
    const matchRate = (reconciliation[0].matched / reconciliation[0].total) * 100;
    staffDataMatchRate.set(matchRate);
    
  } catch (err) {
    syncSuccessRate.inc({ status: 'failed' });
    timer({ status: 'failed' });
  }

  timer({ status: 'success' });
}
```

### Grafana Dashboard: beeSuite Sync Health

**Key Panels:**

1. **Sync Success Rate (7-day trend)**
   - Time series: `rate(beesuite_sync_total{status="success"}[1h]) / rate(beesuite_sync_total[1h])`
   - Alert: Red if < 95% past 6 hours

2. **Last Sync Duration**
   - Single stat: `histogram_quantile(0.95, beesuite_sync_duration_seconds)`
   - Alert: Yellow if > 5min, Red if > 10min

3. **Sync Conflicts Detected**
   - Table: Last 10 syncs with conflict counts
   - Alert: Yellow if > 100 conflicts

4. **Staff Data Match Rate**
   - Gauge: `beesuite_staff_match_rate`
   - Alert: Red if < 99%

5. **API Latency Over Time**
   - Line graph: `histogram_quantile(0.95, beesuite_api_latency_seconds)`
   - Alert: Yellow if > 5s (beeSuite API issues)

6. **Org Hierarchy Staleness**
   - Single stat: `time() - org_hierarchy_last_refresh_timestamp_seconds`
   - Alert: Yellow if > 30min

### Health Check Endpoint

**File:** `backend/src/routes/health.js`

```javascript
router.get('/beesuite/health', async (req, res) => {
  const db = req.app.get('db');

  // Check last sync status
  const [lastSync] = await db.execute(
    'SELECT * FROM beesuite_sync_log ORDER BY created_at DESC LIMIT 1'
  );

  // Check staff reconciliation
  const [reconciliation] = await db.execute(`
    SELECT COUNT(*) as total, SUM(CASE WHEN synced = 1 THEN 1 ELSE 0 END) as matched
    FROM users
  `);

  const matchRate = (reconciliation[0].matched / reconciliation[0].total) * 100;
  const syncAgeMinutes = (Date.now() - lastSync[0].created_at) / 1000 / 60;

  const health = {
    status: matchRate > 99 && syncAgeMinutes < 30 ? 'healthy' : 'degraded',
    lastSync: lastSync[0],
    matchRate: matchRate.toFixed(2),
    syncAgeMinutes: syncAgeMinutes.toFixed(1),
  };

  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});
```

---

## 3. Analytics Dashboard Monitoring {#analytics-monitoring}

### Key Metrics

| Metric | Description | Alert Threshold | Criticality |
|--------|-------------|-----------------|-------------|
| **ANALYTICS_API_LATENCY** | API response time (p95) | > 100ms | **High** |
| **ANALYTICS_REPLICA_LAG** | Delay between prod and analytics replica | > 10 min | **High** |
| **DASHBOARD_LOAD_TIME** | Frontend page load time (p95) | > 2000ms | **Medium** |
| **MATERIALIZE_VIEW_REFRESH_TIME** | Time to refresh aggregations | > 60sec | **Medium** |
| **ACTIVE_DASHBOARD_USERS** | Gauge: concurrent users viewing dashboard | (for capacity planning) | **Low** |

### Metrics Instrumentation

**File:** `backend/src/routes/analytics.js` (instrumented)

```javascript
const prometheus = require('prom-client');

const analyticsLatency = new prometheus.Histogram({
  name: 'analytics_api_latency_seconds',
  help: 'API response time for analytics endpoints',
  labelNames: ['endpoint'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1.0],
});

const replicaLag = new prometheus.Gauge({
  name: 'analytics_replica_lag_seconds',
  help: 'Delay between production and analytics replica',
});

const materializeRefreshTime = new prometheus.Histogram({
  name: 'analytics_materialize_refresh_seconds',
  help: 'Time to refresh materialized views',
  buckets: [1, 5, 10, 30, 60],
});

const activeDashboardUsers = new prometheus.Gauge({
  name: 'analytics_active_dashboard_users',
  help: 'Concurrent users viewing dashboard',
});

// Middleware to track latency
app.use((req, res, next) => {
  if (req.path.startsWith('/api/analytics/')) {
    const timer = analyticsLatency.startTimer({ endpoint: req.path });
    res.on('finish', () => timer());
  }
  next();
});

// Health check: replica lag
router.get('/health', async (req, res) => {
  const prodDB = req.app.get('db');
  const replicaDB = req.app.get('replica-db');

  const [prodVersion] = await prodDB.execute('SELECT VERSION() as version');
  const [replicaVersion] = await replicaDB.execute('SHOW MASTER STATUS');

  const lagSeconds = calculateLag(replicaVersion[0]);
  replicaLag.set(lagSeconds);

  res.json({ lag_seconds: lagSeconds, status: lagSeconds > 600 ? 'warning' : 'healthy' });
});
```

### Grafana Dashboard: Analytics Performance

**Key Panels:**

1. **API Latency (p95 by endpoint)**
   - Line graph: `histogram_quantile(0.95, analytics_api_latency_seconds)` grouped by endpoint
   - Alert: Yellow if > 100ms, Red if > 500ms

2. **Replica Lag (seconds)**
   - Single stat: `analytics_replica_lag_seconds`
   - Alert: Yellow if > 300s, Red if > 600s

3. **Dashboard Load Time (frontend RUM)**
   - (Requires browser instrumentation with WebVitals)
   - Alert: Yellow if > 2s for 10% of users

4. **Materialized View Refresh Duration**
   - Histogram: `histogram_quantile(0.95, analytics_materialize_refresh_seconds)`
   - Alert: Yellow if > 60s

5. **Active Dashboard Users**
   - Time series: `analytics_active_dashboard_users`
   - (Capacity planning — no alert needed)

6. **Query Count by Type**
   - Stacked area: `rate(analytics_queries_total[5m])` by query type
   - Baseline: 100-500 queries/min

---

## 4. CV Export Monitoring {#cv-export-monitoring}

### Key Metrics

| Metric | Description | Alert Threshold | Criticality |
|--------|-------------|-----------------|-------------|
| **CV_EXPORT_REQUESTS** | Counter: total export requests | (baseline) | **Low** |
| **CV_EXPORT_SUCCESS_RATE** | % of successful exports | < 95% | **High** |
| **CV_EXPORT_LATENCY** | Time to generate file (p95) | > 10000ms | **Medium** |
| **PDF_GENERATION_TIME** | Time for Puppeteer PDF | > 8000ms | **Medium** |
| **DOCX_GENERATION_TIME** | Time for docx library | > 2000ms | **Low** |
| **EXPORT_FILE_SIZE** | Bytes generated per export | > 50MB | **Low** |
| **TEMPORARY_FILES_CLEANUP** | Gauge: orphaned temp files | > 100 | **Low** |
| **PUPPETEER_MEMORY** | Memory usage of Puppeteer process | > 1GB | **Medium** |

### Metrics Instrumentation

**File:** `backend/src/services/cvExporter.js` (instrumented)

```javascript
const prometheus = require('prom-client');

const cvExportRequests = new prometheus.Counter({
  name: 'cv_export_requests_total',
  help: 'Total CV export requests',
  labelNames: ['format', 'status'],  // 'pdf'/'docx', 'success'/'failed'
});

const cvExportLatency = new prometheus.Histogram({
  name: 'cv_export_duration_seconds',
  help: 'Time to generate cv export',
  labelNames: ['format'],  // 'pdf', 'docx'
  buckets: [1, 2, 5, 10],
});

const exportFileSize = new prometheus.Histogram({
  name: 'cv_export_file_size_bytes',
  help: 'Size of exported CV files',
  labelNames: ['format'],
  buckets: [100000, 500000, 1000000, 5000000],
});

const temporaryFilesCount = new prometheus.Gauge({
  name: 'cv_export_temporary_files',
  help: 'Number of orphaned temporary files',
});

const puppeteerMemory = new prometheus.Gauge({
  name: 'cv_export_puppeteer_memory_bytes',
  help: 'Memory usage of Puppeteer process',
});

async function exportCVAsPDF(cvHtml, filename) {
  const timer = cvExportLatency.startTimer({ format: 'pdf' });

  try {
    browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    // Monitor memory
    const procInfo = await browser.process();
    puppeteerMemory.set(procInfo.memoryUsage().heapUsed);
    
    await page.setContent(cvHtml, { waitUntil: 'networkidle0' });
    const pdfPath = path.join('/tmp', `${filename}.pdf`);
    await page.pdf({ path: pdfPath, format: 'A4' });

    const fileSize = (await fs.stat(pdfPath)).size;
    exportFileSize.observe({ format: 'pdf' }, fileSize);
    cvExportRequests.inc({ format: 'pdf', status: 'success' });

    timer({ status: 'success' });
    return { path: pdfPath, filename: `${filename}.pdf` };
  } catch (err) {
    cvExportRequests.inc({ format: 'pdf', status: 'failed' });
    timer({ status: 'failed' });
    throw err;
  }
}

// Cleanup task: remove orphaned temp files > 1 hour old
setInterval(async () => {
  const tmpDir = '/tmp';
  const files = await fs.readdir(tmpDir);
  let orphanedCount = 0;

  for (const file of files) {
    if (!file.includes('cv_') || !file.includes('.pdf|.docx')) continue;
    
    const filePath = path.join(tmpDir, file);
    const stat = await fs.stat(filePath);
    const ageMinutes = (Date.now() - stat.mtimeMs) / 1000 / 60;

    if (ageMinutes > 60) {
      await fs.unlink(filePath);
      orphanedCount++;
    }
  }

  temporaryFilesCount.set(orphanedCount);
}, 5 * 60 * 1000);  // Every 5 minutes
```

### Grafana Dashboard: CV Export Health

**Key Panels:**

1. **Export Success Rate (7-day)**
   - Time series: `rate(cv_export_requests_total{status="success"}[1h]) / rate(cv_export_requests_total[1h])`
   - Alert: Red if < 95%

2. **Export Latency by Format**
   - Multi-line: `histogram_quantile(0.95, cv_export_duration_seconds)` grouped by format
   - Alert: Yellow if PDF > 10s, Red if > 15s

3. **PDF vs DOCX Performance**
   - Two gauges: `histogram_quantile(0.95, cv_export_duration_seconds{format="pdf"})` vs docx

4. **File Size Distribution**
   - Box plot: `cv_export_file_size_bytes` by format
   - Alert: Red if any > 50MB

5. **Temporary File Cleanup**
   - Single stat: `cv_export_temporary_files`
   - Alert: Yellow if > 100 orphaned files

6. **Puppeteer Memory Usage**
   - Line graph: `cv_export_puppeteer_memory_bytes`
   - Alert: Yellow if > 1GB

---

## 5. Skill Search Monitoring {#skill-search-monitoring}

### Key Metrics

| Metric | Description | Alert Threshold | Criticality |
|--------|-------------|-----------------|-------------|
| **SKILL_SEARCH_LATENCY** | Query response time (p95) | > 100ms | **High** |
| **SKILL_SEARCH_QUALITY** | % of first result is relevant (user feedback) | < 90% | **Medium** |
| **SKILL_DUPLICATES** | Count of duplicate skills remaining | > 50 | **Medium** |
| **SKILL_INDEX_SIZE** | Full-text index size | > 100MB | **Low** |
| **CANONICALIZATION_JOB_DURATION** | Time to run deduplication | > 300sec | **Low** |
| **SEARCH_NO_RESULTS_RATE** | % of queries returning 0 results | > 10% | **Medium** |
| **SKILL_TAXONOMY_FRESHNESS** | Time since last taxonomy refresh | > 7 days | **Low** |

### Metrics Instrumentation

**File:** `backend/src/routes/skill-search.js` (instrumented)

```javascript
const prometheus = require('prom-client');

const skillSearchLatency = new prometheus.Histogram({
  name: 'skill_search_latency_seconds',
  help: 'Time to perform skill search',
  buckets: [0.01, 0.05, 0.1, 0.5, 1.0],
});

const skillSearchQuality = new prometheus.Gauge({
  name: 'skill_search_quality_rate',
  help: 'Percentage of searches where first result is relevant',
});

const skillDuplicatesCount = new prometheus.Gauge({
  name: 'skill_duplicates_count',
  help: 'Number of duplicate skills detected',
});

const skillIndexSize = new prometheus.Gauge({
  name: 'skill_index_size_bytes',
  help: 'Size of full-text search index',
});

const noResultsRate = new prometheus.Gauge({
  name: 'skill_search_no_results_rate',
  help: 'Percentage of queries returning 0 results',
});

router.get('/search', authorizePermission('view_analytics'), async (req, res) => {
  const { q } = req.query;
  const timer = skillSearchLatency.startTimer();

  try {
    const [skills] = await db.execute(
      `SELECT * FROM canonical_skills
       WHERE MATCH(name) AGAINST(? IN BOOLEAN MODE)
       LIMIT 20`,
      [`${q}*`]
    );

    // Track quality metric
    if (skills.length === 0) {
      noResultsRate.set(noResultsRate.get() + 1);
    }

    timer();
    res.json(skills);
  } catch (err) {
    timer({ error: 'true' });
    res.status(500).json({ error: err.message });
  }
});

// Periodic quality check (requires user feedback)
app.post('/api/skills/search/:searchId/feedback', async (req, res) => {
  const { relevant } = req.body;  // true/false
  const db = req.app.get('db');

  await db.execute(
    'INSERT INTO skill_search_feedback (search_id, relevant) VALUES (?, ?)',
    [req.params.searchId, relevant ? 1 : 0]
  );

  // Recalculate quality metric every hour
  const [feedback] = await db.execute(
    `SELECT SUM(relevant) as relevant_count, COUNT(*) as total_count
     FROM skill_search_feedback
     WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`
  );

  const qualityRate = (feedback[0].relevant_count / feedback[0].total_count) * 100;
  skillSearchQuality.set(qualityRate);

  res.json({ quality: qualityRate });
});

// Canonicalization job
async function canonicalizeSkills() {
  const timer = prometheus.Histogram({
    name: 'skill_canonicalization_duration_seconds',
  }).startTimer();

  try {
    // ... deduplication logic ...

    // Count remaining duplicates
    const [duplicates] = await db.execute(`
      SELECT COUNT(*) as count
      FROM submission_skills ss
      LEFT JOIN canonical_skills cs ON LOWER(ss.skill) = LOWER(cs.name)
      WHERE cs.id IS NULL
    `);

    skillDuplicatesCount.set(duplicates[0].count);

    // Check index size
    const [indexSize] = await db.execute(`
      SELECT STAT_VALUE as size
      FROM mysql.innodb_index_stats
      WHERE STAT_NAME = 'size'
      AND TABLE_NAME = 'canonical_skills'
    `);

    skillIndexSize.set(indexSize[0]?.size || 0);

    timer();
  } catch (err) {
    timer({ error: 'true' });
  }
}
```

### Grafana Dashboard: Skill Search Health

**Key Panels:**

1. **Search Latency (p95)**
   - Single stat + trend: `histogram_quantile(0.95, skill_search_latency_seconds)`
   - Alert: Yellow if > 100ms

2. **Search Quality Rate**
   - Gauge: `skill_search_quality_rate`
   - Alert: Red if < 90%

3. **Skill Duplicates Remaining**
   - Single stat: `skill_duplicates_count`
   - Alert: Yellow if > 50

4. **No Results Rate (7-day)**
   - Line graph: `noResultsRate`
   - Alert: Yellow if > 10%

5. **Full-Text Index Size**
   - Single stat: `skill_index_size_bytes / 1024 / 1024` (MB)
   - Alert: Yellow if > 200MB (plan Elasticsearch migration)

6. **Canonicalization Job Success**
   - Status panel showing last job duration + status
   - Alert: Yellow if job > 300s, Red if failed

7. **Top Search Queries (7-day)**
   - Table: Most popular search queries + result counts
   - (For understanding user behavior + identifying missing skills)

---

## Grafana Dashboards {#grafana-dashboards}

### Import Instructions

1. Log in to Grafana
2. Click "+" → "Import"
3. Copy JSON below and paste
4. Select Prometheus data source
5. Click "Import"

### Dashboard: Role Model Overview

```json
{
  "dashboard": {
    "title": "Role Model & RBAC Health",
    "panels": [
      {
        "title": "JWT Validation Failures (5m)",
        "targets": [
          {
            "expr": "rate(jwt_validation_failures_total[5m])"
          }
        ],
        "alert": {
          "conditions": [
            {
              "evaluator": { "params": [10], "type": "gt" },
              "operator": { "type": "and" },
              "query": { "params": ["A", "5m", "now"] },
              "type": "query"
            }
          ],
          "frequency": "60s",
          "handler": 1,
          "message": "JWT validation failures > 10/min",
          "name": "JWT Failures High"
        }
      },
      {
        "title": "Permission Denials (5m)",
        "targets": [
          {
            "expr": "rate(permission_denials_total[5m])"
          }
        ]
      },
      {
        "title": "Unauthorized Escalation Attempts",
        "targets": [
          {
            "expr": "rate(unauthorized_role_attempts_total[1h])"
          }
        ],
        "alert": {
          "conditions": [
            {
              "evaluator": { "params": [1], "type": "gt" },
              "message": "User attempted unauthorized privilege escalation",
              "name": "Privilege Escalation Attempt"
            }
          ],
          "handler": 2
        }
      }
    ]
  }
}
```

### Dashboard: All Features (Overview)

```json
{
  "dashboard": {
    "title": "StaffTrack Features - Overall Health",
    "panels": [
      {
        "title": "Role Model Status",
        "targets": [
          {
            "expr": "rate(jwt_validation_failures_total[5m]) < 10 or vector(1)"
          }
        ],
        "type": "stat",
        "options": {
          "colorMode": "background",
          "thresholds": {
            "mode": "percentage",
            "steps": [
              { "color": "green", "value": null },
              { "color": "red", "value": 0 }
            ]
          }
        }
      },
      {
        "title": "beeSuite Sync Status",
        "targets": [
          {
            "expr": "beesuite_staff_match_rate"
          }
        ],
        "type": "gauge",
        "options": {
          "threshold": [
            { "value": 99, "color": "green" },
            { "value": 95, "color": "yellow" },
            { "value": 0, "color": "red" }
          ]
        }
      },
      {
        "title": "Analytics Dashboard Latency",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, analytics_api_latency_seconds)"
          }
        ],
        "type": "stat"
      },
      {
        "title": "CV Export Success Rate",
        "targets": [
          {
            "expr": "rate(cv_export_requests_total{status=\"success\"}[1h]) / rate(cv_export_requests_total[1h])"
          }
        ],
        "type": "gauge"
      },
      {
        "title": "Skill Search Quality",
        "targets": [
          {
            "expr": "skill_search_quality_rate"
          }
        ],
        "type": "gauge"
      }
    ]
  }
}
```

---

## AlertManager Rules & Templates {#alerting}

### AlertManager Configuration

**File:** `alertmanager/alertmanager.yml`

```yaml
global:
  resolve_timeout: 5m
  slack_api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'

templates:
  - '/etc/alertmanager/templates/*.tmpl'

route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 12h
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'critical'
      repeat_interval: 1h
    - match:
        severity: warning
      receiver: 'default'

receivers:
  - name: 'default'
    slack_configs:
      - channel: '#monitoring'
        title: '{{ .AlertName }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
        send_resolved: true

  - name: 'critical'
    slack_configs:
      - channel: '#critical-alerts'
        title: '🚨 CRITICAL: {{ .AlertName }}'
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_KEY'
```

### Prometheus Alert Rules

**File:** `prometheus/rules/stafftrack.yml`

```yaml
groups:
  - name: role_model
    interval: 30s
    rules:
      - alert: JWTValidationFailureHigh
        expr: rate(jwt_validation_failures_total[5m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "JWT validation failures high"
          description: "{{ $value }} JWT failures per second"

      - alert: UnauthorizedPrivilegeEscalation
        expr: rate(unauthorized_role_attempts_total[1h]) > 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Unauthorized privilege escalation attempt detected"
          description: "{{ $value }} escalation attempt(s) in the last hour"

      - alert: RoleAssignmentLatencyHigh
        expr: histogram_quantile(0.95, role_assignment_duration_seconds) > 0.5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Role assignment API slow"
          description: "p95 latency: {{ $value }}s"

  - name: beesuite
    interval: 30s
    rules:
      - alert: BeesuiteSyncFailed
        expr: rate(beesuite_sync_total{status="failed"}[1h]) > 0.5
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "beeSuite sync failing"
          description: "Sync failed {{ $value }} times in the last hour"

      - alert: StaffDataMismatch
        expr: beesuite_staff_match_rate < 99
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Staff data mismatch with HRIS"
          description: "Match rate: {{ $value }}%"

      - alert: BeesuiteSyncDurationHigh
        expr: histogram_quantile(0.95, beesuite_sync_duration_seconds) > 300
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "beeSuite sync taking too long"
          description: "p95 duration: {{ $value }}s"

      - alert: OrgHierarchyStaleness
        expr: (time() - org_hierarchy_last_refresh_timestamp_seconds) / 60 > 30
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Org hierarchy not refreshed recently"
          description: "Last refresh: {{ $value }} minutes ago"

  - name: analytics
    interval: 30s
    rules:
      - alert: AnalyticsAPILatencyHigh
        expr: histogram_quantile(0.95, analytics_api_latency_seconds) > 0.1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Analytics API latency high"
          description: "p95 latency: {{ $value }}s"

      - alert: AnalyticsReplicaLagHigh
        expr: analytics_replica_lag_seconds > 600
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Analytics replica lag > 10 minutes"
          description: "Current lag: {{ $value }}s"

      - alert: MaterializedViewRefreshSlow
        expr: histogram_quantile(0.95, analytics_materialize_refresh_seconds) > 60
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Materialized view refresh timing out"
          description: "p95 duration: {{ $value }}s"

  - name: cv_export
    interval: 30s
    rules:
      - alert: CVExportSuccessRateLow
        expr: (rate(cv_export_requests_total{status="success"}[1h]) / rate(cv_export_requests_total[1h])) < 0.95
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "CV export success rate low"
          description: "Success rate: {{ $value | humanizePercentage }}"

      - alert: CVExportLatencyHigh
        expr: histogram_quantile(0.95, cv_export_duration_seconds{format="pdf"}) > 10
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "PDF export taking too long"
          description: "p95 latency: {{ $value }}s"

      - alert: PuppeteerMemoryHigh
        expr: cv_export_puppeteer_memory_bytes > 1073741824
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Puppeteer memory usage high"
          description: "Memory: {{ $value | humanize }}B"

      - alert: TemporaryFilesAccumulating
        expr: cv_export_temporary_files > 100
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Orphaned temporary files accumulating"
          description: "Orphaned files: {{ $value }}"

  - name: skill_search
    interval: 30s
    rules:
      - alert: SkillSearchLatencyHigh
        expr: histogram_quantile(0.95, skill_search_latency_seconds) > 0.1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Skill search latency high"
          description: "p95 latency: {{ $value }}s"

      - alert: SkillSearchQualityLow
        expr: skill_search_quality_rate < 90
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Skill search relevance quality low"
          description: "Quality: {{ $value }}%"

      - alert: SkillsNotCanonicalizedYet
        expr: skill_duplicates_count > 50
        for: 1h
        labels:
          severity: info
        annotations:
          summary: "Skill deduplication incomplete"
          description: "Remaining duplicates: {{ $value }}"

      - alert: NoResultsRateHigh
        expr: skill_search_no_results_rate > 10
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "High rate of searches returning no results"
          description: "No-results rate: {{ $value }}%"

      - alert: SkillIndexSizeHigh
        expr: skill_index_size_bytes > 104857600
        for: 1h
        labels:
          severity: info
        annotations:
          summary: "Skill full-text index getting large"
          description: "Index size: {{ $value | humanize }}B (plan Elasticsearch)"
```

### Slack Notification Template

**File:** `alertmanager/templates/slack.tmpl`

```
{{ define "slack.default.title" -}}
[{{ .Status | toUpper -}}
{{ if eq .Status "firing" }}🔴{{- else }}🟢{{- end }}
] {{ .CommonLabels.alertname }}
{{- end }}

{{ define "slack.default.text" -}}
{{ range .Alerts -}}
*Summary:* {{ .Annotations.summary }}
*Details:* {{ .Annotations.description }}
*Labels:*
{{ range .Labels.SortedPairs -}}
• {{ .Name }}: {{ .Value }}
{{ end }}
{{ end }}
{{- end }}
```

---

## On-Call Runbook

### Responding to Alerts

**Template:** Each alert should have a runbook URL

```
[Alert Name]
Severity: [Critical/Warning/Info]
Description: [What this alert means]
Immediate Actions:
  1. [First troubleshooting step]
  2. [Check X metric in dashboard]
  3. [Escalate to Y if...]

Escalation Path:
  - If not resolved in 5min: Page [owner]
  - If data loss risk: Page [security team]
```

**Example Runbook: `role-model/beesuite-sync-failed.md`**

```markdown
# beeSuite Sync Failed

## Alert
- Fires when: `beesuite_sync_total{status="failed"}` > 0.5/hour
- Severity: **CRITICAL**

## What It Means
The nightly job that syncs staff data from beeSuite HRIS into StaffTrack is failing.
This causes HR data to become stale.

## Immediate Actions
1. Check logs:
   ```
   docker logs stafftrack-backend | grep beesuite-sync
   ```

2. Check last sync status:
   ```
   GET /api/beesuite/sync-status
   {
     "status": "failed",
     "error_message": "API timeout"
   }
   ```

3. Check if beeSuite API is up:
   ```
   curl https://api.beesuite.io/status
   ```

## If API is down
- Wait 15 minutes for recovery
- Try manual sync: `node backend/scripts/sync-beesuite-staff.js`
- If sync still fails, escalate to beeSuite support

## If LocalAPI is up but sync fails
1. Check Vault credentials:
   ```
   vault read secret/beesuite
   ```
2. Verify API key hasn't been rotated
3. Check for network outages (firewall rules)

## If All Else Fails
- **Don't**: Manually modify staff data in StaffTrack (it will get overwritten)
- **Do**: Escalate to HR Manager (for temporary workaround) + Tech Lead (for root cause analysis)
- **Do**: Check if analytics dashboard is affected; if yes, disable until sync restored

## Resolution
Once sync restores, reconciliation report will show any data that diverged:
```
GET /api/beesuite/conflicts
```

## Escalation
- 5min: Page on-call BE engineer
- 15min: Alert HR Manager (data is stale)
- 30min: Page Tech Lead (escalate investigation)
```

---

## Summary

This monitoring guide provides complete observability for all 5 features with:
- **Prometheus metrics** (quantitative health)
- **Grafana dashboards** (visual monitoring)
- **Alert rules** (automated detection)
- **Runbooks** (response procedures)
- **Slack integration** (team notification)
- **On-call rotation** (24/7 coverage)

**Next Steps:**
1. Set up Prometheus + Grafana infrastructure
2. Configure AlertManager + Slack integration
3. Deploy metric exporter sidecars to backend
4. Create grafana dashboards from JSON configs above
5. Test alert firing (e.g., trigger a permission failure test)
6. Schedule on-call rotation
7. Train team on runbooks

All dashboards should be visible at `https://monitoring.stafftrack.io/grafana/` after setup.
