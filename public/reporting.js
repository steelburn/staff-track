'use strict';

const authUser = requireAuth();

// ── State ─────────────────────────────────────────────────────────────────────
let payload = null;          // GET /reports/dashboard response
let includeInactive = false; // default: inactive staff filtered out (server default)
let selectedDept = null;     // department sub-dashboard scope (null = all)
const charts = {};           // id -> echarts instance

// Restore department scope from the URL (?dept=...) on load/refresh.
(function initDeptFromUrl() {
    const deptParam = new URLSearchParams(location.search).get('dept');
    if (deptParam) selectedDept = deptParam;
})();

// ── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Initialize sidebar navigation
    if (typeof renderSidebarNav === 'function') {
        renderSidebarNav('reporting');
    } else if (typeof renderNav === 'function') {
        renderNav('reporting');
    }
    // Initialize theme toggle
    if (typeof ThemeManager !== 'undefined') {
        ThemeManager.updateToggleButtons();
    }
    // Initialize toast
    if (typeof Toast !== 'undefined') {
        Toast.init();
    }

    wireInactiveToggle();
    wireDeptSelect();
    wireThemeCharts();
    wireEmpDrawer();
    const retryBtn = document.getElementById('dash-retry');
    if (retryBtn) retryBtn.addEventListener('click', () => loadDashboard());
    window.addEventListener('resize', () => {
        Object.values(charts).forEach(c => { try { c.resize(); } catch (e) { /* noop */ } });
    });
    loadDashboard();
});

function wireInactiveToggle() {
    const toggleInactive = document.getElementById('toggle-inactive');
    if (toggleInactive) {
        toggleInactive.addEventListener('change', async (e) => {
            includeInactive = e.target.checked;
            await loadDashboard();
        });
    }
}

// ECharts canvas colours come from CSS variables, which the dark theme flips —
// re-render the charts shortly after a theme toggle so they repaint correctly.
function wireThemeCharts() {
    const btn = document.querySelector('[data-theme-toggle]');
    if (btn) {
        btn.addEventListener('click', () => setTimeout(renderAll, 60));
    }
}

// ── Department sub-dashboard scope ───────────────────────────────────────────
function wireDeptSelect() {
    const sel = document.getElementById('dept-select');
    if (!sel) return;
    sel.addEventListener('change', () => selectDept(sel.value || null));
}

function selectDept(dept) {
    selectedDept = dept;
    syncDeptUrl();
    loadDashboard();
}

// Keep ?dept= in the URL so refresh / share / back-forward survive.
function syncDeptUrl() {
    history.replaceState(null, '', location.pathname + (selectedDept ? `?dept=${encodeURIComponent(selectedDept)}` : ''));
}

// Populate the department dropdown from the payload. byDepartment is the org
// map (never dept-filtered), so it stays complete while a sub-dashboard is on.
// Hidden when the viewer has 0-1 departments in scope (no drill-down possible).
// Matching is case/whitespace-insensitive: "PROJECT MANAGEMENT OFFICE" and
// "Project Management Office" are the same department, so a ?dept= deep link
// in any casing resolves to the canonical label.
const normDept = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
function renderDeptSelector() {
    const sel = document.getElementById('dept-select');
    if (!sel) return;
    const depts = payload.headcount.byDepartment || [];
    sel.hidden = depts.length <= 1;
    if (sel.hidden) return;

    // Selection no longer resolvable (e.g. bogus ?dept= param): reset and refetch.
    if (selectedDept) {
        const match = depts.find(d => normDept(d.department) === normDept(selectedDept));
        if (match) {
            // Adopt the canonical spelling so the dropdown + banner agree
            if (match.department !== selectedDept) { selectedDept = match.department; syncDeptUrl(); }
        } else {
            selectedDept = null;
            syncDeptUrl();
            if (payload.department) loadDashboard(); // bogus filter was applied server-side
            return;
        }
    }

    sel.innerHTML = '<option value="">All departments</option>' +
        depts.map(d => `<option value="${escapeHtml(d.department)}">${escapeHtml(d.department)} (${d.active})</option>`).join('');
    sel.value = selectedDept || '';
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadDashboard() {
    // A dept / include-inactive change re-fetches the roster the drawer renders
    // from, so any open employment drawer would show stale rows — close it.
    closeEmploymentDrawer();
    const loading = document.getElementById('dash-loading');
    const content = document.getElementById('dash-content');
    const errorBox = document.getElementById('dash-error');
    const body = document.getElementById('dash-body');

    body.hidden = false;
    loading.hidden = false;
    content.hidden = true;
    errorBox.hidden = true;

    const qs = new URLSearchParams();
    if (includeInactive) qs.set('include_inactive', 'true');
    if (selectedDept) qs.set('department', selectedDept);
    const url = `/api/reports/dashboard${qs.toString() ? `?${qs.toString()}` : ''}`;

    // Hard timeout: a hung in-flight fetch (tunnel keepalive, tab suspension,
    // connection reset) would otherwise leave the spinner spinning forever.
    // The timer guarantees the loading state ALWAYS resolves to content or error.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await window.StaffTrackAuth.apiFetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.status === 403) {
            showError('The reporting dashboard is available to management and team leads only.', false);
            return;
        }
        if (!res.ok) {
            showError('Failed to load dashboard data. Please try again.', true);
            return;
        }
        payload = await res.json();
        loading.hidden = true;
        content.hidden = false;
        renderAll();
    } catch (err) {
        clearTimeout(timeoutId);
        console.error('Dashboard load failed:', err);
        showError(err && err.name === 'AbortError'
            ? 'The dashboard request timed out. Please try again.'
            : 'Failed to load dashboard data. Please try again.', true);
    }
}

function showError(text, canRetry = false) {
    const loading = document.getElementById('dash-loading');
    const content = document.getElementById('dash-content');
    const body = document.getElementById('dash-body');
    const errorBox = document.getElementById('dash-error');
    loading.hidden = true;
    content.hidden = true;
    body.hidden = false;
    errorBox.hidden = false;
    document.getElementById('dash-error-text').textContent = text;
    // A 403 is the only true "no access" case. Timeouts / network / server errors
    // are loading failures an authorized user can retry — never tell them they
    // are "Access restricted".
    const icon = document.getElementById('dash-error-icon');
    const title = document.getElementById('dash-error-title');
    if (icon) icon.textContent = canRetry ? '⚠️' : '🚫';
    if (title) title.textContent = canRetry ? "Couldn't load dashboard" : 'Access restricted';
    const retryBtn = document.getElementById('dash-retry');
    if (retryBtn) retryBtn.hidden = !canRetry;
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderAll() {
    disposeCharts();
    renderDeptSelector();
    renderScopeBanner();
    renderKpis();
    renderEmployment();
    renderOrg();
    renderDeptChart();
    renderCompleteness();
    renderCompletenessChart();
    renderSkillsChart();
    renderProjects();
    renderProjectsChart();
    renderCerts();
    renderCertsChart();
    renderPopularCertsChart();
    renderEngagement();
    renderEngagementChart();
}

function renderScopeBanner() {
    const banner = document.getElementById('scope-banner');
    const toggleWrap = document.getElementById('inactive-toggle-wrap');
    if (payload.scope === 'subordinates') {
        banner.hidden = false;
        banner.textContent = `Showing: your team (${payload.headcount.total} staff)`;
    } else if (payload.department) {
        banner.hidden = false;
        banner.textContent = `Showing: ${payload.department} (${payload.headcount.total} staff)`;
    } else {
        banner.hidden = true;
    }
    // include-inactive toggle only makes sense for full-org viewers
    toggleWrap.hidden = payload.scope !== 'all';
}

function kpiCard(label, value, hint) {
    return `
        <div class="kpi-card">
            <div class="kpi-value">${value}</div>
            <div class="kpi-label">${label}</div>
            ${hint ? `<div class="kpi-hint">${hint}</div>` : ''}
        </div>`;
}

function renderKpis() {
    const hc = payload.headcount;
    const eng = payload.engagement;
    const proj = payload.projects;
    const cert = payload.certifications;
    document.getElementById('dash-kpis').innerHTML =
        kpiCard('Active staff', hc.active, `${hc.total} tracked${payload.includeInactive ? ' incl. inactive' : ''}`) +
        kpiCard('Staff updated CV', eng.staffUpdatedCount, `${eng.edits30d} edits in 30 days`) +
        kpiCard('Catalog projects', proj.catalogTotal, `${proj.staffWithProjects} staff with active projects`) +
        kpiCard('Certs expiring ≤ 90d', cert.expiring90d, `${cert.expired} already expired`);
}

function scoreBadge(score) {
    const cls = score < 40 ? 'low' : score <= 70 ? 'mid' : 'high';
    return `<span class="score-badge ${cls}">${score}%</span>`;
}

function renderOrg() {
    const org = payload.org;
    const el = document.getElementById('dash-org');
    let html = '';

    const alerts = [];
    if (org.noManager > 0) {
        alerts.push(orgAlertHTML('warning',
            `⚠️ <span><strong>${org.noManager}</strong> staff member${org.noManager === 1 ? '' : 's'} have no manager assigned.</span>`,
            'noManager', org.noManagerStaff));
    }
    if (org.orphans > 0) {
        alerts.push(orgAlertHTML('warning',
            `⚠️ <span><strong>${org.orphans}</strong> staff report to a manager not in the roster (or to themselves).</span>`,
            'orphans', org.orphanStaff));
    }
    if (alerts.length === 0) {
        alerts.push('<div class="dash-alert success">✅ All staff have a valid manager in the roster.</div>');
    }
    html += alerts.join('');

    if (org.managers.length === 0) {
        html += '<p class="dash-muted">No managers found in this view.</p>';
    } else {
        html += `
            <table class="dash-table" style="max-height:320px; display:block; overflow-y:auto;">
                <thead><tr><th>Manager</th><th class="num">Direct reports</th><th class="num">Departments</th></tr></thead>
                <tbody>
                    ${org.managers.map(m => `
                        <tr>
                            <td>${escapeHtml(m.name)}</td>
                            <td class="num">${m.directReports}</td>
                            <td class="num">${m.departments}</td>
                        </tr>`).join('')}
                </tbody>
            </table>`;
    }
    el.innerHTML = html;
    wireAlertToggles(el);
}

// Expandable warning alert: summary line + Details toggle revealing the staff list.
function orgAlertHTML(kind, msg, key, staff) {
    const rows = (staff || []).map(s => `
        <tr>
            <td><a href="/cv-profile.html?email=${encodeURIComponent(s.email)}">${escapeHtml(s.name)}</a></td>
            <td>${escapeHtml(s.department || '—')}</td>
            <td>${escapeHtml(s.title || '—')}</td>
            ${s.manager_name ? `<td>${escapeHtml(s.manager_name)}</td>` : ''}
        </tr>`).join('');
    const extraCol = (staff || []).some(s => s.manager_name) ? '<th>Reports to</th>' : '';
    return `
        <div class="dash-alert ${kind}">
            ${msg}
            <button type="button" class="dash-alert-toggle" data-alert-key="${key}" aria-expanded="false">Details ▾</button>
            <div class="dash-alert-details" id="alert-details-${key}" hidden>
                <table class="dash-table">
                    <thead><tr><th>Name</th><th>Department</th><th>Title</th>${extraCol}</tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
}

// Bind Details toggles within a container. Scoped per render so re-rendering
// one section never re-binds (and double-fires) another section's toggles.
function wireAlertToggles(scope) {
    (scope || document).querySelectorAll('.dash-alert-toggle').forEach(btn => {
        btn.addEventListener('click', () => toggleAlertDetails(btn.dataset.alertKey, btn));
    });
}

// Toggle an expandable alert's details block. btn optional — when triggered from
// a chart slice click the button is looked up by key.
function toggleAlertDetails(key, btn) {
    const details = document.getElementById(`alert-details-${key}`);
    if (!details) return;
    const wasExpanded = !details.hidden;
    details.hidden = wasExpanded;
    const target = btn || document.querySelector(`.dash-alert-toggle[data-alert-key="${key}"]`);
    if (target) {
        target.setAttribute('aria-expanded', String(!wasExpanded));
        target.textContent = wasExpanded ? 'Details ▾' : 'Hide ▲';
    }
}

function renderCompleteness() {
    const comp = payload.completeness;
    const el = document.getElementById('dash-completeness');
    let html = '';

    if (comp.zeroSkillStaff > 0) {
        html += `<div class="dash-alert warning">⚠️ <span><strong>${comp.zeroSkillStaff}</strong> staff have no skills recorded.</span></div>`;
    }

    const total = comp.buckets.reduce((s, b) => s + b.count, 0);
    html += `<p class="dash-muted" style="margin-bottom:var(--space-3)">CV/profile completeness score across ${total} staff
        (profile + summary + skills + education + certifications + work history + past projects).
        Average <strong>${comp.avgSkillCount}</strong> skills per staff.</p>`;

    if (comp.lowest.length > 0) {
        // The API returns the full incomplete-staff ranking (attention) plus a
        // 10-row preview (lowest). Preview 10 rows; "Show all" reveals the rest.
        const attention = comp.attention || comp.lowest;
        const ATTENTION_PREVIEW = 10;
        const expandable = attention.length > ATTENTION_PREVIEW;
        const rows = attention.map((p, i) => `
                        <tr${i >= ATTENTION_PREVIEW ? ' class="attention-extra" hidden' : ''}>
                            <td><a href="/cv-profile.html?email=${encodeURIComponent(p.email)}">${escapeHtml(p.name)}</a></td>
                            <td>${escapeHtml(p.department || '—')}</td>
                            <td class="num">${scoreBadge(p.score)}</td>
                        </tr>`).join('');
        html += `
            <div class="dash-section-head">
                <h3 class="dash-muted">Needs attention</h3>
                ${expandable ? `<button type="button" class="dash-showmore" id="btn-attention-toggle"
                    aria-expanded="false" aria-controls="attention-rows" data-total="${attention.length}">Show all ${attention.length} ▾</button>` : ''}
            </div>
            <div class="dash-table-scroll">
                <table class="dash-table" id="attention-rows">
                    <thead><tr><th>Staff</th><th>Department</th><th class="num">Score</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }
    el.innerHTML = html;
    wireAttentionToggle(el);
}

// Expand/collapse the full "Needs attention" staff list. Extra rows are always
// in the DOM (with `hidden`), so toggling never re-renders or loses state.
function wireAttentionToggle(scope) {
    const btn = scope.querySelector('#btn-attention-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        scope.querySelectorAll('tr.attention-extra').forEach(tr => { tr.hidden = expanded; });
        btn.setAttribute('aria-expanded', String(!expanded));
        btn.textContent = expanded ? `Show all ${btn.dataset.total} ▾` : 'Show fewer ▲';
    });
}

function renderProjects() {
    const proj = payload.projects;
    const el = document.getElementById('dash-projects');
    el.innerHTML = `
        <div class="stat-tiles">
            <div class="stat-tile"><span class="num">${proj.catalogTotal}</span><span class="lbl">Catalog projects</span></div>
            <div class="stat-tile"><span class="num">${proj.managedTotal}</span><span class="lbl">Coordinator-managed</span></div>
            <div class="stat-tile"><span class="num">${proj.staffWithProjects}</span><span class="lbl">Staff with active projects</span></div>
        </div>
        <p class="dash-muted" style="margin-top:var(--space-2)">${proj.projectLinks} project assignment${proj.projectLinks === 1 ? '' : 's'} recorded.</p>`;
}

function renderCerts() {
    const cert = payload.certifications;
    const el = document.getElementById('dash-certs');
    let html = '';
    if (cert.total === 0) {
        html = '<p class="dash-muted">No certifications recorded.</p>';
    } else {
        if (cert.expired > 0) {
            html += certAlertHTML('danger',
                `⛔ <span><strong>${cert.expired}</strong> certification${cert.expired === 1 ? '' : 's'} already expired — renew or remove.</span>`,
                'certs-expired', cert.expiredCerts);
        }
        if (cert.expiring90d > 0) {
            html += certAlertHTML('warning',
                `⚠️ <span><strong>${cert.expiring90d}</strong> certification${cert.expiring90d === 1 ? '' : 's'} expiring within 90 days.</span>`,
                'certs-expiring', cert.expiringCerts);
        }
        if (cert.expired === 0 && cert.expiring90d === 0) {
            html += '<div class="dash-alert success">✅ No certifications expiring within 90 days.</div>';
        }
        html += `<p class="dash-muted">${cert.total} certifications on file for staff in this view.</p>`;
    }
    el.innerHTML = html;
    wireAlertToggles(el);
}

// Expandable certification alert: summary + Details toggle revealing the cert list.
function certAlertHTML(kind, msg, key, certs) {
    const rows = (certs || []).map(c => `
        <tr>
            <td>${escapeHtml(c.certName)}</td>
            <td><a href="/cv-profile.html?email=${encodeURIComponent(c.email)}">${escapeHtml(c.staffName)}</a></td>
            <td>${escapeHtml(c.issuer || '—')}</td>
            <td>${c.dateObtained || '—'}</td>
            <td class="num">${c.expiryDate || '—'}</td>
        </tr>`).join('');
    return `
        <div class="dash-alert ${kind}">
            ${msg}
            <button type="button" class="dash-alert-toggle" data-alert-key="${key}" aria-expanded="false">Details ▾</button>
            <div class="dash-alert-details" id="alert-details-${key}" hidden>
                <table class="dash-table">
                    <thead><tr><th>Certification</th><th>Staff</th><th>Issuer</th><th>Obtained</th><th class="num">Expires</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
}

function renderEngagement() {
    const eng = payload.engagement;
    const el = document.getElementById('dash-engagement');
    const series = eng.series || [];
    if (series.length > 0) {
        el.innerHTML = `<p class="dash-muted"><strong>${eng.edits30d}</strong> profile edits in the last 30 days
            (${series.length} active day${series.length === 1 ? '' : 's'}); <strong>${eng.staffUpdatedCount}</strong> staff have updated their own CV.</p>`;
    } else {
        el.innerHTML = '<p class="dash-muted">No audit activity in the last 30 days.</p>';
    }
}

// ── ECharts helpers ───────────────────────────────────────────────────────────
function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Theme-aware palette: colours are read from the live CSS variables, which the
// dark theme ([data-theme="dark"]) flips — re-initialising charts after a theme
// toggle therefore picks up the right colours automatically.
function chartColors() {
    return {
        primary: cssVar('--color-primary') || '#6366f1',
        text: cssVar('--color-text-primary') || '#0f172a',
        muted: cssVar('--color-text-muted') || '#94a3b8',
        border: cssVar('--color-border') || '#e2e8f0',
        grid: 'rgba(148,163,184,0.15)',
        success: '#10b981',
        warning: '#d97706',
        danger: '#dc2626',
        series: ['#6366f1', '#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#7dcfff', '#f7768e', '#2ac3de', '#ff9e64', '#c0caf5']
    };
}

function mkChart(id) {
    const el = document.getElementById(id);
    if (!el || typeof echarts === 'undefined') return null;
    try {
        const c = echarts.init(el);
        charts[id] = c;
        return c;
    } catch (e) {
        console.error(`ECharts init failed for ${id}:`, e);
        return null;
    }
}

function disposeCharts() {
    Object.keys(charts).forEach(k => {
        try { charts[k].dispose(); } catch (e) { /* noop */ }
        delete charts[k];
    });
}

function axisColors(col) {
    return {
        axisLabel: { color: col.muted, fontSize: 11 },
        axisLine: { lineStyle: { color: col.border } },
        splitLine: { lineStyle: { color: col.grid } }
    };
}

// ── Charts ────────────────────────────────────────────────────────────────────
function renderDeptChart() {
    const depts = (payload.headcount.byDepartment || []).slice().reverse();
    const c = mkChart('chart-depts');
    if (!c) return;
    const col = chartColors();
    c.setOption({
        tooltip: {
            trigger: 'axis', axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const d = depts[params[0].dataIndex];
                if (!d) return '';
                return `<strong>${escapeHtml(d.department)}</strong><br/>Active: ${d.active}<br/>Inactive: ${d.inactive}<br/>Total: ${d.total}<br/><em>Click to ${d.department === selectedDept ? 'reset to all departments' : 'open this department\'s dashboard'}</em>`;
            }
        },
        grid: { left: 8, right: 24, top: 10, bottom: 8, containLabel: true },
        xAxis: { type: 'value', ...axisColors(col) },
        yAxis: {
            type: 'category',
            data: depts.map(d => d.department),
            axisLabel: { color: col.text, fontSize: 11 },
            axisLine: { lineStyle: { color: col.border } }
        },
        series: [{
            type: 'bar',
            // Selected department is highlighted amber; others primary.
            data: depts.map(d => ({
                value: d.active,
                itemStyle: {
                    color: d.department === selectedDept ? col.warning : col.primary,
                    borderRadius: [0, 6, 6, 0]
                }
            })),
            barWidth: 12,
            label: { show: true, position: 'right', color: col.muted, fontSize: 11 }
        }]
    });
    // Click a bar to scope the whole dashboard to that department; click the
    // highlighted bar again to reset. Charts are disposed per render, so this
    // handler never accumulates duplicates.
    c.on('click', (params) => {
        const d = depts[params.dataIndex];
        if (!d) return;
        selectDept(d.department === selectedDept ? null : d.department);
    });
}

function renderCompletenessChart() {
    const buckets = payload.completeness.buckets || [];
    const c = mkChart('chart-completeness');
    if (!c) return;
    const col = chartColors();
    c.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: 8, right: 16, top: 10, bottom: 8, containLabel: true },
        xAxis: { type: 'category', data: buckets.map(b => b.bucket), ...axisColors(col) },
        yAxis: { type: 'value', ...axisColors(col) },
        series: [{
            type: 'bar',
            data: buckets.map(b => b.count),
            barWidth: 28,
            itemStyle: { color: col.primary, borderRadius: [6, 6, 0, 0] },
            label: { show: true, position: 'top', color: col.muted, fontSize: 11 }
        }]
    });
}

function renderSkillsChart() {
    const top = (payload.skills.top || []).slice().reverse();
    const c = mkChart('chart-skills');
    if (!c) return;
    const col = chartColors();
    c.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: 8, right: 24, top: 10, bottom: 8, containLabel: true },
        xAxis: { type: 'value', ...axisColors(col) },
        yAxis: {
            type: 'category',
            data: top.map(s => s.name),
            axisLabel: { color: col.text, fontSize: 11 },
            axisLine: { lineStyle: { color: col.border } }
        },
        series: [{
            type: 'bar',
            data: top.map(s => s.staff),
            barWidth: 12,
            itemStyle: { color: col.primary, borderRadius: [0, 6, 6, 0] },
            label: { show: true, position: 'right', color: col.muted, fontSize: 11 }
        }]
    });
}

// Fixed, semantic palette for well-known BeeSuite employment categories; any
// other free-form value falls back to the generic series palette.
const EMP_TYPE_COLORS = { Permanent: '#10b981', Contract: '#6366f1', Temporary: '#d97706', Intern: '#7dcfff' };
const EMP_STATUS_COLORS = { Confirmed: '#10b981', Probation: '#d97706', Terminated: '#dc2626', Unspecified: '#94a3b8' };

// Shared donut for the employment-type / employment-status cards. Renders an
// "empty" message instead of a blank canvas when the sync hasn't populated yet.
// `kind` ('type' | 'status') labels the drill-down drawer a slice click opens.
function renderEmploymentDonut(chartId, data, colorMap, emptyMsg, kind) {
    const c = mkChart(chartId);
    if (!c) return;
    const col = chartColors();
    const rows = (data || []).filter(r => r && r.count > 0);
    if (rows.length === 0) {
        c.clear();
        c.setOption({
            title: {
                text: emptyMsg, left: 'center', top: 'middle',
                textStyle: { color: col.muted, fontSize: 12, fontWeight: 'normal' }
            }
        });
        return;
    }
    const palette = ['#6366f1', '#10b981', '#d97706', '#7dcfff', '#bb9af7', '#f7768e', '#2ac3de', '#e0af68'];
    c.setOption({
        tooltip: {
            trigger: 'item',
            formatter: (p) => `${escapeHtml(p.name)}: ${p.value} (${p.percent}%)<br/><em>Click to list these staff</em>`
        },
        legend: { bottom: 0, textStyle: { color: col.muted, fontSize: 11 } },
        series: [{
            type: 'pie',
            radius: ['45%', '70%'],
            center: ['50%', '44%'],
            avoidLabelOverlap: true,
            // The selected slice pops outward as click feedback; the side drawer
            // carries the actual detail (slice value == drawer row count).
            selectedMode: 'single',
            selectedOffset: 10,
            itemStyle: { borderRadius: 6, borderColor: cssVar('--color-bg-surface') || '#fff', borderWidth: 2 },
            label: { show: false },
            data: rows.map((r, i) => ({
                name: r.name, value: r.count,
                itemStyle: { color: colorMap[r.name] || palette[i % palette.length] }
            }))
        }]
    });
    c.on('click', (params) => openEmploymentDrawer(kind, params.name));
    // A theme toggle / re-render recreates this instance, so restore the
    // selected-slice pop-out while its drawer is still open.
    if (empDrawerState && empDrawerState.kind === kind) {
        try { c.dispatchAction({ type: 'select', seriesIndex: 0, name: empDrawerState.label }); } catch (e) { /* noop */ }
    }
}

function renderEmployment() {
    const emp = payload.employment || {};
    renderEmploymentDonut(
        'chart-employment-type',
        (emp.byType || []).map(r => ({ name: r.type, count: r.count })),
        EMP_TYPE_COLORS,
        'No employment type data yet — run a staff sync.',
        'type'
    );
    renderEmploymentDonut(
        'chart-employment-status',
        (emp.byStatus || []).map(r => ({ name: r.status, count: r.count })),
        EMP_STATUS_COLORS,
        'No employment status data yet — run a staff sync.',
        'status'
    );
}

// ── Employment drill-down drawer ─────────────────────────────────────────────
// Clicking an employment-type / employment-status donut slice slides a panel in
// from the right listing the staff in that slice. The roster ships in
// payload.employment.staff, already filtered to the active scope + department,
// so a drawer's row count always equals the slice value it was opened from.
let empDrawerState = null; // { kind: 'type'|'status', label }

const EMP_DRAWER_META = {
    type: { title: 'Employment type', other: 'status' },
    status: { title: 'Employment status', other: 'type' },
};

function openEmploymentDrawer(kind, label) {
    const meta = EMP_DRAWER_META[kind];
    if (!meta) return;
    const staff = (payload.employment && payload.employment.staff) || [];
    const rows = staff.filter(s => s[kind] === label);

    document.getElementById('emp-drawer-kind').textContent = meta.title;
    document.getElementById('emp-drawer-title').textContent = label;
    document.getElementById('emp-drawer-sub').textContent =
        `${rows.length} staff${payload.department ? ` · ${payload.department}` : ''}`;

    const body = document.getElementById('emp-drawer-body');
    if (rows.length === 0) {
        body.innerHTML = '<div class="dash-drawer-empty">No staff found in this category.</div>';
    } else {
        body.innerHTML = `<div class="emp-list">
            ${rows.map(s => {
                const search = `${s.name} ${s.department || ''} ${s.title || ''} ${s[meta.other] || ''}`.toLowerCase();
                const metaText = [s.department, s.title].filter(Boolean).map(escapeHtml).join(' · ') || '—';
                return `<a class="emp-row" data-search="${escapeHtml(search)}" href="/cv-profile.html?email=${encodeURIComponent(s.email)}">
                    <div class="emp-row-main">
                        <div class="emp-row-name">${escapeHtml(s.name)}</div>
                        <div class="emp-row-meta">${metaText}</div>
                    </div>
                    <span class="emp-pill">${escapeHtml(s[meta.other] || '—')}</span>
                </a>`;
            }).join('')}
        </div>`;
    }

    // Reset + wire the client-side search filter for this open.
    const search = document.getElementById('emp-drawer-search');
    search.value = '';
    search.oninput = () => {
        const q = search.value.trim().toLowerCase();
        body.querySelectorAll('.emp-row').forEach(el => {
            el.hidden = q ? !(el.dataset.search || '').includes(q) : false;
        });
    };

    const drawer = document.getElementById('emp-drawer');
    const overlay = document.getElementById('dash-drawer-overlay');
    drawer.classList.add('open');
    overlay.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    empDrawerState = { kind, label };
    const closeBtn = document.getElementById('emp-drawer-close');
    if (closeBtn) setTimeout(() => closeBtn.focus(), 0);
}

function closeEmploymentDrawer() {
    const drawer = document.getElementById('emp-drawer');
    const overlay = document.getElementById('dash-drawer-overlay');
    if (!drawer || !drawer.classList.contains('open')) return;
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    const prev = empDrawerState;
    empDrawerState = null;
    // Clear the popped-out slice. ECharts' unselect must be told *which* item
    // (by name) — a bare {seriesIndex} is a silent no-op.
    ['chart-employment-type', 'chart-employment-status'].forEach(id => {
        const c = charts[id];
        if (c && prev) {
            try { c.dispatchAction({ type: 'unselect', seriesIndex: 0, name: prev.label }); } catch (e) { /* noop */ }
        }
    });
}

function wireEmpDrawer() {
    const closeBtn = document.getElementById('emp-drawer-close');
    const overlay = document.getElementById('dash-drawer-overlay');
    if (closeBtn) closeBtn.addEventListener('click', closeEmploymentDrawer);
    if (overlay) overlay.addEventListener('click', closeEmploymentDrawer);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && empDrawerState) closeEmploymentDrawer();
    });
}

function renderProjectsChart() {
    const proj = payload.projects;
    const hc = payload.headcount;
    const c = mkChart('chart-projects');
    if (!c) return;
    const col = chartColors();
    const withProj = proj.staffWithProjects;
    const without = Math.max(hc.total - withProj, 0);
    c.setOption({
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { bottom: 0, textStyle: { color: col.muted, fontSize: 11 } },
        series: [{
            type: 'pie',
            radius: ['45%', '70%'],
            center: ['50%', '44%'],
            avoidLabelOverlap: true,
            itemStyle: { borderRadius: 6, borderColor: cssVar('--color-bg-surface') || '#fff', borderWidth: 2 },
            label: { show: false },
            data: [
                { name: 'With ≥1 project', value: withProj, itemStyle: { color: col.primary } },
                { name: 'No project', value: without, itemStyle: { color: col.grid } }
            ]
        }]
    });
}

function renderCertsChart() {
    const cert = payload.certifications;
    const c = mkChart('chart-certs');
    if (!c || cert.total === 0) return;
    const col = chartColors();
    const valid = Math.max(cert.total - cert.expired - cert.expiring90d, 0);
    c.setOption({
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { bottom: 0, textStyle: { color: col.muted, fontSize: 11 } },
        series: [{
            type: 'pie',
            radius: ['45%', '70%'],
            center: ['50%', '44%'],
            avoidLabelOverlap: true,
            itemStyle: { borderRadius: 6, borderColor: cssVar('--color-bg-surface') || '#fff', borderWidth: 2 },
            label: { show: false },
            data: [
                { name: 'Valid', value: valid, itemStyle: { color: col.success } },
                { name: 'Expiring ≤ 90d', value: cert.expiring90d, itemStyle: { color: col.warning } },
                { name: 'Expired', value: cert.expired, itemStyle: { color: col.danger } }
            ]
        }]
    });
    // Slice click drills down into the matching cert list (same toggle as the alert buttons)
    c.on('click', (params) => {
        const key = params.name === 'Expired' ? 'certs-expired'
            : params.name === 'Expiring ≤ 90d' ? 'certs-expiring' : null;
        if (key) toggleAlertDetails(key);
    });
}

function renderEngagementChart() {
    const series = payload.engagement.series || [];
    const c = mkChart('chart-engagement');
    if (!c) return;
    const col = chartColors();
    if (series.length === 0) return;
    const dates = series.map(s => (s.date || '').slice(5)); // MM-DD
    c.setOption({
        tooltip: { trigger: 'axis' },
        grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
        xAxis: { type: 'category', boundaryGap: false, data: dates, ...axisColors(col) },
        yAxis: { type: 'value', minInterval: 1, ...axisColors(col) },
        series: [{
            type: 'line',
            data: series.map(s => s.count),
            smooth: true,
            symbol: 'circle',
            symbolSize: 5,
            lineStyle: { color: col.primary, width: 2 },
            itemStyle: { color: col.primary },
            areaStyle: {
                color: {
                    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                        { offset: 0, color: col.primary + '55' },
                        { offset: 1, color: col.primary + '00' }
                    ]
                }
            }
        }]
    });
}

function renderPopularCertsChart() {
    const popular = (payload.certifications.popular || []).slice().reverse();
    const c = mkChart('chart-popular-certs');
    if (!c || popular.length === 0) return;
    const col = chartColors();
    c.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: 8, right: 24, top: 10, bottom: 8, containLabel: true },
        xAxis: { type: 'value', ...axisColors(col) },
        yAxis: {
            type: 'category',
            data: popular.map(s => s.name),
            axisLabel: { color: col.text, fontSize: 11 },
            axisLine: { lineStyle: { color: col.border } }
        },
        series: [{
            type: 'bar',
            data: popular.map(s => s.staff),
            barWidth: 12,
            itemStyle: { color: col.primary, borderRadius: [0, 6, 6, 0] },
            label: { show: true, position: 'right', color: col.muted, fontSize: 11 }
        }]
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
