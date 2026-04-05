# MySQL Database Migration Guide

**Version:** 1.0  
**Date:** 2026-04-04  
**Status:** Ready for Execution  

---

## Overview

This guide covers the migration from SQLite to MySQL for the StaffTrack application. The migration process is designed to preserve all existing data with zero data loss.

### Key Points

- ✅ **Data Preservation:** All existing data will be migrated
- 🔒 **Integrity Checks:** Schema validation before and after migration
- 📊 **Rollback Ready:** Backup of SQLite database kept for safety
- 🐳 **Docker Native:** All operations run in containers

---

## Pre-Migration Checklist

Before starting the migration, verify:

- [ ] Docker and Docker Compose are installed
- [ ] Current SQLite database is healthy (`submissions.db` exists)
- [ ] Backup of current data exists (auto-created at `/home/steelburn/staff-track-backup-*.json`)
- [ ] No active user sessions (or they will be logged out)
- [ ] Maintenance window scheduled (migration takes ~5-10 minutes)

---

## Migration Process

### Phase 1: Prepare Environment

#### 1.1 Stop Current Services

```bash
cd /home/steelburn/staff-track
docker compose down
```

**What it does:**
- Stops all running containers (nginx, backend, SQLite)
- Preserves all volumes (data is safe)

#### 1.2 Verify SQLite Data

```bash
cd /home/steelburn/staff-track
docker compose exec backend sqlite3 /data/submissions.db ".tables"
```

**Expected output:**
```
auth_audit_log    cv_past_projects  skills_catalog
auth_tokens       cv_profiles       submission_projects
certifications    cv_snapshots      submission_skills
education         cv_templates      submissions
managed_projects  projects_catalog  staff
skill_merge_log   user_roles
```

### Phase 2: Deploy MySQL Infrastructure

#### 2.1 Build and Start MySQL

```bash
# Build fresh containers
docker compose build

# Start with MySQL
docker compose up -d db

# Wait for MySQL to be ready (health check)
sleep 15

# Verify MySQL is running
docker compose exec db mysql -u root -proot_password -e "SELECT 1"
```

**What it does:**
- Pulls MySQL 8.0 Alpine image
- Creates `stafftrack` database
- Applies initial schema (automatic via `migrations/` volume mount)
- Verifies database connectivity

#### 2.2 Verify MySQL Schema

```bash
docker compose exec db mysql -u stafftrack -pstafftrack_dev_password stafftrack -e "SHOW TABLES;"
```

**Expected output:** 18 tables created

```
+-----------------------+
| Tables_in_stafftrack  |
+-----------------------+
| _migrations           |
| auth_audit_log        |
| auth_tokens           |
| certifications        |
| cv_past_projects      |
| cv_profiles           |
| cv_snapshots          |
| cv_templates          |
| education             |
| managed_projects      |
| projects_catalog      |
| skills_catalog        |
| skill_merge_log       |
| staff                 |
| submission_projects   |
| submission_skills     |
| submissions           |
| user_roles            |
+-----------------------+
```

### Phase 3: Migrate Data

#### 3.1 Preview Migration (Dry Run)

```bash
docker compose exec backend node scripts/migrate-to-mysql.js --dry-run
```

**Output shows:**
- Number of tables found
- Number of rows that will be migrated
- Any potential issues detected

#### 3.2 Execute Migration

```bash
docker compose exec backend node scripts/migrate-to-mysql.js
```

**Status indicators:**
- ✓ = Table successfully migrated
- ○ = Table had no data to migrate
- ⊘ = Table not found in SQLite (skipped)
- ❌ = Error during migration (review and retry)

**Example output:**
```
🔄 SQLite to MySQL Data Migration
============================================================

📂 Connecting to SQLite...
✓ SQLite connected: /data/submissions.db

🗄️  Connecting to MySQL...
✓ MySQL connected: db:3306/stafftrack

📋 Starting data migration...

✓ staff - 243 row(s) migrated
✓ submissions - 162 row(s) migrated
✓ submission_skills - 1,045 row(s) migrated
✓ submission_projects - 587 row(s) migrated
✓ user_roles - 28 row(s) migrated
... (more tables)

============================================================
📊 Migration Summary
============================================================
Tables processed: 18
Total rows migrated: 4,892
⚠️  Errors encountered: 0

✅ Data migration completed successfully!
============================================================
```

### Phase 4: Verify Data Integrity

#### 4.1 Compare Row Counts

```bash
# SQLite count
docker compose exec backend sqlite3 /data/submissions.db "SELECT 'Staff:', COUNT(*) FROM staff UNION ALL SELECT 'Submissions:', COUNT(*) FROM submissions UNION ALL SELECT 'Skills:', COUNT(*) FROM submission_skills;"

# MySQL count
docker compose exec db mysql -u stafftrack -pstafftrack_dev_password stafftrack -e "SELECT 'Staff:', COUNT(*) FROM staff UNION ALL SELECT 'Submissions:', COUNT(*) FROM submissions UNION ALL SELECT 'Skills:', COUNT(*) FROM submission_skills;"
```

**Expect:** Identical row counts in both databases

#### 4.2 Spot Check Sample Data

```bash
# Check a staff member exists
docker compose exec db mysql -u stafftrack -pstafftrack_dev_password stafftrack -e "SELECT email, name, department FROM staff LIMIT 5;"

# Check submissions exist
docker compose exec db mysql -u stafftrack -pstafftrack_dev_password stafftrack -e "SELECT id, staff_email, created_at FROM submissions LIMIT 5;"
```

#### 4.3 Verify Foreign Keys

```bash
# Check referential integrity
docker compose exec db mysql -u stafftrack -pstafftrack_dev_password stafftrack -e "SELECT COUNT(*) as orphaned_submissions FROM submissions s WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.email = s.staff_email);"
```

**Expected:** `0` (no orphaned records)

### Phase 5: Start Application

#### 5.1 Start Backend Service

```bash
docker compose up -d backend
```

#### 5.2 Verify Backend Connected

```bash
# Check for connection errors
docker compose logs backend | grep -i "error\|warning\|mysql"

# Test health endpoint
curl -s http://localhost:3000/health | jq .
```

**Expected response:**
```json
{
  "status": "ok",
  "timestamp": "2026-04-04T...",
  "database": "connected"
}
```

#### 5.3 Start Nginx (Frontend)

```bash
docker compose up -d nginx
```

#### 5.4 Full Application Check

```bash
# Verify all services running
docker compose ps

# Test frontend loads
curl -s http://localhost:6082 | head -20
```

---

## Post-Migration Tasks

### 1. Data Validation Queries

Run these queries to verify data integrity:

```sql
-- Check data distribution
SELECT 'Staff Records' as metric, COUNT(*) as count FROM staff
UNION ALL SELECT 'Submissions', COUNT(*) FROM submissions
UNION ALL SELECT 'Users', COUNT(*) FROM user_roles
UNION ALL SELECT 'Projects', COUNT(*) FROM projects_catalog
UNION ALL SELECT 'Skills', COUNT(*) FROM submission_skills
ORDER BY metric;

-- Find any data quality issues
SELECT 'Missing Profile Summary' as issue, COUNT(*) as affected 
FROM submissions WHERE staff_email NOT IN (SELECT staff_email FROM cv_profiles WHERE summary IS NOT NULL);

-- Verify timestamp consistency
SELECT table_name, COUNT(*) as records 
FROM information_schema.TABLES t
WHERE table_schema = 'stafftrack'
AND EXISTS (SELECT 1 FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME AND c.COLUMN_NAME = 'created_at');
```

### 2. Performance Optimization

```sql
-- Display index statistics
SHOW INDEXES FROM submissions;
SHOW INDEXES FROM submission_skills;
SHOW INDEXES FROM user_roles;

-- Check query performance
EXPLAIN SELECT * FROM submissions WHERE staff_email = 'user@example.com';
```

### 3. Backup MySQL Data

```bash
# Export MySQL backup
docker compose exec db mysqldump -u root -proot_password stafftrack > /home/steelburn/stafftrack-mysql-backup-$(date +%Y%m%d-%H%M%S).sql

# Verify backup
ls -lh /home/steelburn/stafftrack-mysql-backup-*.sql
```

---

## Rollback Procedure

If issues occur and you need to rollback to SQLite:

### Step 1: Stop Services

```bash
docker compose down
```

### Step 2: Restore SQLite Volume

```bash
# SQLite volume is still intact at db_data
# Update compose.yaml to use SQLite db service again
# Then restart with SQLite backend
```

### Step 3: Verify Data Recovered

```bash
docker compose exec backend sqlite3 /data/submissions.db "SELECT COUNT(*) FROM submissions;"
```

---

## Troubleshooting

### Issue: MySQL Container Won't Start

**Symptom:**
```
Error: MySQL initialization failed
```

**Solution:**
```bash
# Remove corrupted volume and restart
docker compose down -v
docker compose up db
```

### Issue: Migration Fails - Foreign Key Constraint

**Symptom:**
```
Error: Cannot add or update a child row: foreign key constraint fails
```

**Solution:**
```bash
# Temporarily disable FK checks
docker compose exec db mysql -u root -proot_password -e "SET GLOBAL FOREIGN_KEY_CHECKS=OFF;"

# Re-run migration
docker compose exec backend node scripts/migrate-to-mysql.js

# Re-enable FK checks
docker compose exec db mysql -u root -proot_password -e "SET GLOBAL FOREIGN_KEY_CHECKS=ON;"
```

### Issue: Data Shows But Application Errors

**Symptom:**
```
Error: ECONNREFUSED or connection timeout
```

**Solution:**
```bash
# Check MySQL is healthy
docker compose exec db mysqladmin ping

# Verify credentials in .env match compose.yaml
# Restart backend
docker compose restart backend
```

### Issue: Some Data Didn't Migrate

**Symptom:**
```
⚠️ Table X - Error inserting row: Duplicate key value
```

**Solution:**
```bash
# Check migration errors
docker compose exec backend node scripts/migrate-to-mysql.js 2>&1 | grep "⚠️"

# Clean duplicate and retry
docker compose exec db mysql -u root -proot_password stafftrack -e "DELETE FROM table_name WHERE condition;"
```

---

## Performance Tuning

### Connection Pooling

The backend uses connection pooling (10 connections by default). Adjust in backend code if needed:

```javascript
const pool = mysql.createPool({
  connectionLimit: 10,  // Increase for high concurrency
  queueLimit: 0,        // Unlimited queue
});
```

### Slow Query Log

Enable to identify performance bottlenecks:

```bash
docker compose exec db mysql -u root -proot_password -e "SET GLOBAL slow_query_log = 'ON'; SET GLOBAL long_query_time = 2;"
```

### Index Monitoring

```bash
docker compose exec db mysql -u stafftrack -pstafftrack_dev_password stafftrack -e "SELECT * FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'stafftrack';"
```

---

## Environment Variables

Update `.env` or `docker-compose.yaml` with these values:

```bash
# Database Configuration
DATABASE_DRIVER=mysql
MYSQL_HOST=db
MYSQL_PORT=3306
MYSQL_USER=stafftrack
MYSQL_PASSWORD=stafftrack_dev_password
MYSQL_DATABASE=stafftrack

# Application
NODE_ENV=development
PORT=3000
JWT_SECRET=your-secret-key-here
```

---

## Monitoring Post-Migration

### Daily Checks

1. **Data Consistency:**
   ```bash
   docker compose exec db mysql -u stafftrack -pstafftrack_dev_password stafftrack -e "CHECKSUM TABLE staff, submissions, user_roles;"
   ```

2. **Disk Usage:**
   ```bash
   docker compose exec db du -h /var/lib/mysql/stafftrack/
   ```

3. **Active Connections:**
   ```bash
   docker compose exec db mysql -u root -proot_password -e "SHOW PROCESSLIST;"
   ```

### Weekly Tasks

- Backup MySQL database
- Review slow query log
- Verify no deadlocks in error logs
- Check index fragmentation

---

## Support & Resources

- **MySQL Documentation:** https://dev.mysql.com/doc/
- **Migration Issues:** Check `docker compose logs` for detailed error messages
- **Data Validation Script:** `backend/scripts/migrate-to-mysql.js`
- **Schema Definition:** `backend/migrations/0001_initial_schema.sql`

---

**Migration Status:** ✅ Ready  
**Last Updated:** 2026-04-04  
**Next Step:** Execute Phase 1 (Stop Services)
