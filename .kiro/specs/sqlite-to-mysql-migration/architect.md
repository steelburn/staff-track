# SQLite to MySQL Migration - Architecture & Decisions

## Executive Summary

This document captures the architectural decisions, system integration points, and strategic rationale for migrating StaffTrack from SQLite to MySQL. It serves as the source of truth for why we made specific choices and how the new architecture supports current and future needs.

---

## Part 1: Architecture Decision Records (ADRs)

### ADR-001: Why MySQL Over Other Solutions?

**Status:** Accepted  
**Date:** April 2026  
**Decision Drivers:**
- Current application requires reliable multi-user concurrency
- SQLite has poor concurrent write performance (exclusive locks)
- StaffTrack will scale to 500+ staff with simultaneous submissions
- Need ACID compliance for critical data (submissions, projects)

**Evaluation Matrix:**
| Criterion | SQLite | MySQL 8.0 | PostgreSQL | MongoDB |
|-----------|--------|-----------|------------|---------|
| Concurrency | 1 (Exclusive) | Excellent | Excellent | Excellent |
| ACID Guarantees | Yes | Yes | Yes | Configurable |
| Operational Complexity | Very Low | Medium | Medium | High |
| Operational Cost | Free | ~$0-100/mo | ~$0-100/mo | ~$500+/mo |
| Team Expertise | None | High | Low | Low |
| Data Integrity | Good | Excellent | Excellent | Lower |
| Backup Ecosystem | Weak | Excellent | Excellent | Excellent |
| Migration Risk | N/A | Low | Medium | High |

**Decision:** MySQL 8.0+ for balance of reliability, cost, and team experience.

**Rejected Alternatives:**
- **PostgreSQL**: Lower team expertise, similar cost, more operational overhead
- **MongoDB**: Document-based model doesn't fit structured staff/project data; higher operational complexity
- **Stay with SQLite + Write Sharding**: Over-engineering; complexity scales with users

---

### ADR-002: MySQL 8.0 vs 5.7

**Status:** Accepted  
**Decision:** MySQL 8.0 (minimum version 8.0.16 for CHECK constraints)

**Rationale:**
- 5.7 reaches end-of-life October 2023 (already past in April 2026)
- 8.0 has better performance, security, native JSON, CHECK constraints
- Deployment cost identical (same as 5.7)
- Zero operational difference

---

### ADR-003: InnoDB Storage Engine

**Status:** Accepted  
**Decision:** InnoDB exclusively, no MyISAM

**Rationale:**
- InnoDB: Full ACID, crash recovery, row-level locking → suitable for financial/compliance data
- MyISAM: No transactions, table-level locking → unsuitable for concurrent staff system
- Cost: Identical
- Performance: InnoDB superior for concurrent writes (our use case)

---

### ADR-004: Character Set & Collation

**Status:** Accepted  
**Decision:** UTF8MB4 charset with utf8mb4_unicode_ci collation

**Rationale:**
- UTF8MB4: Supports emoji, CJK characters (future internationalization)
- UTF8 (3-byte): Only supports BMP; cannot represent emoji or rare characters
- Collation: `utf8mb4_unicode_ci` (case-insensitive) aligns with staff names, emails
- Cost: Negligible storage overhead (~10-15% max)
- Compatibility: Solves mojibake issues with international names

---

### ADR-005: Dual-DB Transition Strategy

**Status:** Accepted  
**Decision:** Feature flag-based gradual rollover (0% → 100%)

```
Phase 1: USE_MYSQL=false (SQLite)
  ↓ (deployment)
Phase 2: USE_MYSQL=false, but MySQL synced (write to both) [NOT IMPLEMENTED]
  ↓ (if issues found, easier rollback)
Phase 3: USE_MYSQL=true, but SQLite read fallback [NOT IMPLEMENTED]
  ↓ (verify stability)
Phase 4: USE_MYSQL=true (MySQL only, SQLite kept for 48h backup)
  ↓ (48h stability check)
Phase 5: USE_MYSQL=true (SQLite deleted, MySQL permanent)
```

**Rationale:**
- Single-step cutover (Phase 4) acceptable because:
  - Data is backed up
  - Rollback is 10 minutes (revert flag + restart)
  - Dual-write greatly increases complexity without proportional safety gain
- Reduces code change surface area
- Faster path to production with acceptable risk

---

### ADR-006: Zero-Downtime During Cutover

**Status:** Accepted with constraints  
**Decision:** Read-only mode (5 min) + restart (1 min) = ~6 min effective downtime

**Rationale:**
- True zero-downtime requires persistent connections/queuing (over-engineering)
- 6-minute accepted maintenance window (scheduled 2-3 AM, low traffic)
- Application gracefully handles brief disconnection (existing connection pooling retry)
- Users see "Maintenance: Back Shortly" message

**Alternative (Rejected):** Blue-green MySQL deployment (requires k8s, not available in this stack)

---

### ADR-007: Backup Strategy

**Status:** Accepted  
**Decision:** Daily snapshots + incremental binary logs

**Design:**
```
Backup Type: mysqldump (logical backup)
Frequency: Daily at 2 AM UTC
Retention: 30 days rolling
Verification: Weekly restore to test DB
RTO (Recovery Time Objective): 15 minutes
RPO (Recovery Point Objective): 24 hours (acceptable, data only)
Location: Off-server (cloud storage or NAS)
```

**Rationale:**
- mysqldump: Human-readable, portable across MySQL versions
- Binary logs: Enable point-in-time recovery (if needed for incident investigation)
- Daily: Balances storage cost vs data loss risk
- 30 days: Sufficient for catch bug-induced corruption within 1 month
- Off-server: Protects against server failure/ransomware

---

### ADR-008: Connection Pooling

**Status:** Accepted  
**Decision:** Connection pool with min=5, max=20 connections

**Rationale:**
```
Max Concurrent Requests (expected): 10-15 simultaneous users
Connections per Request: 1-3 (for complex queries with joins)
Safety Factor: 1.5x (20 / 15 = 1.33)
Minimum Warm Connections: 5 (avoid repeated connection setup overhead)
```

**Behavior:**
- MySQL has 16Mb per-connection memory overhead
- 20 connections × 16MB = 320MB memory (acceptable)
- Pool timeout: 30 sec (prevents stale connections)
- Idle cleanup: 10 min (closes unused connections)

---

### ADR-009: Monitoring & Observability

**Status:** Accepted  
**Decision:** Host-level metrics (CPU, memory, disk) + MySQL-specific metrics + application metrics

**What to Monitor:**

| Category | Metric | Alert Threshold | Tool |
|----------|--------|-----------------|------|
| **Connection Pool** | Active connections | > 15 | MySQL SHOW PROCESSLIST |
| **Connection Pool** | Connection errors | > 1 per min | App logs |
| **Query Performance** | Slow queries (>5s) | Any in prod | MySQL slow log |
| **Data Integrity** | Replication lag (if replica) | > 10 sec | SHOW SLAVE STATUS |
| **Capacity** | Disk usage | > 80% used | MySQL SHOW STATUS |
| **Capacity** | Memory usage | > 75% | OS metrics |
| **Capacity** | InnoDB buffer pool hitrate | < 99% | MySQL InnoDB metrics |
| **Security** | Failed auth attempts | > 5 per hour | MySQL audit log |
| **Availability** | MySQL uptime | any restart | MySQL uptime counter |

---

### ADR-010: Dependency on MySQL Version

**Status:** Accepted  
**Decision:** Pin to MySQL 8.0.16 minimum (latest 8.0.x available at deployment time)

**Rationale:**
- 8.0.16+: CHECK constraint support (used in schema)
- 8.0.20+: Better JSON performance (future-proofing)
- Avoid MySQL 8.0.0-8.0.15: Multiple critical bugs in early releases
- Latest 8.0.x: Security patches, stability

**Deployment Validation:**
```sql
SELECT VERSION();  -- Should be 8.0.16 or later
SHOW ENGINES;      -- InnoDB should be DEFAULT
SHOW VARIABLES LIKE 'default_storage_engine';  -- Should be InnoDB
```

---

## Part 2: System Integration Points

### 2.1 Application Layer Integration

**Current (SQLite):**
```javascript
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const result = db.prepare(sql).run(params);  // Synchronous
```

**New (MySQL):**
```javascript
const pool = await mysql.createPool(config);
const [result] = await pool.execute(sql, params);  // Asynchronous
```

**Integration Changes:**
| Layer | Change | Impact | Mitigation |
|-------|--------|--------|-----------|
| **Database** | Async → Await | All queries must await | Systematic code review |
| **Transactions** | Transaction API | Complex multi-step | Test atomicity thoroughly |
| **Error Handling** | Error codes | SQLite ≠ MySQL errors | Create error mapping layer |
| **Connection** | Pool-based | Max connections enforced | Monitor pool exhaustion |
| **Timezone** | May differ | Timestamps could shift | Ensure MySQL set to UTC |

**Critical Integration Points:**
1. `src/db.js` - Connection initialization
2. `src/dump.js` - Data export (no longer used)
3. `src/restore.js` - Data restore (converts to MySQL)
4. `src/routes/*.js` - All query execution
5. `src/services/*.js` - All business logic with DB calls
6. `src/middleware/*.js` - Auth (MySQL foreign keys matter)

---

### 2.2 Infrastructure Layer Integration

**Docker Compose Stack Change:**
```yaml
# Before
services:
  backend:
    volumes:
      - ./data:/data  # SQLite file

# After
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: stafftrack
      MYSQL_ROOT_PASSWORD: ***
    volumes:
      - mysql_data:/var/lib/mysql
  
  backend:
    depends_on:
      mysql:
        condition: service_healthy
    environment:
      MYSQL_HOST: mysql
      MYSQL_DATABASE: stafftrack
      USE_MYSQL: "true"
    volumes:
      - [] # No more SQLite files
```

**Volume Management:**
- SQLite: Single file `/data/submissions.db`
- MySQL: Docker volume `mysql_data:/var/lib/mysql` (managed by Docker)
- Implication: Backup strategy changes

---

### 2.3 Environment-Specific Configuration

**Development:**
```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=dev_password
MYSQL_DATABASE=stafftrack_dev
USE_MYSQL=true
```

**Staging:**
```env
MYSQL_HOST=staging-mysql.internal
MYSQL_PORT=3306
MYSQL_USER=stafftrack_user
MYSQL_PASSWORD=${VAULT:prod-staging-db-password}
MYSQL_DATABASE=stafftrack_staging
USE_MYSQL=true
```

**Production:**
```env
MYSQL_HOST=prod-mysql-primary.internal
MYSQL_PORT=3306
MYSQL_USER=stafftrack_user
MYSQL_PASSWORD=${VAULT:prod-db-password}
MYSQL_DATABASE=stafftrack
USE_MYSQL=true
```

---

### 2.4 Logging & Audit Integration

**MySQL Audit Requirements:**
```sql
-- Enable audit plugin (MySQL Enterprise) or general log (MySQL Community)
SET GLOBAL general_log = 'ON';  -- Development only (performance impact)
SET GLOBAL log_queries_not_using_indexes = 'ON';  -- Log inefficient queries

-- Application must log:
-- 1. All DDL (CREATE, ALTER, DROP) - done by migration script
-- 2. Authentication (user login/logout) - already tracked in auth_audit_log table
-- 3. Data access patterns (optional, via slow log)
```

**Integration with auth_audit_log:**
- Auth service continues to log via `INSERT INTO auth_audit_log`
- No changes needed (same table definition as SQLite)

---

## Part 3: Migration Architecture - Critical Paths

### 3.1 Data Consistency Model

**During Migration:**
```
Time 0:   T_start (no new writes to SQLite)
Time 1:   Export SQLite → JSON
Time 2:   Create MySQL schema (empty tables)
Time 3:   Copy data SQLite → MySQL (can take minutes)
Time 4:   Verify checksums match (error → rollback)
Time 5:   Switch app: USE_MYSQL=false → true + restart
Time 6:   App online, MySQL live
```

**Consistency Guarantee:**
- Point-in-time consistency at Time 0 (when writes stopped)
- No data loss: SQLite retained as backup for 48 hours
- No corrupted data: Verification checks before app cutover

**Race Condition Prevention:**
- Read-only mode enforced at Time 0
- If verification fails at Time 4: rollback → app restarts → continues with SQLite

---

### 3.2 Fault Tolerance & Recovery

**Single Points of Failure (SPOF):**
| SPOF | Likelihood | Impact | Mitigation |
|------|-------------|--------|-----------|
| **MySQL disk full** | Low | Cannot write, app errors | Monitor disk 80% threshold; pre-size 2x expected |
| **MySQL corrupted innodb** | Very Low | Data unreadable | Daily backups + restore testing |
| **Network partitioned** | Low | App cannot reach MySQL | Connection retry logic (exponential backoff) |
| **Migration script bug** | Medium | Data inconsistent | Extensive testing on staging; verification checks |
| **Power failure mid-migration** | Very Low | Half migrated state | Rollback is clean (skip migration, restart SQLite) |

**Recovery Procedures:**

| Failure Scenario | Detection | Recovery | Time |
|---|---|---|---|
| **Migration incomplete** | Row count mismatch in verify | Run rollback script, restart app | 5 min |
| **MySQL connection lost (during live)** | Connection errors in logs | Check MySQL, run health check, restart app | 2 min |
| **Data corruption detected (48h after)** | Users report wrong data | Restore from daily backup | 15 min + data audit |
| **App logic error (wrong FK values)** | FK constraint error during restore | Fix app code, re-run restore script | 10 min |

---

### 3.3 Dependency Graph: What Blocks What?

```
External Dependencies:
├─ MySQL infrastructure (RDS/Docker)
├─ Network connectivity (app to MySQL)
└─ Backup system (S3/NAS for snapshots)

Internal Dependencies:
├─ Export script requires: SQLite DB access
├─ Convert DDL requires: Export output
├─ Create schema requires: MySQL access + DDL
├─ Verify schema requires: MySQL client + DDL executed
├─ Migrate data requires: JSON export + MySQL schema
├─ Verify data requires: JSON export + Migrated MySQL data
├─ Update app code requires: MySQL driver library
├─ Deploy app requires: App code updated + MySQL env vars
└─ Cutover requires: All above complete + staging validated
```

---

## Part 4: Success Criteria & Acceptance

### 4.1 Pre-Migration Sign-Off Gates

| Gate | Owner | Check | Acceptance Criteria |
|------|-------|-------|-------------------|
| **SQL Gate** | Backend Lead | DDL conversion + schema creation | All 12 tables created, no errors |
| **Data Gate** | QA Lead | Export validation | All tables exported, valid JSON, row counts logged |
| **Integration Gate** | Tech Lead | App code changes + dev test | App starts, connects to MySQL, health check passes |
| **Staging Gate** | DevOps | Full dry-run on staging | Migration succeeds, data verified, performance OK |
| **Ops Readiness Gate** | Ops Manager | Monitoring, backups, runbooks | All systems operational, team trained |
| **Legal/Compliance Gate** | Compliance Officer | Audit trail, data retention, GDPR | Audit log preserved, backup retention policy met |

---

### 4.2 Post-Migration Validation

**Automate These Checks (run hourly for 24 hours):**
```javascript
async function validateMigration24h() {
  const checks = {
    // Data integrity
    submission_count: await query('SELECT COUNT(*) FROM submissions'),
    skill_count: await query('SELECT COUNT(*) FROM submission_skills'),
    
    // Connection health
    activeConnections: await query('SHOW PROCESSLIST'),
    connectionPoolSize: pool.getConnection().pool.length,
    
    // Performance
    slowQueries: await query('SELECT * FROM mysql.slow_log LIMIT 10'),
    
    // Application functionality
    getSampleSubmission: await query('SELECT * FROM submissions LIMIT 1'),
    getForeignKeyViolations: await query(`
      SELECT COUNT(*) FROM submission_skills ss 
      WHERE NOT EXISTS (SELECT 1 FROM submissions s WHERE s.id = ss.submission_id)
    `),
  };
  
  return checks;
}
```

**Manual Checks (performed at T+6h, T+12h, T+24h):**
1. Spot-check user can submit a staff CV (end-to-end)
2. Verify reports generate correctly
3. Check data export still works (now from MySQL)
4. Confirm no error spikes in logs

---

## Part 5: Technical Debt & Future Considerations

### 5.1 Areas of Technical Debt Created

| Debt | Introduced By | Paydown Timeline |
|------|---------------|------------------|
| **Feature flag `USE_MYSQL`** | Dual-write avoidance | Remove 1 week after migration (Phase 4.1) |
| **SQLite code paths retained** | Emergency rollback | Remove 1 week after SQLite deletion (Phase 4.1) |
| **Manual DDL conversion** | Lack of schema migration tool | Implement Flyway/Liquibase in phase 2 (Q3 2026) |
| **Async/await changes** | MySQL requires async | NONE - this is correct |

### 5.2 Opportunities Enabled by Migration

| Opportunity | Timeline | Benefit |
|-------------|----------|---------|
| **Read Replicas** | Q2 2026 (post-migration) | 10x faster reporting queries |
| **Sharding for scalability** | Q3 2026 (100+ staff) | Support 10k staff without refactoring |
| **Real-time full-text search** | Q2 2026 | MySQL FTS on projects/skills |
| **Cluster mode (InnoDB Cluster)** | Q4 2026 | Active-active, automatic failover |
| **Automated backups + PITR** | Q2 2026 | Comply with SLA requirements |

---

## Part 6: Architecture Validation Checklist

**Architect Review (Before Phase 2):**
- [ ] All ADRs reviewed and approved by technical steering committee
- [ ] System integration points documented in runbooks
- [ ] No unmitigated single points of failure
- [ ] Disaster recovery tested (backup restore successful)
- [ ] Performance baseline established (SQLite → MySQL comparison)
- [ ] Rollback procedure practiced in staging
- [ ] Security review completed (credentials management, network access)
- [ ] Capacity planning reviewed (storage, memory, CPU)
- [ ] Compliance requirements documented (audit trail, data retention)

**Go/No-Go Decision:** _Pending approval by Tech Lead + DevOps Manager_

