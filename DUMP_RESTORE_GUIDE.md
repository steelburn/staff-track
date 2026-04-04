# Database Dump & Restore Functionality

This documentation describes how to backup and restore the StaffTrack database.

## Overview

The StaffTrack application now includes built-in functionality to:
- **Dump**: Export all database data to a JSON file
- **Restore**: Import database data from a JSON dump

This is useful for:
- Creating backups before major changes
- Migrating data between environments
- Disaster recovery
- Development/testing scenarios

---

## API Endpoints

### 1. GET `/api/data-tools/dump`

**Description**: Export all database data as JSON

**URL**: `http://localhost:3000/data-tools/dump`

**Method**: GET

**Response**: JSON object containing all tables and their records

**Example**:
```bash
curl http://localhost:3000/data-tools/dump -o backup.json
```

**Response Format**:
```json
{
  "exported_at": "2026-04-04T01:21:43.755Z",
  "tables": {
    "staff": [
      { "email": "user@example.com", "name": "John Doe", ... },
      ...
    ],
    "submissions": [
      { "id": "123", "staff_email": "user@example.com", ... },
      ...
    ],
    ...
  }
}
```

---

### 2. POST `/api/data-tools/restore`

**Description**: Restore database from JSON dump (in request body)

**URL**: `http://localhost:3000/data-tools/restore`

**Method**: POST

**Content-Type**: `application/json`

**Request Body**: Full dump JSON object (from GET `/data-tools/dump`)

**Response**: Restoration results

**Example**:
```bash
# First, get the dump
curl http://localhost:3000/data-tools/dump -o backup.json

# Then restore it
curl -X POST http://localhost:3000/data-tools/restore \
  -H "Content-Type: application/json" \
  -d @backup.json
```

**Response Example**:
```json
{
  "success": true,
  "message": "Database restored successfully",
  "results": {
    "tables_processed": 18,
    "total_rows_imported": 892,
    "errors": []
  }
}
```

---

### 3. GET `/api/data-tools/status`

**Description**: Get database statistics and table row counts

**URL**: `http://localhost:3000/data-tools/status`

**Method**: GET

**Response**: Database statistics

**Example**:
```bash
curl http://localhost:3000/data-tools/status | jq
```

**Response Example**:
```json
{
  "status": "ok",
  "database": "/data/submissions.db",
  "tables": 18,
  "statistics": {
    "staff": 243,
    "projects_catalog": 328,
    "submissions": 162,
    "user_roles": 30,
    ...
  }
}
```

---

## Command-Line Scripts

Two npm scripts are available for backend operations:

### 1. Dump the Database

**Command**:
```bash
docker compose exec backend npm run dump
```

**Output**: Creates a file named `submissions-dump-YYYY-MM-DDTHH-mm-ss.json` in the backend directory

**Example Output**:
```
🔄 Starting database dump...

✓ Dumped staff: 243 rows
✓ Dumped projects_catalog: 328 rows
✓ Dumped submissions: 162 rows
...
✓ Database dump saved to: /app/submissions-dump-2026-04-04T01-21-43.json
  File size: 120.45 KB

✅ Dump completed successfully!
```

### 2. Restore from a Dump File

**Command**:
```bash
docker compose exec backend npm run restore -- <path-to-dump-file>
```

**Example**:
```bash
docker compose exec backend npm run restore -- ./submissions-dump-2026-04-04T01-21-43.json
```

**Output Example**:
```
🔄 Starting database restore...

📂 Loading dump from: ./submissions-dump-2026-04-04T01-21-43.json

✓ Restored staff: 243 rows
✓ Restored projects_catalog: 328 rows
✓ Restored submissions: 162 rows
...
✓ Database restoration complete:
  Tables processed: 18
  Rows imported: 892

✅ Restore completed successfully!
```

---

## Workflow Examples

### Example 1: Regular Backup

```bash
# Create a timestamped backup
docker compose exec backend npm run dump

# The file will be created at:
# /home/steelburn/staff-track/backend/submissions-dump-YYYY-MM-DD....json
```

### Example 2: Backup Before Making Changes

```bash
# Backup current state
docker compose exec backend npm run dump

# Make changes to application/data
# ... (modify data via API) ...

# If problems occur, restore the backup
docker compose exec backend npm run restore -- ./submissions-dump-2026-04-04T01-21-43.json
```

### Example 3: Export and Download Backup

```bash
# Method 1: Using API endpoint
curl http://localhost:3000/data-tools/dump -o my-backup-$(date +%s).json

# Method 2: Using docker cp
docker compose exec backend npm run dump
docker cp staff-track-backend-1:/app/submissions-dump-*.json ./backups/
```

### Example 4: Restore from Backup

```bash
# Copy backup file to backend container
docker cp my-backup.json staff-track-backend-1:/app/

# Restore the database
docker compose exec backend npm run restore -- ./my-backup.json
```

---

## Safety Considerations

⚠️ **Important Notes**:

1. **Backup Location**: Dumps are created in the backend container. Use `docker cp` to save them to the host.

2. **Data Persistence**: The Docker volume `staff-track_db_data` contains the actual database. Dumps are JSON exports for backup purposes.

3. **Restore Behavior**: Restoration uses `INSERT OR REPLACE`, which means:
   - Records with the same primary key will be overwritten
   - All data in the dump will be imported
   - Data not in the dump will remain in the database

4. **Before Restoring**:
   - Always verify the dump file is valid and complete
   - Consider the impact of overwriting existing data
   - Test restore in a development environment first

5. **Large Backups**: Very large dumps (>1MB) may take time to process. Be patient during restore operations.

---

## Troubleshooting

### Dump fails with "Database locked"

```
Error: database is locked
```

**Solution**: Stop other database operations first:
```bash
docker compose restart backend
# Wait for backend to start
docker compose exec backend npm run dump
```

### Restore returns "Table X does not exist"

This typically happens if the database schema is missing tables. Ensure the backend has initialized the schema by:
```bash
docker compose restart backend
# Wait for initialization
docker compose logs backend | grep "Database initialization"
```

### Dump file is empty or corrupted

```bash
# Verify file size and format
du -h submissions-dump-*.json
jq . submissions-dump-*.json  # Should parse as valid JSON
```

If corrupted, create a new dump:
```bash
docker compose exec backend npm run dump
```

---

## Advanced Usage

### Create Scheduled Backups

```bash
# Add to crontab (runs daily at 2 AM)
0 2 * * * cd /home/steelburn/staff-track && \
  docker compose exec -T backend npm run dump && \
  docker cp staff-track-backend-1:/app/submissions-dump-*.json \
  /backups/stafftrack/$(date +\%Y-\%m-\%d).json
```

### Compare Two Dumps

```bash
# Dump before and after operations
docker compose exec backend npm run dump
cp submissions-dump-*.json dump-before.json

# ... make changes ...

docker compose exec backend npm run dump
cp submissions-dump-*.json dump-after.json

# Compare
diff <(jq . dump-before.json) <(jq . dump-after.json)
```

### Selective Restore (Using jq)

```bash
# Extract only specific tables from a dump
jq '.tables |= {staff, user_roles}' backup.json > partial-backup.json

# Restore only those tables
docker compose exec backend npm run restore -- ./partial-backup.json
```

---

## File Structure

Dump files are standard JSON with the following structure:

```json
{
  "exported_at": "ISO-8601 timestamp",
  "tables": {
    "table_name": [
      { "column1": "value1", "column2": "value2", ... },
      { "column1": "value1", "column2": "value2", ... },
      ...
    ],
    ...
  }
}
```

---

## API Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success - dump/status completed successfully |
| 400 | Bad Request - invalid request body for restore |
| 500 | Server Error - database operation failed |

---

## Questions or Issues?

For problems or questions about dump/restore functionality:
1. Check the backend logs: `docker compose logs backend`
2. Verify database status: `curl http://localhost:3000/data-tools/status`
3. Ensure database volume has space: `docker volume inspect staff-track_db_data`
