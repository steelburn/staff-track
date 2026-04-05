# CV Export (PDF/DOCX) - Orchestration & Governance

## Project Governance

### Decision-Making Authority

```
Tech Lead (Final Authority)
    ↓
Orchestrator (Export Feature Lead)
    ↓
├─ Backend Lead (Export API)
├─ Frontend Lead (Download UI)
├─ DevOps Manager (File serving, temporary storage)
└─ QA Lead (Export quality validation)
```

### Role Responsibilities

| Role | Responsibilities | Success Metric |
|------|------------------|-----------------|
| **Orchestrator** | Feature delivery, UX decisions, vendor management | Export live in 2 weeks |
| **Backend Lead** | API endpoint, Puppeteer integration, template rendering | PDF/DOCX generated correctly |
| **Frontend Lead** | Export button/modal UI, format selection, progress messaging | UX smooth, < 5s export |
| **DevOps Manager** | Puppeteer deployment, memory limits, temp file cleanup | Stable, no memory leaks |
| **QA Lead** | Export quality testing (visual fidelity, file validity) | All exports valid |

### Communication Cadence

| Frequency | Meeting | Attendees | Purpose |
|-----------|---------|-----------|---------|
| **3x/week** | Design review | Backend + Frontend + Orchestrator | UX feedback, template design |
| **Weekly** | Status review | All leads | Progress, timeline, risks |
| **Pre-launch** | Quality gate | QA + Orchestrator | Export quality sign-off |

---

## Project Timeline

**Duration:** 2 weeks  
**Team Size:** 2-3 FTE  
**Criticality:** MEDIUM (nice-to-have, not blocking)

### Phase 1: Design & Setup (Days 1-2)
- ✅ Template design (HTML mockups)
- ✅ Puppeteer + docx libraries integrated
- ✅ API endpoint design
- ✅ File serving strategy (temp files, cleanup)

**Deliverable:** Design approved, dependencies installed

### Phase 2: Backend Implementation (Days 2-7)
- ✅ PDF export working (Puppeteer)
- ✅ DOCX export working (docx library)
- ✅ Template rendering (placeholders substituted)
- ✅ Image handling (base64 embedding)
- ✅ Error handling & fallbacks

**Deliverable:** Both formats export correctly

### Phase 3: Frontend Implementation (Days 7-10)
- ✅ Export button/modal UI
- ✅ Template preview
- ✅ Format selection (PDF vs DOCX)
- ✅ Download feedback (progress, success message)

**Deliverable:** Export UI complete, integrated with backend

### Phase 4: Testing & Validation (Days 10-12)
- ✅ Export quality testing (PDF looks right, DOCX editable)
- ✅ Large file handling (100-page CV)
- ✅ Performance testing (export < 5s for typical CV)
- ✅ Permission testing (can't export others' CVs)

**Deliverable:** All tests passed, quality sign-off

### Phase 5: Deployment (Days 12-14)
- ✅ Production deployment
- ✅ Feature flag enabled (gradual rollout)
- ✅ Monitoring active
- ✅ Documentation complete

**Deliverable:** Export feature live to all users

---

## Risk Management

### Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **Puppeteer crashes / memory leak** | Medium (20%) | High | Memory limits; restart daily; monitoring |
| **PDF generation times out (> 10s)** | Low (10%) | Medium | Timeout at 10s; fallback to DOCX; async option |
| **DOCX file invalid / won't open in Word** | Low (5%) | Medium | Test in Word; include error handling |
| **Images not embedding correctly** | Low (8%) | Low | Test with profile photos; compression |
| **User exports someone else's CV** | Low (5%) | Critical | Permission check in API; whitebox tests |
| **Exported file contains outdated data** | Medium (20%) | Low | Fresh generation (no caching); clear timestamp UI |
| **Temporary files not cleaned up** | Low (10%) | Medium | Cron job cleanup; disk space monitoring |

---

## Stakeholder Communication

### User Communication

| Phase | Audience | Message |
|-------|----------|---------|
| **Week 1** | Beta testers (10 staff) | "Try exporting your CV as PDF/DOCX; send feedback" |
| **Week 2** | All staff | "Export feature launching today; download your CV anytime" |

### Support Communication

**New FAQ:**
```
Q: How do I export my CV?
A: Go to your profile → Click "Export CV" → Choose PDF or DOCX

Q: Can I edit the exported DOCX?
A: Yes! DOCX is fully editable in Microsoft Word

Q: Why does my exported PDF look different?
A: Slight differences from web template are normal; Word has layout limitations

Q: How long does export take?
A: Usually < 5 seconds; if takes > 10s, try DOCX instead

Q: Is my personal data in the export safe?
A: Your export file contains only your data; never share with untrusted recipients
```

---

## Deployment Strategy

### Staging Validation (Day Before Launch)

- [ ] PDF exports working (test with 2+ templates)
- [ ] DOCX exports working (test with 2+ templates)
- [ ] Files download correctly to browser
- [ ] File size reasonable (< 5 MB)
- [ ] No error messages
- [ ] Permission check working (can't export others' CVs)

### Production Rollout

```
Day 1 (Monday): Canary (10% of staff)
  └─ Feature flag: EXPORT_CV_ENABLED=10
  └─ Monitor error rate (should be 0)
  └─ Collect feedback from 10%

Day 2 (Tuesday): Expand (50% of staff)
  └─ Feature flag: EXPORT_CV_ENABLED=50
  └─ Monitor performance (export < 5s?)
  └─ Monitor error rate

Day 3+ (Wednesday+): Full rollout (100%)
  └─ Feature flag: EXPORT_CV_ENABLED=100
  └─ Monitor production metrics
  └─ Be ready to rollback if issues
```

---

## Monitoring & Alerting

### Metrics to Track

| Metric | Target | Alert if |
|--------|--------|----------|
| **Export success rate** | 99% | < 95% (something broken) |
| **Export latency (p95)** | < 5 sec | > 10 sec (performance issue) |
| **Puppeteer memory usage** | < 500 MB | > 800 MB (memory leak) |
| **Disk space (temp files)** | < 1 GB | > 5 GB (cleanup failed) |
| **Error rate** | 0% | > 1% (any errors) |

### Dashboard Setup

**Grafana dashboard shows:**
- Export success rate (timeline)
- Export latency (histogram)
- Error breakdown (by error type)
- Puppeteer resource usage (memory, CPU)

---

## Quality Assurance Checklist

### Visual Quality Tests

- [ ] PDF matches web template (fonts, colors, layout)
- [ ] PDF renders correctly in Adobe Reader + browser
- [ ] DOCX opens in Microsoft Word without errors
- [ ] DOCX is editable (user can change text, add/remove content)
- [ ] Images appear in PDF and DOCX (not broken)
- [ ] Page breaks look natural (not random split-page)

### Functional Tests

- [ ] User name, email, phone auto-populated correctly
- [ ] Projects list complete (all submissions appear)
- [ ] Skills list complete (all skills appear)
- [ ] File downloads with correct name (e.g., "Alice_CV_2026-04-04.pdf")
- [ ] Permission: User can only export their own CV (not others')

### Performance Tests

- [ ] Typical CV export < 5 seconds
- [ ] Large CV (100+ projects) export < 10 seconds
- [ ] Concurrent exports (5 simultaneous) all succeed
- [ ] No memory leak (export 100 times, memory returns to baseline)

### Edge Cases

- [ ] Staff with no projects: Export works (projects section empty)
- [ ] Staff with special characters (é, ñ, emoji): Render correctly
- [ ] Large images (10MB profile photo): Compressed / handled
- [ ] Very long project descriptions: Wrapped correctly

---

## Orchestrator Checklist

### Pre-Launch

- [ ] **Design**
  - [ ] Template design approved by design team
  - [ ] Multiple template options available
  - [ ] Preview working before export
  
- [ ] **Implementation**
  - [ ] PDF export works (Puppeteer)
  - [ ] DOCX export works (docx library)
  - [ ] Both formats download correctly
  - [ ] Permission checks enabled
  
- [ ] **Quality**
  - [ ] Visual QA passed (PDFs look good)
  - [ ] File validity tests passed (DOCX opens in Word)
  - [ ] Performance tests passed (< 5 sec export)
  - [ ] Edge cases handled (special characters, large files)
  
- [ ] **Operations**
  - [ ] Puppeteer memory limits set
  - [ ] Temp file cleanup scheduled (cron job)
  - [ ] Monitoring configured
  - [ ] Alerts active
  
- [ ] **Documentation**
  - [ ] User guide written
  - [ ] FAQ completed
  - [ ] Troubleshooting guide created

### Launch Day

**Morning:**
- [ ] Staging validation (all tests passed)
- [ ] Feature flag staged (ready to enable)
- [ ] Monitoring dashboard open

**Deploy:**
- [ ] Feature flag: EXPORT_CV_ENABLED=10
- [ ] Monitor error rate (should be 0)
- [ ] Monitor latency (should be < 5s)

**Rollout:**
- [ ] T+4 hours: Increase to 50% if all green
- [ ] T+8 hours: Increase to 100% if all green
- [ ] T+24 hours: Declare launch successful

---

## Contingency Plans

### If PDF Generation Timeouts

1. Puppeteer may be slow (process is CPU-intensive)
2. **Quick fix:** Increase timeout from 10s → 20s (slower but works)
3. **Better fix:** Migrate to Puppeteer cloud (offload rendering)
4. **Ultimate fix:** Async export (return job_id, user polls for completion)

### If DOCX Files Invalid

1. Check docx library version (may have bug)
2. Test with different Word versions
3. **Options:**
   - Switch to `python-docx` (more mature)
   - Stick with PDF only (deprecate DOCX)
   - Return HTML (user opens in browser, saves as DOCX)

### If Permission Bug Leaks Data

1. Immediately rollback (feature flag = 0%)
2. Investigate: Who can export what?
3. Add comprehensive test coverage
4. Code review before re-launch

### If Memory Leak Found

1. Restart Puppeteer process (daily cron)
2. Monitor memory usage (alert if > 80%)
3. Consider separate Puppeteer service (Docker container)
4. Upgrade Puppeteer library (may have fixed leak)

