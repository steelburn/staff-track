# BeeSuite Staff Catalog Integration - Design

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ StaffTrack Backend                                           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Admin Route: POST /api/admin/catalog/sync-beesuite   │   │
│  │ • Validates admin role                               │   │
│  │ • Triggers sync operation                            │   │
│  │ • Returns sync status                                │   │
│  └──────────────────────────────────────────────────────┘   │
│           │                                                   │
│           ▼                                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ BeeSuiteStaffService                                 │   │
│  │ • API client wrapper                                 │   │
│  │ • Handles authentication                             │   │
│  │ • Retry logic with exponential backoff               │   │
│  │ • Response mapping & validation                      │   │
│  └──────────────────────────────────────────────────────┘   │
│           │                                                   │
│           ▼                                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│ │ StaffCatalogSync Service                              │   │
│  │ • Orchestrates sync process                          │   │
│  │ • Database transactions                              │   │
│  │ • Batch operations for performance                   │   │
│  │ • Audit logging                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│           │                                                   │
│           ▼                                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Database Layer (SQLite)                              │   │
│  │ • staff table (U/I updates)                          │   │
│  │ • catalog_sync_log table (metadata)                  │   │
│  │ • staff_audit table (inactive_since)                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│ BeeSuite (External API)                  │
│ GET /api/admin/staff-list?type=report    │
│ Response: Staff records with metadata    │
└─────────────────────────────────────────┘
```

---

## Database Schema Changes

### New Table: `catalog_sync_log`

```sql
CREATE TABLE IF NOT EXISTS catalog_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id TEXT UNIQUE NOT NULL,
  sync_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  sync_status ENUM('SUCCESS', 'FAILED', 'PARTIAL'),
  initiated_by TEXT NOT NULL,
  source_api TEXT DEFAULT 'beesuite',
  
  -- Stats
  total_records INTEGER,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_deactivated INTEGER DEFAULT 0,
  records_activated INTEGER DEFAULT 0,
  
  -- Timing
  api_request_time_ms INTEGER,
  db_operation_time_ms INTEGER,
  total_duration_ms INTEGER,
  
  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- Audit
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

CREATE INDEX idx_catalog_sync_log_timestamp ON catalog_sync_log(sync_timestamp DESC);
CREATE INDEX idx_catalog_sync_log_status ON catalog_sync_log(sync_status);
```

### Update Existing `staff` Table

```sql
-- Add columns to track external sync source
ALTER TABLE staff ADD COLUMN beesuite_employee_id TEXT;
ALTER TABLE staff ADD COLUMN last_synced_at DATETIME;
ALTER TABLE staff ADD COLUMN inactive_since DATETIME;
ALTER TABLE staff ADD COLUMN sync_source TEXT DEFAULT 'manual';

CREATE INDEX idx_staff_beesuite_id ON staff(beesuite_employee_id);
CREATE INDEX idx_staff_is_active ON staff(is_active);
CREATE INDEX idx_staff_inactive_since ON staff(inactive_since);
```

---

## Field Mapping Specification

### BeeSuite to StaffTrack Mapping

| BeeSuite Field | StaffTrack Field | Type | Transform | Notes |
|---|---|---|---|---|
| `employeeId` | `beesuite_employee_id` | TEXT | None | External ID for deduplication |
| `fullName` | `full_name` | TEXT | TRIM() | Required field |
| `email` | `email` | TEXT | LOWER() | For staff lookup |
| `department` | `department` | TEXT | Auto-sync | Matches existing dept or creates |
| `designation` | `designation` | TEXT | Auto-sync | Staff job title |
| `status` | `is_active` | BOOLEAN | "Active"→true, "Inactive"→false | Status conversion |
| `reportingTo` | `manager_id` | GUID | Lookup by manager name | Manager GUID lookup required |
| N/A | `sync_source` | TEXT | 'beesuite' | Mark as imported from BeeSuite |
| N/A | `last_synced_at` | DATETIME | NOW() | Sync timestamp |
| "Inactive" | `inactive_since` | DATETIME | NOW() | When deactivation occurred |

---

## API Integration Implementation

### BeeSuiteStaffService Class

```javascript
/**
 * Service for integrating with BeeSuite Staff API
 * Handles authentication, retries, and response mapping
 */
class BeeSuiteStaffService {
  /**
   * @param {string} apiUrl - BeeSuite API base URL
   * @param {string} jwtToken - JWT token from StaffTrack app authentication
   *                            (obtained from user session, same as app's auth)
   */
  constructor(apiUrl, jwtToken) {
    this.apiUrl = apiUrl;
    this.jwtToken = jwtToken;
    this.maxRetries = 3;
    this.retryDelays = [1000, 2000, 4000]; // exponential backoff
    this.timeout = 30000; // 30 seconds
  }

  /**
   * Fetch staff list from BeeSuite with retries
   * @returns {Promise<Array>} Array of staff objects
   */
  async fetchStaffList() {
    let lastError;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this._makeRequest('GET', '/api/admin/staff-list', {
          type: 'report'
        });
        
        return response.data; // Expected: array of staff objects
      } catch (error) {
        lastError = error;
        
        if (attempt < this.maxRetries - 1) {
          const delay = this.retryDelays[attempt];
          console.warn(
            `BeeSuite API request failed (attempt ${attempt + 1}). ` +
            `Retrying in ${delay}ms...`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw new Error(
      `Failed to retrieve staff list from BeeSuite after ${this.maxRetries} attempts. ` +
      `Last error: ${lastError.message}`
    );
  }

  /**
   * Make authenticated HTTP request to BeeSuite API
   * Uses JWT token from StaffTrack app's own authentication system
   * @private
   */
  async _makeRequest(method, endpoint, params = null) {
    const url = `${this.apiUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        'Authorization': `JWT ${this.jwtToken}`,
        'Content-Type': 'application/json'
      },
      timeout: this.timeout
    };

    // Add query parameters if GET request
    let requestUrl = url;
    if (method === 'GET' && params) {
      const queryString = new URLSearchParams(params).toString();
      requestUrl = `${url}?${queryString}`;
    }

    try {
      const response = await fetch(requestUrl, options);
      
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `API returned ${response.status}: ${errorBody}`
        );
      }
      
      return await response.json();
    } catch (error) {
      // Log request details (mask sensitive data)
      console.error(`BeeSuite API Error [${method} ${endpoint}]:`, {
        status: error.status,
        message: error.message,
        // Don't log token in error messages
      });
      throw error;
    }
  }

  /**
   * Transform BeeSuite response to StaffTrack format
   * @static
   */
  static mapStaffRecord(beesuitePerson) {
    return {
      beesuite_employee_id: beesuitePerson.employeeId,
      full_name: (beesuitePerson.fullName || '').trim(),
      email: (beesuitePerson.email || '').toLowerCase(),
      department: beesuitePerson.department || null,
      designation: beesuitePerson.designation || null,
      is_active: beesuitePerson.status !== 'Inactive',
      manager_name: beesuitePerson.reportingTo || null,
      sync_source: 'beesuite',
      last_synced_at: new Date().toISOString(),
      inactive_since: beesuitePerson.status === 'Inactive' 
        ? new Date().toISOString() 
        : null
    };
  }
}
```

### StaffCatalogSync Service

```javascript
/**
 * Orchestrates staff catalog synchronization
 * Handles database operations, audit logging, and error handling
 */
class StaffCatalogSync {
  constructor(db, beesuiteSvc) {
    this.db = db;
    this.beesuiteSvc = beesuiteSvc;
  }

  /**
   * Execute full sync operation
   * @param {string} operatorId - Admin user ID
   * @returns {Promise<Object>} Sync result with stats
   */
  async syncStaffCatalog(operatorId) {
    const syncId = this._generateSyncId();
    const startTime = Date.now();
    
    try {
      // Step 1: Fetch data from BeeSuite
      const apiStartTime = Date.now();
      const staffList = await this.beesuiteSvc.fetchStaffList();
      const apiDuration = Date.now() - apiStartTime;
      
      if (!Array.isArray(staffList) || staffList.length === 0) {
        throw new Error('BeeSuite API returned empty staff list');
      }

      // Step 2: Database transaction for atomic operations
      const dbStartTime = Date.now();
      const stats = await this.db.transaction(async () => {
        return await this._processSyncTransaction(staffList, syncId);
      })();
      const dbDuration = Date.now() - dbStartTime;

      // Step 3: Log sync success
      const totalDuration = Date.now() - startTime;
      await this._logSyncOperation({
        syncId,
        status: 'SUCCESS',
        operatorId,
        ...stats,
        apiDuration,
        dbDuration,
        totalDuration
      });

      return {
        success: true,
        syncId,
        ...stats,
        duration: totalDuration
      };

    } catch (error) {
      // Log sync failure
      const totalDuration = Date.now() - startTime;
      await this._logSyncOperation({
        syncId,
        status: 'FAILED',
        operatorId,
        errorMessage: error.message,
        totalDuration
      });

      throw error;
    }
  }

  /**
   * Process sync within database transaction
   * @private
   */
  async _processSyncTransaction(staffList, syncId) {
    const stats = {
      total_records: staffList.length,
      records_created: 0,
      records_updated: 0,
      records_deactivated: 0,
      records_activated: 0
    };

    for (const beesuitePerson of staffList) {
      const mappedStaff = BeeSuiteStaffService.mapStaffRecord(beesuitePerson);
      const existingStaff = this.db.prepare(
        'SELECT id, is_active FROM staff WHERE beesuite_employee_id = ?'
      ).get(mappedStaff.beesuite_employee_id);

      if (!existingStaff) {
        // Create new record
        this.db.prepare(`
          INSERT INTO staff (
            beesuite_employee_id, full_name, email, department, 
            designation, is_active, manager_name, sync_source, 
            last_synced_at, inactive_since
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          mappedStaff.beesuite_employee_id,
          mappedStaff.full_name,
          mappedStaff.email,
          mappedStaff.department,
          mappedStaff.designation,
          mappedStaff.is_active ? 1 : 0,
          mappedStaff.manager_name,
          mappedStaff.sync_source,
          mappedStaff.last_synced_at,
          mappedStaff.inactive_since
        );
        stats.records_created++;
        
      } else {
        // Update existing record
        const wasActive = existingStaff.is_active === 1;
        const nowActive = mappedStaff.is_active;

        this.db.prepare(`
          UPDATE staff SET
            full_name = ?,
            email = ?,
            department = ?,
            designation = ?,
            is_active = ?,
            manager_name = ?,
            last_synced_at = ?,
            inactive_since = ?
          WHERE beesuite_employee_id = ?
        `).run(
          mappedStaff.full_name,
          mappedStaff.email,
          mappedStaff.department,
          mappedStaff.designation,
          mappedStaff.is_active ? 1 : 0,
          mappedStaff.manager_name,
          mappedStaff.last_synced_at,
          mappedStaff.inactive_since,
          mappedStaff.beesuite_employee_id
        );
        
        stats.records_updated++;

        // Track activation/deactivation for audit
        if (wasActive && !nowActive) {
          stats.records_deactivated++;
        } else if (!wasActive && nowActive) {
          stats.records_activated++;
        }
      }
    }

    return stats;
  }

  /**
   * Log sync operation to catalog_sync_log table
   * @private
   */
  async _logSyncOperation(logData) {
    this.db.prepare(`
      INSERT INTO catalog_sync_log (
        sync_id, sync_status, initiated_by, source_api,
        total_records, records_created, records_updated,
        records_deactivated, records_activated,
        api_request_time_ms, db_operation_time_ms,
        total_duration_ms, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logData.syncId,
      logData.status,
      logData.operatorId,
      'beesuite',
      logData.total_records || null,
      logData.records_created || 0,
      logData.records_updated || 0,
      logData.records_deactivated || 0,
      logData.records_activated || 0,
      logData.apiDuration || null,
      logData.dbDuration || null,
      logData.totalDuration,
      logData.errorMessage || null
    );
  }

  _generateSyncId() {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

---

## API Endpoint Specification

### Endpoint: POST /api/admin/catalog/sync-beesuite

**Authentication:** Bearer Token (Admin role required)

**Request:**
```json
{
  "operatorId": "user-uuid",
  "dryRun": false  // Optional: validate without committing
}
```

**Response (Success):**
```json
{
  "success": true,
  "syncId": "sync_1704067200000_abc12ef",
  "total_records": 250,
  "records_created": 45,
  "records_updated": 180,
  "records_deactivated": 15,
  "records_activated": 2,
  "duration": 3250,
  "message": "Sync completed successfully"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Failed to retrieve staff list from BeeSuite after 3 attempts",
  "syncId": "sync_1704067200000_abc12ef",
  "duration": 12100
}
```

---

## Error Handling Strategy

| Scenario | Error Code | Handling | Retry |
|---|---|---|---|
| Network timeout | TIMEOUT | Log, display message to admin, suggest retry | Yes (3x) |
| 401 Unauthorized | AUTH_FAILED | Log security event, suggest token check | No |
| 403 Forbidden | FORBIDDEN | Log, display "insufficient permissions" | No |
| Invalid JSON response | PARSE_ERROR | Log with response body, raw error | Yes (1x) |
| Empty results | EMPTY_RESULT | Log warning, allow sync with 0 records | No |
| DB constraint violation | CONSTRAINT_ERROR | Rollback transaction, log details | No |
| Partial failure in batch | PARTIAL_SYNC | Commit successful records, log failures | Partial |

---

## Configuration

**Environment Variables Required:**

```bash
# .env
BEESUITE_API_URL=https://appcore.beesuite.app
BEESUITE_SYNC_TIMEOUT_MS=30000
BEESUITE_SYNC_RETRY_ATTEMPTS=3
BEESUITE_SYNC_ENABLED=true
```

**Token Authentication:**
- JWT token is obtained from the StaffTrack app's existing authentication system
- No separate BeeSuite credential needed
- Uses same JWT token that authenticates the admin user to the StaffTrack app
- Token is passed to BeeSuiteStaffService via constructor when sync is initiated

---

## Security Considerations

1. **Token Reuse**: Uses StaffTrack app's own JWT authentication—no separate credentials needed.
   - Token already expires with app session
   - Better security posture than maintaining separate credentials
   - Eliminates separate token rotation/expiration management
2. **Request Logging**: Mask JWT tokens and sensitive data (email) in logs.
3. **Response Validation**: Validate response schema before processing.
4. **Database Constraints**: Use parameterized queries to prevent SQL injection.
5. **Role-Based Access**: Only admins with valid app session can trigger sync.
6. **Token Scope**: JWT token scope inherited from authenticated admin user.
7. **Audit Trail**: Log all sync operations with operator ID and timestamp.

---

## Performance Optimization

1. **Batch Operations**: Insert/update records in batches of 100.
2. **Database Indexes**: Create indexes on `beesuite_employee_id`, `is_active`, `inactive_since`.
3. **Connection Pooling**: Reuse HTTP connections for API calls.
4. **Incremental Sync**: Future enhancement—only sync changed records.

