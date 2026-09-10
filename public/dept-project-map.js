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
let empFilter = null;        // normalized employment-type key (null = all)
let abortCtrl = null;
let staffFilter = '';        // individual-staff search ('' = all)
let staffSearchTimer = null; // debounce for the treemap staff search
let drawerState = null;      // { dim: 'dept'|'type'|'emp', key, label } | null
let drawerPeople = [];       // people shown in the open drawer
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
    wireStaffSearch();
    wireDrawer();
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

/* ── individual-staff search helpers ─────────────────────────────────────── */
function staffQuery() {
    return staffFilter.trim().toLowerCase();
}

// A staff entry is any object with `name` and/or `email` (person view uses the
// person record itself, dept/team views use the per-project `staff` entries).
function staffMatch(entry, q) {
    if (!q) return true;
    if (!entry) return false;
    return String(entry.name || '').toLowerCase().includes(q) ||
        String(entry.email || '').toLowerCase().includes(q);
}

function matchingStaffCount() {
    const q = staffQuery();
    if (!q || !data) return 0;
    return data.persons.filter(p => staffMatch(p, q)).length;
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
    const persons = new Map(); // email    -> { email, name, deptKey, deptName, manager, empKey, empName, assignments, projects: Map }
    const byKey = new Map();   // projKey  -> { key, name, types, assignments }
    const empTypes = new Map(); // empKey  -> { key, name, assignments }
    const segments = [];       // one entry per assignment (submission) — the
                               // flat list the cross-filtered pies aggregate

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
            // Employment type comes from the BeeSuite staff sync (blank -> Unspecified).
            const empKey = normKey(sub.employee_type) || 'unspecified';
            const empName = String(sub.employee_type || '').trim() || 'Unspecified';
            const staffEntry = { name: sub.staff_name || email, email, role: sub.role || '', deptKey: dk, empKey, empName };

            // Flat assignment record: one row per (staff, project) submission.
            // All three pies aggregate this list, so a filter on one dimension
            // can narrow the other two (cross-filtering).
            segments.push({
                email, name: sub.staff_name || email, role: sub.role || '',
                deptKey: dk, deptName, manager,
                empKey, empName,
                projKey: key, projName: proj.name,
                typeKey: proj.types[0] || 'Unspecified',
            });

            if (!empTypes.has(empKey)) empTypes.set(empKey, { key: empKey, name: empName, assignments: 0 });
            empTypes.get(empKey).assignments++;

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
                persons.set(email, { email, name: sub.staff_name || email, deptKey: dk, deptName, manager, empKey, empName, assignments: 0, projects: new Map() });
            }
            const person = persons.get(email);
            person.assignments++;
            if (!person.projects.has(key)) person.projects.set(key, { key, name: proj.name, count: 0, staff: [] });
            const pperson = person.projects.get(key);
            pperson.count++;
            pperson.staff.push(staffEntry);
        });
    });

    // dedupe staff per (dept|team|person, project) pair
    [depts, teams, persons].forEach(m => m.forEach(x => x.projects.forEach(dp => {
        const seen = new Set();
        dp.staff = dp.staff.filter(s => !seen.has(s.email) && seen.add(s.email));
    })));

    // assignments per type (project primary type)
    const types = new Map();
    byKey.forEach(p => {
        const t = p.types[0] || 'Unspecified';
        types.set(t, (types.get(t) || 0) + p.assignments);
    });

    // Dynamic employment-type list (blanks already normalised to "Unspecified")
    // plus a short unique code per type for the treemap tooltip + legend.
    const employmentTypes = [...empTypes.values()].sort((a, b) => b.assignments - a.assignments);
    uniqueEmpCodes(employmentTypes.map(t => t.name)).forEach((code, i) => { employmentTypes[i].code = code; });

    const links = [...depts.values()].reduce((a, d) => a + d.projects.size, 0);
    return {
        depts: [...depts.values()].sort((a, b) => b.assignments - a.assignments),
        teams: [...teams.values()].sort((a, b) => b.assignments - a.assignments),
        persons: [...persons.values()].sort((a, b) => b.assignments - a.assignments),
        types: [...types.entries()].sort((a, b) => b[1] - a[1]),
        employmentTypes,
        segments,
        byKey,
        departments: depts.size,
        projects: byKey.size,
        links,
        staff: persons.size,
        isEmpty: depts.size === 0 || links === 0,
    };
}

/* ── cross-filtering (assignment segments) ───────────────────────────────── */
// One predicate over an assignment segment. `skip` is the dimension OWNED by
// the chart being rendered: a pie never filters on its own slice (otherwise it
// would collapse to a single 100% slice) but it DOES respect the other two.
function segMatch(s, skip) {
    if (skip !== 'dept' && deptFilter && s.deptKey !== deptFilter) return false;
    if (skip !== 'type' && typeFilter && s.typeKey !== typeFilter) return false;
    if (skip !== 'emp' && empFilter && s.empKey !== empFilter) return false;
    return true;
}

// Aggregate assignment segments by one dimension, respecting every active
// slice filter EXCEPT that dimension. With no filters active this reproduces
// the plain distribution exactly (same counts as dept.assignments / types).
function aggregateSegments(dim) {
    const keyFn = dim === 'dept' ? (s => s.deptKey) : dim === 'type' ? (s => s.typeKey) : (s => s.empKey);
    const nameFn = dim === 'dept' ? (s => s.deptName) : dim === 'type' ? (s => s.typeKey) : (s => s.empName);
    const m = new Map();
    (data.segments || []).forEach(s => {
        if (!segMatch(s, dim)) return;
        const k = keyFn(s);
        if (!m.has(k)) m.set(k, { key: k, name: nameFn(s), assignments: 0 });
        m.get(k).assignments++;
    });
    return [...m.values()].sort((a, b) => b.assignments - a.assignments);
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
        empFilter = null;
        staffFilter = '';
        closeDrawer();
        const searchInput = $('dmap-staff-search');
        if (searchInput) searchInput.value = '';
        syncStaffSearchUi();
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
        emp: {
            'permanent': '#10b981',
            'contract': '#6366f1',
            'temporary': '#d97706',
            'intern': '#7dcfff',
            'unspecified': dark ? '#475569' : '#94a3b8',
        },
    };
}

// Employment-type colour keyed by the NORMALIZED label (lowercase); any
// unknown/free-form BeeSuite value falls back to the muted colour.
function empColor(key) {
    const c = chartColors();
    return c.emp[key] || c.muted;
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
    renderEmploymentPie();
    renderTreemap();
    renderChips();
    renderEmpLegend();
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
            // Selected slice pops outward — the same click feedback as the Dashboard.
            selectedMode: 'single',
            selectedOffset: 10,
            itemStyle: { borderColor: colors.surface, borderWidth: 2, borderRadius: 4 },
            label: { color: colors.text, fontSize: 11, formatter: '{b} {d}%' },
            labelLine: { lineStyle: { color: colors.border } },
            emphasis: { scaleSize: 6 },
            data: [],
        }],
    };
}

// Each pie ignores only its OWN dimension's filter (cross-filtering); the
// pop-out selection is restored after every re-render.
const DIM_CHART = { dept: 'chart-depts-pie', type: 'chart-types-pie', emp: 'chart-employment-pie' };

function selectSliceInPie(chart, name) {
    if (!chart || !name) return;
    try { chart.dispatchAction({ type: 'select', seriesIndex: 0, name }); } catch (e) { /* noop */ }
}

function unselectSliceInPie(chart, name) {
    if (!chart || !name) return;
    try { chart.dispatchAction({ type: 'unselect', seriesIndex: 0, name }); } catch (e) { /* noop */ }
}

function renderDeptPie() {
    const chart = mkChart('chart-depts-pie');
    if (!chart) return;
    const colors = chartColors();
    const option = pieBase(colors);
    const rows = aggregateSegments('dept');
    option.series[0].data = rows.map(d => ({ name: d.name, value: d.assignments }));
    option.color = rows.map(d => deptColor(d.name));
    // Pies are re-rendered on every filter change WITHOUT a dispose, so use
    // notMerge (drop stale legend entries) and drop the previous click handler
    // (otherwise handlers stack and one click fires N times).
    chart.setOption(option, { notMerge: true });
    chart.off('click');
    chart.on('click', (params) => selectSlice('dept', normKey(params.name)));
    if (deptFilter) highlightPie(chart, rows.find(d => d.key === deptFilter)?.name);
    if (drawerState && drawerState.dim === 'dept') selectSliceInPie(chart, drawerState.label);
}

function renderTypePie() {
    const chart = mkChart('chart-types-pie');
    if (!chart) return;
    const colors = chartColors();
    const option = pieBase(colors);
    const rows = aggregateSegments('type');
    option.series[0].data = rows.map(d => ({ name: d.name, value: d.assignments }));
    option.color = rows.map(d => colors.type[d.name] || colors.muted);
    chart.setOption(option, { notMerge: true });
    chart.off('click');
    chart.on('click', (params) => selectSlice('type', params.name));
    if (typeFilter) highlightPie(chart, typeFilter);
    if (drawerState && drawerState.dim === 'type') selectSliceInPie(chart, drawerState.label);
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
//   staffFilter: all views → keep only assignments involving matching staff
//                (person view: matching person roots; dept/team: project tiles
//                 that still have ≥1 matching staff, resized to the match count)
// Shortest unique uppercase prefix for each label (Permanent→P, Contract→C,
// Unspecified→U). Collisions widen automatically, so a future "Consultant"
// beside "Contract" yields Cont/Cons instead of two C's. Fully dynamic.
function uniqueEmpCodes(names) {
    const norm = names.map(n => String(n || '').toUpperCase());
    return norm.map((up, i) => {
        for (let len = 1; len <= up.length; len++) {
            const pre = up.slice(0, len);
            if (!norm.some((o, j) => j !== i && o.slice(0, len) === pre)) return pre;
        }
        return up; // one label is a prefix of another → fall back to the full label
    });
}

// " (P:3, C:2, U:1)" for the employment mix of a list of staff/assignment
// entries. Driven entirely by data.employmentTypes (order + codes), so it
// tracks new types automatically and stays in sync with the pie + legend.
function empBreakdown(entries) {
    if (!data || !Array.isArray(data.employmentTypes) || !Array.isArray(entries) || !entries.length) return '';
    const counts = new Map();
    entries.forEach(s => {
        if (!s) return;
        const k = s.empKey || 'unspecified';
        counts.set(k, (counts.get(k) || 0) + 1);
    });
    const parts = data.employmentTypes
        .filter(t => counts.get(t.key))
        .map(t => `${t.code}:${counts.get(t.key)}`);
    return parts.length ? ` (${parts.join(', ')})` : '';
}

// Treemap tooltip. Leaf = one project tile (staff list on the tile); non-leaf
// = dept/team/person root (no own value → sum the children). Both append the
// employment-type breakdown, e.g. "74 assignments (P:40, C:30, U:4)".
function treemapTooltip(info) {
    if (!info || !info.data) return '';
    const d = info.data;
    const q = staffQuery();
    // Leaf = one project tile: the staff list lives on the tile. In person view
    // the tile counts that person's submissions, so keep the "assignment" unit.
    if (d.staff) {
        const personView = view === 'person';
        const unit = personView
            ? `assignment${(Number(d.value) || 0) === 1 ? '' : 's'}`
            : `${q ? 'matching ' : ''}staff`;
        return `<b>${d.rootName ? d.rootName + ' → ' : ''}${d.name}</b><br/>`
            + `${d.value} ${unit}${empBreakdown(d.staff)}`;
    }
    const sum = (d.children || []).reduce((s, c) => s + (Number(c.value) || 0), 0);
    if (d.children && d.children.length) {
        const kids = d.children.reduce((a, c) => a.concat(c.staff || []), []);
        return `<b>${d.name}</b><br/>${sum} assignments${empBreakdown(kids)}`;
    }
    return `<b>${d.name}</b><br/>${Number(d.value) || 0} assignments${empBreakdown(d.staff || [])}`;
}

function treemapData() {
    const colors = chartColors();
    const q = staffQuery();
    // Leaf tiles carry rootName (dept/team/person) so the click handler builds
    // the panel title without relying on treePathInfo, and so the test hook can
    // drive clicks deterministically. When a staff search is active the leaf's
    // staff list is narrowed to the matches and the tile value becomes the
    // match count, so tile size answers "who/how many match in this project".
    const projLeaf = (dp, rootName) => {
        let staff = dp.staff;
        let value = dp.count;
        // Narrow the leaf's staff list to the active staff-search AND/OR
        // employment-type filter, and size the tile by the match count so tile
        // size answers "how many match in this project".
        if ((q || empFilter) && Array.isArray(dp.staff)) {
            staff = dp.staff.filter(s =>
                (!q || staffMatch(s, q)) && (!empFilter || s.empKey === empFilter));
            value = staff.length;
        }
        return { name: dp.name, value, staff, rootName };
    };
    const passesType = (dp) => {
        if (!typeFilter) return true;
        return (dp.types[0] || 'Unspecified') === typeFilter;
    };
    const passesStaff = (staff) => {
        if (!Array.isArray(staff)) return true;
        if (q && !staff.some(s => staffMatch(s, q))) return false;
        if (empFilter && !staff.some(s => s.empKey === empFilter)) return false;
        return true;
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
                .filter(dp => passesType(dp)
                    && (!deptFilter || dp.staff.some(s => s.deptKey === deptFilter))
                    && passesStaff(dp.staff))
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
            if (empFilter && p.empKey !== empFilter) return;
            if (q && !staffMatch(p, q)) return;
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
        const children = [...d.projects.values()]
            .filter(passesType)
            .filter(dp => passesStaff(dp.staff))
            .map(dp => projLeaf(dp, d.name));
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
    const q = staffQuery();
    const tree = treemapData();
    const labelColor = tileLabelColor();
    const upperBg = document.documentElement.getAttribute('data-theme') === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.20)';
    const hint = $('treemap-hint');
    if (hint) {
        let text = VIEW_HINTS[view] || '';
        if (q) {
            const n = matchingStaffCount();
            text = n
                ? `${n} staff match “${staffFilter.trim()}” · ${text}`
                : `No staff match “${staffFilter.trim()}”`;
        }
        hint.textContent = text;
    }
    chart.setOption({
        tooltip: {
            formatter: treemapTooltip,
            confine: true,
            // Long project titles would otherwise stretch the tooltip across the
            // screen; wrap them and keep the breakdown readable.
            extraCssText: 'max-width: 380px; white-space: normal; line-height: 1.45;',
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
            data: tree,
        }],
    });
    // Filters (dept/type/staff) can exclude every tile. Explain the blank canvas
    // instead of leaving a silent empty chart.
    const emptyEl = $('treemap-empty');
    if (emptyEl) {
        emptyEl.hidden = tree.length > 0;
        const emptyText = $('treemap-empty-text');
        if (emptyText && tree.length === 0) {
            emptyText.textContent = q
                ? `No projects found for “${staffFilter.trim()}” with the current filters.`
                : 'No projects match the current filters.';
        }
    }
    // mkChart() reuses the live instance (only renderAll() disposes), and this
    // function is re-invoked on every filter toggle / tab switch — so drop any
    // previously bound handler first. Otherwise each re-render stacks another
    // click listener: a dept-tile click then fires N handlers and with even N
    // the filter toggles on and immediately off (drill-down silently stops).
    chart.off('click');
    chart.on('click', (params) => handleTreemapClick(params));
}

// Legend for the treemap tooltip's employment codes — dynamic: only the types
// actually present in the data, in the same order as the employment pie.
function renderEmpLegend() {
    const el = $('treemap-emp-legend');
    if (!el) return;
    const types = (data && data.employmentTypes) || [];
    el.hidden = types.length === 0;
    el.innerHTML = types.map(t =>
        `<span class="dmap-emp-key"><span class="dmap-emp-code">${escapeHtml(t.code)}</span> ${escapeHtml(t.name)}</span>`
    ).join('');
}

// Shared by the chart click AND the test hook (window.StaffTrackDeptTest) —
// the panel title comes from leaf.rootName, not treePathInfo, so both paths
// behave identically.
function handleTreemapClick(params) {
    if (!params || !params.data) return;
    const d = params.data;
    if (d.staff) {
        // project tile → staff list (already narrowed by the staff search, if any)
        const title = d.rootName ? `${d.rootName} → ${d.name}` : d.name;
        const q = staffQuery();
        showPanel(title, `${d.value} ${q ? 'matching ' : ''}staff on this project`,
            d.staff.map(s => ({ label: s.name, value: s.role || '', href: `/cv-profile.html?email=${encodeURIComponent(s.email || '')}` })));
    } else if (d.children && view === 'dept') {
        // department tile → drill down (toggle; pie slices use set-semantics)
        const k = normKey(d.name);
        setFilter('dept', deptFilter === k ? null : k);
        refreshLinked();
        syncDrawer();
    } else if (d.children && view === 'person') {
        // person tile → their projects
        const person = data.persons.find(p => p.name === d.name);
        if (person) {
            showPanel(person.name, `${person.assignments} assignment${person.assignments === 1 ? '' : 's'}`,
                [...person.projects.values()].sort((a, b) => b.count - a.count).map(dp => ({
                    label: dp.name,
                    value: `${dp.count} project${dp.count === 1 ? '' : 's'}`,
                })));
        }
    }
}

/* ── filters (cross-filtered + drawer, option A) ──────────────────────────── */
function setFilter(dim, key) {
    if (dim === 'dept') deptFilter = key || null;
    else if (dim === 'type') typeFilter = key || null;
    else empFilter = key || null;
}

function currentFilter(dim) {
    return dim === 'dept' ? deptFilter : dim === 'type' ? typeFilter : empFilter;
}

// Re-render every linked chart after a filter change. Pies are cross-filtered
// (each ignores its own dimension); the treemap keeps respecting all of them.
function refreshLinked() {
    renderDeptPie();
    renderTypePie();
    renderEmploymentPie();
    renderTreemap();
    renderChips();
}

// Pie-slice click (option A): SET the filter (no toggle-off) and open the
// people drawer for that slice. The chip ✕ is the way to clear it.
function selectSlice(dim, key) {
    if (!key) return;
    setFilter(dim, key);
    refreshLinked();
    openDrawer(dim, key);
}

// Chip ✕ / programmatic clear.
function clearFilter(dim) {
    setFilter(dim, null);
    refreshLinked();
    syncDrawer();
}

// Employment-type pie: assignment counts, cross-filtered like the other two.
function renderEmploymentPie() {
    const chart = mkChart('chart-employment-pie');
    if (!chart) return;
    const colors = chartColors();
    const option = pieBase(colors);
    const rows = aggregateSegments('emp');
    option.series[0].data = rows.map(e => ({
        name: e.name, value: e.assignments,
        itemStyle: { color: empColor(e.key) }
    }));
    chart.setOption(option, { notMerge: true });
    chart.off('click');
    chart.on('click', (params) => {
        const e = rows.find(x => x.name === params.name);
        selectSlice('emp', e ? e.key : normKey(params.name));
    });
    const active = rows.find(e => e.key === empFilter);
    if (active) highlightPie(chart, active.name);
    if (drawerState && drawerState.dim === 'emp') selectSliceInPie(chart, drawerState.label);
}

function renderChips() {
    const chips = [];
    if (deptFilter) {
        const d = data.depts.find(x => x.key === deptFilter);
        chips.push({ key: 'dept', label: d ? d.name : deptFilter });
    }
    if (typeFilter) chips.push({ key: 'type', label: typeFilter });
    if (empFilter) {
        const e = data.employmentTypes.find(x => x.key === empFilter);
        chips.push({ key: 'emp', label: e ? e.name : empFilter });
    }
    $('dmap-chips').innerHTML = chips.map(c => `
        <span class="dmap-chip" data-chip="${c.key}">${escapeHtml(c.label)} <button class="dmap-chip-x" data-chip-x="${c.key}" title="Clear filter">✕</button></span>`).join('');
}

function wireChips() {
    const chips = $('dmap-chips');
    if (chips) {
        chips.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-chip-x]');
            if (!btn) return;
            clearFilter(btn.dataset.chipX);
        });
    }
}

/* ── individual-staff search ────────────────────────────────────────────── */
function wireStaffSearch() {
    const input = $('dmap-staff-search');
    const clear = $('dmap-staff-search-clear');
    if (!input) return;

    const apply = () => {
        staffFilter = input.value;
        syncStaffSearchUi();
        renderTreemap();
    };
    const reset = (focus) => {
        if (staffSearchTimer) clearTimeout(staffSearchTimer);
        staffFilter = '';
        input.value = '';
        syncStaffSearchUi();
        renderTreemap();
        if (focus) input.focus();
    };

    // Re-rendering the treemap on every keystroke is heavy (person view has
    // 100+ roots) — debounce the input, but clear/Enter act immediately.
    input.addEventListener('input', () => {
        if (staffSearchTimer) clearTimeout(staffSearchTimer);
        staffSearchTimer = setTimeout(apply, 180);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (staffSearchTimer) clearTimeout(staffSearchTimer);
            apply();
        } else if (e.key === 'Escape' && input.value) {
            e.preventDefault();
            e.stopPropagation(); // don't also close the detail panel
            reset(true);
        }
    });
    if (clear) clear.addEventListener('click', () => reset(true));
    syncStaffSearchUi();
}

function syncStaffSearchUi() {
    const input = $('dmap-staff-search');
    const clear = $('dmap-staff-search-clear');
    const wrap = input ? input.closest('.dmap-staff-search') : null;
    const active = !!staffFilter.trim();
    if (clear) clear.hidden = !active;
    if (wrap) wrap.classList.toggle('is-active', active);
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

/* ── people drawer (pie slice → staff list) ──────────────────────────────────
   The same right slide-in drawer as the reporting Dashboard, but NON-MODAL:
   there is no backdrop, so the pies / chips / treemap stay clickable while it
   is open. It closes via ✕ or Escape (not click-outside — outside clicks are
   meaningful actions on this page). */
function drawerMeta(dim, key) {
    if (dim === 'dept') {
        const d = data.depts.find(x => x.key === key);
        return { kind: 'Department', title: d ? d.name : key };
    }
    if (dim === 'type') return { kind: 'Project type', title: key };
    const e = data.employmentTypes.find(x => x.key === key);
    return { kind: 'Employment type', title: e ? e.name : key };
}

// Labels of the active filters OTHER than `exceptDim` (shown as drawer context).
function activeFilterLabels(exceptDim) {
    const out = [];
    if (exceptDim !== 'dept' && deptFilter) {
        const d = data.depts.find(x => x.key === deptFilter);
        out.push(d ? d.name : deptFilter);
    }
    if (exceptDim !== 'type' && typeFilter) out.push(typeFilter);
    if (exceptDim !== 'emp' && empFilter) {
        const e = data.employmentTypes.find(x => x.key === empFilter);
        out.push(e ? e.name : empFilter);
    }
    return out;
}

// People behind the current slice: every segment passing ALL active slice
// filters (the clicked dimension's filter is set, so this is exactly the
// clicked slice — its assignment count equals the slice value).
function buildDrawerPeople() {
    const m = new Map();
    let assignments = 0;
    (data.segments || []).forEach(s => {
        if (!segMatch(s, null)) return;
        assignments++;
        if (!m.has(s.email)) m.set(s.email, {
            email: s.email, name: s.name, deptName: s.deptName,
            manager: s.manager, empName: s.empName, count: 0,
        });
        m.get(s.email).count++;
    });
    return {
        assignments,
        people: [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    };
}

function drawerQuery() {
    const el = $('dmap-drawer-search');
    return el ? el.value.trim().toLowerCase() : '';
}

function drawerHit(p, q) {
    return `${p.name} ${p.email} ${p.deptName} ${p.manager} ${p.empName}`.toLowerCase().includes(q);
}

function renderDrawerRows() {
    const body = $('dmap-drawer-body');
    if (!body) return;
    if (!drawerPeople.length) {
        body.innerHTML = '<div class="dmap-drawer-empty">No staff found in this category.</div>';
        return;
    }
    const q = drawerQuery();
    const rows = q ? drawerPeople.filter(p => drawerHit(p, q)) : drawerPeople;
    if (!rows.length) {
        body.innerHTML = `<div class="dmap-drawer-empty">No staff match “${escapeHtml(q)}”.</div>`;
        return;
    }
    // Row = name (→ CV) · department · reporting manager, with an assignment pill.
    body.innerHTML = `<div class="dmap-dlist">${rows.map(p => {
        const meta = [p.deptName, p.manager].filter(Boolean).map(escapeHtml).join(' · ') || '—';
        return `<a class="dmap-drow" href="/cv-profile.html?email=${encodeURIComponent(p.email)}" target="_blank" rel="noopener">
            <div class="dmap-drow-main">
                <div class="dmap-drow-name">${escapeHtml(p.name)}</div>
                <div class="dmap-drow-meta">${meta}</div>
            </div>
            <span class="dmap-dpill">${p.count} assignment${p.count === 1 ? '' : 's'}</span>
        </a>`;
    }).join('')}</div>`;
}

function openDrawer(dim, key) {
    if (!data) return;
    const panel = $('dmap-panel');
    if (panel) panel.hidden = true; // never stack two right-side panels
    const meta = drawerMeta(dim, key);
    const built = buildDrawerPeople();
    drawerPeople = built.people;
    drawerState = { dim, key, label: meta.title };

    $('dmap-drawer-kind').textContent = meta.kind;
    $('dmap-drawer-title').textContent = meta.title;
    const ctx = activeFilterLabels(dim);
    $('dmap-drawer-sub').textContent =
        `${built.people.length} staff · ${built.assignments} assignment${built.assignments === 1 ? '' : 's'}` +
        (ctx.length ? ` · within ${ctx.join(', ')}` : '');

    const search = $('dmap-drawer-search');
    if (search) search.value = '';
    renderDrawerRows();

    const drawer = $('dmap-drawer');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    // Push the page content left of the drawer, then resize the ECharts
    // instances so the narrower containers re-layout (see the CSS media query).
    document.body.classList.add('dmap-drawer-open');
    resizeCharts();
    const c = charts[DIM_CHART[dim]];
    if (c) selectSliceInPie(c, meta.title);
}

// Refresh an open drawer after a filter changed, or close it if its own slice
// is no longer the active filter.
function syncDrawer() {
    if (!drawerState) return;
    if (currentFilter(drawerState.dim) !== drawerState.key) { closeDrawer(); return; }
    const built = buildDrawerPeople();
    drawerPeople = built.people;
    const ctx = activeFilterLabels(drawerState.dim);
    $('dmap-drawer-sub').textContent =
        `${built.people.length} staff · ${built.assignments} assignment${built.assignments === 1 ? '' : 's'}` +
        (ctx.length ? ` · within ${ctx.join(', ')}` : '');
    renderDrawerRows();
}

function closeDrawer() {
    const drawer = $('dmap-drawer');
    if (!drawer || !drawer.classList.contains('open')) { drawerState = null; return; }
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('dmap-drawer-open');
    const prev = drawerState;
    drawerState = null;
    if (prev) {
        const c = charts[DIM_CHART[prev.dim]];
        if (c) unselectSliceInPie(c, prev.label);
    }
    resizeCharts();
}

// Re-layout every chart after the content area changes size (drawer push).
function resizeCharts() {
    requestAnimationFrame(() => {
        Object.values(charts).forEach(c => { try { c.resize(); } catch (e) { /* noop */ } });
    });
}

function wireDrawer() {
    const closeBtn = $('dmap-drawer-close');
    if (closeBtn) closeBtn.addEventListener('click', () => closeDrawer());
    const search = $('dmap-drawer-search');
    if (search) search.addEventListener('input', renderDrawerRows);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && drawerState) closeDrawer();
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
    // Mirrors a real pie-slice click: SET the filter + open the drawer.
    clickSlice(chartId, name) {
        if (chartId === 'chart-depts-pie') selectSlice('dept', normKey(name));
        else if (chartId === 'chart-types-pie') selectSlice('type', name);
        else if (chartId === 'chart-employment-pie') {
            const e = data && data.employmentTypes.find(x => x.name === name);
            selectSlice('emp', e ? e.key : normKey(name));
        }
        return true;
    },
    clearFilter(dim) { clearFilter(dim); return true; },
    // Exposes the dynamic abbreviation logic for synthetic (future-type) checks.
    empCodes(names) { return uniqueEmpCodes(names || []); },
    // Renders the real treemap tooltip HTML for a node found by name (a
    // dept/team/person root or a project tile) so the harness can assert the
    // employment breakdown without hovering a canvas.
    treemapTip(name) {
        const find = (nodes) => {
            for (const n of nodes || []) {
                if (n.name === name) return n;
                const f = find(n.children);
                if (f) return f;
            }
            return null;
        };
        const node = find(treemapData());
        return node ? treemapTooltip({ data: node }) : null;
    },
    drawerState() { return drawerState ? { ...drawerState } : null; },
    setStaffSearch(value) {
        const input = $('dmap-staff-search');
        if (!input) return false;
        if (staffSearchTimer) clearTimeout(staffSearchTimer);
        input.value = String(value ?? '');
        staffFilter = input.value;
        syncStaffSearchUi();
        renderTreemap();
        return true;
    },
};
