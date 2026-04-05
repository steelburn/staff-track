---
name: sqlite-to-mysql
description: Migrate SQLite database to MySQL with automatic schema conversion and codebase pattern conversion
author: StaffTrack Migration Team
date: 2026-04-05
tags: [migration, database, sqlite, mysql, devops]
---

# SQLite to MySQL Migration Skill

## Overview

This skill provides comprehensive tools to migrate from SQLite to MySQL, with two main components:

1. **SQLite to MySQL Data Migrator** - Automatically converts SQLite database schema to MySQL-compatible format and migrates all data
2. **SQLite Pattern Scanner** - Scans codebase for SQLite-specific code patterns and converts them to MySQL-compatible syntax

## Features

### Data Migration
- ✅ Automatic schema extraction from SQLite
- ✅ Intelligent data type conversion (INT, FLOAT, VARCHAR, DATETIME, etc.)
- ✅ Support for foreign keys and constraints
- ✅ Batch data insertion for performance
- ✅ Preserves SQLite table structure as priority
- ✅ Dry-run mode for safety verification
- ✅ Optional table dropping before migration

### Pattern Conversion
- ✅ SQLite library import removal
- ✅ Callback-to-Promise pattern conversion (db.run/get/all)
- ✅ PRAGMA statement removal
- ✅ Date/time function conversion (datetime → NOW())
- ✅ JSON function conversion (json_extract → JSON_EXTRACT)
- ✅ String function conversion (group_concat → GROUP_CONCAT)
- ✅ Type casting conversion (CAST AS TEXT → CAST AS CHAR)
- ✅ Detailed reporting with line/column information

## Usage

### 1. Migrate SQLite Database to MySQL

#### Basic Migration (with dry-run first - recommended)
```bash
# Preview changes without modifying data
node backend/scripts/sqlite-to-mysql-migrate.js --dry-run

# Execute migration
node backend/scripts/sqlite-to-mysql-migrate.js

# Drop existing tables and recreate (use with caution)
node backend/scripts/sqlite-to-mysql-migrate.js --drop-tables
```

#### Options
- `--dry-run` - Show migration plan without executing (safe to run)
- `--drop-tables` - Drop existing MySQL tables before migration
- `--sqlite-path PATH` - Specify alternate SQLite database location (default: `/var/lib/mysql/_data`)

#### Environment Variables
Configure these in your `.env` or `docker-compose.yaml`:
```env
MYSQL_HOST=db
MYSQL_PORT=3306
MYSQL_USER=stafftrack
MYSQL_PASSWORD=stafftrack_dev_password
MYSQL_DATABASE=stafftrack
```

### 2. Scan and Convert SQLite Code Patterns

#### Basic Scan (read-only)
```bash
# Scan for SQLite patterns without making changes
node backend/scripts/sqlite-to-mysql-patterns.js
```

#### Generate Detailed Report
```bash
# Show detailed report with line numbers and suggestions
node backend/scripts/sqlite-to-mysql-patterns.js --report
```

#### Apply Conversions
```bash
# Automatically convert all SQLite patterns to MySQL
node backend/scripts/sqlite-to-mysql-patterns.js --fix
```

#### Options
- `--dry-run` - Show what would be changed without modifying files
- `--fix` - Apply all conversions to source files
- `--report` - Generate detailed report with all findings

## Example Conversions

### Database Level

#### Before (SQLite)
```sql
PRAGMA foreign_keys = ON;
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- ...
);
```

#### After (MySQL)
```sql
-- PRAGMA removed (MySQL uses FOREIGN_KEY_CHECKS instead)
CREATE TABLE submissions (
  id VARCHAR(255) PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- ...
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Code Level

#### Before (SQLite)
```javascript
import Database from 'better-sqlite3';

db.run('INSERT INTO table VALUES (?)', [value], (err) => {
  if (!err) callback();
});

db.get('SELECT * FROM table WHERE id = ?', (err, row) => {
  if (row) process(row);
});

db.all('SELECT * FROM table', (err, rows) => {
  return rows.filter(r => typeof r.id === 'integer');
});

const formatted = strftime('%Y-%m-%d', created_at);
const extracted = json_extract(data, '$.key');
```

#### After (MySQL)
```javascript
import mysql from 'mysql2/promise';

await db.execute('INSERT INTO table VALUES (?)', [value]);

const row = await db.queryOne('SELECT * FROM table WHERE id = ?');
if (row) process(row);

const rows = await db.query('SELECT * FROM table');
return rows.filter(r => typeof r.id === 'number');

const formatted = DATE_FORMAT(created_at, '%Y-%m-%d');
const extracted = JSON_EXTRACT(data, '$.key');
```

## Docker Usage

### Run in DB Container
```bash
# Migrate data
docker compose exec -w /app backend node scripts/sqlite-to-mysql-migrate.js

# Scan codebase
docker compose exec -w /app backend node scripts/sqlite-to-mysql-patterns.js --fix
```

### Full Migration Workflow
```bash
# 1. Dry-run to verify migration plan
docker compose exec -w /app backend node scripts/sqlite-to-mysql-migrate.js --dry-run

# 2. Execute migration
docker compose exec -w /app backend node scripts/sqlite-to-mysql-migrate.js

# 3. Scan codebase for patterns
docker compose exec -w /app backend node scripts/sqlite-to-mysql-patterns.js --report

# 4. Apply conversions
docker compose exec -w /app backend node scripts/sqlite-to-mysql-patterns.js --fix

# 5. Test application
docker compose up -d
curl http://localhost:3000/health
```

## Troubleshooting

### Migration Issues

#### SQLite Database Not Found
```
❌ SQLite database not found: /var/lib/mysql/_data/submissions.db
```

**Solution:** Check SQLite database location:
```bash
docker compose exec db ls -la /var/lib/mysql/_data/
# Or specify alternate path:
node scripts/sqlite-to-mysql-migrate.js --sqlite-path /path/to/db
```

#### MySQL Connection Failed
```
❌ MySQL connection failed: connect ECONNREFUSED
```

**Solution:** Ensure MySQL is running and credentials are correct:
```bash
docker compose exec db mysql -u stafftrack -p stafftrack_dev_password -e "SELECT 1;"
```

#### Foreign Key Constraint Errors During Migration
```
ER_NO_REFERENCED_ROW: Cannot add or update a child row
```

**Solution:** Either drop tables or disable foreign key checks:
```bash
# Option 1: Drop and recreate
node scripts/sqlite-to-mysql-migrate.js --drop-tables

# Option 2: Disable FK checks before migration (manual)
docker compose exec db mysql -p root_password stafftrack -e "SET FOREIGN_KEY_CHECKS=0;"
# Then re-enable after
docker compose exec db mysql -p root_password stafftrack -e "SET FOREIGN_KEY_CHECKS=1;"
```

### Pattern Conversion Issues

#### No Changes Made with --fix Flag
This usually means no SQLite patterns were detected. Verify:
1. SQLite patterns actually exist in your code
2. Run without `--fix` first to see findings
3. Check `--report` output

#### Unwanted Conversions
```bash
# Use --dry-run to preview changes before applying
node scripts/sqlite-to-mysql-patterns.js --dry-run

# Review the report in detail
node scripts/sqlite-to-mysql-patterns.js --report
```

## Data Verification

After migration, verify data integrity:

```bash
# Connect to MySQL
docker compose exec db mysql -u stafftrack -p stafftrack_dev_password stafftrack

# Check record counts
SELECT 'submissions' as table_name, COUNT(*) as count FROM submissions
UNION ALL
SELECT 'submission_skills', COUNT(*) FROM submission_skills
UNION ALL
SELECT 'submission_projects', COUNT(*) FROM submission_projects
UNION ALL
SELECT 'user_roles', COUNT(*) FROM user_roles
UNION ALL
SELECT 'managed_projects', COUNT(*) FROM managed_projects
UNION ALL
SELECT 'staff', COUNT(*) FROM staff
UNION ALL
SELECT 'projects_catalog', COUNT(*) FROM projects_catalog;

# Check for NULL values in critical fields
SELECT * FROM submissions WHERE id IS NULL OR staff_email IS NULL LIMIT 1;

# Verify foreign keys
SELECT COUNT(*) FROM submission_skills WHERE submission_id NOT IN (SELECT id FROM submissions);
```

## Script Details

### sqlite-to-mysql-migrate.js

**Purpose:** Complete database migration from SQLite to MySQL

**Key Functions:**
- `extractAndConvertSchema()` - Extracts SQLite schema and generates MySQL CREATE TABLE statements
- `convertDataType()` - Maps SQLite types to MySQL equivalents
- `migrateData()` - Migrates data with automatic value conversion

**Performance:**
- Batch insertion: 1000 records per batch
- Foreign key handling: Automatically converted
- Error handling: Continues on errors, reports summary

### sqlite-to-mysql-patterns.js

**Purpose:** Scan and convert SQLite-specific code patterns

**Key Features:**
- 14+ pattern types detected
- Line and column information for each match
- Intelligent grouping and statistics
- Safe dry-run mode before applying fixes

**Patterns Detected:**
1. Library imports (sqlite3, better-sqlite3)
2. Callback patterns (db.run, db.get, db.all)
3. PRAGMA statements
4. Date/time functions
5. JSON operations
6. Type casting
7. String functions
8. RETURNING clauses

## Performance Considerations

### Migration Speed
- **Small databases (<10K records):** ~5-10 seconds
- **Medium databases (10K-1M records):** ~30 seconds - 5 minutes
- **Large databases (>1M records):** Use batch processing, consider splitting

### Optimization Tips
1. Run migration during low-traffic periods
2. Use `--dry-run` first to estimate time
3. Monitor MySQL logs during migration: `docker compose logs -f db`
4. Increase `connectionLimit` in config if needed
5. Index creation may be slow - add indexes after data migration

## Best Practices

1. **Always dry-run first:**
   ```bash
   node scripts/sqlite-to-mysql-migrate.js --dry-run
   ```

2. **Backup before migration:**
   ```bash
   # SQLite backup
   docker compose exec db cp /var/lib/mysql/_data/submissions.db /var/lib/mysql/_data/submissions.db.backup
   
   # MySQL backup
   docker compose exec db mysqldump -u stafftrack -p stafftrack_dev_password stafftrack > backup.sql
   ```

3. **Test code conversions in development first:**
   ```bash
   # Run on feature branch
   # Make sure all tests pass after conversion
   npm test
   ```

4. **Verify data after each step:**
   - Check record counts match
   - Verify no NULL values in critical fields
   - Test API endpoints work correctly

5. **Monitor application logs:**
   ```bash
   docker compose logs -f backend
   ```

## Related Skills

- **db-record-check** - Verify record counts across MySQL tables
- **api-data-validation** - Test API endpoints after migration

## Files Modified

After running `--fix`, the following files may be modified:
- All `.js` files in `backend/src/`
- Pattern replacement details available in migration report

## Rollback Procedure

If migration fails:

```bash
# 1. Stop the application
docker compose down

# 2. Restore SQLite backup (if needed)
docker compose exec db cp /var/lib/mysql/_data/submissions.db.backup /var/lib/mysql/_data/submissions.db

# 3. Restore MySQL backup (if available)
docker compose exec db mysql -u stafftrack -p stafftrack_dev_password stafftrack < backup.sql

# 4. Restart application
docker compose up -d

# 5. Investigate issues
docker compose logs backend
```

## Support

For detailed migration troubleshooting:
1. Check migration report: `node scripts/sqlite-to-mysql-migrate.js --dry-run`
2. Review pattern scan: `node scripts/sqlite-to-mysql-patterns.js --report`
3. Check application logs: `docker compose logs backend`
4. Verify MySQL connectivity: `docker compose exec db mysql -p root_password -e "SELECT 1;"`

## Testing

Run automated tests after migration:

```bash
# Unit tests
npm test

# API validation
node scripts/api-data-validation.js

# Database checks
node scripts/db-record-check.js
```

---

**Last Updated:** 2026-04-05
**Version:** 1.0.0
