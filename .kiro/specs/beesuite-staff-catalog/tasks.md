# BeeSuite Staff Catalog Integration - Implementation Tasks

## Overview
This document outlines the implementation roadmap for integrating BeeSuite staff catalog API with StaffTrack. Current priority: **DEVELOPMENT SPECS ONLY** (no implementation yet).

---

## Task 1: Database Schema Update
**Status:** Not Started  
**Dependencies:** None  
**Estimated Effort:** 3-4 hours  

### Description
Extend the `staff` table with new columns to track BeeSuite sync metadata and create the catalog sync log table.

### Acceptance Criteria
- [ ] `catalog_sync_log` table created with proper indexes
- [ ] `staff` table extended with 4 new columns: `beesuite_employee_id`, `last_synced_at`, `inactive_since`, `sync_source`
- [ ] Indexes created on `beesuite_employee_id`, `is_active`, `inactive_since`
- [ ] Migration script tested on local dev database
- [ ] Rollback procedure documented

### SQL Changes Required
- Create `catalog_sync_log` table (see Design section)
- ALTER `staff` table to add: `beesuite_employee_id TEXT`, `last_synced_at DATETIME`, `inactive_since DATETIME`, `sync_source TEXT`
- Create 3 indexes for query performance

### Testing Approach
- Run migration on clean database
- Verify schema with `PRAGMA table_info(staff)` and `PRAGMA table_info(catalog_sync_log)`
- Test rollback scenario

---

## Task 2: Create BeeSuiteStaffService Class
**Status:** Not Started  
**Dependencies:** Task 1 (conceptual, not blocking)  
**Estimated Effort:** 4-5 hours  

### Description
Build the HTTP client wrapper for BeeSuite API integration with retry logic, authentication, and response mapping.

### Acceptance Criteria
- [ ] `BeeSuiteStaffService` class created in `/backend/src/services/BeeSuiteStaffService.js`
- [ ] `fetchStaffList()` method implements 3-attempt retry with exponential backoff (1s, 2s, 4s)
- [ ] Timeout enforced at 30 seconds per request
- [ ] JWT token authentication properly set in headers (uses StaffTrack app's own JWT, not separate token)
- [ ] Static method `mapStaffRecord()` transforms BeeSuite fields to StaffTrack schema
- [ ] Error handling covers: 401, 403, timeout, empty results, JSON parse errors
- [ ] Sensitive data masked in error logs (auth tokens, emails)
- [ ] Unit tests cover: successful fetch, retry scenarios, mapping logic, error cases

### Code Structure

```javascript
class BeeSuiteStaffService {
  constructor(apiUrl, jwtToken) { ... }  // JWT token from StaffTrack app auth
  async fetchStaffList() { ... }
  async _makeRequest(method, endpoint, params) { ... }
  static mapStaffRecord(beesuitePerson) { ... }
}
module.exports = BeeSuiteStaffService;
```

### Configuration Integration
- Reads `BEESUITE_API_URL` from environment only (no separate token needed)
- JWT token obtained from authenticated admin's request context (same token used to authenticate to StaffTrack app)
- Token passed to service via constructor when sync is invoked
- Configurable timeout via `BEESUITE_SYNC_TIMEOUT_MS` (default: 30000)

### Testing Approach
- Unit tests with mocked fetch responses
- Test all error scenarios (4xx, 5xx, timeout)
- Verify retry count and delays using fake timers
- Verify field mapping with sample BeeSuite data

---

## Task 3: Create StaffCatalogSync Orchestration Service
**Status:** Not Started  
**Dependencies:** Task 1, Task 2  
**Estimated Effort:** 5-6 hours  

### Description
Build the core orchestration service that coordinates API calls, database updates, and audit logging.

### Acceptance Criteria
- [ ] `StaffCatalogSync` class created in `/backend/src/services/StaffCatalogSync.js`
- [ ] `syncStaffCatalog(operatorId)` executes full sync with transaction support
- [ ] Tracks performance metrics: API duration, DB duration, total duration
- [ ] Handles upsert logic: creates new records, updates existing ones
- [ ] Deactivates staff with `status=Inactive` and records `inactive_since` timestamp
- [ ] Reactivates previously inactive staff if status changes
- [ ] Logs all operations to `catalog_sync_log` table with counts
- [ ] Database transaction rollback on any critical error
- [ ] Partial sync scenarios logged appropriately

### Key Methods
- `async syncStaffCatalog(operatorId)` - Main orchestration
- `async _processSyncTransaction(staffList, syncId)` - Database operations within transaction
- `async _logSyncOperation(logData)` - Audit logging

### Upsert Logic
- Look up staff by `beesuite_employee_id`
- If not found: INSERT new record
- If found: UPDATE all fields including `is_active`, `inactive_since`, `last_synced_at`
- Track counts for: created, updated, deactivated, activated

### Error Handling
- Network errors → logged and re-thrown (will be retried by API service)
- DB errors → transaction rollback, error message logged
- Partial sync failures → commit successful records, log failures with record details

### Testing Approach
- Integration tests with mock database
- Test successful sync workflow
- Test upsert logic (new records, updates, deactivations)
- Test transaction rollback on DB error
- Test async performance and timing

---

## Task 4: Create Admin API Endpoint
**Status:** Not Started  
**Dependencies:** Task 1, Task 2, Task 3  
**Estimated Effort:** 3-4 hours  

### Description
Create the Express route handler for the sync endpoint accessible to admins.

### Acceptance Criteria
- [ ] Route: `POST /api/admin/catalog/sync-beesuite` created in `/backend/src/routes/admin.js`
- [ ] Admin role validation middleware enforced
- [ ] Endpoint accepts optional `dryRun` parameter for testing
- [ ] Endpoint returns sync results with statistics and duration
- [ ] Error responses include sync ID for audit trail correlation
- [ ] Request validation: validate `operatorId` is valid admin user
- [ ] Rate limiting implemented: max 1 sync per minute per admin
- [ ] Logging includes: operator, timestamp, result, error (if any)

### Request & Response Spec

**Request:**
```json
{
  "operatorId": "550e8400-e29b-41d4-",
  "dryRun": false  // optional
}
```

**Success Response (200):**
```json
{
  "success": true,
  "syncId": "sync_1704067200000_abc",
  "total_records": 250,
  "records_created": 45,
  "records_updated": 180,
  "records_deactivated": 15,
  "records_activated": 2,
  "duration": 3250
}
```

**Error Response (400/500):**
```json
{
  "success": false,
  "error": "Error message",
  "syncId": "sync_1704067200000_abc",
  "duration": 12100
}
```

### Test Cases
- Successful sync as admin
- Non-admin user gets 403
- Network error during sync
- Invalid operatorId parameter
- Rate limit enforcement

---

## Task 5: Create Sync Status API Endpoint
**Status:** Not Started  
**Dependencies:** Task 1  
**Estimated Effort:** 2-3 hours  

### Description
Create read-only endpoint for admins to view sync history and metadata.

### Acceptance Criteria
- [ ] Route: `GET /api/admin/catalog/sync-history` created
- [ ] Query parameters: `limit`, `offset`, `status` filter
- [ ] Returns list of sync operations with metadata (timestamp, counts, duration, error)
- [ ] Default limit: 20 records
- [ ] Sorted by timestamp DESC
- [ ] Admin role validation enforced

### Response Format
```json
{
  "success": true,
  "data": [
    {
      "syncId": "sync_1704067200000_abc",
      "timestamp": "2023-12-01T10:30:00Z",
      "status": "SUCCESS",
      "initiatedBy": "admin@company.com",
      "totalRecords": 250,
      "recordsCreated": 45,
      "recordsUpdated": 180,
      "recordsDeactivated": 15,
      "recordsActivated": 2,
      "duration": 3250,
      "errorMessage": null
    }
  ],
  "total": 47,
  "limit": 20,
  "offset": 0
}
```

### SQL Query
```sql
SELECT * FROM catalog_sync_log 
WHERE [status filter if provided]
ORDER BY sync_timestamp DESC
LIMIT ? OFFSET ?
```

---

## Task 6: Environment Variable Configuration
**Status:** Not Started  
**Dependencies:** None  
**Estimated Effort:** 1 hour  

### Description
Set up environment variables for BeeSuite API integration.

### Acceptance Criteria
- [ ] Create `.env.example` with all required variables
- [ ] Add docs explaining each variable
- [ ] Validate at startup that required BEESUITE_API_URL is present
- [ ] Update `docker-compose.yaml` to pass env vars to backend container
- [ ] Document in README that sync uses app's own JWT authentication (no separate token needed)

### Environment Variables
```
BEESUITE_API_URL=https://appcore.beesuite.app
BEESUITE_SYNC_TIMEOUT_MS=30000
BEESUITE_SYNC_RETRY_ATTEMPTS=3
BEESUITE_SYNC_ENABLED=true
```

### Validation Logic
```javascript
const requiredEnvs = [
  'BEESUITE_API_URL'
];
// Note: JWT token is obtained from request context, not env vars

requiredEnvs.forEach(envVar => {
  if (!process.env[envVar]) {
    throw new Error(`Missing required env var: ${envVar}`);
  }
});
```

---

## Task 7: Frontend UI - Sync Button & Status
**Status:** Not Started  
**Dependencies:** Task 4, Task 5  
**Estimated Effort:** 4-5 hours  

### Description
Add admin UI for triggering sync and viewing sync history.

### Acceptance Criteria
- [ ] "Sync Now" button added to `admin.html` in Catalog section
- [ ] Button disabled during sync (shows loading spinner)
- [ ] Success message shows record counts and duration
- [ ] Error messages displayed with retry option
- [ ] Sync history table shows last 10 operations
- [ ] History table columns: Timestamp, Status, Records Created/Updated/Deactivated, Duration, Error
- [ ] One-click access to detailed sync logs (modal with full error text if applicable)
- [ ] Responsive design matches existing admin UI

### JavaScript Implementation (`admin.js`)

```javascript
// Trigger sync
document.getElementById('btn-sync-beesuite').addEventListener('click', async () => {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  
  try {
    const response = await fetch('/api/admin/catalog/sync-beesuite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId: currentUserId })
    });
    
    const result = await response.json();
    if (result.success) {
      showNotification(`Sync completed: ${result.records_created} created, ${result.records_updated} updated`, 'success');
      await loadSyncHistory();
    } else {
      showNotification(`Sync failed: ${result.error}`, 'error');
    }
  } catch (error) {
    showNotification(`Network error: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync Now';
  }
});

// Load & display sync history
async function loadSyncHistory() {
  const response = await fetch('/api/admin/catalog/sync-history?limit=10');
  const data = await response.json();
  
  const table = document.getElementById('sync-history-table');
  table.innerHTML = data.data.map(sync => `
    <tr>
      <td>${new Date(sync.timestamp).toLocaleString()}</td>
      <td><span class="badge badge-${sync.status === 'SUCCESS' ? 'success' : 'danger'}">${sync.status}</span></td>
      <td>${sync.totalRecords}</td>
      <td>${sync.recordsCreated}</td>
      <td>${sync.recordsUpdated}</td>
      <td>${sync.recordsDeactivated}</td>
      <td>${sync.duration}ms</td>
    </tr>
  `).join('');
}
```

### HTML Structure
```html
<section id="catalog-beesuite" class="settings-section">
  <h3>BeeSuite Catalog Sync</h3>
  <button id="btn-sync-beesuite" class="btn btn-primary">Sync Now</button>
  
  <h4>Recent Sync History</h4>
  <table id="sync-history-table" class="data-table">
    <thead>
      <tr>
        <th>Timestamp</th>
        <th>Status</th>
        <th>Total</th>
        <th>Created</th>
        <th>Updated</th>
        <th>Deactivated</th>
        <th>Duration</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
</section>
```

---

## Task 8: Unit Tests - BeeSuiteStaffService
**Status:** Not Started  
**Dependencies:** Task 2  
**Estimated Effort:** 3-4 hours  

### Description
Create comprehensive unit tests for BeeSuite API client.

### Test Coverage
- [ ] `fetchStaffList()` - successful response
- [ ] `fetchStaffList()` - retry logic (timeout, then success)
- [ ] `fetchStaffList()` - 401 unauthorized (no retry)
- [ ] `fetchStaffList()` - 403 forbidden (no retry)
- [ ] `fetchStaffList()` - timeout (3 retries)
- [ ] `fetchStaffList()` - invalid JSON response (1 retry)
- [ ] `fetchStaffList()` - empty results
- [ ] `mapStaffRecord()` - all fields mapped correctly
- [ ] `mapStaffRecord()` - "Inactive" status conversion
- [ ] `mapStaffRecord()` - missing optional fields handled

### Test File
`/backend/test/unit/services/BeeSuiteStaffService.test.js`

---

## Task 9: Integration Tests - StaffCatalogSync
**Status:** Not Started  
**Dependencies:** Task 1, Task 3  
**Estimated Effort:** 4-5 hours  

### Description
Create integration tests for sync orchestration against test database.

### Test Coverage
- [ ] Successful sync: verify records created
- [ ] Sync with updates: verify existing records updated
- [ ] Deactivation: verify `is_active=false` and `inactive_since` set
- [ ] Reactivation: verify inactive staff reactivated if status changes
- [ ] Transaction rollback: verify no records saved on DB error
- [ ] Audit logging: verify sync log entry created correctly
- [ ] Performance: sync 1000 records in <10 seconds
- [ ] Partial failure: verify successful records committed, failures logged

### Test File
`/backend/test/integration/services/StaffCatalogSync.test.js`

---

## Task 10: API Endpoint Tests
**Status:** Not Started  
**Dependencies:** Task 4, Task 5  
**Estimated Effort:** 3 hours  

### Description
Create tests for API endpoints (sync trigger & history).

### Test Coverage
- [ ] Successful sync endpoint call
- [ ] Non-admin user blocked (403)
- [ ] Network error handling
- [ ] Rate limiting enforcement
- [ ] Sync history endpoint returns correct data
- [ ] History filtering by status
- [ ] Pagination (limit/offset)

### Test Files
- `/backend/test/integration/routes/admin.catalog.test.js`

---

## Task 11: Documentation & Training
**Status:** Not Started  
**Dependencies:** All tasks  
**Estimated Effort:** 2-3 hours  

### Description
Create user documentation and operational guidelines.

### Deliverables
- [ ] User Guide: "How to Sync Staff from BeeSuite"
- [ ] Troubleshooting Guide: Common errors and solutions
- [ ] Admin Guide: Setting up BeeSuite API token
- [ ] Architecture Decision Record (ADR): Why this approach
- [ ] API Documentation: OpenAPI/Swagger for endpoints

### Documentation Files
- `docs/BEESUITE_INTEGRATION.md` - User guide
- `docs/BEESUITE_TROUBLESHOOTING.md` - Troubleshooting
- `docs/BEESUITE_SETUP.md` - Configuration guide

---

## Task 12: Performance Testing & Optimization
**Status:** Not Started  
**Dependencies:** Task 3, Task 9  
**Estimated Effort:** 2-3 hours  

### Description
Performance testing and optimization of sync operations.

### Acceptance Criteria
- [ ] Sync 1000 staff records in <10 seconds
- [ ] Sync 10,000 staff records in <30 seconds
- [ ] API response handling optimized (no memory leaks)
- [ ] Database batch operations used for performance
- [ ] Load test results documented
- [ ] Performance baseline established for future releases

### Performance Tests
- Load test: 1000 records
- Load test: 10,000 records
- Memory profiling during sync
- Concurrent sync requests (should reject 2nd)

---

## Deployment Checklist

- [ ] All tests passing (unit, integration, API)
- [ ] Code review completed
- [ ] Database migration tested on staging
- [ ] Environment variables configured in production
- [ ] BeeSuite API token securely stored
- [ ] Monitoring alerts set up for sync failures
- [ ] Rollback plan documented
- [ ] Training completed for admins
- [ ] Documentation updated in README

---

## Implementation Priority & Timeline

**Phase 1 (Foundation)** - Weeks 1-2
- Task 1: Database schema
- Task 6: Environment variables
- Task 2: API client service

**Phase 2 (Core Logic)** - Weeks 2-3
- Task 3: Orchestration service
- Task 8: Unit tests
- Task 9: Integration tests

**Phase 3 (API & UI)** - Weeks 3-4
- Task 4: Sync endpoint
- Task 5: History endpoint
- Task 7: Frontend UI

**Phase 4 (Testing & Deploy)** - Week 4-5
- Task 10: API endpoint tests
- Task 12: Performance testing
- Deployment checklist
- Task 11: Documentation

**Total Estimated Effort:** 40-50 hours

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| BeeSuite API downtime | Medium | High | Implement retry logic, alert admins |
| JWT token expiration (user session ends) | Low | Medium | Handle gracefully—reauth required to sync, normal app behavior |
| Large data sync timeout | Low | Medium | Implement pagination/chunking if needed |
| Duplicate deactivations | Low | Medium | Idempotent operations, check existing inactive_since |
| Sensitive data leak (logs) | Low | High | Mask tokens/emails in all logs |

