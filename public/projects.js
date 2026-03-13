'use strict';

// Use auth module functions
const token = window.StaffTrackAuth.getToken();
const userStr = sessionStorage.getItem('st_user');
if (!token || !userStr) {
  location.href = '/login.html';
  throw new Error('Not logged in');
}
const authUser = JSON.parse(userStr);


// ── Data ──────────────────────────────────────────────────────────────────────
let ALL_PROJECTS_CSV = []; // from extracted_projects.csv (full project list)
let API_PROJECTS = [];     // from /api/reports/projects (projects with staff)
let STAFF_DATA = [];       // from Staff CSV (for assign modal autocomplete)
let MANAGED_PROJECTS = []; // from /api/managed-projects

// ── CSV helpers ───────────────────────────────────────────────────────────────
// (Removed: moved to backend seeder script)

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' toast-err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 400); }, 2800);
}

// ── Highlight ─────────────────────────────────────────────────────────────────
function hl(text, q) {
  if (!q || !text) return text || '';
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return text.slice(0, i) + `<mark>${text.slice(i, i + q.length)}</mark>` + text.slice(i + q.length);
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportProjectsCSV() {
  const rows = [
    ['SOC', 'Project Name', 'Customer', 'Staff Count', 'Staff Names', 'Roles', 'End Dates'],
  ];
  const combined = buildCombinedList(false);
  combined.forEach(p => {
    const staffNames = p.staff.map(s => s.name).join(' | ');
    const roles = p.staff.map(s => s.role || '—').join(' | ');
    const ends = p.staff.map(s => s.endDate || '—').join(' | ');
    rows.push([p.soc, p.projectName, p.customer, p.staff.length, staffNames, roles, ends]);
  });
  downloadCSV(rows, 'stafftrack-projects.csv');
}

function downloadCSV(rows, filename) {
  const content = rows.map(r =>
    r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob([content], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Build combined project list ───────────────────────────────────────────────
// Merges full CSV project list + managed projects API + submissions API
function buildCombinedList(hideEmpty = true) {
  const apiMap = new Map();
  // submissions map
  API_PROJECTS.forEach(p => {
    const key = p.soc || p.projectName;
    apiMap.set(key, p);
  });

  const combinedKeys = new Set();
  const combined = [];

  const addProj = (src, staffList) => {
    const key = src.soc || src.projectName;
    if (!key || combinedKeys.has(key)) return;
    combinedKeys.add(key);
    combined.push({
      soc: src.soc || '',
      projectName: src.projectName || src.name || '',
      customer: src.customer || '',
      staff: staffList || [],
    });
  };

  // 1. Add Managed Projects explicitly created by coordinators
  MANAGED_PROJECTS.forEach(mp => {
    const key = mp.soc || mp.name;
    const fromApi = apiMap.get(key);
    addProj(mp, fromApi ? fromApi.staff : []);
  });

  // 2. Add projects from submissions
  API_PROJECTS.forEach(p => addProj(p, p.staff));

  combined.sort((a, b) => (a.projectName || a.soc).localeCompare(b.projectName || b.soc));
  return hideEmpty ? combined.filter(p => p.staff.length > 0) : combined;
}

// ── Render ────────────────────────────────────────────────────────────────────
let hideEmpty = true;
let searchQuery = '';

function render() {
  const container = document.getElementById('projects-container');
  const countEl = document.getElementById('proj-count');
  const q = searchQuery.toLowerCase();

  let list = buildCombinedList(hideEmpty);

  const isAdminOrHR = authUser.role === 'admin' || authUser.role === 'hr' || authUser.is_hr;
  if (!isAdminOrHR) {
    list = list.filter(p => {
      // 1. Am I assigned to this project?
      if (p.staff.some(s => (s.email || '').toLowerCase() === authUser.email.toLowerCase())) {
        return true;
      }

      // 2. Am I a Coordinator who owns this project?
      if (authUser.is_coordinator || authUser.role === 'coordinator') {
        const managedObj = MANAGED_PROJECTS.find(mp => {
          const s1 = (mp.soc || '').trim().toLowerCase();
          const s2 = (p.soc || '').trim().toLowerCase();
          if (s1 && s1 === s2) return true;
          const n1 = (mp.name || '').trim().toLowerCase();
          const n2 = (p.projectName || '').trim().toLowerCase();
          return (!s1 && !s2 && n1 && n1 === n2);
        });
        if (managedObj) return true;
      }

      return false;
    });
  }

  if (q) {
    list = list.filter(p =>
      p.projectName.toLowerCase().includes(q) ||
      p.soc.toLowerCase().includes(q) ||
      p.customer.toLowerCase().includes(q) ||
      p.staff.some(s => s.name.toLowerCase().includes(q))
    );
  }

  countEl.textContent = `${list.length} project${list.length !== 1 ? 's' : ''}`;

  if (!list.length) {
    container.innerHTML = `<div class="view-empty">
      <span style="font-size:2rem">🗂</span>
      <p>${hideEmpty && !q ? 'No projects with assigned staff.' : 'No projects match your search.'}</p>
      ${hideEmpty && !q ? '<p style="font-size:.8rem;color:var(--text-muted)">Toggle "Hide unassigned" to see all projects.</p>' : ''}
    </div>`;
    return;
  }

  container.innerHTML = list.map((p, idx) => buildProjectCard(p, q, idx)).join('');

  container.querySelectorAll('.btn-assign').forEach(btn => {
    const idx = +btn.dataset.idx;
    btn.addEventListener('click', () => showAssignModal(list[idx]));
  });

  container.querySelectorAll('.btn-edit-project').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = JSON.parse(btn.dataset.project);
      showEditProjectModal(btn.dataset.id, p);
    });
  });

  // Wire up Edit / Delete assignment buttons
  container.querySelectorAll('.btn-edit-assign').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = JSON.parse(btn.dataset.staff);
      const p = JSON.parse(btn.dataset.project);
      showEditAssignModal(s, p);
    });
  });

  container.querySelectorAll('.btn-del-assign').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = JSON.parse(btn.dataset.staff);
      const p = JSON.parse(btn.dataset.project);

      if (!confirm(`Are you sure you want to unassign ${s.name} from ${p.projectName || p.soc}?`)) return;

      try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/submissions/assign-project/${s.assignmentId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error();
        showToast(`Unassigned ${s.name}`);
        await loadData();
      } catch {
        showToast('Failed to unassign staff', true);
      }
    });
  });
}

function buildProjectCard(p, q, idx) {
  let canEditAssign = authUser.role === 'admin';
  const managedObj = MANAGED_PROJECTS.find(mp => {
    const s1 = (mp.soc || '').trim().toLowerCase();
    const s2 = (p.soc || '').trim().toLowerCase();
    if (s1 && s1 === s2) return true;
    const n1 = (mp.name || '').trim().toLowerCase();
    const n2 = (p.projectName || '').trim().toLowerCase();
    return (!s1 && !s2 && n1 && n1 === n2);
  });
  if (managedObj) canEditAssign = true;

  const staffBadges = p.staff.length
    ? p.staff.map(s => `
        <div class="staff-badge">
          <div class="staff-info">
            <span class="staff-badge-name">${hl(s.name, q)}</span>
            ${s.role ? `<span class="staff-badge-role">${hl(s.role, q)}</span>` : ''}
            ${s.endDate ? `<span class="staff-badge-date">until ${s.endDate}</span>` : ''}
          </div>
          ${canEditAssign ? `
          <div class="badge-actions">
            <button class="badge-btn btn-edit-assign" title="Edit Assignment" data-staff='${JSON.stringify(s).replace(/'/g, "&apos;")}' data-project='{"soc":"${p.soc}","projectName":"${(p.projectName || '').replace(/'/g, "&apos;")}","customer":"${(p.customer || '').replace(/'/g, "&apos;")}"}'>✎</button>
            <button class="badge-btn btn-del btn-del-assign" title="Unassign" data-staff='${JSON.stringify(s).replace(/'/g, "&apos;")}' data-project='{"soc":"${p.soc}","projectName":"${(p.projectName || '').replace(/'/g, "&apos;")}"}'>✕</button>
          </div>` : ''}
        </div>`).join('')
    : `<span class="no-staff-label">No staff assigned</span>`;

  let classBadges = '';
  if (p.type_infra) classBadges += `<span class="proj-class-badge infra">Infra</span>`;
  if (p.type_software) classBadges += `<span class="proj-class-badge software">Software</span>`;
  if (p.type_infra_support) classBadges += `<span class="proj-class-badge isupport">Infra Support</span>`;
  if (p.type_software_support) classBadges += `<span class="proj-class-badge ssupport">Software Support</span>`;

  const classHtml = classBadges ? `<div class="project-classifications">${classBadges}</div>` : '';

  const editBtn = (managedObj && canEditAssign) ? `<button class="badge-btn btn-edit-project" style="display:inline-flex;margin-left:.5rem" title="Edit Project Details" data-id="${managedObj.id}" data-project='${JSON.stringify({
    soc: managedObj.soc || '',
    name: managedObj.name || '',
    customer: managedObj.customer || '',
    type_infra: !!managedObj.type_infra,
    type_software: !!managedObj.type_software,
    type_infra_support: !!managedObj.type_infra_support,
    type_software_support: !!managedObj.type_software_support,
    end_date: managedObj.end_date || ''
  }).replace(/'/g, "&apos;")}'>✎</button>` : '';

  return `
    <div class="project-card">
      <div class="project-card-header">
        <div class="project-card-meta" style="display:flex;align-items:center;flex-wrap:wrap">
          ${p.soc ? `<span class="soc-badge">${hl(p.soc, q)}</span>` : ''}
          <h3 class="project-card-name" style="display:flex;align-items:center">${hl(p.projectName || '(unnamed)', q)} ${editBtn}</h3>
          ${p.customer ? `<span class="project-customer">${hl(p.customer, q)}</span>` : ''}
          ${classHtml}
        </div>
        <div class="project-card-actions">
          <span class="staff-count-pill ${p.staff.length ? '' : 'empty'}">${p.staff.length} staff</span>
          ${canEditAssign ? `
          <button class="btn-assign btn-add" data-soc="${p.soc}" data-name="${p.projectName}" data-customer="${p.customer}" data-idx="${idx}">
            ＋ Assign Staff
          </button>` : ''}
        </div>
      </div>
      <div class="project-card-staff">${staffBadges}</div>
    </div>`;
}

// ── Coordinator Create Project Modal ──────────────────────────────────────────
function showCreateProjectModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:480px">
      <div class="modal-header">
        <h2>✨ Add Managed Project</h2>
        <button class="modal-close" title="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid single">
          <div class="form-group full">
            <label>Project Name *</label>
            <div class="autocomplete-wrap">
              <input type="text" id="cp-name" placeholder="Search catalog or type a new name..." autocomplete="off">
            </div>
          </div>
          <div class="form-group">
            <label>SOC Code</label>
            <input type="text" id="cp-soc" placeholder="e.g. ZCS23-158">
          </div>
          <div class="form-group">
            <label>Customer</label>
            <input type="text" id="cp-customer" placeholder="Customer name">
          </div>
          <div class="form-group full" style="margin-top:.5rem">
            <label>Project Classification</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:.3rem">
              <label style="display:flex;align-items:center;gap:.4rem;text-transform:none;letter-spacing:0;color:var(--text-primary)"><input type="checkbox" id="cp-t-infra"> Infrastructure Project</label>
              <label style="display:flex;align-items:center;gap:.4rem;text-transform:none;letter-spacing:0;color:var(--text-primary)"><input type="checkbox" id="cp-t-soft"> Software Project</label>
              <label style="display:flex;align-items:center;gap:.4rem;text-transform:none;letter-spacing:0;color:var(--text-primary)"><input type="checkbox" id="cp-t-isupport"> Infra Support</label>
              <label style="display:flex;align-items:center;gap:.4rem;text-transform:none;letter-spacing:0;color:var(--text-primary)"><input type="checkbox" id="cp-t-ssupport"> Software Support</label>
            </div>
          </div>
          <div class="form-group full">
            <label>Overall End Date</label>
            <input type="date" id="cp-end">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary modal-close-btn">Cancel</button>
        <button class="btn-primary" id="cp-submit">Create Project</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.querySelector('.modal-close-btn').addEventListener('click', close);

  const nameInput = backdrop.querySelector('#cp-name');
  const socInput = backdrop.querySelector('#cp-soc');
  const custInput = backdrop.querySelector('#cp-customer');
  const endInput = backdrop.querySelector('#cp-end');

  const acDrop = document.createElement('div');
  nameInput.parentElement.appendChild(acDrop);

  nameInput.addEventListener('input', () => {
    const q = nameInput.value.trim().toLowerCase();
    acDrop.innerHTML = '';
    if (!q) return;

    // Search ALL_PROJECTS_CSV for matches in the catalog
    const matches = ALL_PROJECTS_CSV.filter(p =>
      p.project_name.toLowerCase().includes(q) ||
      (p.soc || '').toLowerCase().includes(q)
    ).slice(0, 10);

    if (!matches.length) return;

    acDrop.className = 'ac-dropdown';
    matches.forEach(p => {
      const item = document.createElement('div');
      item.className = 'ac-item';
      item.innerHTML = `<div class="ac-name">${hl(p.project_name, q)}</div><div class="ac-sub">${p.soc ? `<span style="color:var(--accent-blue);font-weight:600">${hl(p.soc, q)}</span>` : 'No SOC'} · ${p.customer || '—'}</div>`;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        nameInput.value = p.project_name;
        socInput.value = p.soc || '';
        custInput.value = p.customer || '';
        endInput.value = p.end_date || '';
        acDrop.innerHTML = '';
      });
      acDrop.appendChild(item);
    });
  });

  document.addEventListener('click', function hideAc(e) {
    if (!e.target.closest('.autocomplete-wrap')) { acDrop.innerHTML = ''; document.removeEventListener('click', hideAc); }
  });

  backdrop.querySelector('#cp-submit').addEventListener('click', async () => {
    const btn = backdrop.querySelector('#cp-submit');
    const name = nameInput.value.trim();
    if (!name) return showToast('Project Name is required', true);

    btn.disabled = true;
    btn.textContent = 'Creating...';
    try {
      const res = await window.StaffTrackAuth.apiFetch('/api/managed-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          name: name,
          soc: document.getElementById('cp-soc').value.trim(),
          customer: document.getElementById('cp-customer').value.trim(),
          type_infra: document.getElementById('cp-t-infra').checked,
          type_software: document.getElementById('cp-t-soft').checked,
          type_infra_support: document.getElementById('cp-t-isupport').checked,
          type_software_support: document.getElementById('cp-t-ssupport').checked,
          end_date: document.getElementById('cp-end').value
        })
      });
      if (!res.ok) throw new Error();

      hideEmpty = false;
      const tEmpty = document.getElementById('toggle-empty');
      if (tEmpty) tEmpty.checked = false;

      showToast('Project created successfully');
      close();
      await loadData();
    } catch {
      showToast('Failed to create project', true);
      btn.disabled = false;
      btn.textContent = 'Create Project';
    }
  });
}

// ── Coordinator Edit Project Modal ────────────────────────────────────────────
function showEditProjectModal(id, p) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:480px">
      <div class="modal-header">
        <h2>✎ Edit Managed Project</h2>
        <button class="modal-close" title="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid single">
          <div class="form-group full">
            <label>Project Name *</label>
            <input type="text" id="ep-name" value="${p.name}" autocomplete="off">
          </div>
          <div class="form-group">
            <label>SOC Code</label>
            <input type="text" id="ep-soc" value="${p.soc}">
          </div>
          <div class="form-group">
            <label>Customer</label>
            <input type="text" id="ep-customer" value="${p.customer}">
          </div>
          <div class="form-group full" style="margin-top:.5rem">
            <label>Project Classification</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:.3rem">
              <label style="display:flex;align-items:center;gap:.4rem;text-transform:none;letter-spacing:0;color:var(--text-primary)"><input type="checkbox" id="ep-t-infra" ${p.type_infra ? 'checked' : ''}> Infrastructure Project</label>
              <label style="display:flex;align-items:center;gap:.4rem;text-transform:none;letter-spacing:0;color:var(--text-primary)"><input type="checkbox" id="ep-t-soft" ${p.type_software ? 'checked' : ''}> Software Project</label>
              <label style="display:flex;align-items:center;gap:.4rem;text-transform:none;letter-spacing:0;color:var(--text-primary)"><input type="checkbox" id="ep-t-isupport" ${p.type_infra_support ? 'checked' : ''}> Infra Support</label>
              <label style="display:flex;align-items:center;gap:.4rem;text-transform:none;letter-spacing:0;color:var(--text-primary)"><input type="checkbox" id="ep-t-ssupport" ${p.type_software_support ? 'checked' : ''}> Software Support</label>
            </div>
          </div>
          <div class="form-group full">
            <label>Overall End Date</label>
            <input type="date" id="ep-end" value="${p.end_date}">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary modal-close-btn">Cancel</button>
        <button class="btn-primary" id="ep-submit">Save Changes</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.querySelector('.modal-close-btn').addEventListener('click', close);

  backdrop.querySelector('#ep-submit').addEventListener('click', async () => {
    const btn = backdrop.querySelector('#ep-submit');
    const name = document.getElementById('ep-name').value.trim();
    if (!name) return showToast('Project Name is required', true);

    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const res = await window.StaffTrackAuth.apiFetch(`/api/managed-projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          name: name,
          soc: document.getElementById('ep-soc').value.trim(),
          customer: document.getElementById('ep-customer').value.trim(),
          type_infra: document.getElementById('ep-t-infra').checked,
          type_software: document.getElementById('ep-t-soft').checked,
          type_infra_support: document.getElementById('ep-t-isupport').checked,
          type_software_support: document.getElementById('ep-t-ssupport').checked,
          end_date: document.getElementById('ep-end').value
        })
      });
      if (!res.ok) throw new Error();

      showToast('Project updated successfully');
      close();
      await loadData();
    } catch {
      showToast('Failed to update project', true);
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });
}

// ── Assign Staff Modal ────────────────────────────────────────────────────────
function showAssignModal(project) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:480px">
      <div class="modal-header">
        <h2>＋ Assign Staff</h2>
        <button class="modal-close" title="Close">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:.82rem;color:var(--text-secondary);margin-bottom:1rem">
          Assigning to: <strong>${project.projectName || project.soc}</strong>
          ${project.customer ? ` · ${project.customer}` : ''}
        </p>
        <div class="form-grid single">
          <div class="form-group">
            <label for="assign-name">Staff Name *</label>
            <div class="autocomplete-wrap">
              <input type="text" id="assign-name" placeholder="Search staff name…" autocomplete="off">
            </div>
          </div>
          <div class="form-group">
            <label for="assign-role">Role on Project</label>
            <input type="text" id="assign-role" placeholder="e.g. Project Manager, Developer">
          </div>
          <div class="form-group">
            <label for="assign-end">Estimated End Date</label>
            <input type="date" id="assign-end">
          </div>
        </div>
        <p id="assign-error" style="color:var(--accent-rose);font-size:.82rem;margin-top:.5rem;display:none"></p>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="assign-cancel">Cancel</button>
        <button class="btn-primary" id="assign-submit">Assign</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.getElementById && null;
  backdrop.querySelector('#assign-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  const nameInput = backdrop.querySelector('#assign-name');
  const errEl = backdrop.querySelector('#assign-error');

  // Autocomplete for staff names
  const acDrop = document.createElement('div');
  nameInput.parentElement.appendChild(acDrop);
  nameInput.addEventListener('input', () => {
    const q = nameInput.value.trim().toLowerCase();
    acDrop.innerHTML = '';
    if (!q) return;
    const matches = STAFF_DATA.filter(s => s.name.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) return;
    acDrop.className = 'ac-dropdown';
    matches.forEach(s => {
      const item = document.createElement('div');
      item.className = 'ac-item';
      item.innerHTML = `<div class="ac-name">${s.name}</div><div class="ac-sub">${s.title || ''} · ${s.department || ''}</div>`;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        nameInput.value = s.name;
        nameInput.dataset.staffData = JSON.stringify({ name: s.name, title: s.title, department: s.department, email: s.email });
        acDrop.innerHTML = '';
      });
      acDrop.appendChild(item);
    });
  });
  document.addEventListener('click', function hideAc(e) {
    if (!e.target.closest('.autocomplete-wrap')) { acDrop.innerHTML = ''; document.removeEventListener('click', hideAc); }
  });

  backdrop.querySelector('#assign-submit').addEventListener('click', async () => {
    const staffName = nameInput.value.trim();
    const role = backdrop.querySelector('#assign-role').value.trim();
    const endDate = backdrop.querySelector('#assign-end').value;

    if (!staffName) { errEl.textContent = 'Please enter a staff name.'; errEl.style.display = ''; return; }

    let staffData = null;
    try { staffData = JSON.parse(nameInput.dataset.staffData || 'null'); } catch { /* ok */ }

    const submitBtn = backdrop.querySelector('#assign-submit');
    submitBtn.textContent = 'Assigning…';
    submitBtn.disabled = true;

    try {
      const res = await window.StaffTrackAuth.apiFetch('/api/submissions/assign-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffName,
          staffData,
          project: {
            soc: project.soc,
            projectName: project.projectName,
            customer: project.customer,
            role,
            endDate,
          },
        }),
      });
      if (res.status === 409) {
        errEl.textContent = `${staffName} is already assigned to this project.`;
        errEl.style.display = '';
        submitBtn.textContent = 'Assign';
        submitBtn.disabled = false;
        return;
      }
      if (!res.ok) throw new Error('Server error');
      showToast(`✓ ${staffName} assigned to ${project.projectName || project.soc}`);
      close();
      await loadData(); // refresh
    } catch {
      errEl.textContent = 'Failed to assign. Please try again.';
      errEl.style.display = '';
      submitBtn.textContent = 'Assign';
      submitBtn.disabled = false;
    }
  });
}

// ── Edit Assignment Modal ───────────────────────────────────────────────────────
function showEditAssignModal(staff, project) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:480px">
      <div class="modal-header">
        <h2>✎ Edit Assignment</h2>
        <button class="modal-close" title="Close">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:.9rem;margin-bottom:.5rem"><strong>${staff.name}</strong></p>
        <p style="font-size:.82rem;color:var(--text-secondary);margin-bottom:1rem">
          Assigning to: <strong>${project.projectName || project.soc}</strong>
          ${project.customer ? ` · ${project.customer}` : ''}
        </p>
        <div class="form-grid single">
          <div class="form-group">
            <label for="edit-role">Role on Project</label>
            <input type="text" id="edit-role" placeholder="e.g. Project Manager, Developer" value="${staff.role || ''}">
          </div>
          <div class="form-group">
            <label for="edit-end">Estimated End Date</label>
            <input type="date" id="edit-end" value="${staff.endDate || ''}">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="edit-cancel">Cancel</button>
        <button class="btn-primary" id="edit-submit">Save Changes</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.querySelector('#edit-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  backdrop.querySelector('#edit-submit').addEventListener('click', async () => {
    const role = backdrop.querySelector('#edit-role').value.trim();
    const endDate = backdrop.querySelector('#edit-end').value;
    const submitBtn = backdrop.querySelector('#edit-submit');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
      const res = await window.StaffTrackAuth.apiFetch(`/api/submissions/assign-project/${staff.assignmentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ role, endDate })
      });

      if (!res.ok) throw new Error('Save failed');

      showToast('Assignment updated successfully!');
      close();
      await loadData();
    } catch (err) {
      console.error(err);
      showToast('Failed to update assignment', true);
      submitBtn.textContent = 'Save Changes';
      submitBtn.disabled = false;
    }
  });
}

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadData() {
  try {
    // Only admin and coordinator roles can access /api/managed-projects
    // (backend returns 403 for all others — HR, staff etc)
    const canAccessManagedProjects = authUser.role === 'admin' || authUser.role === 'coordinator';

    const [projRes, csvProjRes, csvStaffRes] = await Promise.all([
      window.StaffTrackAuth.apiFetch('/api/reports/projects'),
      window.StaffTrackAuth.apiFetch('/api/catalog/projects'),
      window.StaffTrackAuth.apiFetch('/api/catalog/staff')
    ]);

    if (canAccessManagedProjects) {
      const managedRes = await window.StaffTrackAuth.apiFetch('/api/managed-projects');
      if (managedRes.ok) MANAGED_PROJECTS = await managedRes.json();
    }

    if (projRes.ok) API_PROJECTS = await projRes.json();
    if (csvProjRes.ok) ALL_PROJECTS_CSV = await csvProjRes.json();
    if (csvStaffRes.ok) STAFF_DATA = await csvStaffRes.json();

    render();
  } catch (err) {
    console.error('Failed to load data:', err);
    showToast('Failed to load projects', true);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  renderNav('projects');

  // If coordinator or admin, inject "Add New Project" button
  if (authUser.is_coordinator || authUser.role === 'admin' || authUser.role === 'coordinator') {
    const tbRight = document.querySelector('.view-toolbar-right');
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add';
    addBtn.style.marginRight = 'auto';
    addBtn.innerHTML = `＋ New Project`;
    addBtn.onclick = showCreateProjectModal;
    tbRight.prepend(addBtn);
  } else {
    // Hide assignment buttons if not a coordinator
    const style = document.createElement('style');
    style.textContent = '.btn-assign { display: none !important; }';
    document.head.appendChild(style);
  }

  await loadData();

  document.getElementById('toggle-empty').addEventListener('change', e => {
    hideEmpty = e.target.checked;
    render();
  });
  document.getElementById('proj-search').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    render();
  });
  document.getElementById('btn-export-projects').addEventListener('click', exportProjectsCSV);
}

document.addEventListener('DOMContentLoaded', init);
