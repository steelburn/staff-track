'use strict';

const token = sessionStorage.getItem('st_token');
const userStr = sessionStorage.getItem('st_user');
if (!token || !userStr) {
    location.href = '/login.html';
    throw new Error('Not logged in');
}
const authUser = JSON.parse(userStr);

function renderNav(activeTab) {
    const nav = document.getElementById('main-nav');
    if (!nav) return;

    let html = '';
    if (authUser.role !== 'admin') html += `<a href="/" class="nav-link ${activeTab === 'my' ? 'active' : ''}">📝 My Submission</a>`;

    html += `<a href="/projects.html" class="nav-link ${activeTab === 'projects' ? 'active' : ''}">🗂 Projects</a>`;

    if (authUser.role === 'admin' || authUser.is_hr || authUser.role === 'hr' || authUser.is_coordinator || authUser.role === 'coordinator') {
        html += `<a href="/skills.html" class="nav-link ${activeTab === 'skills' ? 'active' : ''}">📊 Skills</a>`;
    }

    html += `<a href="/orgchart.html" class="nav-link ${activeTab === 'orgchart' ? 'active' : ''}">🌳 Org Chart</a>`;

    if (authUser.role === 'admin' || authUser.is_hr || authUser.role === 'hr') {
        html += `<a href="/staff-view.html" class="nav-link ${activeTab === 'staff' ? 'active' : ''}">👥 All Staff</a>`;
    }
    if (authUser.role === 'admin') {
        html += `<a href="/catalog.html" class="nav-link ${activeTab === 'catalog' ? 'active' : ''}">⚙️ Catalog</a>`;
        html += `<a href="/system.html" class="nav-link ${activeTab === 'system' ? 'active' : ''}">💻 System</a>`;
        html += `<a href="/admin.html" class="nav-link">🛡️ Admin</a>`;
    }

    html += `<div style="margin-left:auto;display:flex;align-items:center;gap:1rem">
      <span style="font-size:0.8rem;color:var(--text-secondary)">${authUser.email}</span>
      <button class="btn-secondary" id="btn-logout" style="padding:.3rem .6rem;font-size:0.75rem">Logout</button>
    </div>`;
    nav.innerHTML = html;

    document.getElementById('btn-logout')?.addEventListener('click', () => {
        sessionStorage.clear();
        location.href = '/login.html';
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    renderNav('orgchart');
    await initChart();
});

async function initChart() {
    try {
        const res = await fetch('/api/catalog/staff', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to load staff data');
        const staff = await res.json();

        const treeData = buildHierarchy(staff);

        $('#chart-container').orgchart({
            'data': treeData,
            'nodeContent': 'title',
            'pan': true,
            'zoom': true,
            'nodeId': 'id',
            'depth': 4,
            'verticalLevel': 3
        });
    } catch (e) {
        console.error(e);
        document.getElementById('chart-container').innerHTML = `<p class="grid-empty">Error loading organization chart.</p>`;
    }
}

function buildHierarchy(staff) {
    // Map of all employees for quick lookup by name (using manager_name which is name-based in catalog)
    const map = new Map();
    staff.forEach(s => {
        const node = {
            id: s.email,
            name: s.name,
            title: s.title || '',
            children: []
        };
        map.set(s.name, node);
    });

    let root = null;
    const roots = [];

    staff.forEach(s => {
        const node = map.get(s.name);
        if (s.manager_name && map.has(s.manager_name)) {
            const parent = map.get(s.manager_name);
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    });

    // If multiple roots (e.g. silos), wrap them under a virtual CEO
    if (roots.length > 1) {
        return {
            name: 'StaffTrack Org',
            title: 'Top Level',
            className: 'root-node',
            children: roots
        };
    }

    return roots[0] || { name: 'Empty', title: 'No data' };
}
