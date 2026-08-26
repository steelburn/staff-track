'use strict';

const authUser = requireAuth();

// ── State ─────────────────────────────────────────────────────────────────────
let payload = null;          // GET /reports/dashboard response
let includeInactive = false; // default: inactive staff filtered out (server default)
const charts = {};           // id -> echarts instance

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
    wireThemeCharts();
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

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadDashboard() {
    const loading = document.getElementById('dash-loading');
    const content = document.getElementById('dash-content');
    const errorBox = document.getElementById('dash-error');
    const body = document.getElementById('dash-body');

    body.hidden = false;
    loading.hidden = false;
    content.hidden = true;
    errorBox.hidden = true;

    const url = `/api/reports/dashboard${includeInactive ? '?include_inactive=true' : ''}`;
    try {
        const res = await window.StaffTrackAuth.apiFetch(url);
        if (res.status === 403) {
            showError('The reporting dashboard is available to management and team leads only.');
            return;
        }
        if (!res.ok) {
            showError('Failed to load dashboard data. Please try again.');
            return;
        }
        payload = await res.json();
        loading.hidden = true;
        content.hidden = false;
        renderAll();
    } catch (err) {
        console.error('Dashboard load failed:', err);
        showError('Failed to load dashboard data. Please try again.');
    }
}

function showError(text) {
    const loading = document.getElementById('dash-loading');
    const content = document.getElementById('dash-content');
    const body = document.getElementById('dash-body');
    const errorBox = document.getElementById('dash-error');
    loading.hidden = true;
    content.hidden = true;
    body.hidden = false;
    errorBox.hidden = false;
    document.getElementById('dash-error-text').textContent = text;
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderAll() {
    disposeCharts();
    renderScopeBanner();
    renderKpis();
    renderOrg();
    renderDeptChart();
    renderCompleteness();
    renderCompletenessChart();
    renderSkillsChart();
    renderProjects();
    renderProjectsChart();
    renderCerts();
    renderCertsChart();
    renderEngagement();
    renderEngagementChart();
}

function renderScopeBanner() {
    const banner = document.getElementById('scope-banner');
    const toggleWrap = document.getElementById('inactive-toggle-wrap');
    if (payload.scope === 'subordinates') {
        banner.hidden = false;
        banner.textContent = `Showing: your team (${payload.headcount.total} staff)`;
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
        html += `
            <h3 class="dash-muted" style="margin:var(--space-4) 0 var(--space-2); font-size:var(--font-size-base);">Needs attention</h3>
            <table class="dash-table">
                <thead><tr><th>Staff</th><th>Department</th><th class="num">Score</th></tr></thead>
                <tbody>
                    ${comp.lowest.map(p => `
                        <tr>
                            <td><a href="/cv-profile.html?email=${encodeURIComponent(p.email)}">${escapeHtml(p.name)}</a></td>
                            <td>${escapeHtml(p.department || '—')}</td>
                            <td class="num">${scoreBadge(p.score)}</td>
                        </tr>`).join('')}
                </tbody>
            </table>`;
    }
    el.innerHTML = html;
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
    const depts = (payload.headcount.byDepartment || []).slice(0, 12).slice().reverse();
    const c = mkChart('chart-depts');
    if (!c) return;
    const col = chartColors();
    c.setOption({
        tooltip: {
            trigger: 'axis', axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const d = depts[params[0].dataIndex];
                return `<strong>${escapeHtml(d.department)}</strong><br/>Active: ${d.active}<br/>Inactive: ${d.inactive}<br/>Total: ${d.total}`;
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
            data: depts.map(d => d.active),
            barWidth: 12,
            itemStyle: { color: col.primary, borderRadius: [0, 6, 6, 0] },
            label: { show: true, position: 'right', color: col.muted, fontSize: 11 }
        }]
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
