'use strict';

const authUser = requireAuth();


const logoutBtn = document.getElementById('btn-logout');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        sessionStorage.clear();
        location.href = '/login.html';
    });
}

// ── Helper ───────────────────────────────────────────────────────────────────
function showToast(msg, isErr = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' toast-err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 400); }, 2800);
}

// ── Data ──────────────────────────────────────────────────────────────────────
let catalogStaff = [];
let catalogProjects = [];
let managedProjects = []; // managed_projects rows — the store for classification
let projectStaffCounts = []; // [{ soc, project_name, staff_count }] — profiles that list each project
// Per-view sort state: { key, dir } — dir === null restores natural order.
// Staff keys: name|title|department|email.
// Projects keys: soc|project_name|customer|staff_count|classification.
let staffTableSort = { key: null, dir: null };
let projectsTableSort = { key: null, dir: null };
let activeTab = 'staff';
let catalogSearchQ = '';

// [managed_projects column, chip css class, full label, short label]
const CLS_FIELDS = [
    ['type_infra', 'infra', 'Infrastructure Project', 'Infra'],
    ['type_software', 'software', 'Software Project', 'Software'],
    ['type_infra_support', 'isupport', 'Infra Support', 'Infra Sup'],
    ['type_software_support', 'ssupport', 'Software Support', 'Soft Sup']
];

function canClassifyProjects() {
    return authUser.isAdmin === true || authUser.is_coordinator === true || authUser.is_coordinator === 1;
}

// managed_projects join keyed by SOC, else by project name when there is no
// SOC — mirrors the LEFT JOIN used across reports/projects views.
const managedBySoc = new Map();
const managedByName = new Map();
function indexManaged() {
    managedBySoc.clear();
    managedByName.clear();
    managedProjects.forEach(mp => {
        const code = (mp.soc || '').trim().toLowerCase();
        const nm = (mp.project_name || mp.name || '').trim().toLowerCase();
        if (code && !managedBySoc.has(code)) managedBySoc.set(code, mp);
        if (!code && nm && !managedByName.has(nm)) managedByName.set(nm, mp);
    });
}
function findManaged(p) {
    const code = (p.soc || '').trim().toLowerCase();
    const nm = (p.project_name || '').trim().toLowerCase();
    return (code && managedBySoc.get(code)) || (nm && managedByName.get(nm)) || null;
}

// Staff-count index — mirrors the Projects page keying: a project is matched
// by exact SOC; SOC-less profile entries fall back to their project name.
const staffCountBySoc = new Map();
const staffCountByNameOnly = new Map();
function indexStaffCounts() {
    staffCountBySoc.clear();
    staffCountByNameOnly.clear();
    projectStaffCounts.forEach(r => {
        const code = (r.soc || '').trim().toLowerCase();
        const nm = (r.project_name || '').trim().toLowerCase();
        const n = Number(r.staff_count) || 0;
        if (code) {
            staffCountBySoc.set(code, (staffCountBySoc.get(code) || 0) + n);
        } else if (nm) {
            staffCountByNameOnly.set(nm, (staffCountByNameOnly.get(nm) || 0) + n);
        }
    });
}
function projectStaffCount(p) {
    const code = (p.soc || '').trim().toLowerCase();
    const nm = (p.project_name || '').trim().toLowerCase();
    return code
        ? (staffCountBySoc.get(code) || 0)
        : (nm ? (staffCountByNameOnly.get(nm) || 0) : 0);
}

async function loadData() {
    try {
        const jobs = [
            window.StaffTrackAuth.apiFetch('/api/catalog/staff'),
            window.StaffTrackAuth.apiFetch('/api/catalog/projects'),
            window.StaffTrackAuth.apiFetch('/api/catalog/projects/staff-counts')
        ];
        const managedIdx = jobs.length;
        if (canClassifyProjects()) {
            jobs.push(window.StaffTrackAuth.apiFetch('/api/managed-projects'));
        }
        const results = await Promise.all(jobs);

        if (results[0].ok) catalogStaff = await results[0].json();
        if (results[1].ok) catalogProjects = await results[1].json();
        if (results[2].ok) projectStaffCounts = await results[2].json();
        if (results[managedIdx] && results[managedIdx].ok) managedProjects = await results[managedIdx].json();
        indexManaged();
        indexStaffCounts();

        // Default: surface projects that staff actually have first, so
        // classifications can be prioritised; header click cycles desc/asc/off.
        projectsTableSort = {
            key: 'staff_count',
            dir: projectStaffCounts.some(r => (Number(r.staff_count) || 0) > 0) ? 'desc' : null
        };

        renderCatalog();
    } catch (err) {
        console.error('Failed to load catalog data:', err);
        showToast('Failed to load data', true);
    }
}

function staffCountCell(p) {
    const n = projectStaffCount(p);
    const tier = n === 0 ? 'zero' : (n >= 10 ? 'high' : (n >= 3 ? 'mid' : 'low'));
    const title = n
        ? `${n} active staff have this project in their profile`
        : 'No staff have this project in their profile';
    return `<td class="project-staff-col"><span class="staff-count ${tier}" title="${title}">${n}</span></td>`;
}

// ── Column sorting ─────────────────────────────────────────────────────────────
// Every sortable header shares one tri-state cycle: natural order (↕) → the
// column's natural direction (text ▲ asc, staff-count ▼ desc) → reversed → off.
// A click on a new column starts at its natural direction.

const COL_DEFAULT_DIR = {
    name: 'asc', title: 'asc', department: 'asc', email: 'asc',
    soc: 'asc', project_name: 'asc', customer: 'asc',
    staff_count: 'desc', classification: 'asc'
};

function nextSort(state, key) {
    const def = COL_DEFAULT_DIR[key] || 'asc';
    if (state.key !== key || state.dir === null) return { key, dir: def };
    if (state.dir === def) return { key, dir: def === 'asc' ? 'desc' : 'asc' };
    return { key, dir: null }; // was showing the reversed order — back to natural
}

// Cell value used for sorting: numbers for the count columns, plain strings
// elsewhere. Missing text cells become '' and always sort last.
function staffColValue(s, key) {
    const v = s[key];
    return v == null ? '' : String(v);
}

function projectColValue(p, key) {
    if (key === 'staff_count') return projectStaffCount(p);
    if (key === 'classification') {
        const { st } = clsState(p);
        return CLS_FIELDS.reduce((n, [f]) => n + (st[f] ? 1 : 0), 0);
    }
    const v = p[key];
    return v == null ? '' : String(v);
}

function compareCells(va, vb, dir) {
    const aNum = typeof va === 'number';
    const bNum = typeof vb === 'number';
    const aEmpty = !aNum && va === '';
    const bEmpty = !bNum && vb === '';
    if (aEmpty || bEmpty) {
        if (aEmpty && bEmpty) return 0;
        return aEmpty ? 1 : -1; // missing values stay last in either direction
    }
    let c;
    if (aNum && bNum) c = va - vb;
    else c = String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true });
    return dir === 'desc' ? -c : c;
}

function updateSortIndicators() {
    const apply = (tableId, state) => {
        const table = document.getElementById(tableId);
        if (!table) return;
        table.querySelectorAll('th.sortable').forEach(th => {
            const ind = th.querySelector('.sort-ind');
            const active = !!state && state.key === th.dataset.sort && state.dir !== null;
            th.classList.toggle('sorted', active);
            if (active) th.setAttribute('aria-sort', state.dir === 'desc' ? 'descending' : 'ascending');
            else th.removeAttribute('aria-sort');
            if (ind) ind.textContent = active ? (state.dir === 'asc' ? '▲' : '▼') : '↕';
        });
    };
    apply('catalog-staff-table', staffTableSort);
    apply('catalog-projects-table', projectsTableSort);
}

// ── Catalog Management ────────────────────────────────────────────────────────
function renderCatalog() {
    updateSortIndicators();
    const q = catalogSearchQ.toLowerCase();

    if (activeTab === 'staff') {
        document.getElementById('catalog-staff-view').style.display = 'block';
        document.getElementById('catalog-projects-view').style.display = 'none';

        const tbody = document.getElementById('catalog-staff-tbody');
        let list = catalogStaff;
        if (q) {
            list = list.filter(s => (s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q));
        }
        if (staffTableSort.key && staffTableSort.dir) {
            const { key, dir } = staffTableSort;
            list = list.slice().sort((a, b) =>
                compareCells(staffColValue(a, key), staffColValue(b, key), dir));
        }

        if (!list.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="table-empty">Catalog is empty.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(s => `
            <tr>
                <td>${s.name}</td>
                <td>${s.title}</td>
                <td>${s.department}</td>
                <td style="font-size:.8rem">${s.email}</td>
                <td><button class="btn btn-danger" style="padding:.25rem .5rem;font-size:.7rem" onclick="deleteStaff('${s.email}')">Remove</button></td>
            </tr>
        `).join('');
    } else {
        document.getElementById('catalog-staff-view').style.display = 'none';
        document.getElementById('catalog-projects-view').style.display = 'block';

        const tbody = document.getElementById('catalog-projects-tbody');
        let list = catalogProjects;
        if (q) {
            list = list.filter(p => (p.project_name || '').toLowerCase().includes(q) || (p.soc || '').toLowerCase().includes(q));
        }
        if (projectsTableSort.key && projectsTableSort.dir) {
            const { key, dir } = projectsTableSort;
            list = list.slice().sort((a, b) =>
                compareCells(projectColValue(a, key), projectColValue(b, key), dir));
        }

        if (!list.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Catalog is empty.</td></tr>`;
            return;
        }

        const allowCls = canClassifyProjects();
        tbody.innerHTML = list.map(p => `
            <tr>
                <td>${p.soc || '—'}</td>
                <td>${p.project_name}</td>
                <td>${p.customer}</td>
                ${staffCountCell(p)}
                <td>${classificationCell(p, allowCls)}</td>
                <td><button class="btn btn-danger" style="padding:.25rem .5rem;font-size:.7rem" onclick="deleteProject('${p.id}')">Remove</button></td>
            </tr>
        `).join('');
    }
}

async function deleteStaff(email) {
    if (!confirm(`Delete ${email} from staff catalog?`)) return;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/admin/staff/${encodeURIComponent(email)}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            catalogStaff = catalogStaff.filter(s => s.email !== email);
            renderCatalog();
            showToast('Staff removed from catalog');
        }
    } catch (e) { showToast('Delete failed', true); }
}

function escAttr(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function techStr(v) {
    return Array.isArray(v) ? v.join(', ') : (v || '');
}

// Classification state for a project row: the managed_projects record (if any)
// merged over the row, keyed by the four classification columns.
function clsState(p) {
    const mp = findManaged(p);
    const st = {};
    CLS_FIELDS.forEach(([f]) => { st[f] = mp ? !!mp[f] : false; });
    return { mp, st };
}

function classificationCell(p, allowCls) {
    if (!allowCls) return '—';
    const { st } = clsState(p);
    return `
      <div class="cls-chip-grid" data-soc="${escAttr(p.soc)}" data-name="${escAttr(p.project_name)}" data-customer="${escAttr(p.customer)}">
        ${CLS_FIELDS.map(([f, cls, label, short]) => `
          <label class="cls-chip ${cls}${st[f] ? ' checked' : ''}" title="${label}">
            <input type="checkbox" class="cls-chip-input" data-field="${f}" ${st[f] ? 'checked' : ''}>
            ${short}
          </label>`).join('')}
      </div>`;
}

// ── Classification save (delegated on the projects tbody) ─────────────────────
async function handleClsChange(input) {
    const grid = input.closest('.cls-chip-grid');
    if (!grid || grid.dataset.saving === '1') return;
    const checked = input.checked;

    const soc = grid.dataset.soc || '';
    const name = grid.dataset.name || '';
    const project = catalogProjects.find(p => (p.soc || '') === soc && (p.project_name || '') === name)
        || { soc, project_name: name, customer: grid.dataset.customer || '' };

    // Optimistic visual state — revert if the save fails
    const chip = input.closest('.cls-chip');
    if (chip) chip.classList.toggle('checked', input.checked);

    // Full classification state after this tick
    const cls = {};
    grid.querySelectorAll('.cls-chip-input').forEach(inp => { cls[inp.dataset.field] = inp.checked; });

    grid.dataset.saving = '1';
    grid.querySelectorAll('.cls-chip').forEach(c => c.classList.add('saving'));

    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/catalog/projects/classification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                soc,
                project_name: name,
                customer: project.customer || '',
                start_date: project.start_date || '',
                end_date: project.end_date || '',
                technologies: techStr(project.technologies),
                description: project.description || project.project_brief || '',
                ...cls
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'save failed');

        // Keep the local index in sync so later ticks and re-renders stay correct
        let rec = findManaged(project);
        if (!rec) {
            rec = { id: data.id, soc: soc || null, project_name: name, name, customer: project.customer || null };
            managedProjects.push(rec);
        }
        CLS_FIELDS.forEach(([f]) => { rec[f] = cls[f] ? 1 : 0; });
        indexManaged();

        grid.dataset.saving = '0';
        grid.querySelectorAll('.cls-chip').forEach(c => c.classList.remove('saving'));
        showToast(Object.values(cls).some(Boolean) ? 'Classification saved' : 'Classification cleared');
    } catch (err) {
        // Revert the tick and restore the UI
        input.checked = !checked;
        const chip = input.closest('.cls-chip');
        if (chip) chip.classList.toggle('checked', input.checked);
        grid.dataset.saving = '0';
        grid.querySelectorAll('.cls-chip').forEach(c => c.classList.remove('saving'));
        showToast('Failed to save classification', true);
    }
}

async function deleteProject(id) {
    if (!confirm('Delete this project from catalog?')) return;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/admin/projects/${id}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            catalogProjects = catalogProjects.filter(p => p.id !== id);
            renderCatalog();
            showToast('Project removed from catalog');
        }
    } catch (e) { showToast('Delete failed', true); }
}

// ── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Initialize sidebar navigation
    if (typeof renderSidebarNav === 'function') {
        renderSidebarNav('catalog');
    } else if (typeof renderNav === 'function') {
        renderNav();
    }
    // Initialize theme toggle
    if (typeof ThemeManager !== 'undefined') {
        ThemeManager.updateToggleButtons();
    }
    // Initialize toast
    if (typeof Toast !== 'undefined') {
        Toast.init();
    }
    loadData();

    // Inline Project Classification tick-chips (auto-save on toggle)
    const projTbody = document.getElementById('catalog-projects-tbody');
    if (projTbody) {
        projTbody.addEventListener('change', e => {
            const input = e.target;
            if (input && input.classList.contains('cls-chip-input')) {
                handleClsChange(input);
            }
        });
    }

    // Catalog Search
    document.getElementById('catalog-search').addEventListener('input', e => {
        catalogSearchQ = e.target.value.trim();
        renderCatalog();
    });

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTab = btn.dataset.tab;
            renderCatalog();
        });
    });

    // Column sorting — every sortable header shares the tri-state cycle
    document.querySelectorAll('#catalog-staff-table th.sortable, #catalog-projects-table th.sortable')
        .forEach(th => {
            const key = th.dataset.sort;
            if (!key) return;
            th.addEventListener('click', () => {
                if (th.closest('table').id === 'catalog-staff-table') {
                    staffTableSort = nextSort(staffTableSort, key);
                } else {
                    projectsTableSort = nextSort(projectsTableSort, key);
                }
                renderCatalog();
            });
        });
});

// Expose globals for onclick handlers
window.deleteStaff = deleteStaff;
window.deleteProject = deleteProject;
