---
name: db-record-check
description: 'Check MySQL table record counts for tables related to the api-data-validation skill endpoints. Use when: validating data integrity after migrations, auditing record counts across the system, checking table population before API testing, or verifying data import success.'
arg-hint: 'Optional: specific tables to check (e.g., "submissions staff"), or leave blank for all tables'
---

# Database Record Count Checker

Inspect MySQL table record counts related to StaffTrack API endpoints that are validated by the api-data-validation skill.

## When to Use This Skill

✅ **Use this skill when:**
- Validating data integrity after database migrations
- Auditing record counts across the system
- Checking if tables are populated before running API tests
- Verifying success of data imports (staff, projects, submissions)
- Quick sanity check that data exists in the database
- Investigating discrepancies between expected and actual record counts

❌ **Don't use this skill for:**
- Deep schema inspection (use database admin tools)
- Querying specific records or running complex SQL
- Modifying data (this skill is read-only)
- Performance analysis or query optimization

## Workflow: Check Table Record Counts

### Step 1: Prerequisites
Ensure Docker containers are running:
```bash
docker compose up -d
```

The MySQL database must be accessible on `localhost:3306` or via Docker network on `db:3306`.

### Step 2: Run the Script
Execute the check script:

**Option A: All tables**
```bash
bash .github/skills/db-record-check/scripts/check-records.sh
```

**Option B: Specific tables**
```bash
bash .github/skills/db-record-check/scripts/check-records.sh submissions staff projects_catalog
```

### Step 3: Read the Output
Output shows:
- ✓ Table name: Record count
- Total count across all checked tables
- Human-readable summary

Example:
```
✓ submissions: 142
✓ submission_skills: 1,256
✓ submission_projects: 487
✓ user_roles: 23
✓ managed_projects: 18
✓ staff: 142
✓ projects_catalog: 45
✓ skills_catalog: 127
✓ auth_tokens: 15
✓ auth_audit_log: 342

Total records across tables: 2,597
```

### Step 4: Interpret Results
- **High record counts** (100+): Data is imported and table is in use
- **Low record counts** (0-10): Fresh setup or data not yet imported
- **Zero records**: Table exists but has no data (check import status)
- **Missing tables**: Schema not initialized (run migrations first)

## Related Endpoints

These tables support the following API endpoints (validated by api-data-validation skill):

| Endpoint | Primary Tables | Related Tables |
|----------|---|---|
| `POST /auth/login` | `user_roles`, `auth_tokens` | `auth_audit_log` |
| `GET /submissions` | `submissions` | `submission_skills`, `submission_projects` |
| `GET /submissions/me` | `submissions` | `submission_skills`, `submission_projects` |
| `GET /catalog/staff` | `staff` | — |
| `GET /catalog/projects` | `projects_catalog` | `managed_projects` |
| `GET /admin/roles` | `user_roles` | — |
| `GET /reports/projects` | `managed_projects` | `submission_projects` |

## Configuration

### Environment Variables

Control the database connection:

```bash
# Inside Docker container (default, uses service name)
MYSQL_HOST=db
MYSQL_USER=root
MYSQL_PASSWORD=root_password
MYSQL_DATABASE=stafftrack

# Or connect to external database
MYSQL_HOST=db.example.com
MYSQL_PORT=3306
```

### Custom Table List

Edit `scripts/check-records.sh` to customize which tables are checked:

```bash
# Default tables
TABLES=("submissions" "submission_skills" "submission_projects" "user_roles" "managed_projects" "staff" "projects_catalog" "skills_catalog" "auth_tokens" "auth_audit_log")

# Or specify custom subset
TABLES=("submissions" "user_roles" "staff")
```

## Troubleshooting

**Error: "Can't connect to MySQL server"**
- Verify Docker containers are running: `docker compose ps`
- Check database is healthy: `docker compose logs db`
- Confirm MySQL port 3306 is available

**Error: "Unknown database"**
- Run migrations first: `npm run migrate`
- Check database name in `.env` or Docker compose config

**All tables show 0 records**
- This is normal for fresh setup
- Import staff data: `npm run import:staff`
- It's okay to test API endpoints without full data

## See Also

- [API Data Validation](../api-data-validation/) — Validate the API endpoints
- [Database Migration Guide](../../DATABASE_MIGRATION_GUIDE.md) — Migration procedures
- [Data Backup Quick Ref](../../DATA_BACKUP_QUICK_REF.md) — Backup and restore
