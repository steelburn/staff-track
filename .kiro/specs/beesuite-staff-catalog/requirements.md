# BeeSuite Staff Catalog Integration - Requirements

## Overview
Integrate StaffTrack's staff catalog with BeeSuite's external staff API to ensure real-time synchronization of staff records. Automatically sync staff data from BeeSuite and disable staff marked as inactive in the source system.

## User Stories

### US-1: Admin Retrieves Staff List from BeeSuite API
**As an** admin  
**I want to** retrieve staff list data from the BeeSuite API endpoint  
**So that** I can maintain current staff records in StaffTrack from an authoritative source

**EARS Acceptance Criteria:**
- GIVEN I have admin permissions
- WHEN I access the catalog synchronization feature
- THEN the system retrieves staff data from `https://appcore.beesuite.app/api/admin/staff-list?type=report`
- AND the response includes all fields: employee ID, full name, email, department, designation, status, and manager information
- AND the request includes proper Bearer token authentication
- AND the system handles API timeouts (>5 seconds) gracefully

---

### US-2: System Automatically Disables Inactive Staff
**As an** admin  
**I want to** automatically disable staff records marked with `status=Inactive`  
**So that** inactive employees are removed from selection lists and reporting without manual intervention

**EARS Acceptance Criteria:**
- GIVEN staff data is retrieved from BeeSuite
- WHEN a staff record has `status` field set to "Inactive"
- THEN the system automatically sets `is_active=false` in the local staff database
- AND the disabled staff remains in the database (no deletion) for historical purposes
- AND a timestamp `inactive_since` is recorded for audit purposes
- AND the operation is logged with the count of disabled records

---

### US-3: Map BeeSuite Fields to StaffTrack Schema
**As a** developer  
**I want to** map BeeSuite API response fields to StaffTrack database columns  
**So that** data is correctly stored and accessible within the application

**EARS Acceptance Criteria:**
- GIVEN BeeSuite API returns staff objects
- WHEN I examine the response structure
- THEN I can map the following fields:
  - BeeSuite `employeeId` → StaffTrack `employee_id`
  - BeeSuite `fullName` → StaffTrack `full_name`
  - BeeSuite `email` → StaffTrack `email`
  - BeeSuite `department` → StaffTrack `department`
  - BeeSuite `designation` → StaffTrack `designation`
  - BeeSuite `status` → StaffTrack `is_active` (convert manually: "Inactive" → false)
  - BeeSuite `reportingTo` → StaffTrack `manager_id` (manager name/GUID lookup)
- AND missing fields in BeeSuite use StaffTrack defaults or remain NULL
- AND the mapping is documented in a configuration file

---

### US-4: Handle API Response Errors and Edge Cases
**As an** admin  
**I want to** receive clear error messages when BeeSuite API integration fails  
**So that** I know what went wrong and can take corrective action

**EARS Acceptance Criteria:**
- GIVEN the BeeSuite API is called
- WHEN the API returns an error (4xx, 5xx)
- THEN the system logs the error with full response details
- AND an error message is displayed to the admin: "Failed to retrieve staff list: [reason]"
- AND retries are attempted up to 3 times with exponential backoff (1s, 2s, 4s)
- WHEN the API returns empty results
- THEN the system logs a warning and prompts the admin to verify credentials
- WHEN authentication fails (401/403)
- THEN the system suggests checking the Bearer token validity

---

### US-5: Track Synchronization Metadata
**As an** admin  
**I want to** see when staff catalog was last synchronized  
**So that** I can verify data freshness and schedule regular sync operations

**EARS Acceptance Criteria:**
- GIVEN the sync operation completes
- WHEN I view the catalog import history
- THEN I can see:
  - Last sync timestamp (UTC)
  - Number of records processed
  - Number of records activated
  - Number of records deactivated
  - API response time
  - Sync status (Success/Failed/Partial)
- AND this metadata is persisted in `catalog_sync_log` table

---

## Non-Functional Requirements

### Performance
- Staff list sync should complete within 30 seconds for up to 10,000 staff records
- API response parsing should be optimized using streaming for large payloads
- Database batch inserts/updates should be used for performance

### Security
- Bearer token must be stored securely in environment variables (not in code)
- API requests must use HTTPS only
- Request/response logging must mask sensitive fields (email, phone)
- Only admins can trigger manual sync operations

### Reliability
- Sync operations must be idempotent (safe to run multiple times without side effects)
- Network failures should trigger automatic retry with exponential backoff
- Partial failures should log details without affecting already-processed records

### Audit & Compliance
- All sync operations must be logged with operator ID, timestamp, and record counts
- Staff status changes must be tracked in an audit table with reason "BeeSuite sync"
- Historical inactive_since dates must be preserved for compliance reporting

---

## API Specification Reference

**Endpoint:** `GET https://appcore.beesuite.app/api/admin/staff-list?type=report`

**Authentication:** JWT Token (from StaffTrack app authentication, same token as admin session)

**Authorization Header:** `Authorization: JWT {{access_token}}`

**Response Code:** 200 OK

**Response Structure** (expected):
```json
{
  "success": true,
  "data": [
    {
      "employeeId": "E001234",
      "fullName": "John Doe",
      "email": "john.doe@company.com",
      "department": "Engineering",
      "designation": "Senior Software Engineer",
      "status": "Active",
      "reportingTo": "Manager Name"
    }
  ],
  "total": 150
}
```

---

## Dependencies
- Existing staff catalog database schema (`staff` table)
- BeeSuite API endpoint access (authenticated via StaffTrack's own JWT token)
- Environment variable support in backend configuration
- HTTP client library for Node.js (axios/node-fetch)

---

## Out of Scope
- Modification of BeeSuite staff records
- Two-way sync (StaffTrack → BeeSuite)
- Merging duplicate staff records
- Staff re-activation (manual process only)
- Historical staff data purging
