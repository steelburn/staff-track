'use strict';

const authUser = requireAuth();

// ── State ─────────────────────────────────────────────────────────────────────
let payload = null;          // GET /reports/dashboard response
let includeInactive = false; // default: inactive staff filtered out (server default)

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
    renderScopeBanner();
    renderKpis();
    renderOrg();
    renderCompleteness();
    renderEngagement();
    renderSkills();
    renderProjects();
    renderCerts();
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

function barRow(label, value, max, countLabel) {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return `
        <div class="bar-row">
            <div class="bar-label" title="${label}">${label}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.max(pct, value > 0 ? 2 : 0)}%"></div></div>
            <div class="bar-count">${countLabel || value}</div>
        </div>`;
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
        alerts.push(`<div class="dash-alert warning">⚠️ <span><strong>${org.noManager}</strong> staff member${org.noManager === 1 ? '' : 's'} have no manager assigned.</span></div>`);
    }
    if (org.orphans > 0) {
        alerts.push(`<div class="dash-alert warning">⚠️ <span><strong>${org.orphans}</strong> staff report to a manager not in the roster (or to themselves).</span></div>`);
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
}

function renderCompleteness() {
    const comp = payload.completeness;
    const el = document.getElementById('dash-completeness');
    let html = '';

    if (comp.zeroSkillStaff > 0) {
        html += `<div class="dash-alert warning">⚠️ <span><strong>${comp.zeroSkillStaff}</strong> staff have no skills recorded.</span></div>`;
    }

    const total = comp.buckets.reduce((s, b) => s + b.count, 0);
    const maxBucket = Math.max(...comp.buckets.map(b => b.count), 1);
    html += `<p class="dash-muted" style="margin-bottom:var(--space-3)">CV/profile completeness score across ${total} staff
        (profile + summary + skills + education + certifications + work history + past projects).
        Average <strong>${comp.avgSkillCount}</strong> skills per staff.</p>`;
    comp.buckets.forEach(b => {
        html += barRow(b.bucket, b.count, maxBucket, `${b.count} · ${total ? Math.round(b.count / total * 100) : 0}%`);
    });

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

function renderEngagement() {
    const eng = payload.engagement;
    const el = document.getElementById('dash-engagement');
    const series = eng.series || [];

    let svg = '';
    if (series.length > 0) {
        const maxC = Math.max(...series.map(s => s.count), 1);
        const n = series.length;
        const bw = 4, gap = 2;
        const viewW = n * (bw + gap);
        svg = `
            <svg class="eng-chart" viewBox="0 0 ${viewW} 90" preserveAspectRatio="none" role="img" aria-label="Edits per day over the last 30 days">
                ${series.map((s, i) => {
                    const h = Math.max(2, Math.round((s.count / maxC) * 80));
                    return `<rect class="eng-bar" x="${i * (bw + gap)}" y="${90 - h}" width="${bw}" height="${h}" rx="1">
                        <title>${s.date}: ${s.count} edit${s.count === 1 ? '' : 's'}</title></rect>`;
                }).join('')}
            </svg>
            <p class="dash-muted" style="margin-top:var(--space-2)"><strong>${eng.edits30d}</strong> profile edits in the last 30 days
                (${series.length} active day${series.length === 1 ? '' : 's'}); <strong>${eng.staffUpdatedCount}</strong> staff have updated their own CV.</p>`;
    } else {
        svg = '<p class="dash-muted">No audit activity in the last 30 days.</p>';
    }
    el.innerHTML = svg;
}

function renderSkills() {
    const top = payload.skills.top || [];
    const el = document.getElementById('dash-skills');
    if (top.length === 0) {
        el.innerHTML = '<p class="dash-muted">No skills recorded yet.</p>';
        return;
    }
    const max = top[0].staff;
    el.innerHTML = top.map(s => barRow(s.name, s.staff, max, `${s.staff} staff`)).join('');
}

function renderProjects() {
    const proj = payload.projects;
    const hc = payload.headcount;
    const el = document.getElementById('dash-projects');
    const coverage = hc.total > 0 ? Math.round((proj.staffWithProjects / hc.total) * 100) : 0;
    el.innerHTML = `
        <div class="stat-tiles" style="margin-bottom:var(--space-4)">
            <div class="stat-tile"><span class="num">${proj.catalogTotal}</span><span class="lbl">Catalog projects</span></div>
            <div class="stat-tile"><span class="num">${proj.managedTotal}</span><span class="lbl">Coordinator-managed</span></div>
            <div class="stat-tile"><span class="num">${proj.staffWithProjects}</span><span class="lbl">Staff with active projects</span></div>
        </div>
        ${barRow('Staff with ≥ 1 project', proj.staffWithProjects, hc.total, `${coverage}% of ${hc.total}`)}
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
            html += `<div class="dash-alert danger">⛔ <span><strong>${cert.expired}</strong> certification${cert.expired === 1 ? '' : 's'} already expired — renew or remove.</span></div>`;
        }
        if (cert.expiring90d > 0) {
            html += `<div class="dash-alert warning">⚠️ <span><strong>${cert.expiring90d}</strong> certification${cert.expiring90d === 1 ? '' : 's'} expiring within 90 days.</span></div>`;
        }
        if (cert.expired === 0 && cert.expiring90d === 0) {
            html += '<div class="dash-alert success">✅ No certifications expiring within 90 days.</div>';
        }
        html += `<p class="dash-muted">${cert.total} certifications on file for staff in this view.</p>`;
    }
    el.innerHTML = html;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
