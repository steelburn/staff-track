/**
 * StaffTrack — Department × Project Analysis (pies + treemap, linked)
 *
 * For higher management: projects per DEPARTMENT, per TEAM (reporting line),
 * and per INDIVIDUAL. Fetches /api/reports/projects and renders:
 *   • pie 1 — assignments by department
 *   • pie 2 — assignments by project type
 *   • treemap — switchable: Department → projects | Team → projects | Person → projects
 *
 * Linked: pie slice clicks filter the treemap (chip bar shows active filters,
 * ✕ clears); treemap project tiles open the staff list panel; person tiles
 * open that person's project list. Theme-aware via CSS vars (repainted ~60ms
 * after a theme toggle, reporting.js pattern).
 *
 * Access: server-gated by requireReporterOrManager. 403 → "Access restricted"
 * (no retry); other failures → "Couldn't load analysis" + Try again.
 */
'use strict';

const authUser = requireAuth();

// ── State ─────────────────────────────────────────────────────────────────────
let includeInactive = false; // default: inactive staff filtered out (server default)
let projectsCache = null;    // last good /api/reports/projects payload
let data = null;             // buildData() result
let view = 'dept';           // treemap view: 'dept' | 'team' | 'person'
let deptFilter = null;       // normalized dept key (null = all)
let typeFilter = null;       // project type label (null = all)
let abortCtrl = null;
const charts = {};           // id -> echarts instance

// ── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (typeof renderSidebarNav === 'function') {
        renderSidebarNav('dept-project-map');
    } else if (typeof renderNav === 'function') {
        renderNav('dept-project-map');
    }
    if (typeof ThemeManager !== 'undefined') {
        ThemeManager.updateToggleButtons();
    }
    if (typeof Toast !== 'undefined') {
        Toast.init();
    }

    wireInactiveToggle();
    wireThemeRepaint();
    wirePanelClose();
    wireTabs();
    wireChips();
    const retryBtn = document.getElementById('dmap-retry');
    if (retryBtn) retryBtn.addEventListener('click', () => load());
    window.addEventListener('resize', () => {
        Object.values(charts).forEach(c => { try { c.resize(); } catch (e) { /* noop */ } });
    });
    load();
});

/* ── status strip ─────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

function showStatus(which, title, msg, canRetry) {
    $('dmap-loading').hidden = which !== 'loading';
    $('dmap-error').hidden = which !== 'error';
    if (which === 'error') {
        $('dmap-error-title').textContent = title;
        $('dmap-error-text').textContent = msg || '';
        $('dmap-error-icon').textContent = title === 'Access restricted' ? '🚫' : '⚠️';
        $('dmap-retry').hidden = !canRetry;
    }
}

function hideStatus() {
    $('dmap-loading').hidden = true;
    $('dmap-error').hidden = true;
}

/* ── data ─────────────────────────────────────────────────────────────────── */
// Case/whitespace-insensitive key (same normalization as the rest of the app):
// "PROJECT MANAGEMENT OFFICE" === "Project Management Office".
function normKey(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function classifyTypes(p) {
    const t = [];
    if (p.type_infra) t.push('Infra');
    if (p.type_software) t.push('Software');
    if (p.type_infra_support) t.push('Infra Support');
    if (p.type_software_support) t.push('SW Support');
    return t;
}

function buildData(projects) {
    const depts = new Map();   // deptKey -> { key, name, assignments, staff:Set, projects: Map }
    const teams = new Map();   // manager  -> { name, assignments, staff:Set, depts:Set, projects: Map }
    const persons = new Map(); // email    -> { email, name, deptKey, deptName, manager, assignments, projects: Map }
    const byKey = new Map();   // projKey  -> { key, name, types, assignments }

    (projects || []).forEach(p => {
        const key = normKey(p.soc || p.project_name) || '(unknown)';
        if (!byKey.has(key)) {
            byKey.set(key, { key, name: p.project_name || p.soc || '(unknown)', types: classifyTypes(p), assignments: 0 });
        }
        const proj = byKey.get(key);
        proj.assignments += (p.submissions || []).length;
        (p.submissions || []).forEach(sub => {
            const email = String(sub.staff_email || '').trim().toLowerCase();
            if (!email) return;
            const dk = normKey(sub.department) || 'unspecified';
            const deptName = String(sub.department || '').trim() || 'Unspecified';
            const manager = String(sub.manager_name || '').trim() || 'Unassigned';
            const staffEntry = { name: sub.staff_name || email, email, role: sub.role || '', deptKey: dk };

            // department
            if (!depts.has(dk)) {
                depts.set(dk, { key: dk, name: deptName, assignments: 0, staff: new Set(), projects: new Map() });
            }
            const dept = depts.get(dk);
            dept.assignments++;
            dept.staff.add(email);
            if (!dept.projects.has(key)) dept.projects.set(key, { key, name: proj.name, types: proj.types, count: 0, staff: [] });
            const dp = dept.projects.get(key);
            dp.count++;
            dp.staff.push(staffEntry);

            // team (reporting line)
            if (!teams.has(manager)) {
                teams.set(manager, { name: manager, assignments: 0, staff: new Set(), depts: new Set(), projects: new Map() });
            }
            const team = teams.get(manager);
            team.assignments++;
            team.staff.add(email);
            team.depts.add(dk);
            if (!team.projects.has(key)) team.projects.set(key, { key, name: proj.name, types: proj.types, count: 0, staff: [] });
            const tp = team.projects.get(key);
            tp.count++;
            tp.staff.push(staffEntry);

            // individual
            if (!persons.has(email)) {
                persons.set(email, { email, name: sub.staff_name || email, deptKey: dk, deptName, manager, assignments: 0, projects: new Map() });
            }
            const person = persons.get(email);
            person.assignments++;
            if (!person.projects.has(key)) person.projects.set(key, { key, name: proj.name, count: 0 });
            person.projects.get(key).count++;
        });
    });

    // dedupe staff per (dept|team, project) pair
    [depts, teams].forEach(m => m.forEach(x => x.projects.forEach(dp => {
        const seen = new Set();
        dp.staff = dp.staff.filter(s => !seen.has(s.email) && seen.add(s.email));
    })));

    // assignments per type (project primary type)
    const types = new Map();
    byKey.forEach(p => {
        const t = p.types[0] || 'Unspecified';
        types.set(t, (types.get(t) || 0) + p.assignments);
    });

    const links = [...depts.values()].reduce((a, d) => a + d.projects.size, 0);
    return {
        depts: [...depts.values()].sort((a, b) => b.assignments - a.assignments),
        teams: [...teams.values()].sort((a, b) => b.assignments - a.assignments),
        persons: [...persons.values()].sort((a, b) => b.assignments - a.assignments),
        types: [...types.entries()].sort((a, b) => b[1] - a[1]),
        byKey,
        departments: depts.size,
        projects: byKey.size,
        links,
        staff: persons.size,
        isEmpty: depts.size === 0 || links === 0,
    };
}

async function fetchProjects() {
    const qs = includeInactive ? '?include_inactive=true' : '';
    const res = await window.StaffTrackAuth.apiFetch(`/api/reports/projects${qs}`, { signal: abortCtrl ? abortCtrl.signal : undefined });
    if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

async function load() {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    const timer = setTimeout(() => abortCtrl.abort(), 20000);
    showStatus('loading', '', '', false);
    try {
        const projects = await fetchProjects();
        clearTimeout(timer);
        projectsCache = projects;
        data = buildData(projects);
        deptFilter = null;
        typeFilter = null;
        hideStatus();
        renderAll();
    } catch (e) {
        clearTimeout(timer);
        if (e && e.name === 'AbortError') {
            showStatus('error', "Couldn't load analysis", 'Request timed out — check your connection and retry.', true);
        } else if (e && e.status === 403) {
            showStatus('error', 'Access restricted', 'You need admin, HR or coordinator access to view this analysis.', false);
        } else {
            showStatus('error', "Couldn't load analysis", (e && e.message) || 'Unexpected error.', true);
        }
    }
}

/* ── ECharts helpers (theme-aware, reporting.js pattern) ──────────────────── */
function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartColors() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
        primary: cssVar('--color-primary') || '#6366f1',
        text: cssVar('--color-text-primary') || '#0f172a',
        muted: cssVar('--color-text-muted') || '#94a3b8',
        border: cssVar('--color-border') || '#e2e8f0',
        surface: cssVar('--color-bg-surface') || '#ffffff',
        type: {
            'Infra': '#3b82f6',
            'Software': '#10b981',
            'Infra Support': '#f59e0b',
            'SW Support': '#ef4444',
            'Unspecified': dark ? '#475569' : '#94a3b8',
        },
    };
}

// Deterministic per-name hue so a department keeps its colour across pie AND
// treemap (and across re-renders). Lightness is theme-aware so the tile
// LABEL keeps contrast: darker tiles + white text in light mode, lighter
// tiles + dark text in dark mode (KN: text must be readable on the tiles).
function deptColor(name) {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return `hsl(${hue}, ${dark ? 55 : 62}%, ${dark ? 68 : 42}%)`;
}

// Text colour that contrasts with the colored tiles/slices above.
function tileLabelColor() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? '#0f172a' : '#ffffff';
}

function mkChart(id) {
    const el = document.getElementById(id);
    if (!el || typeof echarts === 'undefined') return null;
    try {
        // Reuse an existing instance (filter/view changes re-render without
        // disposing); echarts.init on an initialized dom warns/errors.
        const existing = echarts.getInstanceByDom(el);
        if (existing) return existing;
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

/* ── rendering ────────────────────────────────────────────────────────────── */
function renderAll() {
    // Unhide BEFORE init — echarts.init on a hidden (0-size) container falls
    // back to a 100px canvas and never recovers (dashboard lesson, 2026-08-26).
    $('dmap-body').hidden = false;
    $('dmap-content').hidden = false;
    disposeCharts();
    renderKpis();
    renderDeptPie();
    renderTypePie();
    renderTreemap();
    renderChips();
    renderTabs();
}

function renderKpis() {
    const tiles = [
        { v: data.departments, l: 'Departments' },
        { v: data.projects, l: 'Projects' },
        { v: data.links, l: 'Dept↔Project links' },
        { v: data.staff, l: 'Staff assigned' },
    ];
    $('dmap-kpis').innerHTML = tiles.map(t => `
        <div class="dmap-kpi">
            <div class="dmap-kpi-value">${t.v}</div>
            <div class="dmap-kpi-label">${t.l}</div>
        </div>`).join('');
    $('dmap-empty-card').hidden = !data.isEmpty;
    $('treemap-card').hidden = data.isEmpty;
    const grid = document.getElementById('dmap-grid');
    if (grid) grid.hidden = data.isEmpty;
}

function pieBase(colors) {
    return {
        tooltip: { trigger: 'item', formatter: '{b}: {c} assignments ({d}%)' },
        legend: {
            type: 'scroll',
            orient: 'vertical',
            right: 8,
            top: 'middle',
            textStyle: { color: colors.muted, fontSize: 11 },
        },
        series: [{
            type: 'pie',
            radius: ['32%', '64%'],
            center: ['38%', '50%'],
            minAngle: 3,
            avoidLabelOverlap: true,
            itemStyle: { borderColor: colors.surface, borderWidth: 2, borderRadius: 4 },
            label: { color: colors.text, fontSize: 11, formatter: '{b} {d}%' },
            labelLine: { lineStyle: { color: colors.border } },
            emphasis: { scaleSize: 6 },
            data: [],
        }],
    };
}

function renderDeptPie() {
    const chart = mkChart('chart-depts-pie');
    if (!chart) return;
    const colors = chartColors();
    const option = pieBase(colors);
    option.series[0].data = data.depts.map(d => ({ name: d.name, value: d.assignments }));
    option.color = data.depts.map(d => deptColor(d.name));
    chart.setOption(option);
    chart.on('click', (params) => toggleDeptFilter(normKey(params.name)));
    if (deptFilter) highlightPie(chart, data.depts.find(d => d.key === deptFilter)?.name);
}

function renderTypePie() {
    const chart = mkChart('chart-types-pie');
    if (!chart) return;
    const colors = chartColors();
    const option = pieBase(colors);
    option.series[0].data = data.types.map(([name, value]) => ({ name, value }));
    option.color = data.types.map(([name]) => colors.type[name] || colors.muted);
    chart.setOption(option);
    chart.on('click', (params) => toggleTypeFilter(params.name));
    if (typeFilter) highlightPie(chart, typeFilter);
}

function highlightPie(chart, name) {
    try {
        chart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
        if (name) chart.dispatchAction({ type: 'highlight', seriesIndex: 0, name });
    } catch (e) { /* noop */ }
}

/* ── treemap (per view) ───────────────────────────────────────────────────── */
// Filters apply per view:
//   dept view:   deptFilter → only that department's tree
//   team view:   deptFilter → keep teams with staff on a project that involves
//                the filtered department (project-level match)
//   person view: deptFilter → people whose own department matches
//   typeFilter:  all views → keep projects of the matching type
function treemapData() {
    const colors = chartColors();
    // Leaf tiles carry rootName (dept/team/person) so the click handler builds
    // the panel title without relying on treePathInfo, and so the test hook can
    // drive clicks deterministically.
    const projLeaf = (dp, rootName) => ({ name: dp.name, value: dp.count, staff: dp.staff, rootName });
    const passesType = (dp) => {
        if (!typeFilter) return true;
        return (dp.types[0] || 'Unspecified') === typeFilter;
    };
    const root = (name, color, children) => ({
        name,
        itemStyle: { color },
        children: children.length ? children : undefined,
    });

    if (view === 'team') {
        const roots = [];
        data.teams.forEach(t => {
            const children = [...t.projects.values()]
                .filter(dp => passesType(dp) && (!deptFilter || dp.staff.some(s => s.deptKey === deptFilter)))
                .map(dp => projLeaf(dp, t.name));
            if (children.length) {
                roots.push(root(t.name, deptColor(t.name), children));
            }
        });
        return roots;
    }

    if (view === 'person') {
        const roots = [];
        data.persons.forEach(p => {
            if (deptFilter && p.deptKey !== deptFilter) return;
            const children = [...p.projects.values()]
                .filter(dp => passesType({ types: data.byKey.get(dp.key)?.types || [] }))
                .map(dp => projLeaf(dp, p.name));
            if (children.length) {
                // colour by the person's DEPARTMENT so departments cluster visually
                roots.push(root(p.name, deptColor(p.deptName), children));
            }
        });
        return roots;
    }

    // dept view
    let depts = data.depts;
    if (deptFilter) depts = depts.filter(d => d.key === deptFilter);
    const roots = [];
    depts.forEach(d => {
        const children = [...d.projects.values()].filter(passesType).map(dp => projLeaf(dp, d.name));
        if (children.length) roots.push(root(d.name, deptColor(d.name), children));
    });
    return roots;
}

const VIEW_HINTS = {
    dept: 'tile size = staff assigned · click a department tile to filter, a project tile for the staff list',
    team: 'teams = reporting line (manager) · tile size = staff assigned · click a project tile for the staff list',
    person: 'tile size = projects per person · colour = department · click a person tile for their projects',
};

function renderTreemap() {
    const chart = mkChart('chart-treemap');
    if (!chart) return;
    const colors = chartColors();
    const labelColor = tileLabelColor();
    const upperBg = document.documentElement.getAttribute('data-theme') === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.20)';
    const hint = $('treemap-hint');
    if (hint) hint.textContent = VIEW_HINTS[view] || '';
    chart.setOption({
        tooltip: {
            formatter: (info) => {
                if (!info.data) return '';
                const d = info.data;
                // Leaf = one project tile: the staff list lives on the tile.
                if (d.staff) return `<b>${d.rootName ? d.rootName + ' → ' : ''}${d.name}</b><br/>${d.value} staff`;
                // Non-leaf (dept/team/person root) carries no own `value`;
                // sum its children so we don't print "undefined assignments".
                const sum = (d.children || []).reduce((s, c) => s + (Number(c.value) || 0), 0);
                if (d.children && d.children.length) return `<b>${d.name}</b><br/>${sum} assignments`;
                return `<b>${d.name}</b><br/>${Number(d.value) || 0} assignments`;
            },
        },
        series: [{
            type: 'treemap',
            roam: true,
            nodeClick: false, // custom filtering/panels via chart.on('click')
            breadcrumb: { show: false },
            visibleMin: 2,
            // label colour contrasts with the tile fill (KN: text readability)
            label: { show: true, formatter: '{b}', fontSize: 11, color: labelColor, overflow: 'truncate' },
            upperLabel: { show: true, height: 20, color: labelColor, backgroundColor: upperBg, fontSize: 11, formatter: '{b}' },
            itemStyle: { borderColor: colors.surface, borderWidth: 2, gapWidth: 2 },
            levels: [
                { itemStyle: { borderColor: colors.surface, borderWidth: 2, gapWidth: 3 } },
                { colorSaturation: [0.35, 0.55], itemStyle: { borderColor: colors.surface, borderWidth: 2 } },
            ],
            data: treemapData(),
        }],
    });
    // mkChart() reuses the live instance (only renderAll() disposes), and this
    // function is re-invoked on every filter toggle / tab switch — so drop any
    // previously bound handler first. Otherwise each re-render stacks another
    // click listener: a dept-tile click then fires N handlers and with even N
    // the filter toggles on and immediately off (drill-down silently stops).
    chart.off('click');
    chart.on('click', (params) => handleTreemapClick(params));
}

// Shared by the chart click AND the test hook (window.StaffTrackDeptTest) —
// the panel title comes from leaf.rootName, not treePathInfo, so both paths
// behave identically.
function handleTreemapClick(params) {
    if (!params || !params.data) return;
    const d = params.data;
    if (d.staff) {
        // project tile → staff list
        const title = d.rootName ? `${d.rootName} → ${d.name}` : d.name;
        showPanel(title, `${d.value} staff on this project`,
            d.staff.map(s => ({ label: s.name, value: s.role || '', href: `/cv-profile.html?email=${encodeURIComponent(s.email || '')}` })));
    } else if (d.children && view === 'dept') {
        // department tile → drill down
        toggleDeptFilter(normKey(d.name));
    } else if (d.children && view === 'person') {
        // person tile → their projects
        const person = data.persons.find(p => p.name === d.name);
        if (person) {
            showPanel(person.name, `${d.value} assignments`,
                [...person.projects.values()].sort((a, b) => b.count - a.count).map(dp => ({
                    label: dp.name,
                    value: `${dp.count} project${dp.count === 1 ? '' : 's'}`,
                })));
        }
    }
}

/* ── filters ─────────────────────────────────────────────────────────────── */
function toggleDeptFilter(key) {
    deptFilter = deptFilter === key ? null : key;
    renderTreemap();
    renderChips();
    const pie = charts['chart-depts-pie'];
    if (pie) highlightPie(pie, data.depts.find(d => d.key === deptFilter)?.name);
}

function toggleTypeFilter(name) {
    typeFilter = typeFilter === name ? null : name;
    renderTreemap();
    renderChips();
    const pie = charts['chart-types-pie'];
    if (pie) highlightPie(pie, typeFilter);
}

function renderChips() {
    const chips = [];
    if (deptFilter) {
        const d = data.depts.find(x => x.key === deptFilter);
        chips.push({ key: 'dept', label: d ? d.name : deptFilter });
    }
    if (typeFilter) chips.push({ key: 'type', label: typeFilter });
    $('dmap-chips').innerHTML = chips.map(c => `
        <span class="dmap-chip" data-chip="${c.key}">${escapeHtml(c.label)} <button class="dmap-chip-x" data-chip-x="${c.key}" title="Clear filter">✕</button></span>`).join('');
}

function wireChips() {
    const chips = $('dmap-chips');
    if (chips) {
        chips.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-chip-x]');
            if (!btn) return;
            if (btn.dataset.chipX === 'dept') toggleDeptFilter(deptFilter);
            else toggleTypeFilter(typeFilter);
        });
    }
}

/* ── view tabs ───────────────────────────────────────────────────────────── */
function renderTabs() {
    document.querySelectorAll('#dmap-tabs .dmap-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
}

function wireTabs() {
    const tabs = $('dmap-tabs');
    if (!tabs) return;
    tabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.dmap-tab');
        if (!btn || btn.dataset.view === view) return;
        view = btn.dataset.view;
        $('dmap-panel').hidden = true;
        renderTabs();
        renderTreemap();
    });
}

/* ── detail panel ────────────────────────────────────────────────────────── */
// rows: [{ label, value?, href? }]
function showPanel(title, subtitle, rows) {
    $('dmap-panel-kind').textContent = 'Detail';
    $('dmap-panel-title').textContent = title;
    $('dmap-panel-sub').textContent = subtitle;
    $('dmap-panel-list').innerHTML = rows
        .slice()
        .sort((a, b) => (a.label || '').localeCompare(b.label || ''))
        .map(r => `
            <div class="dmap-panel-row">
                ${r.href
                    ? `<a class="dmap-panel-name" href="${r.href}" target="_blank" rel="noopener">${escapeHtml(r.label)}</a>`
                    : `<span class="dmap-panel-name">${escapeHtml(r.label)}</span>`}
                ${r.value ? `<span class="dmap-panel-value">${escapeHtml(r.value)}</span>` : ''}
            </div>`).join('');
    $('dmap-panel').hidden = false;
}

function wirePanelClose() {
    const closeBtn = $('dmap-panel-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { $('dmap-panel').hidden = true; });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('dmap-panel').hidden) $('dmap-panel').hidden = true;
    });
}

/* ── misc helpers ─────────────────────────────────────────────────────────── */
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/* ── wiring ───────────────────────────────────────────────────────────────── */
function wireInactiveToggle() {
    const toggle = document.getElementById('toggle-inactive');
    if (toggle) {
        toggle.addEventListener('change', (e) => {
            includeInactive = e.target.checked;
            load();
        });
    }
}

function wireThemeRepaint() {
    const btn = document.querySelector('[data-theme-toggle]');
    if (btn) {
        btn.addEventListener('click', () => {
            setTimeout(() => {
                if (data) renderAll(); // dispose + re-init picks up flipped CSS vars
            }, 60);
        });
    }
}

// Test/automation hook (review-dept-map.cjs). Canvas hit-testing for treemap
// tiles is unreliable (roam/upperLabel transforms shift layout vs render), so
// the harness drives the SAME handlers the chart clicks use.
window.StaffTrackDeptTest = {
    clickTreemapNode(name) {
        const chart = charts['chart-treemap'];
        if (!chart) return false;
        const opt = chart.getOption();
        const find = (nodes) => {
            for (const n of nodes || []) {
                if (n.name === name) return n;
                const f = find(n.children);
                if (f) return f;
            }
            return null;
        };
        const node = find(opt.series[0].data);
        if (!node) return false;
        handleTreemapClick({ data: node });
        return true;
    },
    clickSlice(chartId, name) {
        if (chartId === 'chart-depts-pie') toggleDeptFilter(normKey(name));
        else if (chartId === 'chart-types-pie') toggleTypeFilter(name);
        return true;
    },
};
