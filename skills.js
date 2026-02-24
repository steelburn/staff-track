'use strict';

const token = sessionStorage.getItem('st_token');
const userStr = sessionStorage.getItem('st_user');
if (!token || !userStr) {
    location.href = '/login.html';
    throw new Error('Not logged in');
}
const authUser = JSON.parse(userStr);

// Security Check: Only Admin, HR, Coordinator
if (authUser.role !== 'admin' && !authUser.is_hr && !authUser.is_coordinator && authUser.role !== 'hr' && authUser.role !== 'coordinator') {
    location.href = '/';
    throw new Error('Unauthorized');
}

function renderNav(activeTab) {
    const nav = document.getElementById('main-nav');
    if (!nav) return;

    let html = '';
    if (authUser.role !== 'admin') html += `<a href="/" class="nav-link ${activeTab === 'my' ? 'active' : ''}">📝 My Submission</a>`;

    html += `<a href="/projects.html" class="nav-link ${activeTab === 'projects' ? 'active' : ''}">🗂 Projects</a>`;
    html += `<a href="/skills.html" class="nav-link ${activeTab === 'skills' ? 'active' : ''}">📊 Skills</a>`;

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

// ── Data ──────────────────────────────────────────────────────────────────────
let SKILLS_DATA = [];

// ── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    renderNav('skills');
    await loadSkills();

    const searchInput = document.getElementById('skill-search');
    searchInput.addEventListener('input', (e) => {
        renderSkills(e.target.value);
    });
});

async function loadSkills() {
    try {
        const res = await fetch('/api/reports/skills', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to load skills');
        SKILLS_DATA = await res.json();
        renderSkills();
    } catch (e) {
        console.error(e);
        document.getElementById('skills-grid').innerHTML = `<p class="grid-empty">Error loading skills report.</p>`;
    }
}

function renderSkills(q = '') {
    const grid = document.getElementById('skills-grid');
    const countEl = document.getElementById('skills-count');
    const ql = q.toLowerCase();

    const filtered = SKILLS_DATA.filter(item =>
        item.skill.toLowerCase().includes(ql) ||
        item.staff.some(s => s.name.toLowerCase().includes(ql))
    );

    countEl.textContent = `${filtered.length} unique skill${filtered.length !== 1 ? 's' : ''} found`;

    if (!filtered.length) {
        grid.innerHTML = `<p class="grid-empty">${q ? 'No matching skills found.' : 'No skills data available.'}</p>`;
        return;
    }

    grid.innerHTML = filtered.map(item => `
        <div class="skill-group-card">
            <div class="skill-group-header">
                <h3>${hl(item.skill, q)}</h3>
                <span class="skill-count-pill">${item.staff.length} staff</span>
            </div>
            <div class="skill-staff-list">
                ${item.staff.map(s => `
                    <div class="skill-staff-row">
                        <div class="staff-info">
                            <span class="staff-name">${hl(s.name, q)}</span>
                            <span class="staff-meta">${s.title} • ${s.department}</span>
                        </div>
                        <div class="staff-rating">
                            ${renderStars(s.rating)}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function renderStars(rating) {
    let html = '<div class="star-rating-static">';
    for (let i = 1; i <= 5; i++) {
        html += `<span class="star ${i <= rating ? 'on' : ''}">★</span>`;
    }
    html += '</div>';
    return html;
}

function hl(text, q) {
    if (!q || !text) return text || '';
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return text;
    return text.slice(0, i) + `<mark>${text.slice(i, i + q.length)}</mark>` + text.slice(i + q.length);
}
