'use strict';

const token = sessionStorage.getItem('st_token');
const userStr = sessionStorage.getItem('st_user');
if (!token || !userStr) {
    location.href = '/login.html';
    throw new Error('Not logged in');
}
const authUser = JSON.parse(userStr);

function renderNav(activeTab) {
    const nav = document.querySelector('.app-nav');
    if (!nav) return;

    let html = '';
    if (authUser.role !== 'admin') html += `<a href="/" class="nav-link ${activeTab === 'my' ? 'active' : ''}">📝 My Submission</a>`;

    html += `<a href="/projects.html" class="nav-link ${activeTab === 'projects' ? 'active' : ''}">🗂 Projects</a>`;
    if (authUser.role === 'admin' || authUser.is_hr || authUser.is_coordinator || authUser.role === 'hr' || authUser.role === 'coordinator') {
        html += `<a href="/skills.html" class="nav-link ${activeTab === 'skills' ? 'active' : ''}">📊 Skills</a>`;
    }

    if (authUser.role === 'admin' || authUser.is_hr || authUser.role === 'hr') {
        html += `<a href="/staff-view.html" class="nav-link ${activeTab === 'staff' ? 'active' : ''}">👥 All Staff</a>`;
    }
    if (authUser.role === 'admin') html += `<a href="/admin.html" class="nav-link">⚙️ Admin</a>`;

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
let STAFF_REPORT = []; // from /api/reports/staff

// ── Utility ───────────────────────────────────────────────────────────────────
function hl(text, q) {
    if (!q || !text) return text || '';
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return text;
    return text.slice(0, i) + `<mark>${text.slice(i, i + q.length)}</mark>` + text.slice(i + q.length);
}

function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportStaffCSV() {
    const rows = [
        ['Name', 'Title', 'Department', 'Email', 'Project Count', 'Projects (SOC)', 'Project Names', 'Roles', 'End Dates', 'Skill Count', 'Skills'],
    ];
    STAFF_REPORT.forEach(s => {
        rows.push([
            s.staffName,
            s.title,
            s.department,
            s.email,
            s.projects.length,
            s.projects.map(p => p.soc || '').join(' | '),
            s.projects.map(p => p.projectName || '').join(' | '),
            s.projects.map(p => p.role || '').join(' | '),
            s.projects.map(p => p.endDate || '').join(' | '),
            s.skills.length,
            s.skills.map(sk => `${sk.skill}(${sk.rating}★)`).join(' | '),
        ]);
    });
    const content = rows.map(r =>
        r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob([content], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'stafftrack-all-staff.csv';
    a.click();
    URL.revokeObjectURL(a.href);
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable(q = '') {
    const ql = q.toLowerCase();
    const countEl = document.getElementById('staff-count');
    const tbody = document.getElementById('staff-tbody');
    const panel = document.getElementById('staff-detail-panel');
    panel.style.display = 'none';

    let list = STAFF_REPORT;
    if (ql) {
        list = list.filter(s =>
            s.staffName.toLowerCase().includes(ql) ||
            s.department.toLowerCase().includes(ql) ||
            s.title.toLowerCase().includes(ql) ||
            s.projects.some(p =>
                (p.projectName || '').toLowerCase().includes(ql) ||
                (p.soc || '').toLowerCase().includes(ql)
            )
        );
    }

    countEl.textContent = `${list.length} staff member${list.length !== 1 ? 's' : ''}`;

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="table-empty">${q ? 'No results for "' + q + '"' : 'No submissions yet.'}</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((s, i) => {
        const projLabels = s.projects.length
            ? s.projects.slice(0, 3).map(p =>
                `<span class="proj-pill">${hl(p.soc || p.projectName || '—', q)}</span>`
            ).join('') + (s.projects.length > 3 ? `<span class="proj-pill muted">+${s.projects.length - 3} more</span>` : '')
            : `<span style="color:var(--text-muted);font-size:.8rem">—</span>`;

        const skillCount = s.skills.length
            ? `<span class="skill-count-pill">${s.skills.length} skill${s.skills.length !== 1 ? 's' : ''}</span>`
            : `<span style="color:var(--text-muted);font-size:.8rem">—</span>`;

        return `<tr class="staff-row" data-idx="${i}" title="Click for details" style="cursor:pointer">
      <td><span class="staff-name-cell">${hl(s.staffName, q)}</span></td>
      <td><span style="font-size:.82rem;color:var(--text-secondary)">${hl(s.title, q) || '—'}</span></td>
      <td><span style="font-size:.82rem;color:var(--text-secondary)">${hl(s.department, q) || '—'}</span></td>
      <td><div class="proj-pills">${projLabels}</div></td>
      <td>${skillCount}</td>
      <td><span style="font-size:.78rem;color:var(--text-muted)">${formatDate(s.updatedAt)}</span></td>
    </tr>`;
    }).join('');

    tbody.querySelectorAll('.staff-row').forEach(row => {
        row.addEventListener('click', () => {
            const s = list[+row.dataset.idx];
            showDetailPanel(s, q);
        });
    });
}

function showDetailPanel(s, q = '') {
    const panel = document.getElementById('staff-detail-panel');
    document.getElementById('detail-name').textContent = s.staffName;

    const projects = s.projects.length
        ? `<table class="report-table" style="margin-top:.5rem">
        <thead><tr><th>SOC</th><th>Project</th><th>Customer</th><th>Role</th><th>End Date</th></tr></thead>
        <tbody>${s.projects.map(p => {
            let cLabels = '';
            if (p.type_infra) cLabels += '<span class="proj-class-badge infra" style="margin-left:4px">Infra</span>';
            if (p.type_software) cLabels += '<span class="proj-class-badge software" style="margin-left:4px">Software</span>';
            if (p.type_infra_support) cLabels += '<span class="proj-class-badge isupport" style="margin-left:4px">Infra Support</span>';
            if (p.type_software_support) cLabels += '<span class="proj-class-badge ssupport" style="margin-left:4px">Software Support</span>';

            return `
          <tr>
            <td>${p.soc ? `<span class="soc-badge">${p.soc}</span>` : '—'}</td>
            <td>${p.projectName || '—'} ${cLabels}</td>
            <td style="color:var(--text-secondary);font-size:.82rem">${p.customer || '—'}</td>
            <td style="color:var(--text-secondary);font-size:.82rem">${p.role || '—'}</td>
            <td style="color:var(--text-secondary);font-size:.82rem">${p.endDate || '—'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`
        : `<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0">No projects assigned.</p>`;

    const skills = s.skills.length
        ? `<div class="skill-badges">${s.skills.map(sk =>
            `<span class="skill-badge">${sk.skill} <span class="skill-stars">${'★'.repeat(sk.rating)}${'☆'.repeat(5 - sk.rating)}</span></span>`
        ).join('')}</div>`
        : `<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0">No skills listed.</p>`;

    document.getElementById('detail-body').innerHTML = `
    <div class="detail-meta">
      <span>${s.title || '—'}</span>
      <span class="separator">·</span>
      <span>${s.department || '—'}</span>
      ${s.email ? `<span class="separator">·</span><a href="mailto:${s.email}" style="color:var(--accent-blue)">${s.email}</a>` : ''}
    </div>
    <h4 style="margin:.75rem 0 .25rem;font-size:.82rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em">Projects (${s.projects.length})</h4>
    ${projects}
    <h4 style="margin:.75rem 0 .25rem;font-size:.82rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em">Skills (${s.skills.length})</h4>
    ${skills}`;

    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    renderNav('staff');
    try {
        const res = await fetch('/api/reports/staff');
        if (res.ok) STAFF_REPORT = await res.json();
    } catch (e) { console.error('Failed to load staff report', e); }

    renderTable();

    document.getElementById('staff-search').addEventListener('input', e => {
        renderTable(e.target.value.trim());
    });

    document.getElementById('btn-export-staff').addEventListener('click', exportStaffCSV);

    document.getElementById('detail-close').addEventListener('click', () => {
        document.getElementById('staff-detail-panel').style.display = 'none';
    });
}

document.addEventListener('DOMContentLoaded', init);
