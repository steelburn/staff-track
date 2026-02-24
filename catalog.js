'use strict';

const token = sessionStorage.getItem('st_token');
const userStr = sessionStorage.getItem('st_user');

if (!token || !userStr) {
    location.href = '/login.html';
    throw new Error('Not logged in');
}

let authUser;
try {
    authUser = JSON.parse(userStr);
    if (authUser.role !== 'admin') {
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
        <a href="/catalog.html" class="nav-link active">⚙️ Catalog</a>
        <a href="/system.html" class="nav-link">💻 System</a>
        <a href="/admin.html" class="nav-link">🛡️ Admin</a>
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
let catalogStaff = [];
let catalogProjects = [];
let activeTab = 'staff';
let catalogSearchQ = '';

async function loadData() {
    try {
        const [catStaffRes, catProjRes] = await Promise.all([
            fetch('/api/admin/catalog/staff', { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch('/api/admin/catalog/projects', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);

        if (catStaffRes.ok) catalogStaff = await catStaffRes.json();
        if (catProjRes.ok) catalogProjects = await catProjRes.json();

        renderCatalog();
    } catch (err) {
        console.error('Failed to load catalog data:', err);
        showToast('Failed to load data', true);
    }
}

// ── Catalog Management ────────────────────────────────────────────────────────
function renderCatalog() {
    const q = catalogSearchQ.toLowerCase();

    if (activeTab === 'staff') {
        document.getElementById('catalog-staff-view').style.display = 'block';
        document.getElementById('catalog-projects-view').style.display = 'none';

        const tbody = document.getElementById('catalog-staff-tbody');
        let list = catalogStaff;
        if (q) {
            list = list.filter(s => (s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q));
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
                <td><button class="btn-danger" style="padding:.25rem .5rem;font-size:.7rem" onclick="deleteStaff('${s.email}')">Remove</button></td>
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

        if (!list.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="table-empty">Catalog is empty.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(p => `
            <tr>
                <td>${p.soc || '—'}</td>
                <td>${p.project_name}</td>
                <td>${p.customer}</td>
                <td><button class="btn-danger" style="padding:.25rem .5rem;font-size:.7rem" onclick="deleteProject('${p.id}')">Remove</button></td>
            </tr>
        `).join('');
    }
}

async function deleteStaff(email) {
    if (!confirm(`Delete ${email} from staff catalog?`)) return;
    try {
        const res = await fetch(`/api/admin/staff/${encodeURIComponent(email)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            catalogStaff = catalogStaff.filter(s => s.email !== email);
            renderCatalog();
            showToast('Staff removed from catalog');
        }
    } catch (e) { showToast('Delete failed', true); }
}

async function deleteProject(id) {
    if (!confirm('Delete this project from catalog?')) return;
    try {
        const res = await fetch(`/api/admin/projects/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
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
    renderNav();
    loadData();

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
});

// Expose globals for onclick handlers
window.deleteStaff = deleteStaff;
window.deleteProject = deleteProject;
