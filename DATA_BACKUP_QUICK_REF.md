# Quick Data Backup & Restore Guide

## Current Database Status
- **Staff Records**: 243
- **Submissions**: 162
- **Users**: 30
- **Projects**: 327
- **CV Templates**: 3

## Quick Commands

### 1. Backup via API Endpoint
```bash
# Download backup from running application
curl http://localhost:3000/data-tools/dump -o backup-$(date +%Y%m%d-%H%M%S).json

# Check file size
ls -lh backup-*.json
```

### 2. Backup from Docker Container
```bash
# Create dump inside container
docker compose exec backend npm run dump

# Copy to host
docker cp staff-track-backend-1:/app/submissions-dump-*.json ./backups/
```

### 3. Restore from Backup File (Using Docker Cp)
```bash
# Copy backup to container
docker cp backup-20260404-012343.json staff-track-backend-1:/app/

# Restore via CLI
docker compose exec backend npm run restore -- ./backup-20260404-012343.json
```

### 4. Restore from API Endpoint
```bash
# Simple way - use jq to send JSON directly
curl -X POST http://localhost:3000/data-tools/restore \
  -H "Content-Type: application/json" \
  -d @backup-20260404-012343.json

# Or with Python (more reliable for large files)
python3 << 'EOF'
import json
import requests

with open('backup-file.json') as f:
    data = json.load(f)

response = requests.post(
    'http://localhost:3000/data-tools/restore',
    json=data
)
print(response.json())
EOF
```

### 5. Check Database Status
```bash
# View table record counts
curl http://localhost:3000/data-tools/status | jq

# Or via Docker
docker compose exec backend sqlite3 /data/submissions.db ".tables"
```

## Where Data is Stored

- **Running Database**: `/data/submissions.db` (inside container at `/data/`)
- **Docker Volume**: `staff-track_db_data` (managed by Docker)
- **Backup Location**: `/home/steelburn/staff-track-data/_data/` (original backup)

## Prevent Data Loss

To avoid losing data in the future:

1. **Create Regular Backups**:
   ```bash
   # Run this periodically
   curl http://localhost:3000/data-tools/dump -o ~/backups/stafftrack-$(date +%Y%m%d).json
   ```

2. **Never use `docker compose down -v`**:
   - The `-v` flag removes all volumes, which deletes the database
   - Use: `docker compose down` (without `-v`)

3. **Keep Backup Files**:
   - Store backups outside the container
   - Test restoration periodically to ensure backups work

4. **When Rebuilding Containers**:
   ```bash
   # GOOD - preserves database volume
   docker compose down
   docker compose build
   docker compose up

   # BAD - deletes database
   docker compose down -v
   docker compose build
   docker compose up
   ```

## Emergency Restore from Original Backup

If the database is completely lost and needs to be restored from the original backup:

```bash
# 1. Ensure containers are running
docker compose up -d

# 2. Copy backup files
docker cp /home/steelburn/staff-track-data/_data/submissions.db staff-track-backend-1:/tmp/
docker cp /home/steelburn/staff-track-data/_data/submissions.db-shm staff-track-backend-1:/tmp/ 2>/dev/null || true
docker cp /home/steelburn/staff-track-data/_data/submissions.db-wal staff-track-backend-1:/tmp/ 2>/dev/null || true

# 3. Replace database
docker compose exec backend sh -c "cp /tmp/submissions.db* /data/"

# 4. Restart backend
docker compose restart backend

# 5. Verify
docker compose exec backend sqlite3 /data/submissions.db "SELECT COUNT(*) FROM submissions;"
```

## API Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/data-tools/dump` | GET | Download database as JSON |
| `/data-tools/restore` | POST | Restore from JSON data |
| `/data-tools/status` | GET | View database statistics |

## File Format

All backup files are standard JSON format that can be:
- Viewed: `jq . backup.json`
- Compressed: `gzip backup.json`
- Versioned: Store with `.json` extension with date/time
- Transferred: Email, cloud storage, etc.

Example backup file structure:
```json
{
  "exported_at": "2026-04-04T01:21:43.755Z",
  "tables": {
    "submissions": [
      { "id": "abc-123", "staff_email": "...", ... },
      ...
    ],
    "staff": [...],
    ...
  }
}
```

---

**Last Updated**: 2026-04-04
**Data Restore Date**: 2026-04-04 01:24 UTC
