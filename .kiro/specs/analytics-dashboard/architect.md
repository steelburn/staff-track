# Analytics Dashboard - Architecture & Decisions

## Executive Summary

The StaffTrack Analytics Dashboard provides real-time visibility into staffing metrics, project allocations, skill distributions, and team health. This document captures architectural decisions and system design that enable scalable, maintainable analytics with minimal impact on operational production systems.

---

## Part 1: Architecture Decision Records (ADRs)

### ADR-001: Analytics Database Strategy (Separate OLAP vs. Inline OLTP)

**Status:** Accepted  
**Decision:** Separate read-only analytics replica, not real-time transactional queries

**Rationale:**
| Aspect | Inline OLTP | Separate OLAP Replica | Winner |
|--------|-----------|----------------------|--------|
| **Query Complexity** | Complex aggregations slow production | Optimized for complex joins | OLAP |
| **Production Impact** | Slow analytics queries block transactions | 0 impact on production | OLAP |
| **Infrastructure** | Single MySQL instance (low cost) | MySQL + replica + background process | OLTP (cost) |
| **Scalability** | Degrades as data grows | Scales independently | OLAP |
| **Features** | Limited (can't cache/index heavily) | Full control (pre-aggregated tables) | OLAP |
| **Latency** | Real-time (~1 sec) | Near-real-time (5-10 min delay) | OLTP |

**Decision:** Separate analytics replica accepts 5-10 minute data lag in exchange for zero production impact.

**Implementation:**
- Production MySQL: Transactional (staff, submissions, projects)
- Analytics MySQL replica: Materialized views (pre-aggregated dashboards)
- Sync job: Every 5 minutes, refresh aggregate tables from production

---

### ADR-002: Visualization Library (Recharts vs. D3 vs. Plotly)

**Status:** Accepted  
**Decision:** Recharts (React component library)

**Rationale:**
| Aspect | D3.js | Plotly | Recharts | Winner |
|--------|-------|--------|----------|--------|
| **Learning Curve** | Very steep (2-4 weeks) | Medium (1 week) | Shallow (2-3 days) | Recharts |
| **Team Expertise** | None in React team | None | Already using React | Recharts |
| **Customization** | Unlimited (but time-consuming) | Good | Good (80% of needs) | D3 (if needed) |
| **Bundle Size** | 80KB | 200KB | 45KB | Recharts |
| **Time to MVP** | 4 weeks | 2 weeks | 1 week | **Recharts** |
| **Responsive Design** | Requires custom code | Built-in | Built-in | Recharts |
| **Accessibility** | Requires extra work | Good | Good | Recharts |

**Decision:** Recharts for MVP (1 week), with plan to migrate to D3 if custom visualizations needed later.

**Integration:** React component in `frontend/src/components/DashboardChart.jsx`

---

### ADR-003: Real-Time Updates (Polling vs. WebSocket vs. GraphQL)

**Status:** Accepted  
**Decision:** 5-minute polling interval (not real-time)

**Rationale:**
```
Business Requirement: "How current does data need to be?"
  ↓
Answer: "Analytics typically reviewed 2-4x daily, not continuously monitored"
  ↓
Conclusion: 5-minute refresh sufficient (not 1-second real-time)
  ↓
Architecture Choice: Polling (simplest, lowest overhead)
```

| Approach | Overhead | Complexity | Latency |
|----------|----------|-----------|---------|
| **Polling (5min)** | 288 req/day, 10KB ea | Trivial | 0-5 min |
| **WebSocket** | Persistent connection | Medium | Real-time |
| **GraphQL** | Same as polling | High | Depends |

**Decision:** HTTP polling every 5 minutes (background job in frontend).

**Rejected:** WebSocket (unnecessary complexity for analytics use case).

---

### ADR-004: Data Aggregation Granularity (Real-Time vs. Nightly Pre-Compute)

**Status:** Accepted  
**Decision:** Nightly pre-computed aggregations + real-time counts from main DB

**Design:**
```
Nightly (2 AM):
├─ SELECT SUM(hours) FROM staff_allocations GROUP BY project_id
├─ SELECT DISTINCT skills FROM submissions GROUP BY skill_category
└─ SELECT COUNT(*) FROM submissions GROUP BY status, date

Real-Time (Frontend Query):
├─ SELECT COUNT(*) FROM staff WHERE is_active = 1
├─ SELECT COUNT(*) FROM submissions WHERE submitted_at > NOW() - INTERVAL 7 DAY
└─ [Fetch pre-computed aggregates from cache]
```

**Rationale:**
- Nightly aggregations: Expensive queries (histograms, percentiles) pre-computed
- Real-time counts: Fast, single-row lookups
- Hybrid approach: 80% nightly + 20% real-time = best balance

---

### ADR-005: Caching Strategy (Redis vs. In-Memory vs. Database Views)

**Status:** Accepted  
**Decision:** MySQL materialized views (no external cache layer)

**Rationale:**
```
Option 1: Redis (external cache)
  - Complexity: Additional service to run/monitor
  - Latency: Sub-millisecond queries
  - Risk: Cache invalidation bugs

Option 2: MySQL Views (database-level)
  - Simplicity: One less service
  - Latency: Milliseconds
  - Risk: Lower (data freshness guaranteed by refresh job)

Option 3: Application-level caching
  - Risk: Stale data across deployments
  
Decision: MySQL views, with simple Redis added if latency becomes issue (< 1%)
```

**Implementation:** Create materialized view tables:
```sql
CREATE TABLE mv_staff_by_project AS (
  SELECT project_id, COUNT(*) as staff_count, AVG(level) as avg_level
  FROM staff_allocations GROUP BY project_id
);
```

Refresh every 5 minutes via background job.

---

### ADR-006: Role-Based Access Control for Dashboards

**Status:** Accepted  
**Decision:** Three dashboard tiers: Executive (all data), Manager (team data), Individual (self + team)

**Model:**
```
┌─────────────────────────────────┐
│   EXECUTIVE DASHBOARD           │
│ • Company-wide metrics          │
│ • All teams, all projects       │
│ • P&L impact analysis           │
│ Access: C-level, CFO, CTO       │
└─────────────────────────────────┘
         ↓ Filtered by team
┌─────────────────────────────────┐
│   MANAGER DASHBOARD             │
│ • Team-specific metrics         │
│ • Direct reports only           │
│ • Utilization vs. capacity      │
│ Access: Managers, Team leads    │
└─────────────────────────────────┘
         ↓ Filtered by self
┌─────────────────────────────────┐
│   INDIVIDUAL DASHBOARD          │
│ • Personal skill profile        │
│ • My projects, my hours         │
│ • Goal progress                 │
│ Access: All staff               │
└─────────────────────────────────┘
```

**Implementation:** Middleware validates role + filters queries by user's team scope.

---

### ADR-007: Data Freshness Requirements

**Status:** Accepted  
**Decision:** 5-minute lag acceptable; snapshot consistency not required

**Rationale:**
- Analytics dashboard used for **planning** (not real-time decisions)
- 5-minute refresh = refresh every time user opens dashboard
- Consistency risk: Acceptable (aggregates don't need row-level consistency)

**Not acceptable:** Real-time trading, fraud detection (would need different architecture)

---

### ADR-008: Handling Large Datasets (> 10K records)

**Status:** Accepted  
**Decision:** Server-side pagination + pre-aggregated summary views

**Example:**
```
User asks: "Show me skills of staff on Project X"
  → 500+ people = too large for browser
  → Server returns: aggregated skill histogram + top 20 individuals
  → Pagination controls: next 20, previous 20, etc.
```

**Rejected approach:** Client-side pagination of 10K+ rows (poor UX, memory issues)

---

## Part 2: System Integration Points

### 2.1 Data Flow Architecture

```
Production MySQL (OLTP)
  ├─ staff table (1000 rows)
  ├─ submissions table (5000 rows)
  ├─ projects_catalog table (200 rows)
  └─ submission_skills table (50K rows)
         │
         │ (CDC: Change Data Capture) 
         │ Every 5 minutes
         ▼
Analytics Replica MySQL (OLAP)
  ├─ mv_staff_by_project (agg)
  ├─ mv_skills_distribution (agg)
  ├─ mv_utilization_by_team (agg)
  └─ mv_submission_timeline (agg)
         │
         │ (Query)
         │ Via API
         ▼
Backend API (/api/analytics/*)
  └─ Validates role permissions
  └─ Applies data filters (by manager/team)
  └─ Returns JSON
         │
         │ (HTTP, polling every 5 min)
         ▼
Frontend React Dashboard
  ├─ DashboardChart (Recharts)
  ├─ MetricsCard (KPI display)
  ├─ SkillMatrix (table)
  └─ UtilizationGauge (gauge chart)
         │
         │ (Display)
         ▼
Browser UI (Executive/Manager/Individual)
```

### 2.2 Backend Integration Points

**New API Endpoints (in `src/routes/analytics.js`):**
```javascript
GET /api/analytics/overview          → Staff count, projects, submissions
GET /api/analytics/utilization       → Utilization % by team
GET /api/analytics/skills            → Skills distribution (histogram)
GET /api/analytics/timeline          → Submissions over time (line chart)
GET /api/analytics/team/{team_id}    → Manager's team dashboard
GET /api/analytics/self              → Individual's personal dashboard
```

**Middleware:**
- Role validation: `middleware/analyticsAuth.js`
- Data filtering: `middleware/analyticsFilter.js` (apply team/manager filters)

**Database:**
- New schema: `mysql/0010_analytics_views.sql` (materialized view definitions)
- Background job: `scripts/refresh-analytics-views.js` (runs every 5 min)

### 2.3 Frontend Integration Points

**New Components (in `frontend/src/components/`):**
```
DashboardLayout.jsx          (page container)
├─ MetricsCard.jsx          (KPI boxes)
├─ DashboardChart.jsx        (Recharts wrapper)
├─ SkillMatrixTable.jsx      (skills distribution)
├─ UtilizationGauge.jsx      (team % gauge)
└─ FilterPanel.jsx           (date range, team selection)

hooks/
├─ useDashboardData.js       (fetch from API)
├─ useAnalyticsRole.js       (determine which dashboard to show)
└─ useDashboardFilters.js    (manage filter state)
```

**Store (Pinia or Vuex if switching):**
- `stores/analytics.js` - Dashboard state, caching (optional)

### 2.4 Environment-Specific Configuration

```env
# .env.development
ANALYTICS_REFRESH_INTERVAL=300000    # 5 minutes (ms)
ANALYTICS_API_TIMEOUT=5000           # 5 second timeout
ANALYTICS_ENABLE_DEMO=true           # Use demo data if true

# .env.production
ANALYTICS_REFRESH_INTERVAL=300000
ANALYTICS_API_TIMEOUT=10000
ANALYTICS_ENABLE_DEMO=false
ANALYTICS_REPLICA_HOST=analytics-mysql.internal    # Separate read-only MySQL
```

---

## Part 3: Technical Decisions & Trade-Offs

### 3.1 Why Not Real-Time Updates?

**Considered:** WebSocket + event-driven architecture

**Rejected because:**
- Analytics dashboards reviewed 2-4x daily (not continuously)
- Real-time infrastructure adds 2-3 weeks to delivery
- 5-minute lag imperceptible to users
- WebSocket memory footprint (1 connection per user per dashboard view)

**Acceptable trade-off:** 5-10 minute freshness accepted

---

### 3.2 Why Separate Replica, Not Caching Layer?

**Considered:** Redis in front of production MySQL

**Rejected because:**
- Analytics queries use different access patterns (full table scans)
- Cache invalidation complexity (when does cache expire?)
- MySQL replica more maintainable (replication built-in)
- MySQL replica doubles as backup (two benefits, one cost)

**Trade-off:** Slightly higher infrastructure cost (replica), but much simpler maintenance

---

### 3.3 Why Recharts, Not D3?

**Considered:** D3.js for maximum customization

**Rejected for MVP because:**
- Team has no D3 experience (4 week ramp)
- Recharts "good enough" for 80% of requirements
- Faster MVPdelivery (1 vs. 4 weeks)
- Migration path to D3 exists (if needed later)

**Plan:** If custom geospatial or network visualizations needed in Q3, migrate to D3

---

## Part 4: Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **Dashboard slow with large datasets** | Medium (25%) | High | Pre-aggregate; pagination; separate read replica |
| **Stale data confuses executives** | Low (5%) | High | Clear "last updated" timestamp on dashboard |
| **Role-based filtering bug shows private data** | Low (5%) | Critical | Whitebox test every permission rule; code review |
| **Analytics replica falls out of sync** | Low (10%) | Medium | Monitoring + automatic resync if > 30 min drift |
| **Visualization library (Recharts) has bug** | Very Low (1%) | High | Escape hatch: export data to CSV + Excel |

---

## Part 5: Success Criteria & Acceptance

### 5.1 Functional Requirements
- ✅ Executive dashboard shows company-wide KPIs (staff count, project count, utilization %)
- ✅ Manager dashboard filters to team scope (no access to other teams)
- ✅ Individual dashboard shows personal metrics (my skills, my hours, my projects)
- ✅ All dashboards update every 5 minutes without clicking refresh
- ✅ Charts render smoothly (< 500ms load time)
- ✅ Large datasets (1000+ records) handled via pagination

### 5.2 Non-Functional Requirements
- ✅ Analytics replica stays within 5 minutes of production (no later than 5 min lag)
- ✅ Dashboard loads in < 2 seconds (p95)
- ✅ No queries exceed 5 seconds on analytics replica
- ✅ Analytics queries don't block production transactions (< 1% CPU impact)
- ✅ 99% uptime for analytics dashboard (acceptable if down 1h/month)

### 5.3 Security Requirements
- ✅ Managers cannot see other teams' data (enforced by API)
- ✅ Staff cannot see company financial metrics (role-based)
- ✅ All API requests logged (for audit)
- ✅ SQL injection protection (parameterized queries)

---

## Part 6: Architecture Validation Checklist

**Architect Review (Before implementation):**
- [ ] All ADRs reviewed and approved by tech lead
- [ ] System integration points documented
- [ ] Data freshness requirements communicated to stakeholders
- [ ] Role-based access control model reviewed by security team
- [ ] MySQL replica capacity planned (storage, CPU)
- [ ] Performance testing approach documented
- [ ] Monitoring strategy for replica sync defined

**Go/No-Go Approval:** _Pending Tech Lead sign-off_

