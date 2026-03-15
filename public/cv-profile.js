'use strict';

const authUser = requireAuth();

// ── Utility ────
function showToast(msg, isErr = false) {
    const t = document.createElement('div');
    t.className = 'toast';
    if (isErr) {
        t.style.background = 'var(--accent-rose)';
        t.style.borderColor = 'rgba(0,0,0,0.1)';
    }
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 400); }, 2500);
}

// Use auth module functions

// ── State ────
let profileExists = false;
let targetProfileEmail = authUser.email;
let certificationsData = [];
let certificationsLoaded = false;
let workHistoryData = [];
let workHistoryLoaded = false;
let pastProjectsData = [];
let pastProjectsLoaded = false;

// Submission State
const AppState = {
    submissionId: null,        // UUID from backend, stored in sessionStorage
    originalStaff: {},         // snapshot from CSV (for edit tracking)
    staff: { name: '', title: '', department: '', managerName: '', email: '' },
    editedFields: new Set(),
    skills: [],                // [{ id, skill, rating }]
    projects: [],              // [{ id, soc, projectName, customer, role, endDate }]
};
let STAFF_DATA = [];
let ALL_PROJECTS_CSV = [];
let submissionLoaded = false;
let saveTimer = null;

// ── Tab Switching ───
function wireUpTabSwitching() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;

            // Deactivate all tabs
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            // Activate target
            btn.classList.add('active');
            const targetContent = document.getElementById(`${targetTab}-tab`);
            if (targetContent) targetContent.classList.add('active');

            // Scroll to top so tab bar and content are both visible
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    // Check URL params for deep linking
    const urlParams = new URLSearchParams(window.location.search);
    const requestedTab = urlParams.get('tab');
    if (requestedTab) {
        const btn = document.querySelector(`.tab-btn[data-tab="${requestedTab}"]`);
        if (btn) {
            btn.click();
        }
    }
}

// ── Persistence for My Submission ──────────────────────────────────────────
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

function showLoadModal(submissions) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const rows = submissions.map((s, i) => `
        <div class="load-row" data-idx="${i}">
          <div class="load-row-info">
            <span class="load-row-name">${s.staffName}</span>
            <span class="load-row-date">Last saved: ${new Date(s.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
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
            document.getElementById('projects-tbody-sub').innerHTML = '';
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

function initSubmissionTab() {
    // Buttons are now wired up in separate section in init()
    // This function primarily handles specific identity logic for the submission tab
    
    // Identity fields setup
    const nameInput = document.getElementById('staff-name');
    if (nameInput) {
        nameInput.readOnly = true;
        nameInput.style.background = 'var(--bg-elevated)';
        nameInput.style.color = 'var(--text-secondary)';
        nameInput.style.cursor = 'not-allowed';
    }

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
    };

    Object.entries(fields).forEach(([key, el]) => {
        if (!el) return;
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

async function loadSubmissionData() {
    try {
        const [staffRes, projectsRes] = await Promise.all([
            window.StaffTrackAuth.apiFetch('/api/catalog/staff'),
            window.StaffTrackAuth.apiFetch('/api/catalog/projects')
        ]);
        if (staffRes.ok) STAFF_DATA = await staffRes.json();
        if (projectsRes.ok) ALL_PROJECTS_CSV = await projectsRes.json();
    } catch (e) { console.error('Data load failed', e); }

    const dbUser = STAFF_DATA.find(s => (s.email || '').toLowerCase() === targetProfileEmail.toLowerCase());
    const identityName = dbUser ? dbUser.name : targetProfileEmail;

    const mentionEl = document.getElementById('target-staff-mention');
    if (mentionEl && targetProfileEmail.toLowerCase() !== authUser.email.toLowerCase()) {
        mentionEl.textContent = `(Generating CV for: ${identityName})`;
    } else if (mentionEl) {
        mentionEl.textContent = '';
    }

    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/submissions/email/${encodeURIComponent(targetProfileEmail)}`);
        const all = res.ok ? await res.json() : [];
        // The new endpoint might return just one or an array. Let's assume array for compatibility.
        const mySubs = Array.isArray(all) ? all : (all ? [all] : []);

        if (mySubs.length > 0) {
            const latestId = mySubs[0].id;
            sessionStorage.setItem('stafftrack_id', latestId);
            const ok = await loadFromBackend(latestId);
            if (ok) { restoreForm(); setSaveStatus('Restored from server'); }
        } else {
            AppState.submissionId = null;
            const snap = {
                name: dbUser ? (dbUser.name || identityName) : identityName,
                title: dbUser ? (dbUser.title || '') : '',
                department: dbUser ? (dbUser.department || '') : '',
                managerName: dbUser ? (dbUser.manager_name || '') : '',
                email: dbUser ? (dbUser.email || targetProfileEmail) : targetProfileEmail,
            };
            AppState.originalStaff = { ...snap };
            AppState.staff = { ...snap };

            document.getElementById('staff-name').value = snap.name;
            document.getElementById('staff-title').value = snap.title;
            document.getElementById('staff-department').value = snap.department;
            document.getElementById('staff-manager').value = snap.managerName;
            document.getElementById('staff-email').value = snap.email;

            showSkillsEmpty(true);
            showProjectsEmptySub(true);
        }
    } catch (e) { console.error('Failed to init identity', e); }
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

function addProjectRowSub(data = {}) {
    const tbody = document.getElementById('projects-tbody-sub');
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
        updateProjectsCountSub();
        scheduleAutoSave();
        if (!AppState.projects.length) showProjectsEmptySub(true);
    });

    const empty = document.getElementById('projects-empty');
    if (empty) empty.style.display = 'none';
}

function showProjectsEmptySub(show) {
    const empty = document.getElementById('projects-empty');
    if (empty) empty.style.display = show ? 'block' : 'none';
}

function updateProjectsCountSub() {
    const el = document.getElementById('projects-count');
    if (el) el.textContent = `${AppState.projects.length} project${AppState.projects.length !== 1 ? 's' : ''}`;
}

function restoreForm() {
    const s = AppState.staff;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('staff-name', s.name);
    setVal('staff-title', s.title);
    setVal('staff-department', s.department);
    setVal('staff-manager', s.managerName);
    setVal('staff-email', s.email);

    document.querySelector('#skills-tbody').innerHTML = '';
    document.querySelector('#projects-tbody-sub').innerHTML = '';

    AppState.skills.forEach(row => addSkillRow(row));
    AppState.projects.forEach(row => addProjectRowSub(row));
    updateSkillsCount();
    updateProjectsCountSub();
    updateEditNote();
    if (!AppState.skills.length) showSkillsEmpty(true);
    if (!AppState.projects.length) showProjectsEmptySub(true);
}

// ── Profile Functions ───
async function loadProfile() {
    const email = targetProfileEmail;
    const profileFields = ['cv-phone', 'cv-linkedin', 'cv-location', 'cv-summary'];
    const photoContainer = document.getElementById('photo-preview-container');
    const photoPreview = document.getElementById('photo-preview');

    // Clear form fields
    profileFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    if (photoContainer) photoContainer.style.display = 'none';
    if (photoPreview) photoPreview.src = '';

    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}`);
        if (res.ok) {
            const data = await res.json();

            // profile may be null if the user hasn't saved the profile section yet
            // but sub-resources (education, certifications, etc.) can still exist.
            profileExists = !!data.profile;

            // Populate profile fields
            if (data.profile) {
                if (data.profile.phone) document.getElementById('cv-phone').value = data.profile.phone;
                if (data.profile.linkedin) document.getElementById('cv-linkedin').value = data.profile.linkedin;
                if (data.profile.location) document.getElementById('cv-location').value = data.profile.location;
                if (data.profile.summary) document.getElementById('cv-summary').value = data.profile.summary;
            }

            // Show photo if exists
            if (data.profile && data.profile.photo_path) {
                if (photoContainer) photoContainer.style.display = 'block';
                if (photoPreview) photoPreview.src = data.profile.photo_path;
            }

            // Pre-populate all section data from the same response so that
            // clicking any tab immediately shows data without a separate fetch.
            educationData = data.education || [];
            renderEducationList();
            educationLoaded = true;

            certificationsData = data.certifications || [];
            renderCertificationsList();
            certificationsLoaded = true;

            workHistoryData = data.workHistory || [];
            pastProjectsData = data.pastProjects || [];
            renderWorkHistoryList();
            workHistoryLoaded = true;
            renderPastProjectsList();
            pastProjectsLoaded = true;

        } else {
            // Any error (including legacy 404) = treat as no profile
            profileExists = false;
        }
    } catch (err) {
        console.error('Error loading profile:', err);
        profileExists = false;
    }
}

async function saveProfile() {
    const email = targetProfileEmail;
    const summary = document.getElementById('cv-summary')?.value?.trim() || '';
    const phone = document.getElementById('cv-phone')?.value?.trim() || '';
    const linkedin = document.getElementById('cv-linkedin')?.value?.trim() || '';
    const location = document.getElementById('cv-location')?.value?.trim() || '';

    if (!summary && !phone && !linkedin && !location) {
        showToast('Please fill in at least one field', true);
        return;
    }

    try {
        let res;
        if (profileExists) {
            res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ summary, phone, linkedin, location })
            });
        } else {
            res = await window.StaffTrackAuth.apiFetch('/api/cv-profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ staff_email: email, summary, phone, linkedin, location })
            });
        }

        if (res.ok) {
            profileExists = true;
            showToast('Profile saved successfully');
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.error || 'Failed to save profile', true);
        }
    } catch (err) {
        console.error('Error saving profile:', err);
        showToast('Failed to save profile', true);
    }
}

async function uploadPhoto() {
    const email = targetProfileEmail;
    const fileInput = document.getElementById('cv-photo');
    const file = fileInput.files[0];

    if (!file) {
        showToast('Please select a photo file', true);
        return;
    }

    const formData = new FormData();
    formData.append('photo', file);

    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/photo`, {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            const data = await res.json();
            const photoContainer = document.getElementById('photo-preview-container');
            const photoPreview = document.getElementById('photo-preview');

            if (photoContainer) photoContainer.style.display = 'block';
            if (photoPreview) photoPreview.src = data.photo_path;

            showToast('Photo uploaded successfully');
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.error || 'Failed to upload photo', true);
        }
    } catch (err) {
        console.error('Error uploading photo:', err);
        showToast('Failed to upload photo', true);
    }
}




// ── Education State ───
let educationData = [];

// ── Education Functions ───
let educationLoaded = false;

async function loadEducation() {
    const email = targetProfileEmail;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}`);
        if (!res.ok) {
            if (res.status === 404) {
                educationData = [];
            } else {
                throw new Error('Failed to fetch education');
            }
        } else {
            const data = await res.json();
            educationData = data.education || [];
        }
    } catch (err) {
        console.error('Error loading education:', err);
        educationData = [];
    }
    renderEducationList();
}

function renderEducationList() {
    const countEl = document.getElementById('education-count');
    const emptyState = document.getElementById('education-empty');
    const list = document.getElementById('education-list');

    // Update count
    if (countEl) {
        const count = educationData.length;
        countEl.textContent = `${count} entr${count !== 1 ? 'ies' : 'y'}`;
    }

    // Toggle empty state vs list
    if (emptyState && list) {
        if (educationData.length === 0) {
            emptyState.style.display = 'block';
            list.style.display = 'none';
        } else {
            emptyState.style.display = 'none';
            list.style.display = 'grid';
        }
    }

    // Render education entries (sorted by end_year DESC, nulls last)
    if (list) {
        const sortedEdu = [...educationData].sort((a, b) => {
            if (a.end_year == null && b.end_year == null) return 0;
            if (a.end_year == null) return 1;
            if (b.end_year == null) return -1;
            return b.end_year - a.end_year;
        });
        let html = '';
        sortedEdu.forEach(entry => {
            const institution = entry.institution || '—';
            const degree = entry.degree || '—';
            const field = entry.field || '';
            const startYear = entry.start_year || '?';
            const endYear = entry.end_year === null || entry.end_year === '' ? 'Present' : (entry.end_year || '?');
            const description = entry.description || '';
            const proofPath = entry.proof_path || '';

            html += `
                <div class="section-card" style="padding:1.25rem; position:relative;" data-id="${entry.id}">
                    <div style="font-weight:700; font-size:1rem; margin-bottom:0.25rem;">${institution}</div>
                    <div style="color:var(--accent-blue); font-size:0.9rem; margin-bottom:0.25rem;">${degree}${field ? ' — ' + field : ''}</div>
                    <div style="color:var(--text-secondary); font-size:0.82rem; margin-bottom:0.5rem;">${startYear} – ${endYear}</div>
                    ${description ? '<div style="font-size:0.85rem; color:var(--text-secondary);">' + description + '</div>' : ''}
                    ${proofPath ? `<div style="margin-top:0.5rem;"><a href="${proofPath}" target="_blank" style="font-size:0.78rem; color:var(--accent-amber); text-decoration:none;">📎 View Proof</a></div>` : ''}
                    <div style="display:flex; gap:0.5rem; margin-top:1rem;">
                        <button class="btn-secondary btn-edit-education" data-id="${entry.id}" style="padding:0.35rem 0.75rem; font-size:0.8rem;">✏️ Edit</button>
                        <button class="btn-remove btn-delete-education" data-id="${entry.id}" style="width:auto; padding:0.35rem 0.75rem; font-size:0.8rem;">🗑 Delete</button>
                    </div>
                </div>
            `;
        });
        list.innerHTML = html;

        // Wire up edit buttons
        document.querySelectorAll('.btn-edit-education').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const entry = educationData.find(e => e.id == id);
                if (entry) showEducationForm(entry);
            });
        });

        // Wire up delete buttons
        document.querySelectorAll('.btn-delete-education').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                deleteEducation(id);
            });
        });
    }
}

function showEducationForm(entry = null) {
    const form = document.getElementById('education-form');
    const title = document.getElementById('education-form-title');
    const idInput = document.getElementById('education-id');
    const institutionInput = document.getElementById('edu-institution');
    const degreeInput = document.getElementById('edu-degree');
    const fieldInput = document.getElementById('edu-field');
    const startYearInput = document.getElementById('edu-start-year');
    const endYearInput = document.getElementById('edu-end-year');
    const descriptionInput = document.getElementById('edu-description');

    const proofSection = document.getElementById('edu-proof-section');
    const proofExisting = document.getElementById('edu-proof-existing');
    const proofFileInput = document.getElementById('edu-proof');

    if (entry) {
        // Edit mode
        if (title) title.textContent = 'Edit Education';
        if (idInput) idInput.value = entry.id;
        if (institutionInput) institutionInput.value = entry.institution || '';
        if (degreeInput) degreeInput.value = entry.degree || '';
        if (fieldInput) fieldInput.value = entry.field || '';
        if (startYearInput) startYearInput.value = entry.start_year || '';
        if (endYearInput) endYearInput.value = entry.end_year || '';
        if (descriptionInput) descriptionInput.value = entry.description || '';

        // Show proof section for existing entries; hide hint
        if (proofSection) proofSection.style.display = '';
        const eduHint = document.getElementById('edu-proof-hint');
        if (eduHint) eduHint.style.display = 'none';
        if (proofFileInput) proofFileInput.value = '';
        if (proofExisting) {
            if (entry.proof_path) {
                proofExisting.style.display = '';
                proofExisting.innerHTML = `<span style="font-size:0.82rem; color:var(--accent-amber);">📎 Current: <a href="${entry.proof_path}" target="_blank" style="color:var(--accent-amber);">${entry.proof_path.split('/').pop()}</a></span> <button class="btn-remove" data-proof-id="${entry.id}" data-proof-type="education" style="width:auto; padding:0.2rem 0.5rem; font-size:0.75rem; margin-left:0.5rem;">✕ Remove</button>`;
                proofExisting.querySelector('[data-proof-type="education"]')?.addEventListener('click', () => deleteEducationProof(entry.id));
            } else {
                proofExisting.style.display = 'none';
                proofExisting.innerHTML = '';
            }
        }
    } else {
        // Add mode
        if (title) title.textContent = 'Add Education';
        if (idInput) idInput.value = '';
        if (institutionInput) institutionInput.value = '';
        if (degreeInput) degreeInput.value = '';
        if (fieldInput) fieldInput.value = '';
        if (startYearInput) startYearInput.value = '';
        if (endYearInput) endYearInput.value = '';
        if (descriptionInput) descriptionInput.value = '';

        // Hide proof section for new entries (no ID yet); show hint
        if (proofSection) proofSection.style.display = 'none';
        const eduHint = document.getElementById('edu-proof-hint');
        if (eduHint) eduHint.style.display = '';
        if (proofExisting) { proofExisting.style.display = 'none'; proofExisting.innerHTML = ''; }
    }

    if (form) form.style.display = '';
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideEducationForm() {
    const form = document.getElementById('education-form');
    const institutionInput = document.getElementById('edu-institution');
    const degreeInput = document.getElementById('edu-degree');
    const fieldInput = document.getElementById('edu-field');
    const startYearInput = document.getElementById('edu-start-year');
    const endYearInput = document.getElementById('edu-end-year');
    const descriptionInput = document.getElementById('edu-description');

    const proofSection = document.getElementById('edu-proof-section');
    const proofExisting = document.getElementById('edu-proof-existing');
    const proofFileInput = document.getElementById('edu-proof');

    if (form) form.style.display = 'none';
    if (institutionInput) institutionInput.value = '';
    if (degreeInput) degreeInput.value = '';
    if (fieldInput) fieldInput.value = '';
    if (startYearInput) startYearInput.value = '';
    if (endYearInput) endYearInput.value = '';
    if (descriptionInput) descriptionInput.value = '';
    if (proofSection) proofSection.style.display = 'none';
    if (proofExisting) { proofExisting.style.display = 'none'; proofExisting.innerHTML = ''; }
    if (proofFileInput) proofFileInput.value = '';
}

async function saveEducation() {
    const institution = document.getElementById('edu-institution')?.value?.trim() || '';
    const degree = document.getElementById('edu-degree')?.value?.trim() || '';
    const field = document.getElementById('edu-field')?.value?.trim() || '';
    const startYear = parseInt(document.getElementById('edu-start-year')?.value) || null;
    const endYear = parseInt(document.getElementById('edu-end-year')?.value) || null;
    const description = document.getElementById('edu-description')?.value?.trim() || '';
    const id = document.getElementById('education-id')?.value?.trim() || '';

    if (!institution) {
        showToast('Institution is required', true);
        return;
    }

    // Date validation
    if (startYear && endYear && startYear > endYear) {
        showToast('End year must be greater than or equal to start year', true);
        return;
    }

    const body = {
        institution,
        degree,
        field,
        start_year: startYear,
        end_year: endYear,
        description
    };

    const email = targetProfileEmail;
    try {
        let res;
        if (id) {
            res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/education/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } else {
            res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/education`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        }

        if (res.ok) {
            showToast('Education saved successfully');
            educationLoaded = false;
            loadEducation();
            hideEducationForm();
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.error || 'Failed to save education', true);
        }
    } catch (err) {
        console.error('Error saving education:', err);
        showToast('Failed to save education', true);
    }
}

async function deleteEducation(id) {
    if (!confirm('Delete this education entry?')) return;

    const email = targetProfileEmail;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/education/${id}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            showToast('Education deleted successfully');
            educationLoaded = false;
            loadEducation();
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.error || 'Failed to delete education', true);
        }
    } catch (err) {
        console.error('Error deleting education:', err);
        showToast('Failed to delete education', true);
    }
}

async function uploadEducationProof(id) {
    const email = targetProfileEmail;
    const fileInput = document.getElementById('edu-proof');
    const file = fileInput?.files?.[0];
    if (!file) { showToast('Please select a file first', true); return; }

    const formData = new FormData();
    formData.append('proof', file);
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/education/${id}/proof`, {
            method: 'POST', body: formData
        });
        if (res.ok) {
            showToast('Proof uploaded successfully');
            educationLoaded = false;
            loadEducation();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Failed to upload proof', true);
        }
    } catch (e) {
        console.error('Error uploading education proof:', e);
        showToast('Failed to upload proof', true);
    }
}

async function deleteEducationProof(id) {
    if (!confirm('Remove the proof document from this education entry?')) return;
    const email = targetProfileEmail;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/education/${id}/proof`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Proof removed');
            educationLoaded = false;
            loadEducation();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Failed to remove proof', true);
        }
    } catch (e) {
        console.error('Error removing education proof:', e);
        showToast('Failed to remove proof', true);
    }
}

// ── Certifications Functions ───
async function loadCertifications() {
    const email = targetProfileEmail;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}`);
        if (!res.ok) {
            if (res.status === 404) {
                certificationsData = [];
            } else {
                throw new Error('Failed to fetch certifications');
            }
        } else {
            const data = await res.json();
            certificationsData = data.certifications || [];
        }
    } catch (err) {
        console.error('Error loading certifications:', err);
        certificationsData = [];
    }
    renderCertificationsList();
}

function renderCertificationsList() {
    const countEl = document.getElementById('certifications-count');
    const emptyState = document.getElementById('certifications-empty');
    const list = document.getElementById('certifications-list');

    // Update count
    if (countEl) {
        const count = certificationsData.length;
        countEl.textContent = `${count} entr${count !== 1 ? 'ies' : 'y'}`;
    }

    // Toggle empty state vs list
    if (emptyState && list) {
        if (certificationsData.length === 0) {
            emptyState.style.display = 'block';
            list.style.display = 'none';
        } else {
            emptyState.style.display = 'none';
            list.style.display = 'grid';
        }
    }

    // Render certification entries (sorted by date_obtained DESC, nulls last)
    if (list) {
        const sortedCerts = [...certificationsData].sort((a, b) => {
            if (!a.date_obtained && !b.date_obtained) return 0;
            if (!a.date_obtained) return 1;
            if (!b.date_obtained) return -1;
            return b.date_obtained.localeCompare(a.date_obtained);
        });
        let html = '';
        sortedCerts.forEach(entry => {
            const name = entry.name || '—';
            const issuer = entry.issuer || '—';
            const dateObtained = entry.date_obtained || '—';
            const expiryDate = entry.expiry_date || '';
            const credentialId = entry.credential_id || '';
            const description = entry.description || '';
            const proofPath = entry.proof_path || '';

            html += `
                <div class="section-card" style="padding:1.25rem; position:relative;" data-id="${entry.id}">
                    <div style="font-weight:700; font-size:1rem; margin-bottom:0.25rem;">${name}</div>
                    <div style="color:var(--accent-blue); font-size:0.9rem; margin-bottom:0.25rem;">${issuer}</div>
                    <div style="color:var(--text-secondary); font-size:0.82rem; margin-bottom:0.25rem;">
                        Obtained: ${dateObtained}
                        ${expiryDate ? ' · Expires: ' + expiryDate : ''}
                    </div>
                    ${credentialId ? '<div style="font-size:0.78rem; color:var(--text-muted);">ID: ' + credentialId + '</div>' : ''}
                    ${description ? '<div style="font-size:0.85rem; color:var(--text-secondary); margin-top:0.5rem;">' + description + '</div>' : ''}
                    ${proofPath ? `<div style="margin-top:0.5rem;"><a href="${proofPath}" target="_blank" style="font-size:0.78rem; color:var(--accent-amber); text-decoration:none;">📎 View Proof</a></div>` : ''}
                    <div style="display:flex; gap:0.5rem; margin-top:1rem;">
                        <button class="btn-secondary btn-edit-certification" data-id="${entry.id}" style="padding:0.35rem 0.75rem; font-size:0.8rem;">✏️ Edit</button>
                        <button class="btn-remove btn-delete-certification" data-id="${entry.id}" style="width:auto; padding:0.35rem 0.75rem; font-size:0.8rem;">🗑 Delete</button>
                    </div>
                </div>
            `;
        });
        list.innerHTML = html;

        // Wire up edit buttons
        document.querySelectorAll('.btn-edit-certification').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const entry = certificationsData.find(e => e.id == id);
                if (entry) showCertificationForm(entry);
            });
        });

        // Wire up delete buttons
        document.querySelectorAll('.btn-delete-certification').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                deleteCertification(id);
            });
        });
    }
}

function showCertificationForm(entry = null) {
    const form = document.getElementById('certification-form');
    const title = document.getElementById('certification-form-title');
    const idInput = document.getElementById('certification-id');
    const nameInput = document.getElementById('cert-name');
    const issuerInput = document.getElementById('cert-issuer');
    const dateObtainedInput = document.getElementById('cert-date-obtained');
    const expiryDateInput = document.getElementById('cert-expiry-date');
    const credentialIdInput = document.getElementById('cert-credential-id');
    const descriptionInput = document.getElementById('cert-description');

    const proofSection = document.getElementById('cert-proof-section');
    const proofExisting = document.getElementById('cert-proof-existing');
    const proofFileInput = document.getElementById('cert-proof');

    if (entry) {
        // Edit mode
        if (title) title.textContent = 'Edit Certification';
        if (idInput) idInput.value = entry.id;
        if (nameInput) nameInput.value = entry.name || '';
        if (issuerInput) issuerInput.value = entry.issuer || '';
        if (dateObtainedInput) dateObtainedInput.value = entry.date_obtained || '';
        if (expiryDateInput) expiryDateInput.value = entry.expiry_date || '';
        if (credentialIdInput) credentialIdInput.value = entry.credential_id || '';
        if (descriptionInput) descriptionInput.value = entry.description || '';

        // Show proof section for existing entries; hide hint
        if (proofSection) proofSection.style.display = '';
        const certHint = document.getElementById('cert-proof-hint');
        if (certHint) certHint.style.display = 'none';
        if (proofFileInput) proofFileInput.value = '';
        if (proofExisting) {
            if (entry.proof_path) {
                proofExisting.style.display = '';
                proofExisting.innerHTML = `<span style="font-size:0.82rem; color:var(--accent-amber);">📎 Current: <a href="${entry.proof_path}" target="_blank" style="color:var(--accent-amber);">${entry.proof_path.split('/').pop()}</a></span> <button class="btn-remove" data-proof-id="${entry.id}" data-proof-type="certification" style="width:auto; padding:0.2rem 0.5rem; font-size:0.75rem; margin-left:0.5rem;">✕ Remove</button>`;
                proofExisting.querySelector('[data-proof-type="certification"]')?.addEventListener('click', () => deleteCertificationProof(entry.id));
            } else {
                proofExisting.style.display = 'none';
                proofExisting.innerHTML = '';
            }
        }
    } else {
        // Add mode
        if (title) title.textContent = 'Add Certification';
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (issuerInput) issuerInput.value = '';
        if (dateObtainedInput) dateObtainedInput.value = '';
        if (expiryDateInput) expiryDateInput.value = '';
        if (credentialIdInput) credentialIdInput.value = '';
        if (descriptionInput) descriptionInput.value = '';

        // Hide proof section for new entries; show hint
        if (proofSection) proofSection.style.display = 'none';
        const certHint = document.getElementById('cert-proof-hint');
        if (certHint) certHint.style.display = '';
        if (proofExisting) { proofExisting.style.display = 'none'; proofExisting.innerHTML = ''; }
    }

    if (form) form.style.display = '';
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideCertificationForm() {
    const form = document.getElementById('certification-form');
    const nameInput = document.getElementById('cert-name');
    const issuerInput = document.getElementById('cert-issuer');
    const dateObtainedInput = document.getElementById('cert-date-obtained');
    const expiryDateInput = document.getElementById('cert-expiry-date');
    const credentialIdInput = document.getElementById('cert-credential-id');
    const descriptionInput = document.getElementById('cert-description');

    const proofSection = document.getElementById('cert-proof-section');
    const proofExisting = document.getElementById('cert-proof-existing');
    const proofFileInput = document.getElementById('cert-proof');

    if (form) form.style.display = 'none';
    if (nameInput) nameInput.value = '';
    if (issuerInput) issuerInput.value = '';
    if (dateObtainedInput) dateObtainedInput.value = '';
    if (expiryDateInput) expiryDateInput.value = '';
    if (credentialIdInput) credentialIdInput.value = '';
    if (descriptionInput) descriptionInput.value = '';
    if (proofSection) proofSection.style.display = 'none';
    if (proofExisting) { proofExisting.style.display = 'none'; proofExisting.innerHTML = ''; }
    if (proofFileInput) proofFileInput.value = '';
}

async function saveCertification() {
    const name = document.getElementById('cert-name')?.value?.trim() || '';
    const issuer = document.getElementById('cert-issuer')?.value?.trim() || '';
    const dateObtained = document.getElementById('cert-date-obtained')?.value?.trim() || '';
    const expiryDate = document.getElementById('cert-expiry-date')?.value?.trim() || '';
    const credentialId = document.getElementById('cert-credential-id')?.value?.trim() || '';
    const description = document.getElementById('cert-description')?.value?.trim() || '';
    const id = document.getElementById('certification-id')?.value?.trim() || '';

    if (!name) {
        showToast('Certification name is required', true);
        return;
    }

    // Date validation
    if (dateObtained && expiryDate && dateObtained > expiryDate) {
        showToast('Expiry date must be on or after the obtained date', true);
        return;
    }

    const body = {
        name,
        issuer,
        date_obtained: dateObtained || null,
        expiry_date: expiryDate || null,
        credential_id: credentialId,
        description
    };

    const email = targetProfileEmail;
    try {
        let res;
        if (id) {
            res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/certifications/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } else {
            res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/certifications`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        }

        if (res.ok) {
            showToast('Certification saved successfully');
            certificationsLoaded = false;
            loadCertifications();
            hideCertificationForm();
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.error || 'Failed to save certification', true);
        }
    } catch (err) {
        console.error('Error saving certification:', err);
        showToast('Failed to save certification', true);
    }
}

async function deleteCertification(id) {
    if (!confirm('Delete this certification?')) return;

    const email = targetProfileEmail;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/certifications/${id}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            showToast('Certification deleted successfully');
            certificationsLoaded = false;
            loadCertifications();
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.error || 'Failed to delete certification', true);
        }
    } catch (err) {
        console.error('Error deleting certification:', err);
        showToast('Failed to delete certification', true);
    }
}

async function uploadCertificationProof(id) {
    const email = targetProfileEmail;
    const fileInput = document.getElementById('cert-proof');
    const file = fileInput?.files?.[0];
    if (!file) { showToast('Please select a file first', true); return; }

    const formData = new FormData();
    formData.append('proof', file);
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/certifications/${id}/proof`, {
            method: 'POST', body: formData
        });
        if (res.ok) {
            showToast('Proof uploaded successfully');
            certificationsLoaded = false;
            loadCertifications();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Failed to upload proof', true);
        }
    } catch (e) {
        console.error('Error uploading certification proof:', e);
        showToast('Failed to upload proof', true);
    }
}

async function deleteCertificationProof(id) {
    if (!confirm('Remove the proof document from this certification?')) return;
    const email = targetProfileEmail;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/certifications/${id}/proof`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Proof removed');
            certificationsLoaded = false;
            loadCertifications();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Failed to remove proof', true);
        }
    } catch (e) {
        console.error('Error removing certification proof:', e);
        showToast('Failed to remove proof', true);
    }
}

// ── Work History Functions ───
async function loadWorkHistory() {
    const email = targetProfileEmail;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}`);
        if (!res.ok) {
            if (res.status === 404) {
                workHistoryData = [];
            } else {
                throw new Error('Failed to fetch work history');
            }
        } else {
            const data = await res.json();
            workHistoryData = data.workHistory || [];
            if (data.pastProjects) {
                pastProjectsData = data.pastProjects;
            }
        }
    } catch (err) {
        console.error('Error loading work history:', err);
        workHistoryData = [];
    }
    renderWorkHistoryList();
}

function renderWorkHistoryList() {
    const countEl = document.getElementById('work-history-count');
    const emptyState = document.getElementById('work-history-empty');
    const list = document.getElementById('work-history-list');

    // Update count
    if (countEl) {
        const count = workHistoryData.length;
        countEl.textContent = `${count} entr${count !== 1 ? 'ies' : 'y'}`;
    }

    // Toggle empty state vs list
    if (emptyState && list) {
        if (workHistoryData.length === 0) {
            emptyState.style.display = 'block';
            list.style.display = 'none';
        } else {
            emptyState.style.display = 'none';
            list.style.display = 'grid';
        }
    }

    // Render work history entries
    if (list) {
        // Sort by start_date descending (most recent first), entries without start_date go last
        const sortedData = [...workHistoryData].sort((a, b) => {
            if (!a.start_date && !b.start_date) return 0;
            if (!a.start_date) return 1;
            if (!b.start_date) return -1;
            return b.start_date.localeCompare(a.start_date);
        });

        let html = '';
        sortedData.forEach(entry => {
            const employer = entry.employer || '—';
            const jobTitle = entry.job_title || '—';
            const startDate = entry.start_date || '?';
            const endDate = entry.end_date === null || entry.end_date === '' ? 'Present' : (entry.end_date || '?');
            const description = entry.description || '';
            const isCurrent = !!entry.is_current;

            html += `
                <div class="section-card" style="padding:1.25rem; position:relative; ${isCurrent ? 'border-left: 4px solid var(--accent-blue);' : ''}" data-id="${entry.id}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div style="font-weight:700; font-size:1rem; margin-bottom:0.25rem;">${employer}</div>
                        ${isCurrent ? '<span style="background:var(--accent-blue); color:white; font-size:0.65rem; padding:0.1rem 0.4rem; border-radius:4px; text-transform:uppercase; font-weight:700;">Current</span>' : ''}
                    </div>
                    <div style="color:var(--accent-blue); font-size:0.9rem; margin-bottom:0.25rem;">${jobTitle}</div>
                    <div style="color:var(--text-secondary); font-size:0.82rem; margin-bottom:0.5rem;">${startDate} – ${endDate}</div>
                    ${description ? '<div style="font-size:0.85rem; color:var(--text-secondary);">' + description + '</div>' : ''}
                    <div style="display:flex; gap:0.5rem; margin-top:1rem;">
                        <button class="btn-secondary btn-edit-work-history" data-id="${entry.id}" style="padding:0.35rem 0.75rem; font-size:0.8rem;">✏️ Edit</button>
                        <button class="btn-remove btn-delete-work-history" data-id="${entry.id}" style="width:auto; padding:0.35rem 0.75rem; font-size:0.8rem;">🗑 Delete</button>
                    </div>
                </div>
            `;
        });
        list.innerHTML = html;

        // Wire up edit buttons
        document.querySelectorAll('.btn-edit-work-history').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const entry = workHistoryData.find(e => e.id == id);
                if (entry) showWorkHistoryForm(entry);
            });
        });

        // Wire up delete buttons
        document.querySelectorAll('.btn-delete-work-history').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                deleteWorkHistory(id);
            });
        });
    }
}

function showWorkHistoryForm(entry = null) {
    const form = document.getElementById('work-history-form');
    const title = document.getElementById('work-history-form-title');
    const idInput = document.getElementById('work-history-id');
    const employerInput = document.getElementById('wh-employer');
    const jobTitleInput = document.getElementById('wh-job-title');
    const startDateInput = document.getElementById('wh-start-date');
    const endDateInput = document.getElementById('wh-end-date');
    const isCurrentInput = document.getElementById('wh-is-current');
    const descriptionInput = document.getElementById('wh-description');

    if (entry) {
        // Edit mode
        if (title) title.textContent = 'Edit Work History';
        if (idInput) idInput.value = entry.id;
        if (employerInput) employerInput.value = entry.employer || '';
        if (jobTitleInput) jobTitleInput.value = entry.job_title || '';
        if (startDateInput) startDateInput.value = entry.start_date || '';
        if (endDateInput) endDateInput.value = entry.end_date || '';
        if (isCurrentInput) isCurrentInput.checked = !!entry.is_current;
        if (descriptionInput) descriptionInput.value = entry.description || '';
    } else {
        // Add mode
        if (title) title.textContent = 'Add Work History';
        if (idInput) idInput.value = '';
        if (employerInput) employerInput.value = '';
        if (jobTitleInput) jobTitleInput.value = '';
        if (startDateInput) startDateInput.value = '';
        if (endDateInput) endDateInput.value = '';
        if (isCurrentInput) isCurrentInput.checked = false;
        if (descriptionInput) descriptionInput.value = '';
    }

    if (form) form.style.display = '';
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideWorkHistoryForm() {
    const form = document.getElementById('work-history-form');
    const employerInput = document.getElementById('wh-employer');
    const jobTitleInput = document.getElementById('wh-job-title');
    const startDateInput = document.getElementById('wh-start-date');
    const endDateInput = document.getElementById('wh-end-date');
    const isCurrentInput = document.getElementById('wh-is-current');
    const descriptionInput = document.getElementById('wh-description');

    if (form) form.style.display = 'none';
    if (employerInput) employerInput.value = '';
    if (jobTitleInput) jobTitleInput.value = '';
    if (startDateInput) startDateInput.value = '';
    if (endDateInput) endDateInput.value = '';
    if (isCurrentInput) isCurrentInput.checked = false;
    if (descriptionInput) descriptionInput.value = '';
}

async function saveWorkHistory() {
    const employer = document.getElementById('wh-employer')?.value?.trim() || '';
    const jobTitle = document.getElementById('wh-job-title')?.value?.trim() || '';
    const startDate = document.getElementById('wh-start-date')?.value?.trim() || null;
    const endDate = document.getElementById('wh-end-date')?.value?.trim() || null;
    const isCurrent = document.getElementById('wh-is-current')?.checked ? 1 : 0;
    const description = document.getElementById('wh-description')?.value?.trim() || '';
    const id = document.getElementById('work-history-id')?.value?.trim() || '';

    if (!employer) {
        showToast('Employer is required', true);
        return;
    }

    // Date validation
    if (startDate && endDate && startDate > endDate) {
        showToast('End date must be on or after the start date', true);
        return;
    }

    const body = {
        employer,
        job_title: jobTitle,
        start_date: startDate,
        end_date: endDate,
        is_current: isCurrent,
        description
    };

    const email = targetProfileEmail;
    try {
        let res;
        if (id) {
            res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/work-history/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } else {
            res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/work-history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        }

        if (res.ok) {
            showToast('Work history saved successfully');
            workHistoryLoaded = false;
            await loadWorkHistory();
            refreshEmployerDropdown();
            hideWorkHistoryForm();
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.error || 'Failed to save work history', true);
        }
    } catch (err) {
        console.error('Error saving work history:', err);
        showToast('Failed to save work history', true);
    }
}

async function deleteWorkHistory(id) {
    if (!confirm('Delete this work history entry?')) return;

    const email = targetProfileEmail;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/work-history/${id}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            showToast('Work history deleted successfully');
            workHistoryLoaded = false;
            await loadWorkHistory();
            refreshEmployerDropdown();
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.error || 'Failed to delete work history', true);
        }
    } catch (err) {
        console.error('Error deleting work history:', err);
        showToast('Failed to delete work history', true);
    }
}

// Rebuild the Associated Employer dropdown in the Past Project form
// using the current workHistoryData (call after any WH save/delete).
function refreshEmployerDropdown() {
    const select = document.getElementById('pp-work-history-id');
    if (!select) return;
    const currentVal = select.value;
    let html = '<option value="">— No Association —</option>';
    workHistoryData.forEach(wh => {
        html += `<option value="${wh.id}"${wh.id === currentVal ? ' selected' : ''}>${wh.employer}${wh.is_current ? ' (Current)' : ''}</option>`;
    });
    select.innerHTML = html;
}

// ── Past Projects Functions ───
async function loadPastProjects() {
    const email = targetProfileEmail;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}`);
        if (!res.ok) {
            if (res.status === 404) {
                pastProjectsData = [];
            } else {
                throw new Error('Failed to fetch past projects');
            }
        } else {
            const data = await res.json();
            pastProjectsData = data.pastProjects || [];
            if (data.workHistory) {
                workHistoryData = data.workHistory;
            }
        }
    } catch (err) {
        console.error('Error loading past projects:', err);
        pastProjectsData = [];
    }
    renderPastProjectsList();
}

function renderPastProjectsList() {
    const countEl = document.getElementById('past-projects-count');
    const emptyState = document.getElementById('past-projects-empty');
    const list = document.getElementById('past-projects-list');

    // Update count
    if (countEl) {
        const count = pastProjectsData.length;
        countEl.textContent = `${count} entr${count !== 1 ? 'ies' : 'y'}`;
    }

    // Toggle empty state vs list
    if (emptyState && list) {
        if (pastProjectsData.length === 0) {
            emptyState.style.display = 'block';
            list.style.display = 'none';
        } else {
            emptyState.style.display = 'none';
            list.style.display = 'grid';
        }
    }

    // Render past project entries
    if (list) {
        // Sort by start_date descending (most recent first), entries without start_date go last
        const sortedData = [...pastProjectsData].sort((a, b) => {
            if (!a.start_date && !b.start_date) return 0;
            if (!a.start_date) return 1;
            if (!b.start_date) return -1;
            return b.start_date.localeCompare(a.start_date);
        });

        let html = '';
        sortedData.forEach(entry => {
            const projectName = entry.project_name || '—';
            const role = entry.role || '—';
            const startDate = entry.start_date || '?';
            const endDate = entry.end_date === null || entry.end_date === '' ? 'Present' : (entry.end_date || '?');
            const technologies = entry.technologies || '';
            const description = entry.description || '';

            // Find associated employer
            const employer = workHistoryData.find(wh => wh.id === entry.work_history_id);
            const employerName = employer ? employer.employer : null;

            html += `
                <div class="section-card" style="padding:1.25rem; position:relative;" data-id="${entry.id}">
                    <div style="font-weight:700; font-size:1rem; margin-bottom:0.25rem;">${projectName}</div>
                    ${employerName ? `<div style="font-size:0.82rem; color:var(--text-muted); margin-bottom:0.25rem;">📍 ${employerName}</div>` : ''}
                    <div style="color:var(--accent-blue); font-size:0.9rem; margin-bottom:0.25rem;">${role}</div>
                    <div style="color:var(--text-secondary); font-size:0.82rem; margin-bottom:0.5rem;">${startDate} – ${endDate}</div>
                    ${technologies ? '<div style="font-size:0.78rem; color:var(--accent-amber); margin-bottom:0.5rem;">' + technologies + '</div>' : ''}
                    ${description ? '<div style="font-size:0.85rem; color:var(--text-secondary);">' + description + '</div>' : ''}
                    <div style="display:flex; gap:0.5rem; margin-top:1rem;">
                        <button class="btn-secondary btn-edit-past-project" data-id="${entry.id}" style="padding:0.35rem 0.75rem; font-size:0.8rem;">✏️ Edit</button>
                        <button class="btn-remove btn-delete-past-project" data-id="${entry.id}" style="width:auto; padding:0.35rem 0.75rem; font-size:0.8rem;">🗑 Delete</button>
                    </div>
                </div>
            `;
        });
        list.innerHTML = html;

        // Wire up edit buttons
        document.querySelectorAll('.btn-edit-past-project').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const entry = pastProjectsData.find(e => e.id == id);
                if (entry) showPastProjectForm(entry);
            });
        });

        // Wire up delete buttons
        document.querySelectorAll('.btn-delete-past-project').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                deletePastProject(id);
            });
        });
    }
}

function showPastProjectForm(entry = null) {
    const form = document.getElementById('past-project-form');
    const title = document.getElementById('past-project-form-title');
    const idInput = document.getElementById('past-project-id');
    const workHistoryIdInput = document.getElementById('pp-work-history-id');
    const projectNameInput = document.getElementById('pp-project-name');
    const roleInput = document.getElementById('pp-role');
    const startDateInput = document.getElementById('pp-start-date');
    const endDateInput = document.getElementById('pp-end-date');
    const technologiesInput = document.getElementById('pp-technologies');
    const descriptionInput = document.getElementById('pp-description');

    // Populate employer dropdown
    if (workHistoryIdInput) {
        let html = '<option value="">— No Association —</option>';
        workHistoryData.forEach(wh => {
            html += `<option value="${wh.id}">${wh.employer} ${wh.is_current ? '(Current)' : ''}</option>`;
        });
        workHistoryIdInput.innerHTML = html;
    }

    // Load catalog if needed
    if (!projectCatalogLoaded) {
        loadProjectCatalog();
    }

    // Set up autocomplete event
    if (workHistoryIdInput && projectNameInput) {
        const updateAutocomplete = () => {
            const whId = workHistoryIdInput.value;
            const employer = workHistoryData.find(e => e.id === whId);
            const datalist = document.getElementById('project-catalog-list');

            if (employer && employer.is_current && datalist) {
                let optionsHtml = '';
                projectCatalog.forEach(p => {
                    optionsHtml += `<option value="${p.project_name}">`;
                });
                datalist.innerHTML = optionsHtml;
            } else if (datalist) {
                datalist.innerHTML = '';
            }
        };
        workHistoryIdInput.onchange = updateAutocomplete;
    }

    if (entry) {
        // Edit mode
        if (title) title.textContent = 'Edit Past Project';
        if (idInput) idInput.value = entry.id;
        if (workHistoryIdInput) workHistoryIdInput.value = entry.work_history_id || '';
        if (projectNameInput) projectNameInput.value = entry.project_name || '';
        if (roleInput) roleInput.value = entry.role || '';
        if (startDateInput) startDateInput.value = entry.start_date || '';
        if (endDateInput) endDateInput.value = entry.end_date || '';
        if (technologiesInput) technologiesInput.value = entry.technologies || '';
        if (descriptionInput) descriptionInput.value = entry.description || '';

        // Trigger initial autocomplete setup if needed
        if (projectNameInput.onchange) projectNameInput.onchange();
    } else {
        // Add mode
        if (title) title.textContent = 'Add Past Project';
        if (idInput) idInput.value = '';
        if (workHistoryIdInput) workHistoryIdInput.value = '';
        if (projectNameInput) projectNameInput.value = '';
        if (roleInput) roleInput.value = '';
        if (startDateInput) startDateInput.value = '';
        if (endDateInput) endDateInput.value = '';
        if (technologiesInput) technologiesInput.value = '';
        if (descriptionInput) descriptionInput.value = '';
    }

    if (form) form.style.display = '';
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hidePastProjectForm() {
    const form = document.getElementById('past-project-form');
    const projectNameInput = document.getElementById('pp-project-name');
    const workHistoryIdInput = document.getElementById('pp-work-history-id');
    const roleInput = document.getElementById('pp-role');
    const startDateInput = document.getElementById('pp-start-date');
    const endDateInput = document.getElementById('pp-end-date');
    const technologiesInput = document.getElementById('pp-technologies');
    const descriptionInput = document.getElementById('pp-description');

    if (form) form.style.display = 'none';
    if (projectNameInput) projectNameInput.value = '';
    if (workHistoryIdInput) workHistoryIdInput.value = '';
    if (roleInput) roleInput.value = '';
    if (startDateInput) startDateInput.value = '';
    if (endDateInput) endDateInput.value = '';
    if (technologiesInput) technologiesInput.value = '';
    if (descriptionInput) descriptionInput.value = '';
    const datalist = document.getElementById('project-catalog-list');
    if (datalist) datalist.innerHTML = '';
}

async function savePastProject() {
    const projectName = document.getElementById('pp-project-name')?.value?.trim() || '';
    const workHistoryId = document.getElementById('pp-work-history-id')?.value || null;
    const role = document.getElementById('pp-role')?.value?.trim() || '';
    const startDate = document.getElementById('pp-start-date')?.value?.trim() || null;
    const endDate = document.getElementById('pp-end-date')?.value?.trim() || null;
    const technologies = document.getElementById('pp-technologies')?.value?.trim() || '';
    const description = document.getElementById('pp-description')?.value?.trim() || '';
    const id = document.getElementById('past-project-id')?.value?.trim() || '';

    if (!projectName) {
        showToast('Project name is required', true);
        return;
    }

    // Start/end date validation
    if (startDate && endDate && startDate > endDate) {
        showToast('End date must be on or after the start date', true);
        return;
    }

    // Validation: Ensure project dates are within employer's dates
    if (workHistoryId) {
        const employer = workHistoryData.find(e => e.id === workHistoryId);
        if (employer) {
            if (startDate && employer.start_date && startDate < employer.start_date) {
                showToast(`Project start date (${startDate}) cannot be earlier than employer start date (${employer.start_date})`, true);
                return;
            }
            if (endDate && employer.end_date && endDate > employer.end_date) {
                showToast(`Project end date (${endDate}) cannot be later than employer end date (${employer.end_date})`, true);
                return;
            }
            // If employer has no end date (current), project can have an end date or not.
            // If project is ongoing, its endDate might be null/empty.
        }
    }

    const body = {
        project_name: projectName,
        work_history_id: workHistoryId,
        role,
        start_date: startDate,
        end_date: endDate,
        technologies,
        description
    };

    const email = targetProfileEmail;
    try {
        let res;
        if (id) {
            res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/past-projects/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } else {
            res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/past-projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        }

        if (res.ok) {
            showToast('Past project saved successfully');
            pastProjectsLoaded = false;
            loadPastProjects();
            hidePastProjectForm();
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.error || 'Failed to save past project', true);
        }
    } catch (err) {
        console.error('Error saving past project:', err);
        showToast('Failed to save past project', true);
    }
}

async function deletePastProject(id) {
    if (!confirm('Delete this past project?')) return;

    const email = targetProfileEmail;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/past-projects/${id}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            showToast('Past project deleted successfully');
            pastProjectsLoaded = false;
            loadPastProjects();
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.error || 'Failed to delete past project', true);
        }
    } catch (err) {
        console.error('Error deleting past project:', err);
        showToast('Failed to delete past project', true);
    }
}

async function loadProjectCatalog() {
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/catalog/projects');
        if (res.ok) {
            projectCatalog = await res.json();
            projectCatalogLoaded = true;
        }
    } catch (err) {
        console.error('Error loading project catalog:', err);
    }
}

// ── Generate CV ───────────────────────────────────────────────────────────────

let generateCvLoaded = false;
let cvTemplates = [];
let selectedTemplateId = null;
let currentGenerateEmail = null; // email of the user being generated for
let lastGeneratedHtml = null;   // last generated HTML blob URL

function initGenerateCvTab() {
    const isAdmin = authUser.role === 'admin';
    const isHR = authUser.role === 'hr';

    // Show user-select section for HR and Admin
    if (isAdmin || isHR) {
        const sect = document.getElementById('gen-target-section');
        if (sect) sect.style.display = '';
    }

    // Show "Clear All" button for all non-HR users
    const clearBtn = document.getElementById('btn-clear-snapshots');
    if (clearBtn && authUser.role !== 'hr') clearBtn.style.display = '';

    // Check URL params
    const urlParams = new URLSearchParams(window.location.search);
    const emailFromUrl = urlParams.get('email');
    if (emailFromUrl) {
        currentGenerateEmail = emailFromUrl.toLowerCase();
    } else {
        currentGenerateEmail = authUser.email;
    }

    loadCvTemplates();
    loadSnapshots(currentGenerateEmail);
}

async function loadGenTarget() {
    const input = document.getElementById('gen-target-email');
    const email = input?.value?.trim().toLowerCase();
    if (!email) {
        currentGenerateEmail = authUser.email;
        showToast('Generating for your own profile');
        loadSnapshots(currentGenerateEmail);
        return;
    }
    currentGenerateEmail = email;
    showToast(`Target set to ${email}`);
    loadSnapshots(email);
}

async function loadCvTemplates() {
    const picker = document.getElementById('template-picker');
    if (!picker) return;
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/cv-profiles/templates');
        if (!res.ok) throw new Error('Failed to load templates');
        cvTemplates = await res.json();
        renderTemplatePicker();
    } catch (err) {
        console.error('Error loading templates:', err);
        if (picker) picker.innerHTML = '<div style="color:var(--accent-rose); font-size:0.85rem;">Failed to load templates</div>';
    }
}

function renderTemplatePicker() {
    const picker = document.getElementById('template-picker');
    if (!picker) return;

    const defaultTemplate = cvTemplates.find(t => t.is_default) || cvTemplates[0];
    if (!selectedTemplateId && defaultTemplate) selectedTemplateId = defaultTemplate.id;

    const styleMap = {
        'classic': { icon: '📄', desc: 'Clean & professional — ideal for corporate CVs' },
        'modern': { icon: '🌙', desc: 'Bold dark theme — great for tech & creative roles' },
        'minimal': { icon: '🎯', desc: 'Monospace minimal — understated elegance' },
    };

    picker.innerHTML = cvTemplates.map(t => {
        const meta = styleMap[t.id] || { icon: '📋', desc: '' };
        const isSelected = t.id === selectedTemplateId;
        return `
        <div class="template-card section-card ${isSelected ? 'selected' : ''}" data-id="${t.id}"
            style="padding:1rem 1.25rem; cursor:pointer; min-width:180px; flex:1; max-width:260px;
            border:2px solid ${isSelected ? 'var(--accent-blue)' : 'var(--border)'};
            transition:border-color 0.15s, box-shadow 0.15s;
            ${isSelected ? 'box-shadow:0 0 0 3px rgba(59,130,246,0.15);' : ''}">
            <div style="font-size:1.8rem; margin-bottom:0.4rem;">${meta.icon}</div>
            <div style="font-weight:700; font-size:0.95rem; margin-bottom:0.25rem;">${t.name}</div>
            <div style="font-size:0.78rem; color:var(--text-muted);">${meta.desc}</div>
            ${t.is_default ? '<div style="margin-top:0.5rem; font-size:0.7rem; color:var(--accent-blue); font-weight:600;">DEFAULT</div>' : ''}
        </div>`;
    }).join('');

    picker.querySelectorAll('.template-card').forEach(card => {
        card.addEventListener('click', () => {
            selectedTemplateId = card.dataset.id;
            // Update selection highlight
            picker.querySelectorAll('.template-card').forEach(c => {
                c.style.borderColor = c.dataset.id === selectedTemplateId ? 'var(--accent-blue)' : 'var(--border)';
                c.style.boxShadow = c.dataset.id === selectedTemplateId ? '0 0 0 3px rgba(59,130,246,0.15)' : '';
            });
        });
    });
}

async function generateCv() {
    const email = currentGenerateEmail || authUser.email;
    const status = document.getElementById('gen-status');
    const btn = document.getElementById('btn-generate-cv');

    if (btn) btn.disabled = true;
    if (status) status.textContent = '⏳ Generating…';

    try {
        const body = {};
        if (selectedTemplateId) body.template_id = selectedTemplateId;

        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Failed to generate CV', true);
            if (status) status.textContent = '❌ Failed';
            return;
        }

        const data = await res.json();
        lastGeneratedHtml = data.html;

        // Render into iframe
        const frame = document.getElementById('cv-preview-frame');
        if (frame) {
            frame.srcdoc = data.html;
        }

        const previewSection = document.getElementById('cv-preview-section');
        if (previewSection) previewSection.style.display = '';

        if (status) status.textContent = `✅ Generated using "${data.template_name}"`;
        showToast('CV generated successfully');

        // Reload snapshots
        await loadSnapshots(email);

    } catch (err) {
        console.error('Error generating CV:', err);
        showToast('Failed to generate CV', true);
        if (status) status.textContent = '❌ Error';
    } finally {
        if (btn) btn.disabled = false;
    }
}

function printCv() {
    if (!lastGeneratedHtml) {
        showToast('Please generate a CV first', true);
        return;
    }
    // Open in new tab and trigger print - more reliable than iframe.contentWindow.print()
    const blob = new Blob([lastGeneratedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const printWin = window.open(url, '_blank');
    if (printWin) {
        printWin.addEventListener('load', () => {
            printWin.focus();
            printWin.print();
        });
    }
}

function openCvInTab() {
    if (!lastGeneratedHtml) {
        showToast('Please generate a CV first', true);
        return;
    }
    const blob = new Blob([lastGeneratedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
}

async function loadSnapshots(email) {
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/snapshots`);
        if (!res.ok) return;
        const snapshots = await res.json();
        renderSnapshotsTable(snapshots, email);
    } catch (err) {
        console.error('Error loading snapshots:', err);
    }
}

function renderSnapshotsTable(snapshots, email) {
    const empty = document.getElementById('snapshots-empty');
    const container = document.getElementById('snapshots-table-container');
    const tbody = document.getElementById('snapshots-tbody');
    const clearBtn = document.getElementById('btn-clear-snapshots');

    const role = authUser.role;
    const isAdmin = role === 'admin';
    const isHR = role === 'hr';
    const isOwnProfile = authUser.email.toLowerCase() === email.toLowerCase();
    // Can delete: admin always, HR/staff only own profile
    const canDelete = isAdmin || isOwnProfile;

    if (!snapshots || snapshots.length === 0) {
        if (empty) empty.style.display = 'block';
        if (container) container.style.display = 'none';
        // Show Clear All (disabled) for users who can manage their own CV
        if (clearBtn && canDelete) {
            clearBtn.style.display = 'inline-flex';
            clearBtn.disabled = true;
            clearBtn.style.opacity = '0.4';
        }
        return;
    }

    if (empty) empty.style.display = 'none';
    if (container) container.style.display = '';
    if (clearBtn && canDelete) {
        clearBtn.style.display = 'inline-flex';
        clearBtn.disabled = false;
        clearBtn.style.opacity = '';
    }

    if (!tbody) return;
    tbody.innerHTML = snapshots.map(s => {
        const created = new Date(s.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
        const deleteBtn = canDelete
            ? `<button class="btn-remove btn-delete-snapshot" data-id="${s.id}" data-email="${email}" style="width:auto; padding:0.25rem 0.6rem; font-size:0.78rem;">🗑</button>`
            : `<span style="font-size:0.75rem; color:var(--text-muted);" title="HR cannot delete snapshots">—</span>`;
        return `<tr>
            <td style="font-size:0.85rem;">${created}</td>
            <td style="font-size:0.85rem;">${s.template_name || '—'}</td>
            <td style="font-size:0.85rem;">${s.generated_by}</td>
            <td style="display:flex; gap:0.4rem; align-items:center;">
                <button class="btn-secondary btn-view-snapshot" data-id="${s.id}" data-email="${email}" style="padding:0.25rem 0.6rem; font-size:0.78rem;">👁 View</button>
                ${deleteBtn}
            </td>
        </tr>`;
    }).join('');

    // Wire view buttons
    tbody.querySelectorAll('.btn-view-snapshot').forEach(btn => {
        btn.addEventListener('click', () => viewSnapshot(btn.dataset.email, btn.dataset.id));
    });
    // Wire delete buttons
    tbody.querySelectorAll('.btn-delete-snapshot').forEach(btn => {
        btn.addEventListener('click', () => deleteSnapshot(btn.dataset.email, btn.dataset.id));
    });
}

async function viewSnapshot(email, id) {
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/snapshots/${id}`);
        if (!res.ok) { showToast('Failed to load snapshot', true); return; }
        const data = await res.json();
        lastGeneratedHtml = data.snapshot_html;

        const frame = document.getElementById('cv-preview-frame');
        if (frame) frame.srcdoc = data.snapshot_html;

        const previewSection = document.getElementById('cv-preview-section');
        if (previewSection) previewSection.style.display = '';

        const status = document.getElementById('gen-status');
        const created = new Date(data.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
        if (status) status.textContent = `📸 Viewing snapshot from ${created}`;

        previewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        console.error('Error viewing snapshot:', err);
        showToast('Failed to load snapshot', true);
    }
}

async function deleteSnapshot(email, id) {
    if (!confirm('Delete this CV snapshot?')) return;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/snapshots/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Snapshot deleted');
            loadSnapshots(email);
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Failed to delete snapshot', true);
        }
    } catch (err) {
        console.error('Error deleting snapshot:', err);
        showToast('Failed to delete snapshot', true);
    }
}

async function clearAllSnapshots() {
    const email = currentGenerateEmail || authUser.email;
    if (!confirm(`Clear ALL CV snapshots for ${email}? This cannot be undone.`)) return;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/${email}/snapshots`, { method: 'DELETE' });
        if (res.ok) {
            showToast('All snapshots cleared');
            loadSnapshots(email);
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Failed to clear snapshots', true);
        }
    } catch (err) {
        console.error('Error clearing snapshots:', err);
        showToast('Failed to clear snapshots', true);
    }
}

// ── Init ───

async function init() {
    renderNav('cv-profile');
    
    // Set target email from URL
    const urlParams = new URLSearchParams(window.location.search);
    const emailFromUrl = urlParams.get('email');
    if (emailFromUrl) {
        targetProfileEmail = emailFromUrl.toLowerCase();
    } else {
        targetProfileEmail = authUser.email.toLowerCase();
    }

    // 1. Initial Data Load (Parallel)
    try {
        await Promise.all([
            loadSubmissionData(), 
            loadProfile()         
        ]);
    } catch (e) {
        console.error('Initial data load failed:', e);
    }

    // 2. Tab Infrastructure
    initSubmissionTab(); 
    initGenerateCvTab();
    wireUpTabSwitching();

    // 3. Global Event Listeners
    document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
        await saveToBackend();
        await saveProfile();
        showToast('Saved to server ✓');
        loadProfile();
    });
    document.getElementById('btn-save')?.addEventListener('click', async () => {
        await saveToBackend();
        await saveProfile();
        showToast('Saved to server ✓');
        loadProfile();
    });
    document.getElementById('btn-upload-photo')?.addEventListener('click', uploadPhoto);

    // Proof upload buttons
    document.getElementById('btn-upload-edu-proof')?.addEventListener('click', () => {
        const id = document.getElementById('education-id')?.value;
        if (id) uploadEducationProof(id);
        else showToast('Please save the education entry first', true);
    });
    document.getElementById('btn-upload-cert-proof')?.addEventListener('click', () => {
        const id = document.getElementById('certification-id')?.value;
        if (id) uploadCertificationProof(id);
        else showToast('Please save the certification entry first', true);
    });

    // Education tab buttons
    document.getElementById('btn-add-education')?.addEventListener('click', () => showEducationForm(null));
    document.getElementById('btn-save-education')?.addEventListener('click', saveEducation);
    document.getElementById('btn-cancel-education')?.addEventListener('click', hideEducationForm);

    // Certifications tab buttons
    document.getElementById('btn-add-certification')?.addEventListener('click', () => showCertificationForm(null));
    document.getElementById('btn-save-certification')?.addEventListener('click', saveCertification);
    document.getElementById('btn-cancel-certification')?.addEventListener('click', hideCertificationForm);

    // Work History tab buttons
    document.getElementById('btn-add-work-history')?.addEventListener('click', () => showWorkHistoryForm(null));
    document.getElementById('btn-save-work-history')?.addEventListener('click', saveWorkHistory);
    document.getElementById('btn-cancel-work-history')?.addEventListener('click', hideWorkHistoryForm);

    // Past Projects tab buttons
    document.getElementById('btn-add-past-project')?.addEventListener('click', () => showPastProjectForm(null));
    document.getElementById('btn-save-past-project')?.addEventListener('click', savePastProject);
    document.getElementById('btn-cancel-past-project')?.addEventListener('click', hidePastProjectForm);

    // Submission tab specific buttons
    document.getElementById('btn-add-skill')?.addEventListener('click', () => {
        addSkillRow({ id: uid(), skill: '', rating: 0 });
        updateSkillsCount();
        scheduleAutoSave();
    });
    document.getElementById('btn-add-project')?.addEventListener('click', () => {
        addProjectRowSub({});
        updateProjectsCountSub();
        scheduleAutoSave();
    });
    document.getElementById('btn-load-previous')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-load-previous');
        if (!btn) return;
        btn.textContent = '⏳ Loading…';
        btn.disabled = true;
        try {
            const res = await window.StaffTrackAuth.apiFetch('/api/submissions');
            const all = res.ok ? await res.json() : [];
            if (!all.length) {
                showToast('No saved submissions found');
            } else {
                showLoadModal(all);
            }
        } catch { showToast('Could not reach server'); }
        btn.textContent = '📂 Load Previous';
        btn.disabled = false;
    });
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

    // Generate CV buttons
    document.getElementById('btn-generate-cv')?.addEventListener('click', generateCv);
    document.getElementById('btn-print-cv')?.addEventListener('click', printCv);
    document.getElementById('btn-open-cv')?.addEventListener('click', openCvInTab);
    document.getElementById('btn-clear-snapshots')?.addEventListener('click', clearAllSnapshots);
    document.getElementById('btn-load-gen-target')?.addEventListener('click', loadGenTarget);
}

document.addEventListener('DOMContentLoaded', init);
