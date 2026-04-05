# beeSuite Staff Catalog - Orchestration & Governance

## Project Governance

### Decision-Making Authority

```
Tech Lead + HR Manager (Joint Authority)
    ↓
Orchestrator (Integration Product Owner)
    ↓
├─ Backend Lead (Sync script implementation)
├─ HR Partner (Requirements validation)
├─ Data Lead (Database schema & migrations)
└─ DevOps Manager (Vault, scheduling, monitoring)
```

### Role Responsibilities

| Role | Responsibilities | Success Metric |
|------|------------------|-----------------|
| **Orchestrator** | Timeline, vendor communication, conflict resolution | Sync live in 2 weeks |
| **Backend Lead** | Sync script, API integration, error handling | Sync runs daily, zero failures |
| **HR Partner** | Data requirements, reconciliation rules | Staff data matches HRIS 100% |
| **Data Lead** | Schema changes, denormalization, conflict detection | Sync completes < 30sec |
| **DevOps Manager** | API key management, scheduling, monitoring | Sync successful 99.9% |

### Communication Cadence

| Frequency | Meeting | Attendees | Purpose |
|-----------|---------|-----------|---------|
| **2x/week** | Sync planning | Backend Lead + HR Partner + Orchestrator | Conflict resolution, edge cases |
| **Weekly** | Status review | All leads | Progress, risks, timeline |
| **Pre-implementation** | Vendor kickoff | Orchestrator + HR + Vendor (beeSuite) | API access, authentication |

---

## Project Timeline

**Duration:** 2-3 weeks (smaller than analytics)  
**Team Size:** 2-3 FTE  
**Criticality:** HIGH (HR trusts this data)

### Phase 1: Vendor Setup & API Access (Days 1-2)
- ✅ Request API access from beeSuite
- ✅ Receive API credentials (in Vault)
- ✅ Document API endpoints
- ✅ Test API access (simple GET request)

**Deliverable:** Working API credentials + documented endpoints

### Phase 2: Schema & Database Migration (Days 2-4)
- ✅ Design schema changes (staff_hierarchy, sync_log)
- ✅ Write migrations scripts
- ✅ Test migrations on staging
- ✅ Soft-delete strategy documented

**Deliverable:** Schema ready, migrations reversible

### Phase 3: Sync Job Implementation (Days 4-8)
- ✅ Implement basic sync (fetch → upsert)
- ✅ Implement conflict detection
- ✅ Implement error handling
- ✅ Implement org hierarchy sync

**Deliverable:** Sync job running daily successfully

### Phase 4: Validation & Monitoring (Days 8-10)
- ✅ Reconciliation report (compare beeSuite vs. StaffTrack)
- ✅ Monitoring dashboard (sync status, error rates)
- ✅ Alerting rules (sync failures)
- ✅ Runbooks for common issues

**Deliverable:** Confidence in data accuracy

### Phase 5: Production Launch (Days 10-14)
- ✅ Staging dry-run (sync once, verify data)
- ✅ HR approval (data looks correct)
- ✅ Production deployment
- ✅ HR monitoring (first 48 hours)

**Deliverable:** Sync running in production

---

## Risk Management

### Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **beeSuite API slow/unreliable** | Medium (25%) | High | Implement retries + circuit breaker; alerting |
| **Data conflicts (StaffTrack ≠ beeSuite)** | High (40%) | Medium | Conflict detection + admin dashboard for review |
| **Circular org hierarchy** | Low (5%) | Low | Detection + alert; don't update chart |
| **API key exposed in code/logs** | Low (5%) | Critical | Vault-based; never log credentials |
| **Nightly sync takes > 30 minutes** | Low (8%) | Medium | Optimize query; implement pagination if needed |
| **Staff terminated but still appears active** | Medium (20%) | High | Sync catches terminations; mark is_active=0 |
| **Org chart becomes stale** | Low (10%) | Low | Daily refresh; monitoring for sync failures |

---

## Stakeholder Communication

### HR Communication Plan

| Phase | Audience | Message |
|-------|----------|---------|
| **Before start** | HR Manager | "We're syncing with beeSuite for single source of truth" |
| **Week 1** | HR Manager | "API access granted; beginning sync implementation" |
| **Week 2** | HR Manager | "Testing sync; small discrepancies expected (will be resolved)" |
| **Week 3** | HR Manager | "Ready for production; please approve final data" |
| **Post-launch** | HR Manager | "Syncing daily; conflicts flagged for manual review" |

### Conflict Communication

**When data drifts detected (e.g., email changed):**
```
Alert to HR: "Staff #42 email differs:
  beeSuite: alice@newemail.com
  StaffTrack: alice@oldemail.com
  
Action: StaffTrack updated to new email (HRIS is source of truth)
Review: HR should never see this alert (means HRIS already changed)"
```

---

## Data Reconciliation Strategy

### Pre-Launch Dry-Run

1. **Export production data:**
   - StaffTrack export: `SELECT * FROM staff` (200 rows)
   - beeSuite export: API download (200 rows)

2. **Compare:**
   - Check row count (same?)
   - Sample 10 rows (field by field comparison)
   - Identify any discrepancies

3. **HR Review:**
   - "These mismatches found — are they expected?"
   - Document exclusions (e.g., "Contractors in StaffTrack but not HRIS — OK")

4. **Decision:**
   - ✓ Green: Data looks good, proceed
   - ❌ Red: Found unexpected difference, investigate and fix

### Post-Launch Monitoring

**Daily Report (automated):**
```
BEESUITE SYNC REPORT - 2026-04-04

Status: ✓ SUCCESS (synced 287 staff)
Time: 0:15 (15 minutes)
Errors: 0

Data Reconciliation:
  Row count match: 287 = 287 ✓
  Email changes: 2 (updated in StaffTrack)
  Org changes: 5 (managers updated)
  Terminations: 1 (marked inactive)
  New hires: 3 (added to StaffTrack)

Next sync: 2026-04-05 01:00 UTC
```

---

## Conflict Resolution Workflow

**When difference detected:**

```
Difference found: staff.department
  StaffTrack: "IT"
  beeSuite: "Engineering"

Decision Logic:
  ├─ Is field "master data"? (name, email, manager)
  │   → Update StaffTrack (HRIS is source)
  │   → Log change in sync_log
  │   └─ Alert HR admin if > 5 changes
  │
  └─ Is field "StaffTrack-specific"? (submissions, projects)
      → Keep StaffTrack value
      → Log as "conflict, ignored"
      └─ Alert ops for manual resolution
```

---

## Monitoring & Alerting

### Health Checks

**Pre-Sync Validation:**
```bash
# Check 1: Can we reach beeSuite API?
curl -H "Authorization: Bearer $API_KEY" \
  https://api.beesuite.com/v1/employees?limit=1

# Check 2: Is API key valid?
# Response should be 200, not 401 or 403

# Check 3: Are we within rate limit?
# Track: X-RateLimit-Remaining header
```

**Post-Sync Validation:**
```bash
# Check 1: Did sync complete?
SELECT COUNT(*) FROM sync_log WHERE DATE(sync_timestamp) = TODAY();

# Check 2: Were there errors?
SELECT * FROM sync_log WHERE status IN ('partial', 'failed');

# Check 3: Is replica consistent?
SELECT COUNT(*) FROM staff WHERE is_active = 1;  -- Compare to beeSuite
```

### Alert Rules

| Condition | Severity | Action |
|-----------|----------|--------|
| **Sync fails** | Critical | Page on-call; alert HR + DevOps |
| **Replica lag > 10 min** | High | Alert DevOps; investigate |
| **API rate limit hit** | High | Adjust batch size; alert ops |
| **Conflicts > 10** | Medium | Alert HR for review |
| **API key invalid** | Critical | Rotate key; rollback sync to previous state |

---

## Orchestrator Checklist

### Before First Sync

- [ ] **API Access**
  - [ ] beeSuite API credentials received
  - [ ] Credentials stored in Vault (not in .env)
  - [ ] API access tested (simple GET request works)
  - [ ] Rate limits documented

- [ ] **Database**
  - [ ] Schema migration written and tested
  - [ ] Rollback migration tested (can undo schema changes)
  - [ ] Soft-delete strategy documented
  - [ ] Indexes created for sync performance

- [ ] **Sync Job**
  - [ ] Script fetches all fields correctly
  - [ ] Error handling implemented (retries + exponential backoff)
  - [ ] Conflict detection works
  - [ ] Dry-run successful (actual data, no changes to DB)

- [ ] **Monitoring**
  - [ ] sync_log table created and populated
  - [ ] Monitoring dashboard shows sync status
  - [ ] Alerts configured
  - [ ] On-call rotation aware of alerts

- [ ] **HR Sign-Off**
  - [ ] HR reviewed reconciliation report
  - [ ] HR confirmed data looks correct
  - [ ] HR knows how to handle conflicts

### First Production Sync Day

**T-1 hour:**
- [ ] Take fresh backup of staff table
- [ ] Alert HR (sync about to run)

**T (Sync execution):**
- [ ] Monitor sync in real-time (watch logs)
- [ ] Check for errors (should be none)
- [ ] Verify row count matches

**T+1 hour:**
- [ ] Reconciliation report generated
- [ ] HR reviews report (any unexpected changes?)
- [ ] Declare success or investigate issues

**T+24 hours:**
- [ ] Verify sync ran at scheduled time (1 AM)
- [ ] Check for any data inconsistencies
- [ ] HR confirms data still looks good

---

## Contingency Plans

### If API Key Compromised

1. Immediately revoke key in beeSuite
2. Request new API key
3. Update Vault secret
4. Restart sync job
5. Review logs for suspicious API calls (audit)

### If Sync Takes > 30 Minutes

1. Check beeSuite API performance
2. Check MySQL performance (slow queries?)
3. **Options:**
   - Implement pagination (fetch 100 at a time, not all)
   - Implement incremental sync (only recent changes)
   - Schedule sync at less busy time
4. Monitor to prevent timeout

### If Data Corruption Found

1. Immediately pause sync (stop cron job)
2. Investigate what went wrong
3. Restore from backup
4. Fix root cause
5. Test on staging before re-enabling

### If User Reports Staff Missing

1. Check if synced (in sync_log for today)
2. If synced: Check if is_active=0 (marked inactive)
3. If missing: Check beeSuite (maybe not in HRIS)
4. Resolution: Update beeSuite or reactivate in StaffTrack

---

## Post-Launch Support

### Week 1: Active Monitoring

- Daily checking of sync logs
- HR partner available for conflict resolution
- On-call ready for emergency issues

### Week 2-4: Normal Monitoring

- Daily sync log review (automated report)
- Weekly HR check-in
- On-call handles alerts

### Ongoing

- Monthly reconciliation report (spot-check 10% of records)
- Quarterly review with HR (any process improvements?)

