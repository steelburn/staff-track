# BeesuiteStaff Catalog - Architecture & Decisions

## Executive Summary

StaffTrack integrates with the beeSuite HRIS (Human Resource Information System) as the source of truth for staff master data. This document captures the architectural decisions enabling reliable, maintainable synchronization of staff records, organizational hierarchies, and employment data.

---

## Part 1: Architecture Decision Records (ADRs)

### ADR-001: Source of Truth Architecture (StaffTrack vs. beeSuite)

**Status:** Accepted  
**Decision:** BeeSuite HRIS is golden record; StaffTrack caches staff master data

**Rationale:**
```
StaffTrack's role: 
  - Submission tracking (staff CVs, skills, project work)
  - Project management (allocations, timelines)
  - Reporting (analytics, utilization)

BeesuiteStaff's role:
  - Legal employment record (salary, dates, org structure)
  - Headcount reporting (compliance)
  - Access control (permissions, roles)

Conflict resolution:
  - If staff name differs: Use BeesuiteStaff (legal record)
  - If department differs: Use BeesuiteStaff (HRIS source)
  - If email differs: Use BeesuiteStaff (identity source)
  - If manager differs: Use BeesuiteStaff (org hierarchy)
```

**Implementation:** 
- StaffTrack stores copy of staff records (denormalization for performance)
- Nightly sync with BeesuiteStaff via API
- Conflict detection logs any differences (alerts if > 5% drift)

---

### ADR-002: Sync Frequency (Real-Time vs. Nightly vs. On-Demand)

**Status:** Accepted  
**Decision:** Nightly full sync + on-demand partial sync for critical changes

**Rationale:**
| Frequency | Overhead | Complexity | Staleness Risk |
|-----------|----------|-----------|-----------------|
| **Real-time API hook** | High (webhook per change) | Medium | None |
| **Hourly polling** | Medium (24 calls/day) | Low | 1 hour max |
| **Nightly (1 AM)** | Low (1 call/day) | Low | 24 hours max |
| **On-demand only** | Minimal | Medium | Unbounded |

**Decision:** Nightly (1 AM UTC) full sync + on-demand partial when:
- New hire detected (missing in StaffTrack)
- Termination detected (needs immediate deactivation)
- Manager change (org chart affects access control)

**Trade-off:** Slight staleness (up to 24 hrs) acceptable for non-critical changes (name, title, email corrections).

---

### ADR-003: Conflict Resolution & Data Validation

**Status:** Accepted  
**Decision:** Detect conflicts, alert, but continue sync (never block)

**Model:**
```
If staff.email mismatch (StaffTrack has alice@old.com, beeSuite has alice@new.com):
  → Log warning: "Email changed for ID 42"
  → Update StaffTrack: alice@new.com
  → Alert: Send to HR admin "Email sync detected change"
  
If staff.id doesn't exist in beeSuite:
  → Mark as "orphaned" (exists in StaffTrack but not HRIS)
  → DON'T delete (historical data, still needed for old submissions)
  → Manual review: HR admin decides if keep/archive

If org hierarchy circular reference (Manager A → B → C → A):
  → Alert but don't update
  → Keep previous hierarchy
  → HR must fix in beeSuite
```

**Not acceptable:** Rejecting entire sync because of one conflict (too risky).

---

### ADR-004: Historical Data & Terminations

**Status:** Accepted  
**Decision:** Soft delete (mark inactive, keep record) not hard delete

**Rationale:**
```
Scenario: Alice was terminated on March 1, 2026
  
If we DELETE her from StaffTrack:
  ✗ All her submissions disappear
  ✗ Historical reports show wrong numbers
  ✗ Can't generate "staff who worked on Project X 2025"
  ✗ GDPR right-to-be-forgotten vs. audit requirements conflict

If we mark is_active = false:
  ✓ History preserved
  ✓ Reports can filter (include/exclude terminated)
  ✓ Audit trail intact
  ✓ Can un-terminate if hire-back occurs
```

**Implementation:** 
```sql
ALTER TABLE staff ADD COLUMN is_active TINYINT DEFAULT 1;
ALTER TABLE staff ADD COLUMN terminated_at DATETIME NULL;

UPDATE staff SET is_active = 0, terminated_at = NOW() 
WHERE staff_id IN (beeSuite.terminated_ids);
```

---

### ADR-005: Organizational Hierarchy Caching

**Status:** Accepted  
**Decision:** Cache org chart in StaffTrack (manager → direct reports mapping)

**Rationale:**
- Org hierarchy used frequently:
  - Manager dashboards (filter by team)
  - Permission checks (can only see your reports)
  - Org chart visualization
- Direct query of beeSuite inefficient (N+1 queries)
- Cache invalidation: Refresh during nightly sync (simple)

**Implementation:**
```
Table: staff_hierarchy (denormalized)
├─ manager_id (foreign key to staff)
├─ direct_report_id (foreign key to staff)
└─ depth (how many levels deep)

Refresh every night during sync:
  SELECT * FROM beeSuite.orgchart
  MERGE INTO StaffTrack.staff_hierarchy
```

---

### ADR-006: API Integration Pattern (REST vs. SOAP vs. GraphQL)

**Status:** Accepted  
**Decision:** REST with JSON (BeesuiteStaff's endpoint format)

**Rationale:**
- beeSuite publishes REST API (not GraphQL, not SOAP)
- No need to translate (would add complexity)
- Existing `fetch()` patterns in backend sufficient
- No need for GraphQL's batching (nightly sync not performance-critical)

**Endpoint mapping:**
```
beeSuite REST API              StaffTrack Usage
GET /api/employees                  Nightly sync (all staff)
GET /api/employees/{id}             On-demand for single staff
GET /api/orgchart                   Org hierarchy sync
GET /api/departments                Department lookup
GET /api/attributes/{attr}          Custom attributes
```

---

### ADR-007: Authentication & Secrets Management

**Status:** Accepted  
**Decision:** API key in HashiCorp Vault, rotated quarterly

**Rationale:**
```
Option 1: Store in .env file
  ✗ Visible in git history (security risk)
  ✗ Same key across all environments
  
Option 2: Store in vault (HashiCorp Vault or AWS Secrets Manager)
  ✓ Encrypted at rest
  ✓ Audit trail of access
  ✓ Easy rotation (no code redeploy)
  ✓ Environment-specific secrets

Decision: HashiCorp Vault (or AWS Secrets Manager if on EC2)
```

**Implementation:**
```javascript
// At startup
const API_KEY = await vault.getSecret('beesuite/api-key');
const API_URL = process.env.BEESUITE_API_URL;  // Non-secret, OK in .env

// In sync script
fetch(`${API_URL}/api/employees`, {
  headers: { 'Authorization': `Bearer ${API_KEY}` }
});
```

---

### ADR-008: Error Handling & Retries

**Status:** Accepted  
**Decision:** Exponential backoff, max 3 retries, notify on total failure

**Rationale:**
```
If beeSuite API returns 503 (Service Unavailable):
  → Retry 1: Wait 2 seconds, retry
  → Retry 2: Wait 4 seconds, retry
  → Retry 3: Wait 8 seconds, retry
  → Failure: Log error, send alert to ops, continue using stale data

Never:
  ✗ Fail hard (stops entire job)
  ✗ Retry forever (wastes CPU)
  ✗ Ignore error silently (undetected outage)
```

**Implementation:** Use Node.js `p-retry` library with options:
```javascript
const pRetry = require('p-retry');
await pRetry(
  () => fetchFromBeesuite(),
  {
    retries: 3,
    onFailedAttempt: (err) => console.log(`Retry ${err.attemptNumber}`)
  }
);
```

---

## Part 2: System Integration Points

### 2.1 Data Flow Architecture

```
BeesuiteStaff HRIS (External SaaS)
  ├─ Employees (name, email, id, manager_id, hire_date)
  ├─ Org Chart (manager → direct reports)
  ├─ Departments (IT, Finance, Operations)
  └─ Custom Attributes (cost_center, level, location)
         │
         │ (Nightly sync script, 1 AM UTC)
         │ Scripts/sync-beesuite-staff.js
         ▼
StaffTrack MySQL (Local Cache)
  ├─ staff (store copy of employees)
  ├─ staff_hierarchy (org chart)
  ├─ sync_log (track what synced, errors)
  └─ staff_attributes (custom attrs)
         │
         │ (Query via REST API)
         │ /api/staff/*
         ▼
Backend API
  ├─ GET /api/staff → list with filtering
  ├─ GET /api/staff/{id} → single staff details
  ├─ GET /api/orgchart → org structure
  └─ GET /api/sync-status → when last synced
         │
         ▼
Frontend & Reports
  ├─ Staff View (list view, search)
  ├─ Org Chart Visualization
  ├─ Manager Dashboard (team view)
  └─ Reports (headcount, utilization)
```

### 2.2 Backend Integration Points

**New API Endpoints (in `src/routes/beesuite-staff.js`):**
```javascript
GET /api/staff                       → Cached staff list (w/ filters)
GET /api/staff/{id}                 → Single staff profile
GET /api/staff/search?q=alice        → Full-text search
GET /api/orgchart                   → Org chart (manager → reports)
GET /api/orgchart/{manager_id}      → Team under manager
GET /api/sync-status                → Last sync timestamp, health
```

**Background Job (in `scripts/sync-beesuite-staff.js`):**
```javascript
exports.syncBeesuiteCatalog = async () => {
  // 1. Fetch all employees from BeesuiteStaff
  // 2. Compare with StaffTrack database
  // 3. Detect adds, updates, deletes
  // 4. Update StaffTrack
  // 5. Log sync results (success/errors)
  // 6. Alert if conflicts found
}
```

**Cron Job (in `docker-compose.yaml`):**
```yaml
cron-sync-beesuite:
  image: mcr.microsoft.com/cron:latest
  command: "0 1 * * * node /app/scripts/sync-beesuite-staff.js"
```

### 2.3 Monitoring & Observability

**Sync Status Table (new):**
```sql
CREATE TABLE beesuite_sync_log (
  id VARCHAR(36) PRIMARY KEY,
  sync_timestamp DATETIME NOT NULL,
  total_synced INT,
  errors_detected INT,
  conflicts_detected INT,
  status ENUM('success', 'partial', 'failed'),
  error_message LONGTEXT,
  next_sync DATETIME,
  created_at DATETIME DEFAULT NOW()
);
```

**Dashboards:**
- Sync success rate (should be 100%)
- Average sync time (should be < 30 seconds)
- Error count (should be 0)
- Data drift (if > 5% mismatch, alert)

---

## Part 3: Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **BeesuiteStaff API outage** | Medium (20%) | Medium | Continue with cached data; alert; queue partial sync for retry |
| **Data drift (StaffTrack ≠ BeesuiteStaff)** | Low (10%) | Medium | Daily validation report; auto-alert if > 5% drift |
| **Circular org hierarchy** | Low (5%) | Low | Detect and alert (log); don't update org chart |
| **Terminated staff still visible** | Low (5%) | Low | Mark is_active = false; managers still see (with [INACTIVE] badge) |
| **API key exposed** | Very Low (1%) | Critical | Vault-based storage; rotate quarterly; audit logs |
| **Sync takes > 1 hour** | Very Low (1%) | Medium | Investigate; may need API pagination optimization |

---

## Part 4: Success Criteria & Acceptance

### 4.1 Functional Requirements
- ✅ All staff in beeSuite appear in StaffTrack within 24 hours
- ✅ Staff additions/terminations synced automatically
- ✅ Organizational hierarchy (manager relationships) accurate
- ✅ Terminated staff marked inactive (visible with badge)
- ✅ Staff search works (name, email, ID, manager)
- ✅ Managers see only their direct reports (access control)

### 4.2 Non-Functional Requirements
- ✅ Nightly sync completes in < 30 seconds (99th percentile)
- ✅ Sync error rate < 1% (recoverable, not show-stopper)
- ✅ Data drift < 5% (validated nightly)
- ✅ API response time < 100ms for staff list queries
- ✅ Sync log retention: 90 days (audit)

### 4.3 Security Requirements
- ✅ API key never logged or visible in client console
- ✅ Sync job runs as service account (limited permissions)
- ✅ All sync operations logged (who, what, when)
- ✅ Terminated staff cannot authenticate (if using for login)

---

## Part 5: Architecture Validation Checklist

**Architect Review (Before implementation):**
- [ ] ADRs reviewed and approved by Tech Lead
- [ ] beeSuite API documentation reviewed
- [ ] Conflict resolution strategy vetted by HR
- [ ] Vault setup planned (key rotation, access control)
- [ ] Sync job scheduling verified (cron, error handling)
- [ ] Data validation/drift detection approach approved
- [ ] Monitoring dashboards planned

**Go/No-Go Approval:** _Pending Tech Lead + HR Manager sign-off_

