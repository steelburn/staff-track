'use strict';

// Use auth module functions

// ── AppState ──────────────────────────────────────────────────────────────────
const AppState = {
    submissionId: null,        // UUID from backend, stored in sessionStorage
    originalStaff: {},         // snapshot from CSV (for edit tracking)
    staff: { name: '', title: '', department: '', managerName: '', email: '' },
    editedFields: new Set(),
    skills: [],                // [{ id, skill, rating }]
    projects: [],              // [{ id, soc, projectName, customer, role, endDate }]
};

// ── CSV data (loaded at runtime) ──────────────────────────────────────────────
let STAFF_DATA = [];
let ALL_PROJECTS_CSV = [];

// ── Persistence ───────────────────────────────────────────────────────────────
let saveTimer = null;

function scheduleAutoSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToBackend, 1500);
}

async function saveToBackend() {
    const payload = {
        staffName: AppState.staff.name,
        staffData: { ...AppState.staff, email: authUser.email },
        editedFields: [...AppState.editedFields],
        skills: AppState.skills.map(({ skill, rating }) => ({ skill, rating })),
        projects: AppState.projects.map(({ soc, projectName, customer, role, endDate }) =>
            ({ soc, projectName, customer, role, endDate })),
    };

    try {
        if (!AppState.submissionId) {
            const res = await window.StaffTrackAuth.apiFetch('/api/submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error('POST failed');
            const data = await res.json();
            AppState.submissionId = data.id;
            sessionStorage.setItem('stafftrack_id', data.id);
            setSaveStatus('Draft saved ✓');
        } else {
            const res = await window.StaffTrackAuth.apiFetch(`/api/submissions/${AppState.submissionId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error('PUT failed');
            setSaveStatus('Auto-saved ✓');
        }
    } catch (e) {
        setSaveStatus('Save error ✗', true);
        console.error(e);
    }
}

async function loadFromBackend(id) {
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/submissions/${id}`);
        if (!res.ok) return false;
        const data = await res.json();
        AppState.submissionId = id;
        AppState.staff = {
            name: data.staffName || '',
            ...(data.staffData || {})
        };
        // Backfill missing info from catalog
        const dbEntry = STAFF_DATA.find(s => (s.email || '').toLowerCase() === (AppState.staff.email || '').toLowerCase());
        if (dbEntry) {
            if (!AppState.staff.title) AppState.staff.title = dbEntry.title || '';
            if (!AppState.staff.department) AppState.staff.department = dbEntry.department || '';
            if (!AppState.staff.managerName) AppState.staff.managerName = dbEntry.manager_name || '';
        }
        AppState.editedFields = new Set(data.editedFields || []);
        AppState.skills = (data.skills || []).map(s => ({ ...s, id: uid() }));
        AppState.projects = (data.projects || []).map(p => ({ ...p, id: uid() }));
        return true;
    } catch { return false; }
}

// ── Load-previous helpers ─────────────────────────────────────────────────────
async function fetchSubmissionsByName(name) {
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/submissions');
        if (res.ok) {
            const list = await res.json();
            return list.filter(s => s.staffName.toLowerCase() === name.toLowerCase());
        }
    } catch (e) { console.error('Failed to fetch subs by name', e); }
    return [];
}

function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function showLoadModal(submissions) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const rows = submissions.map((s, i) => `
        <div class="load-row" data-idx="${i}">
          <div class="load-row-info">
            <span class="load-row-name">${s.staffName}</span>
            <span class="load-row-date">Last saved: ${formatDate(s.updatedAt)}</span>
          </div>
          <button class="btn-load-item" data-idx="${i}">Load ↗</button>
        </div>`).join('');
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width:520px">
        <div class="modal-header">
          <h2>📂 Load Previous Submission</h2>
          <button class="modal-close" title="Close">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:.85rem;color:var(--text-secondary);margin-bottom:1rem">
            Select a previous submission to load and continue editing.
          </p>
          <div class="load-list">${rows}</div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary modal-close-btn">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelector('.modal-close').addEventListener('click', close);
    backdrop.querySelector('.modal-close-btn').addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

    backdrop.querySelectorAll('.btn-load-item').forEach(btn => {
        btn.addEventListener('click', async () => {
            const sub = submissions[+btn.dataset.idx];
            btn.textContent = 'Loading…';
            btn.disabled = true;
            // Clear current grid rows from DOM
            document.getElementById('skills-tbody').innerHTML = '';
            document.getElementById('projects-tbody').innerHTML = '';
            AppState.skills = [];
            AppState.projects = [];
            const ok = await loadFromBackend(sub.id);
            if (ok) {
                sessionStorage.setItem('stafftrack_id', sub.id);
                restoreForm();
                setSaveStatus('Loaded ✓');
                showToast(`Loaded: ${sub.staffName}`);
            } else {
                showToast('Failed to load submission');
            }
            close();
        });
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
}

function setSaveStatus(msg, isErr = false) {
    const el = document.getElementById('save-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isErr ? 'var(--accent-rose)' : 'var(--accent-green)';
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.textContent = ''), 3000);
}

function highlightMatch(text, query) {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return text;
    return text.slice(0, idx)
        + `<span class="ac-match">${text.slice(idx, idx + query.length)}</span>`
        + text.slice(idx + query.length);
}

function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 400); }, 2500);
}

// ── Autocomplete engine ───────────────────────────────────────────────────────
function makeAutocomplete({ inputEl, getItems, renderItem, onSelect, minLen = 1 }) {
    let dropdown = null;
    let activeIdx = -1;
    let items = [];

    function close() {
        dropdown?.remove(); dropdown = null; activeIdx = -1; items = [];
    }

    function open(results, query) {
        close();
        if (!results.length) {
            dropdown = document.createElement('div');
            dropdown.className = 'ac-dropdown';
            dropdown.innerHTML = `<div class="ac-empty">No results found</div>`;
            inputEl.parentElement.appendChild(dropdown);
            return;
        }
        dropdown = document.createElement('div');
        dropdown.className = 'ac-dropdown';
        items = results;
        results.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = 'ac-item';
            div.innerHTML = renderItem(item, query);
            div.addEventListener('mousedown', e => { e.preventDefault(); select(i); });
            dropdown.appendChild(div);
        });
        inputEl.parentElement.appendChild(dropdown);
    }

    function setActive(i) {
        if (!dropdown) return;
        const els = dropdown.querySelectorAll('.ac-item');
        els.forEach(e => e.classList.remove('active'));
        activeIdx = (i + els.length) % els.length;
        els[activeIdx]?.classList.add('active');
        els[activeIdx]?.scrollIntoView({ block: 'nearest' });
    }

    function select(i) {
        onSelect(items[i]);
        close();
    }

    inputEl.addEventListener('input', () => {
        const q = inputEl.value.trim();
        if (q.length < minLen) { close(); return; }
        const results = getItems(q);
        open(results, q);
    });

    inputEl.addEventListener('keydown', e => {
        if (!dropdown) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
        else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); select(activeIdx); }
        else if (e.key === 'Escape') close();
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('.autocomplete-wrap') && !e.target.closest('.project-ac-wrap')) close();
    });
}

// ── Section 1: Staff Identity ─────────────────────────────────────────────────
function initStaffSection() {
    const nameInput = document.getElementById('staff-name');
    nameInput.readOnly = true; // Lock identity
    nameInput.style.background = 'var(--bg-elevated)';
    nameInput.style.color = 'var(--text-secondary)';
    nameInput.style.cursor = 'not-allowed';

    const emailInput = document.getElementById('staff-email');
    if (emailInput) {
        emailInput.readOnly = true;
        emailInput.style.background = 'var(--bg-elevated)';
        emailInput.style.color = 'var(--text-secondary)';
        emailInput.style.cursor = 'not-allowed';
    }

    const fields = {
        title: document.getElementById('staff-title'),
        department: document.getElementById('staff-department'),
        managerName: document.getElementById('staff-manager'),
        // Email intentionally excluded from editable fields
    };

    // Track edits on readonly-like fields (title, dept, manager, email)
    Object.entries(fields).forEach(([key, el]) => {
        el.addEventListener('input', () => {
            const original = AppState.originalStaff[key] || '';
            const label = el.closest('.form-group')?.querySelector('label');
            if (el.value !== original) {
                AppState.editedFields.add(key);
                el.classList.add('edited');
                label?.classList.add('edited-label');
            } else {
                AppState.editedFields.delete(key);
                el.classList.remove('edited');
                label?.classList.remove('edited-label');
            }
            AppState.staff[key] = el.value;
            updateEditNote();
            scheduleAutoSave();
        });
    });
}

function updateEditNote() {
    const note = document.getElementById('edit-note');
    if (!note) return;
    if (AppState.editedFields.size > 0) {
        const list = [...AppState.editedFields].join(', ');
        note.textContent = `✎ Manually edited: ${list}`;
        note.classList.add('visible');
    } else {
        note.classList.remove('visible');
    }
}

// ── Section 2: Skills Grid ────────────────────────────────────────────────────
function initSkillsSection() {
    document.getElementById('btn-add-skill').addEventListener('click', () => {
        addSkillRow({ id: uid(), skill: '', rating: 0 });
        updateSkillsCount();
        scheduleAutoSave();
    });
}

function addSkillRow(row) {
    if (!AppState.skills.find(s => s.id === row.id)) {
        AppState.skills.push(row);
    }
    const tbody = document.querySelector('#skills-tbody');
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    tr.innerHTML = `
    <td><input type="text" placeholder="e.g. Azure, Project Management" value="${row.skill}"></td>
    <td>
      <div class="star-rating">
        ${[1, 2, 3, 4, 5].map(n =>
        `<button type="button" class="${n <= row.rating ? 'on' : ''}" data-val="${n}" title="${n} star${n > 1 ? 's' : ''}">★</button>`
    ).join('')}
      </div>
    </td>
    <td class="col-remove"><button class="btn-remove" title="Remove">✕</button></td>`;

    const skillInput = tr.querySelector('input');
    skillInput.addEventListener('input', () => {
        const s = AppState.skills.find(s => s.id === row.id);
        if (s) s.skill = skillInput.value;
        scheduleAutoSave();
    });

    tr.querySelectorAll('.star-rating button').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = +btn.dataset.val;
            const s = AppState.skills.find(s => s.id === row.id);
            if (s) s.rating = val;
            tr.querySelectorAll('.star-rating button').forEach(b => {
                b.classList.toggle('on', +b.dataset.val <= val);
            });
            scheduleAutoSave();
        });
    });

    tr.querySelector('.btn-remove').addEventListener('click', () => {
        AppState.skills = AppState.skills.filter(s => s.id !== row.id);
        tr.remove();
        updateSkillsCount();
        scheduleAutoSave();
        if (!AppState.skills.length) showSkillsEmpty(true);
    });

    const empty = document.getElementById('skills-empty');
    if (empty) empty.style.display = 'none';
    tbody.appendChild(tr);
}

function showSkillsEmpty(show) {
    const empty = document.getElementById('skills-empty');
    if (empty) empty.style.display = show ? 'block' : 'none';
}

function updateSkillsCount() {
    const el = document.getElementById('skills-count');
    if (el) el.textContent = `${AppState.skills.length} skill${AppState.skills.length !== 1 ? 's' : ''}`;
}

// ── Section 3: Projects Grid ──────────────────────────────────────────────────
function initProjectsSection() {
    document.getElementById('btn-add-project').addEventListener('click', () => {
        addProjectRow({});
        updateProjectsCount();
        scheduleAutoSave();
    });
}

function addProjectRow(data = {}) {
    const tbody = document.getElementById('projects-tbody');
    const tr = document.createElement('tr');
    const rowId = data.id || uid();
    tr.dataset.id = rowId;

    tr.innerHTML = `
    <td>
      <div class="project-ac-wrap">
        <input type="text" class="p-name" placeholder="Search project name…" value="${data.projectName || ''}">
      </div>
    </td>
    <td><input type="text" class="p-soc" placeholder="Auto-filled" value="${data.soc || ''}" readonly style="background:var(--bg-elevated)" title="${data.soc || 'Auto-filled'}"></td>
    <td><input type="text" class="p-customer" placeholder="Auto-filled" value="${data.customer || ''}" readonly style="background:var(--bg-elevated)"></td>
    <td><input type="text" class="p-role" placeholder="e.g. Lead Dev, PM" value="${data.role || ''}"></td>
    <td><input type="date" class="p-end" value="${data.endDate || ''}"></td>
    <td class="col-actions">
      <button class="btn-icon btn-del-row" title="Remove row">✖</button>
    </td>
  `;
    tbody.appendChild(tr);

    const nameInput = tr.querySelector('.p-name');
    const socInput = tr.querySelector('.p-soc');
    const custInput = tr.querySelector('.p-customer');
    const roleInput = tr.querySelector('.p-role');
    const dateInput = tr.querySelector('.p-end');

    const saveProjects = () => {
        const proj = AppState.projects.find(x => x.id === rowId);
        if (proj) {
            proj.projectName = nameInput.value;
            proj.soc = socInput.value;
            proj.customer = custInput.value;
            proj.role = roleInput.value;
            proj.endDate = dateInput.value;
        }
        scheduleAutoSave();
    };

    makeAutocomplete({
        inputEl: nameInput,
        getItems: q => ALL_PROJECTS_CSV.filter(p =>
            p.project_name.toLowerCase().includes(q.toLowerCase()) ||
            (p.soc || '').toLowerCase().includes(q.toLowerCase())
        ).slice(0, 10),
        renderItem: (p, q) => `
      <div class="ac-name">${highlightMatch(p.project_name, q)}</div>
      <div class="ac-sub">${p.soc ? `<span style="color:var(--accent-blue);font-weight:600">${highlightMatch(p.soc, q)}</span>` : 'No SOC'} · ${p.customer || '—'}</div>
    `,
        onSelect: p => {
            const isDup = AppState.projects.some(x =>
                x.id !== rowId &&
                ((x.soc && p.soc && x.soc === p.soc) || (!x.soc && x.projectName && p.project_name && x.projectName === p.project_name))
            );

            if (isDup) {
                showToast('Project already added', true);
                nameInput.value = '';
                socInput.value = '';
                custInput.value = '';
                return;
            }

            nameInput.value = p.project_name;
            socInput.value = p.soc || '';
            socInput.title = p.soc || 'Auto-filled';
            custInput.value = p.customer || '';
            saveProjects();
        }
    });

    // If this is a new row, add it to AppState.projects
    if (!AppState.projects.find(p => p.id === rowId)) {
        AppState.projects.push({
            id: rowId,
            projectName: data.projectName || '',
            soc: data.soc || '',
            customer: data.customer || '',
            role: data.role || '',
            endDate: data.endDate || ''
        });
    }

    nameInput.addEventListener('input', saveProjects);
    roleInput.addEventListener('input', saveProjects);
    dateInput.addEventListener('change', saveProjects);

    tr.querySelector('.btn-del-row').addEventListener('click', () => {
        AppState.projects = AppState.projects.filter(p => p.id !== rowId);
        tr.remove();
        updateProjectsCount();
        scheduleAutoSave();
        if (!AppState.projects.length) showProjectsEmpty(true);
    });

    const empty = document.getElementById('projects-empty');
    if (empty) empty.style.display = 'none';
}

function showProjectsEmpty(show) {
    const empty = document.getElementById('projects-empty');
    if (empty) empty.style.display = show ? 'block' : 'none';
}

function updateProjectsCount() {
    const el = document.getElementById('projects-count');
    if (el) el.textContent = `${AppState.projects.length} project${AppState.projects.length !== 1 ? 's' : ''}`;
}

// ── Summary Modal ─────────────────────────────────────────────────────────────
function buildSummaryText() {
    const s = AppState.staff;
    const edits = AppState.editedFields.size
        ? `  ⚠ Manually edited fields: ${[...AppState.editedFields].join(', ')}\n` : '';
    const skills = AppState.skills.length
        ? AppState.skills.map(sk => `  • ${sk.skill || '(unnamed)'} — ${'★'.repeat(sk.rating)}${'☆'.repeat(5 - sk.rating)}`).join('\n')
        : '  (none)';
    const projects = AppState.projects.length
        ? AppState.projects.map(p =>
            `  • [${p.soc || '—'}] ${p.projectName || '(unnamed)'}\n    Role: ${p.role || '—'}  |  End: ${p.endDate || '—'}\n    Customer: ${p.customer || '—'}`
        ).join('\n')
        : '  (none)';

    return `STAFFTRACK SUBMISSION
${'═'.repeat(40)}
Staff Details
  Name:       ${s.name || '—'}
  Title:      ${s.title || '—'}
  Department: ${s.department || '—'}
  Manager:    ${s.managerName || '—'}
  Email:      ${s.email || '—'}
${edits}
Skills
${skills}

Active Projects
${projects}
${'═'.repeat(40)}
Submitted: ${new Date().toLocaleString()}
ID: ${AppState.submissionId || 'not yet saved'}`;
}

function showSummaryModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2>📋 Submission Summary</h2>
        <button class="modal-close" title="Close">✕</button>
      </div>
      <div class="modal-body">
        <pre class="summary-pre" id="summary-text"></pre>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="btn-copy-json">Copy JSON</button>
        <button class="btn-primary" id="btn-copy-text">Copy Summary</button>
      </div>
    </div>`;

    document.body.appendChild(backdrop);
    document.getElementById('summary-text').textContent = buildSummaryText();

    backdrop.querySelector('.modal-close').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

    document.getElementById('btn-copy-text').addEventListener('click', () => {
        navigator.clipboard.writeText(buildSummaryText()).then(() => showToast('Summary copied!'));
    });
    document.getElementById('btn-copy-json').addEventListener('click', () => {
        const json = JSON.stringify({
            staffName: AppState.staff.name,
            staffData: AppState.staff,
            editedFields: [...AppState.editedFields],
            skills: AppState.skills,
            projects: AppState.projects,
        }, null, 2);
        navigator.clipboard.writeText(json).then(() => showToast('JSON copied!'));
    });
}

// ── Restore form from loaded data ─────────────────────────────────────────────
function restoreForm() {
    const s = AppState.staff;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('staff-name', s.name);
    setVal('staff-title', s.title);
    setVal('staff-department', s.department);
    setVal('staff-manager', s.managerName);
    setVal('staff-email', s.email);

    // Clear existing rows before re-populating
    document.querySelector('#skills-tbody').innerHTML = '';
    document.querySelector('#projects-tbody').innerHTML = '';

    AppState.skills.forEach(row => addSkillRow(row));
    AppState.projects.forEach(row => addProjectRow(row));
    updateSkillsCount();
    updateProjectsCount();
    updateEditNote();
    if (!AppState.skills.length) showSkillsEmpty(true);
    if (!AppState.projects.length) showProjectsEmpty(true);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
    renderNav('my');
    if (authUser.role === 'admin') {
        // Admins shouldn't be making submissions
        document.querySelector('.submit-area').style.display = 'none';
    }

    try {
        const [staffRes, projectsRes] = await Promise.all([
            window.StaffTrackAuth.apiFetch('/api/catalog/staff'),
            window.StaffTrackAuth.apiFetch('/api/catalog/projects')
        ]);
        if (staffRes.ok) STAFF_DATA = await staffRes.json();
        if (projectsRes.ok) ALL_PROJECTS_CSV = await projectsRes.json();
    } catch (e) { console.error('Data load failed', e); }

    initStaffSection();
    initSkillsSection();
    initProjectsSection();

    // Wire up summary button
    document.getElementById('btn-summary')?.addEventListener('click', showSummaryModal);

    // Wire up save button
    document.getElementById('btn-save')?.addEventListener('click', async () => {
        await saveToBackend();
        showToast('Saved to server ✓');
    });

    // Wire up Load Previous button
    document.getElementById('btn-load-previous')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-load-previous');
        btn.textContent = '⏳ Loading…';
        btn.disabled = true;
        try {
            const res = await window.StaffTrackAuth.apiFetch(authUser.role === 'staff' ? '/api/submissions/me' : '/api/submissions');
            let all = [];
            if (res.ok) {
                const data = await res.json();
                all = Array.isArray(data) ? data : [data];
            }
            if (!all.length) {
                showToast('No saved submissions found');
            } else {
                showLoadModal(all);
            }
        } catch { showToast('Could not reach server'); }
        btn.textContent = '📂 Load Previous';
        btn.disabled = false;
    });

    // Wire up clear button
    document.getElementById('btn-clear')?.addEventListener('click', () => {
        if (!confirm('Clear form and start over?')) return;
        AppState.submissionId = null;
        AppState.staff = { name: '', title: '', department: '', managerName: '', email: '' };
        AppState.originalStaff = {};
        AppState.editedFields.clear();
        AppState.skills = [];
        AppState.projects = [];
        sessionStorage.removeItem('stafftrack_id');
        location.reload();
    });

    // Auto-load or initialize user identity
    if (authUser.role !== 'admin') {
        const dbUser = STAFF_DATA.find(s => (s.email || '').toLowerCase() === authUser.email.toLowerCase());
        const identityName = dbUser ? dbUser.name : authUser.email;

        try {
            const res = await window.StaffTrackAuth.apiFetch(authUser.role === 'staff' ? '/api/submissions/me' : '/api/submissions');
            let all = [];
            if (res.ok) {
                const data = await res.json();
                all = Array.isArray(data) ? data : [data];
            }
            const mySubs = all.filter(s => s.staffName.toLowerCase() === identityName.toLowerCase());

            if (mySubs.length > 0) {
                // Restore most recent
                const latestId = mySubs[0].id;
                sessionStorage.setItem('stafftrack_id', latestId);
                const ok = await loadFromBackend(latestId);
                if (ok) { restoreForm(); setSaveStatus('Restored from server'); }
            } else {
                // Initialize fresh form constraints
                AppState.submissionId = null;
                const snap = {
                    name: dbUser ? (dbUser.name || identityName) : identityName,
                    title: dbUser ? (dbUser.title || '') : '',
                    department: dbUser ? (dbUser.department || '') : '',
                    managerName: dbUser ? (dbUser.manager_name || '') : '',
                    email: dbUser ? (dbUser.email || authUser.email) : authUser.email,
                };
                AppState.originalStaff = { ...snap };
                AppState.staff = { ...snap };

                document.getElementById('staff-name').value = snap.name;
                document.getElementById('staff-title').value = snap.title;
                document.getElementById('staff-department').value = snap.department;
                document.getElementById('staff-manager').value = snap.managerName;
                document.getElementById('staff-email').value = snap.email;

                showSkillsEmpty(true);
                showProjectsEmpty(true);
            }
        } catch (e) { console.error('Failed to init identity', e); }
    }
}

// ── Sync across tabs ──────────────────────────────────────────────────────────
window.addEventListener('focus', async () => {
    if (!AppState.submissionId) return;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/submissions/${AppState.submissionId}`);
        if (!res.ok) return;
        const data = await res.json();
        let changed = false;

        // Sync skills
        (data.skills || []).forEach(bs => {
            if (bs.skill && !AppState.skills.find(s => s.skill.toLowerCase() === bs.skill.toLowerCase())) {
                const sRow = { ...bs, id: uid() };
                addSkillRow(sRow);
                changed = true;
            }
        });

        // Sync projects
        (data.projects || []).forEach(bp => {
            if (!bp.soc && !bp.projectName) return;
            const dup = AppState.projects.find(p =>
                (p.soc && bp.soc && p.soc === bp.soc) ||
                (!p.soc && p.projectName && p.projectName === bp.projectName)
            );
            if (!dup) {
                const pRow = { ...bp, id: uid() };
                addProjectRow(pRow);
                changed = true;
            }
        });

        if (changed) {
            updateSkillsCount();
            updateProjectsCount();
            showToast('Synced new assignments ▲');
            // Data is effectively saved to DB already, no need to trigger autosave immediately
        }
    } catch { /* ignore network error on focus */ }
});

document.addEventListener('DOMContentLoaded', init);
