'use strict';

const token = sessionStorage.getItem('st_token');
const userStr = sessionStorage.getItem('st_user');

if (!token || !userStr) {
    location.href = '/login.html';
    throw new Error('Not logged in');
}

let user;
try {
    user = JSON.parse(userStr);
    if (user.role !== 'admin') {
        location.href = '/'; // kick non-admins out
        throw new Error('Not admin');
    }
} catch {
    location.href = '/login.html';
}

// ── Navigation ───────────────────────────────────────────────────────────────
function renderNav() {
    const nav = document.getElementById('main-nav');
    if (!nav) return;

    let html = `
        <a href="/projects.html" class="nav-link">🗂 Projects</a>
        <a href="/skills.html" class="nav-link">📊 Skills</a>
        <a href="/orgchart.html" class="nav-link">🌳 Org Chart</a>
        <a href="/staff-view.html" class="nav-link">👥 All Staff</a>
        <a href="/catalog.html" class="nav-link">⚙️ Catalog</a>
        <a href="/system.html" class="nav-link">💻 System</a>
        <a href="/admin.html" class="nav-link active">🛡️ Admin</a>
    `;
    nav.innerHTML = html;
}

document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.clear();
    location.href = '/login.html';
});

// ── Helper ───────────────────────────────────────────────────────────────────
function showToast(msg, isErr = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' toast-err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 400); }, 2800);
}

// ── Data ──────────────────────────────────────────────────────────────────────
let staffData = [];
let roleOverrides = new Map(); // email -> { is_hr, is_coordinator }

async function loadData() {
    try {
        const [staffRes, rolesRes] = await Promise.all([
            fetch('/api/catalog/staff'),
            fetch('/api/admin/roles', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);

        if (staffRes.ok) staffData = await staffRes.json();

        if (rolesRes.ok) {
            const overrides = await rolesRes.json();
            overrides.forEach(r => {
                roleOverrides.set(r.email.toLowerCase(), {
                    is_hr: !!r.is_hr,
                    is_coordinator: !!r.is_coordinator
                });
            });
        }

        renderRoles();
    } catch (err) {
        console.error('Failed to load admin data:', err);
        showToast('Failed to load data', true);
    }
}

// ── Role Management ───────────────────────────────────────────────────────────
let roleSearchQ = '';
function renderRoles() {
    const tbody = document.getElementById('admin-tbody');
    if (!tbody) return;

    let list = staffData;
    const q = roleSearchQ.toLowerCase();

    if (q) {
        list = list.filter(s =>
            (s.name || '').toLowerCase().includes(q) ||
            (s.title || '').toLowerCase().includes(q) ||
            (s.email || '').toLowerCase().includes(q)
        );
    }

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="table-empty">No matching staff found.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((s, i) => {
        const email = (s.email || '').toLowerCase();
        if (!email) return '';
        const role = roleOverrides.get(email) || { is_hr: false, is_coordinator: false };

        return `<tr data-email="${email}">
          <td style="font-weight:600">${s.name}</td>
          <td style="color:var(--text-secondary);font-size:.85rem">${s.title || '—'}</td>
          <td style="color:var(--text-secondary);font-size:.85rem">${s.email}</td>
          <td style="text-align:center"><input type="checkbox" class="cb-hr" ${role.is_hr ? 'checked' : ''}></td>
          <td style="text-align:center"><input type="checkbox" class="cb-coord" ${role.is_coordinator ? 'checked' : ''}></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
        const email = tr.dataset.email;
        const cbHr = tr.querySelector('.cb-hr');
        const cbCoord = tr.querySelector('.cb-coord');

        const onChange = () => updateRole(email, cbHr.checked, cbCoord.checked);
        cbHr?.addEventListener('change', onChange);
        cbCoord?.addEventListener('change', onChange);
    });
}

async function updateRole(email, is_hr, is_coordinator) {
    try {
        const res = await fetch('/api/admin/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ email, is_hr, is_coordinator })
        });
        if (!res.ok) throw new Error('Save failed');
        roleOverrides.set(email, { is_hr, is_coordinator });
        showToast(`Saved roles for ${email} ✓`);
    } catch (err) {
        showToast('Failed to update role', true);
        renderRoles();
    }
}

// ── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    renderNav();
    loadData();

    // Roles Search
    const adminSearch = document.getElementById('admin-search');
    if (adminSearch) {
        adminSearch.addEventListener('input', e => {
            roleSearchQ = e.target.value.trim();
            renderRoles();
        });
    }
});
