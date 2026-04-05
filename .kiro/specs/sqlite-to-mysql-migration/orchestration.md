# SQLite to MySQL Migration - Orchestration & Governance

## Executive Summary

This document defines how the SQLite to MySQL migration will be coordinated across teams, how risks will be managed, how stakeholders will be kept informed, and how decisions will be made. The orchestrator (migration lead) uses this document to maintain control and visibility throughout the project lifecycle.

---

## Part 1: Project Governance & Organizational Structure

### 1.1 Decision-Making Authority & Escalation

```
┌─────────────────────────────────────────────────────┐
│ STEERING COMMITTEE (Final Authority)                │
│ • CTO / Tech Lead                                   │
│ • DevOps Manager                                    │
│ • Product Manager (StaffTrack)                      │
│ • Meets: Weekly, or on escalation                   │
│                                                      │
│ Decisions: Go/no-go, major scope changes,           │
│ budget/timeline extensions, risk acceptance         │
└────────────┬────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│ ORCHESTRATOR (Project Lead) - Central Hub            │
│ • Migration Lead (1 person)                         │
│ • Responsible for approval of task execution        │
│ • Escalates blockers to Steering Committee          │
│ • Daily accountability for timeline                 │
│ • Single point of project status                    │
└────────────┬────────────────────────────────────────┘
             │
    ┌────────┼──────────┬──────────┬────────────┐
    │        │          │          │            │
    ▼        ▼          ▼          ▼            ▼
  ┌──┐   ┌──────┐   ┌────┐   ┌────────┐   ┌─────┐
  │QA│   │DevOps│   │Back│   │   TW   │   │Infra│
  │  │   │ Mgr  │   │End │   │(Writer)│   │ Eng │
  └──┘   └──────┘   └────┘   └────────┘   └─────┘
  (QA    (Schema   (Coding)  (Docs)       (MySQL)
  Lead)  + Config)
```

### 1.2 Roles & Responsibilities

| Role | Responsibilities | Escalation Authority |
|------|------------------|----------------------|
| **Orchestrator (Migration Lead)** | Daily check-ins, approve phase transitions, manage risks, communicate status | Steering Committee |
| **DevOps Manager** | MySQL infra, backup strategy, monitoring, production cutover | Orchestrator → Steering Committee |
| **Backend Lead** | Code changes, testing, script development | Orchestrator |
| **QA Lead** | Verification scripts, data validation, testing | Orchestrator |
| **Infra Engineer** | MySQL setup, Docker changes, CI/CD integration | DevOps Manager |
| **Tech Writer** | Runbooks, documentation | Orchestrator |
| **On-Call Engineer** | Production support during cutover (24h) | DevOps Manager |

### 1.3 Communication Cadence

| Frequency | Meeting | Attendees | Agenda |
|-----------|---------|-----------|--------|
| **Daily** | 15 min standup | Orchestrator + all leads | Blockers, today's progress, risks |
| **Weekly** | 1h status review | Orchestrator + Steering Committee | Phase completion, metrics, budget/timeline |
| **Before Phase 2** | Architecture review | Steering Committee + Architect | Sign-off on design, ADRs, risk acceptance |
| **Before Phase 3** | Production readiness | DevOps + Orchestrator | Operability, runbooks, monitoring |
| **Before Phase 4** | PRE-CUTOVER (T-2h) | Full team | Final checklist, go/no-go decision |
| **During Phase 4** | LIVE WAR ROOM | On-call + DevOps + Infra | Second-by-second status, immediate issue escalation |
| **After Phase 4** | 24-hour check-in | Orchestrator + Ops | Validation, incident review, metrics |
| **Post-project** | Lessons learned | Full team | What went well, improvements, documentation |

---

## Part 2: Risk Management & Mitigation

### 2.1 Risk Register

#### Risk 1: Data Loss During Migration
**Likelihood:** Low | **Impact:** Critical | **Overall Risk:** HIGH

| Element | Details |
|---------|---------|
| **Description** | Data corruption, incomplete copy, FK violations → data loss |
| **Probability** | 5% (assuming QA testing, but bugs in custom scripts) |
| **Impact if occurs** | Total business impact (need restore from backup) |
| **Detection Point** | Verify script (Task 2.4) should catch this |
| **Mitigation** | Multi-level validation: row counts, checksums, spot checks, FK verification |
| **Contingency** | Restore from fresh backup + rollback to SQLite |
| **Owner** | QA Lead |
| **Monitoring** | Verification script must pass 100% checks; no warnings |

---

#### Risk 2: Performance Degradation in Production
**Likelihood:** Medium | **Impact:** High | **Overall Risk:** HIGH

| Element | Details |
|---------|---------|
| **Description** | MySQL slow queries → user-facing latency increase |
| **Probability** | 25% (query patterns may differ between SQLite and MySQL) |
| **Impact if occurs** | Users notice slow UI, report issues, potential SLA breach |
| **Detection Point** | Real User Monitoring (RUM) dashboards, application error rates |
| **Mitigation** | Load testing (Task 2.3), index optimization before cutover, warm-up queries |
| **Contingency** | Immediate rollback if p95 latency > 2x SQLite baseline |
| **Owner** | Backend Lead + DevOps |
| **Monitoring** | Continuous monitoring of: query times, slow log, connection pool usage |

---

#### Risk 3: MySQL Connection Pool Exhaustion
**Likelihood:** Low | **Impact:** High | **Overall Risk:** MEDIUM

| Element | Details |
|---------|---------|
| **Description** | Too many simultaneous requests → all 20 connections consumed → new requests queued/timeout |
| **Probability** | 10% (if load testing not thorough or actual traffic spikes) |
| **Impact if occurs** | New requests fail with "Connection limit reached" → 503 errors |
| **Detection Point** | Alert when active connections > 15 for 30 seconds |
| **Mitigation** | Load testing under peak conditions, proper connection pool sizing, idle connection cleanup |
| **Contingency** | Auto-scale: increase pool size to 30 (if resources allow) or trigger load shedding (reject new requests gracefully) |
| **Owner** | DevOps Manager |
| **Monitoring** | Alert: `active_connections > 15`, `failed_connection_attempts > 1/min` |

---

#### Risk 4: Rollback Takes Too Long / Fails
**Likelihood:** Low | **Impact:** High | **Overall Risk:** MEDIUM

| Element | Details |
|---------|---------|
| **Description** | Rollback procedure takes > 30 min or encounters errors → migration not reversible |
| **Probability** | 5% (if rollback not tested before production) |
| **Impact if occurs** | Stuck with broken MySQL setup; users offline for extended period |
| **Detection Point** | Rollback procedure must be tested in staging (Task 2) |
| **Mitigation** | Dry-run rollback on staging, document exact steps, have on-call ready |
| **Contingency** | If rollback fails: restore SQLite from fresh backup, restart app → instant recovery |
| **Owner** | DevOps Manager |
| **Monitoring** | During cutover, rollback should complete in < 10 minutes; if > 15 min, escalate immediately |

---

#### Risk 5: Environment Variables / Secrets Not Configured
**Likelihood:** Medium | **Impact:** High | **Overall Risk:** MEDIUM

| Element | Details |
|---------|---------|
| **Description** | MySQL credentials not in vault, connection string malformed, wrong env loaded |
| **Probability** | 20% (common in infrastructure changes) |
| **Impact if occurs** | App fails to start or connects to wrong database |
| **Detection Point** | Health check fails at app startup |
| **Mitigation** | Pre-production validation checklist (Task 3.2), secrets audit 48h before cutover |
| **Contingency** | Rollback to SQLite (no env var changes needed) |
| **Owner** | Infra Engineer |
| **Monitoring** | App startup logs must show correct MySQL host/database |

---

#### Risk 6: Unplanned Downtime Due to MySQL Crash
**Likelihood:** Very Low | **Impact:** Critical | **Overall Risk:** MEDIUM

| Element | Details |
|---------|---------|
| **Description** | MySQL process dies, runs out of memory, or disk full → database unavailable |
| **Probability** | 2% (standard SLA for managed MySQL) |
| **Impact if occurs** | All app queries fail → total application down |
| **Detection Point** | Health check fails, MySQL SHOW PROCESSLIST returns no connection |
| **Mitigation** | Proper resource provisioning, monitoring for disk/memory exhaustion, automated alerting |
| **Contingency** | Auto-restart MySQL (via supervisor/systemd), or fail-back to cached SQLite copy (if within sync window) |
| **Owner** | DevOps Manager |
| **Monitoring** | Alert: `mysql_uptime < expected`, `disk_usage > 90%`, `memory_usage > 90%` |

---

#### Risk 7: Compliance / Audit Trail Lost
**Likelihood:** Low | **Impact:** High | **Overall Risk:** MEDIUM

| Element | Details |
|---------|---------|
| **Description** | Historical audit logs or compliance data lost, cannot demonstrate GDPR/SOX compliance |
| **Probability** | 5% (if audit log table not migrated correctly) |
| **Impact if occurs** | Compliance violation, potential fines, customer trust damage |
| **Detection Point** | Audit log row count validation (Task 2.4) + legal review before cutover |
| **Mitigation** | Explicit audit table migration verification, legal review of data retention policy |
| **Contingency** | Restore audit log from SQLite backup (kept for 90 days post-migration) |
| **Owner** | Orchestrator + Legal |
| **Monitoring** | Verify auth_audit_log has same row count pre/post migration |

---

#### Risk 8: Timezone Issues Cause Timestamp Corruption
**Likelihood:** Low | **Impact:** Medium | **Overall Risk:** MEDIUM

| Element | Details |
|---------|---------|
| **Description** | SQLite timestamps in one timezone, MySQL in another → 8-hour offset in data |
| **Probability** | 8% (common issue in database migrations) |
| **Impact if occurs** | Reports show wrong submission times, SLA calculations off |
| **Detection Point** | Data validation checks timestamp consistency (Task 2.4) |
| **Mitigation** | Ensure MySQL and application both set to UTC; validate timestamps against SQLite export |
| **Contingency** | Re-run migration with correct timezone; timestamps can be bulk-updated if needed |
| **Owner** | Backend Lead + QA |
| **Monitoring** | Verify: `SELECT NOW()` on MySQL = UTC; app logs show UTC times |

---

### 2.2 Risk Monitoring Dashboard

**Orchestrator maintains this during each phase:**

| Phase | Risk to Watch | Green Flag | Red Flag | Action |
|-------|---------------|-----------|----------|--------|
| **Phase 1** | Schema conversion bugs | All DDL creates without error | Any SQL parse error | Revert, fix, retry |
| **Phase 2** | Data loss | Row count match, FK validation passes | Mismatched rows or FK violations | Halt phase 2, investigate |
| **Phase 2** | Performance regression | p95 < 200ms, no slow queries | p95 > 200ms or slow queries found | Fix indexes, re-run perf test |
| **Phase 3** | Env var misconfiguration | App logs show MySQL connection | Connection refused or wrong database | Check env vars, rollback if production |
| **Phase 4** | Production MySQL crash | MySQL uptime stable, connection pool healthy | Any restart or connection errors | Escalate immediately |
| **Phase 4** | Rollback works | Revert to SQLite succeeds in < 10 min | Rollback takes > 15 min or fails | Critical incident - escalate |

---

## Part 3: Stakeholder Communication Plan

### 3.1 Communication Timeline

```
T-4 weeks:  Announce migration to all stakeholders (blog post, meeting)
T-3 weeks:  Architecture review sign-off
T-2 weeks:  Staging migration dry-run complete
T-1 week:   Operations ready (monitoring, runbooks, team trained)
T-2 days:   Production cutover window published; users notified
T-2 hours:  Final pre-migration checklist
T-1 hour:   Deploy read-only banner to UI
T (cutover):Application offline (planned maintenance)
T+30 min:   Application switches to MySQL
T+6 hours:  Status update email to stakeholders: "Migration successful"
T+24 hours: Full post-migration report
T+1 week:   Lessons learned published
```

### 3.2 Messaging by Audience

#### **Executive Stakeholders (CTO, Product Lead, Org Leaders)**
**Cadence:** Weekly status email + steering committee meetings  
**Template:**
```
SUBJECT: StaffTrack MySQL Migration - Week X Status

[Green/Yellow/Red Dashboard]

PROGRESS:
- Phase 1 (Prep): ████████░░ 80% complete
- Phase 2 (Staging): ░░░░░░░░░░ 0% (scheduled Week 3)

KEY METRICS:
- On budget: ✓ (29 person-hours, 15 used)
- On schedule: ✓ (2 weeks ahead)
- Quality: ✓ (zero defects found in staging, 100% data validation)
- Risk level: MEDIUM (Connection pool exhaustion risk under monitoring)

NEXT STEPS:
- Complete Phase 2 dry-run (Week 3)
- Steering committee sign-off before production cut (Week 4)
- Production cutover scheduled: [Date, 2-3 AM]

BLOCKERS: None

Questions? Slack: #migration-chat
```

#### **Engineering Team (DevOps, Backend, QA)**
**Cadence:** Daily 15-min standup + detailed task updates  
**Template:**
```
TASK: Export SQLite Data
STATUS: In Progress (80% complete)
OWNER: @backend_dev
BLOCKER: None
NEXT: Complete validation, commit to exports/ folder (by EOD today)

EXPECTED OUTPUT:
- exports/schema.sql (CREATE TABLE statements)
- exports/data.json (all rows from all tables)
- exports/row_counts_before.json (baseline for verification)
```

#### **Operations / On-Call Team**
**Cadence:** Weekly deep-dive + T-7 days operational readiness review  
**Template:**
```
RUNBOOK UPDATES FOR MYSQL:
1. Health check: curl http://app:3000/health (should show "db": "mysql")
2. Emergency rollback: Set USE_MYSQL=false in .env, restart app (10 min)
3. MySQL slow queries: tail -f /var/log/mysql/slow.log
4. Connection pool status: docker exec backend nc -zv mysql 3306
5. Restore from backup: mysql < backup_2026-04-04.sql (15 min)

MONITORING DASHBOARD:
- MySQL connection pool dashboard: [Grafana link]
- Error rate dashboard: [DataDog link]
- Alerts set for: p95 latency > 200ms, active connections > 15, disk > 90%

CUTOVER DAY (April 4, 2-3 AM):
- On-call ready: [name, phone]
- War room channel: #postgresql-cutover [should be #mysql-cutover]
- Rollback procedure tested: ✓
```

#### **Users / General Staff**
**Cadence:** Announcement 2 days before; banner during maintenance  
**Template (Email):**
```
SUBJECT: Scheduled Database Maintenance - April 4, 2:00-3:00 AM

Dear StaffTrack Users,

We're performing a scheduled maintenance upgrade to improve system performance and reliability. During this time, StaffTrack will be temporarily offline.

MAINTENANCE WINDOW: April 4, 2:00 AM - 3:00 AM UTC
EXPECTED IMPACT: ~45 minutes offline
ACTIONS NEEDED: None - please resume work when the system comes back online

Thank you for your patience!

— StaffTrack Engineering Team
```

**Banner (during maintenance):**
```
System Maintenance in Progress
We're upgrading our database for better performance. 
Back online by 3:00 AM. Thanks for your patience!
```

---

## Part 4: Change Management Procedures

### 4.1 Code Review & Approval Process

**For all code changes related to migration:**

1. **Create feature branch:** `feature/mysql-migration-{phase}-{task}`
2. **Code development** in that branch
3. **Internal testing** by task owner (dev, unit tests)
4. **Code review** by peer engineer (30 min)
5. **Automated testing** in CI/CD (must pass)
6. **QA testing** if applicable (integration tests)
7. **Merge approval** by Backend Lead (final OK)
8. **Merge to main** and deploy to staging
9. **Staging validation** for 24 hours
10. **Release notes** documenting changes
11. **Production deployment** (rolling restart, zero downtime)

**Code freeze:** 48 hours before production cutover (no new changes beyond emergency fixes)

### 4.2 Database Schema Changes

**All DDL changes follow this procedure:**

1. **Design review**: architect examines schema change, approves before implementation
2. **Development**: Create schema in development MySQL
3. **Testing**: Verify schema with data, test queries, check performance
4. **Staging**: Apply schema to staging database, full regression test
5. **Documentation**: Update schema documentation, ADRs if affected
6. **Production**: Apply during cutover window (single atomic set of CREATE TABLE statements)

**No schema changes allowed after Monday T-2 days (production cutover window Friday).**

### 4.3 Rollback Authority & Criteria

**Who can initiate rollback:**
- Orchestrator (migration lead)
- DevOps Manager
- On-call engineer (if critical incident)

**Automatic rollback criteria:**
- Migration script fails verification (row count mismatch)
- Production MySQL fails to start or cannot be reached
- Connection pool exhaustion (active_connections > 20)
- Error rate > 10% above baseline (immediate rollback)

**Manual assessment criteria:**
- User reports significant slowness (> 5 complaints in 30 min)
- Data inconsistency detected (FK violations, NULL where should exist)
- Memory/disk exhaustion on MySQL (> 90%)

**Rollback decision window:** Must decide within 30 minutes of cutover. After 30 min, assess stability for 2 more hours before deciding (avoid flip-flopping).

---

## Part 5: Contingency Planning & Incident Response

### 5.1 Incident Severity Levels

| Severity | Definition | Response | Escalation |
|----------|-----------|----------|-----------|
| **CRITICAL** | Data loss, application down, security breach | Immediate rollback assessment (5 min) | Orchestrator → CTO |
| **HIGH** | Performance degradation > 50%, errors > 5%, incomplete migration | Immediate investigation + decision (15 min) | Orchestrator → Steering Committee |
| **MEDIUM** | Performance degradation < 50%, warnings in logs, isolated errors | Investigate and fix (1 hour) | Orchestrator checks-in |
| **LOW** | Minor issues, documentation needed, non-urgent fixes | Schedule fix in next phase | Record for post-mortem |

### 5.2 Incident Response Runbook

**IF: Row Count Mismatch Detected (Data Loss Risk)**
```
Severity: CRITICAL
Detection: Task 2.4 verification script fails
Response Timeline:
  T+0min:  Orchestrator and QA lead notified
  T+2min:  Immediate investigation: which table has mismatch?
  T+5min:  Decision: Fix migration script vs. Rollback
  T+10min: Execute decision (either re-run migration or rollback)
  
Resolution Path A (Migration Script Bug):
  1. Identify missing rows in MySQL table
  2. Investigate why they weren't inserted
  3. Fix script (e.g., batch size too small, timeout issue)
  4. Clear MySQL table (TRUNCATE)
  5. Re-run migration with fix
  6. Re-run verification
  7. If successful: proceed to Task 2.5
  8. If still fails: → Response Path B (Rollback)

Resolution Path B (Rollback):
  1. Orchestrator calls rollback (see Task 3.5)
  2. Set USE_MYSQL=false in .env
  3. Restart application
  4. Verify health check shows SQLite
  5. Notify stakeholders: "Migration delayed, retrying next week"
  6. Post-mortem to identify script bug
```

**IF: MySQL Connection Refused**
```
Severity: CRITICAL
Detection: Application cannot start or connection pool reports 0 connections
Response Timeline:
  T+0min:  DevOps checks MySQL service: docker-compose ps, mysql -u root -p -e "SELECT 1"
  T+2min:  If MySQL is down → Restart MySQL (docker restart)
  T+4min:  Check logs: docker logs mysql (look for corruption or disk full)
  T+10min: If MySQL cannot recover → restore from backup or rollback to SQLite
  
Remediation:
  Step 1: Check MySQL is running
    docker-compose ps | grep mysql
    # Should show: mysql RUNNING
  
  Step 2: Check MySQL is accessible
    mysql -h mysql -u stafftrack_user -p stafftrack -e "SELECT 1"
    # Should show: | 1 |
  
  Step 3: Check app can connect
    docker logs backend | grep "mysql"
    # Should show: connected to mysql:3306
  
  Step 4: If all passes, restart app
    docker-compose restart backend
  
  Step 5: If MySQL won't restart, rollback to SQLite (Task 3.5)
```

**IF: Error Rate Spikes to > 10%**
```
Severity: HIGH
Detection: Monitoring alert triggered; user reports errors in Slack
Response Timeline:
  T+0min:  DevOps acknowledged alert, checking dashboards
  T+2min:  Identify error type (connection error? query timeout? FK violation?)
  T+5min:  Orchestrator decides: investigate further vs. immediate rollback
  
Decision Logic:
  IF error is "Connection refused":
    → Likely MySQL crash → Check MySQL status → Rollback if cannot recover
  
  ELSE IF error is "FOREIGN KEY constraint failed":
    → Likely data corruption in migration → Investigate which table
    → If fixable: TRUNCATE table, re-migrate, verify
    → If not fixable: Rollback
  
  ELSE IF error is "Query timeout (>30s)":
    → Likely performance regression → Check slow log
    → If > 10 slow queries: Rollback + add indexes
    → If < 10: Investigate specific query + optimize
  
  ELSE:
    → Investigate root cause (may be unrelated to migration)
    → Monitor error rate for 5 min more
    → If stabilizes: Continue
    → If worsens: Rollback
```

**IF: Rollback Fails**
```
Severity: CRITICAL (indicates system instability)
Detection: rollback script hangs or errors
Response Timeline:
  T+0min:  Rollback initiated but stalls
  T+5min:  Escalate to CTO + full ops team
  T+10min: Manual intervention: restore SQLite from backup
  
Emergency Recovery:
  1. Stop all application containers
    docker-compose stop backend
  
  2. Restore SQLite from pre-migration backup
    cp /backups/submissions-pre-migration.db /data/submissions.db
  
  3. Set env var (if not set): USE_MYSQL=false
  
  4. Restart application
    docker-compose start backend
  
  5. Verify health (should show SQLite not MySQL)
    curl http://localhost:3000/health
    # Should show: "db": "sqlite"
  
  6. Application should be back online within 5 minutes
  
  Post-Incident:
  - Why did rollback fail? (MySQL crashed? Config issue?)
  - Communicate to users: "We've reverted to previous database, investigating"
  - Schedule post-mortem for same day
```

---

## Part 6: Orchestrator Checklist

### Pre-Migration Checklist (T-2 days)

- [ ] **Architecture Sign-Off**
  - [ ] Architect.md reviewed and approved by Tech Lead
  - [ ] ADRs understood by team
  - [ ] Risk register reviewed; mitigation plans in place
  
- [ ] **Code Readiness**
  - [ ] All Phase 1-3 code merged to main
  - [ ] Code freeze enforced (no new changes)
  - [ ] Staging fully tested; zero known defects
  - [ ] Release notes prepared
  
- [ ] **Infrastructure Readiness**
  - [ ] Production MySQL provisioned and tested
  - [ ] Backups configured and tested (restore successful)
  - [ ] Monitoring dashboards operational
  - [ ] Alerts configured (connection pool, disk, memory, slow queries)
  - [ ] Network connectivity verified (app can reach MySQL)
  
- [ ] **Documentation & Training**
  - [ ] Runbooks written and reviewed
  - [ ] Operations team trained on rollback procedure
  - [ ] On-call engineer assigned and briefed
  - [ ] Incident response procedures posted in war room channel
  
- [ ] **Stakeholder Communication**
  - [ ] Executive steering committee sign-off obtained
  - [ ] User notification (email + in-app banner scheduled)
  - [ ] Support team trained to respond to issues
  - [ ] Escalation contacts verified
  
- [ ] **Final Validation**
  - [ ] Environment variables audited (no hardcoded secrets)
  - [ ] Rollback procedure dry-run completed successfully
  - [ ] Verification scripts tested against production-like data
  - [ ] MySQL-to-SQLite data comparison done (spot check 10% of data)

**Go/No-Go Decision:** Orchestrator + CTO must sign-off on this checklist.

---

### Cutover Day Checklist (T-2 hours)

**2 hours before cutover:**
- [ ] War room channel created: #mysql-cutover
- [ ] All team members logged into war room channel
- [ ] On-call engineer has runbook printed/downloaded
- [ ] Orchestrator has decision authority documented (email from CTO)
- [ ] Health check script ready: `curl http://localhost:3000/health`

**1 hour before cutover:**
- [ ] Fresh SQLite backup taken: `cp /data/submissions.db /backups/submissions-pre-cutover-final.db`
- [ ] Verify backup restored successfully to test database
- [ ] MySQL verified online and accessible: `mysql -h mysql -u stafftrack_user -p -e "SELECT 1"`
- [ ] Export from SQLite completed: `node scripts/export-sqlite.js`
- [ ] All export files generated: schema.sql, data.json, row_counts_before.json
- [ ] DDL conversion completed: `node scripts/convert-ddl.js` → schema_mysql.sql
- [ ] Schema creation script tested on test database (successful)
- [ ] Data migration script ready: `scripts/migrate-data.js`
- [ ] Verification script ready: `scripts/verify-migration.js`
- [ ] Monitoring dashboard open in Grafana (CPU, memory, connections, error rate)
- [ ] Slow query log enabled on MySQL: `SET GLOBAL slow_query_log = 'ON'`

**30 minutes before cutover:**
- [ ] Application placed in read-only mode (UI banner: "Maintenance")
- [ ] Verify no new writes to database for 2+ minutes (check with business)
- [ ] War room ready: Orchestrator, DevOps Manager, Backend Lead, On-Call, QA Lead
- [ ] Final checklist items confirmed (all green)

**Cutover begins (T = 0):**
1. [ ] Record start time in war room
2. [ ] Execute Phase 3: `node scripts/convert-ddl.js`
3. [ ] Execute Phase 3: `mysql < exports/schema_mysql.sql` (create tables)
4. [ ] Record current time (schema creation completed)
5. [ ] Execute Phase 3: `node scripts/migrate-data.js --target production`
6. [ ] Record current time (data migration completed)
7. [ ] Execute Phase 3: `node scripts/verify-migration.js --target production`
8. [ ] Review verification_report.json - all tables PASS?
   - [ ] YES → Continue to step 9
   - [ ] NO → Execute rollback (Task 3.5) + post-incident review
9. [ ] Update application: `USE_MYSQL=true` in .env
10. [ ] Restart application: `docker-compose restart backend`
11. [ ] Wait 30 seconds, then check health: `curl http://localhost:3000/health`
    - [ ] Response shows `"db": "mysql"` → SUCCESS, proceed
    - [ ] Response shows `"db": "sqlite"` → Config error, troubleshoot
    - [ ] No response / timeout → App crashed, check logs
12. [ ] Disable read-only mode (remove UI banner)
13. [ ] Record cutover completion time

**Post-Cutover (T+6 hours):**
- [ ] Monitor error rate (should be < 1%)
- [ ] Monitor latency (p95 should match pre-migration baseline)
- [ ] Run spot checks: create CV submission, view reports, generate project report
- [ ] Send status email to stakeholders: "Migration successful - see metrics at [link]"
- [ ] Declare "stable" if no incidents

**Post-Cutover (T+24 hours):**
- [ ] Still stable? Run final verification script again
- [ ] Generate post-migration report (see below)
- [ ] Decide: Keep MySQL (success) or investigate issues

---

## Part 7: Post-Migration Support Model

### 7.1 Handoff to Operations (After Phase 4)

**Orchestrator creates runbook package:**
```
/docs/operations/mysql/
├── RUNBOOK.md
│   ├── Health checks
│   ├── Common errors
│   ├── Troubleshooting flowchart
│   ├── Emergency rollback (with exact commands)
│   └── Escalation contacts
├── BACKUP_RESTORE.md
│   ├── Daily backup schedule
│   ├── How to restore from backup
│   ├── Point-in-time recovery (if needed)
│   └── Backup verification (test monthly)
├── MONITORING.md
│   ├── Dashboard links
│   ├── Alert thresholds
│   ├── What each metric means
│   └── When to escalate
├── PERFORMANCE_TUNING.md
│   ├── Current MySQL my.cnf settings
│   ├── How to interpret slow log
│   ├── Index optimization procedure
│   └── When to contact database engineer
└── INCIDENT_RESPONSE.md
    ├── Connection errors: [checklist]
    ├── Slow queries: [checklist]
    ├── Disk full: [procedure]
    ├── Memory exhaustion: [procedure]
    └── Cannot start app: [procedure]
```

**Knowledge transfer sessions:**
- Week 1: On-call engineer shadows DevOps on production troubleshooting
- Week 2: On-call engineer handles all MySQL issues (with DevOps backup)
- Week 3+: On-call engineer responsible; DevOps available for escalation

### 7.2 Post-Migration Support Timeline

| Period | Escalation Level | Response Time | Metrics Tracked |
|--------|------------------|----------------|-----------------|
| **Phase 4 (Week 1)** | Real-time (war room) | Immediate | All dashboards open 24/7 |
| **Week 2** | Elevated (pagerduty) | 15 min | Daily report to CTO |
| **Week 3** | Normal (business hours) | 1 hour | Weekly report to Steering Committee |
| **Week 4+** | Normal | 2 hours | Monthly ops review |

**Success metrics for handoff:**
- [ ] Zero unplanned outages in week 1
- [ ] P95 latency stable (matches or improves SQLite)
- [ ] Connection pool healthy (< 10 avg, < 15 peak)
- [ ] Error rate < 0.5%
- [ ] On-call team confident handling issues

---

## Part 8: Post-Mortem Template

**After migration complete (T+1 week):**

```markdown
# MySQL Migration Post-Mortem

## Executive Summary
[1 paragraph overview of what went well and what didn't]

## Timeline
- T-0: Cutover began
- T+30min: All tables created and populated
- T+45min: Application switched to MySQL
- T+1h: Monitoring shows normal operation
- [List all significant events]

## Metrics
- Total downtime: 45 minutes (expected: 60 min) ✓
- Data loss: 0 rows ✓
- Performance regression: +5% (acceptable range) ✓
- Error rate post-migration: 0.2% (baseline: 0.1%) ✓

## What Went Well
1. [Aspect of migration that succeeded]
2. [Team coordination, communication]
3. [Testing caught issues before production]

## What Went Poorly
1. [Issue encountered]
   - Root cause: [why it happened]
   - Impact: [how it affected timeline]
   - Resolution: [how it was fixed]

## Action Items
- [ ] Fix [issue] by [date] (Owner: [name])
- [ ] Implement [improvement] by [date] (Owner: [name])

## Lessons Learned
1. [Learning point] - applies to [future projects]
2. [Process improvement] - update [document]
3. [Training gap] - retrain team on [topic]

## Sign-Off
- Orchestrator: _____________________ Date: _____
- CTO: _____________________ Date: _____
```

---

## Part 9: Orchestrator Decision Log

**Orchestrator maintains this log throughout project (decisions recorded in real-time):**

| Date | Decision | Rationale | Owner | Approval |
|------|----------|-----------|-------|----------|
| 2026-03-15 | Use MySQL 8.0 | 5.7 end-of-life, zero cost difference | Tech Lead | CTO ✓ |
| 2026-03-20 | Minimize dual-write logic | Single-step cutover acceptable given rollback plan | Architect | CTO ✓ |
| 2026-03-28 | Extend staging test to 2 weeks | Found connection pool edge case worth stress-testing | QA Lead | Orchestrator ✓ |
| 2026-04-03 | Move cutover from April 3 to April 4 | Waiting on 1 infrastructure dependency | DevOps Manager | Orchestrator ✓ |
| 2026-04-04 | GO for production cutover | All sign-offs complete, zero critical risks | Orchestrator | CTO ✓ |
| [Future] | [Decision] | [Rationale] | [Owner] | [Approval] |

---

## Appendix: Communication Templates

### Email Template: All-Hands Announcement (T-2 weeks)

```
Subject: StaffTrack Database Upgrade Coming April 4
To: all-hands@company.com

Hi Team,

We're excited to announce an important upgrade to the StaffTrack system coming April 4. 
We're migrating from our current SQLite database to MySQL for improved performance and scalability.

WHAT'S HAPPENING:
 - Brief maintenance window: April 4, 2:00-3:00 AM UTC (~45 minutes)
 - Zero data loss (fully backed up)
 - Better performance and stability

WHAT YOU NEED TO DO:
 - Nothing! Please resume work normally after 3:00 AM
 - Any questions? Reach out to #stafftrack-help

Thank you for your patience during this upgrade!

— Engineering Team
```

### Slack Update Template (Daily during project)

```
[Project Status #mysql-migration]

Today's Standup:
✅ Completed:
 - Converted SQLite DDL to MySQL DDL (100 CREATE TABLE statements)
 - Created and tested new application database connection code
 
🔄 In Progress:
 - Data migration script (50% complete, targeting EOD)
 - Verification script (starting tomorrow)

⚠️ Blockers:
 - None currently

📊 Metrics:
 - On schedule: ✓
 - Quality: ✓ (zero critical bugs)
 - Risk level: 🟡 MEDIUM (connection pool testing in progress)

Next: Data migration completion, then Phase 2 dry-run

Questions? Reply in thread!
```

---

## Orchestrator Authority Matrix

**This orchestrator has authority to:**
- ✅ Approve task start/completion
- ✅ Request task re-work if quality insufficient
- ✅ Escalate blockers to steering committee
- ✅ Delay phase transition if not ready
- ✅ Approve small scope changes (< 4 hours extra work)
- ✅ Request additional resources (third-party DBA, additional QA)
- ✅ Require additional testing/validation
- ✅ Make go/no-go decision at phase gates (with steering committee)

**This orchestrator does NOT have authority to:**
- ❌ Change budget/timeline without steering committee
- ❌ Remove safety measures (verification scripts, monitoring)
- ❌ Ignore risk management procedures
- ❌ Merge code without code review
- ❌ Skip staging testing and go straight to production

---

## Success Criteria for Orchestrator

**The orchestrator has successfully orchestrated this migration if:**
1. ✅ Zero unplanned data loss
2. ✅ Downtime < 1 hour
3. ✅ Team morale remains high (no burnout)
4. ✅ Zero security incidents during migration
5. ✅ Post-migration performance meets or exceeds SQLite
6. ✅ Full documentation handed to ops team
7. ✅ Team can execute second migration faster (if needed)

