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
        <a href="/catalog.html" class="nav-link">⚙️ Catalog</a>
        <a href="/system.html" class="nav-link active">💻 System</a>
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

// ── Import Logic ──────────────────────────────────────────────────────────────
async function handleImport(type, csv) {
    const btn = document.getElementById(`btn-do-import-${type}`);
    const statsCard = document.getElementById('import-stats-card');
    const resultsBody = document.getElementById('import-results-body');

    if (!btn) return;

    btn.disabled = true;
    btn.textContent = '⌛ Processing...';

    try {
        const res = await fetch(`/api/admin/import-${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ csv })
        });
        const data = await res.json();

        if (data.success) {
            showToast(`Import Success: ${data.count} added, ${data.skipped} skipped`);
            if (statsCard) statsCard.style.display = 'block';
            if (resultsBody) {
                resultsBody.innerHTML = `
                    <div style="color:var(--accent-blue);font-weight:600">Import Complete (${type})</div>
                    <div>✅ New records added: <b>${data.count}</b></div>
                    <div>⏭️ Duplicates skipped: <b>${data.skipped}</b></div>
                    <div style="margin-top:.5rem;font-size:.75rem">Caches refreshed. New data is now active.</div>
                `;
            }
        } else {
            throw new Error(data.error || 'Import failed');
        }
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Import & Update';
    }
}

// ── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    renderNav();

    // File Inputs
    const setupFile = (id, type) => {
        const input = document.getElementById(`file-import-${id}`);
        const info = document.getElementById(`${id}-file-info`);
        const btn = document.getElementById(`btn-do-import-${id}`);

        if (!input || !btn || !info) return;

        input.addEventListener('change', () => {
            if (input.files.length) {
                const f = input.files[0];
                info.textContent = `📄 ${f.name} (${(f.size / 1024).toFixed(1)} KB)`;
                btn.disabled = false;
            }
        });

        btn.addEventListener('click', () => {
            const reader = new FileReader();
            reader.onload = (e) => handleImport(id, e.target.result);
            reader.readAsText(input.files[0]);
        });
    };

    setupFile('staff', 'staff');
    setupFile('projects', 'projects');

    // Init Skill Consolidation
    initSkillConsolidation();
});

// ── Skill Consolidation Logic ─────────────────────────────────────────────────
let catalogSkills = [];

async function initSkillConsolidation() {
    await loadCatalogSkills();
    setupSkillActions();
}

async function loadCatalogSkills() {
    const tbody = document.getElementById('skills-catalog-tbody');
    if (!tbody) return;

    try {
        const res = await fetch('/api/admin/skills', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to load skills');
        catalogSkills = await res.json();
        renderCatalogSkills();
    } catch (e) {
        showToast(e.message, true);
        tbody.innerHTML = `<tr><td colspan="3" style="padding:1rem;color:var(--danger)">Error loading skills.</td></tr>`;
    }
}

function renderCatalogSkills() {
    const tbody = document.getElementById('skills-catalog-tbody');
    if (!tbody) return;

    if (!catalogSkills.length) {
        tbody.innerHTML = `<tr><td colspan="3" style="padding:1rem;color:var(--text-muted);text-align:center">No skills found.</td></tr>`;
        updateSkillButtons();
        return;
    }

    tbody.innerHTML = catalogSkills.map((s, i) => `
        <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:.5rem"><input type="checkbox" class="chk-skill" data-name="${s.name.replace(/"/g, '&quot;')}"></td>
            <td style="padding:.5rem;font-weight:500">${s.name}</td>
            <td style="padding:.5rem"><span class="skill-count-pill" style="display:inline-block;padding:.1rem .5rem;background:var(--bg-hover);border-radius:1rem;font-size:.75rem">${s.count}</span></td>
        </tr>
    `).join('');

    document.querySelectorAll('.chk-skill').forEach(chk => {
        chk.addEventListener('change', updateSkillButtons);
    });
    updateSkillButtons();
}

function getSelectedSkills() {
    return Array.from(document.querySelectorAll('.chk-skill:checked')).map(chk => chk.dataset.name);
}

function updateSkillButtons() {
    const sel = getSelectedSkills();
    const len = sel.length;
    document.getElementById('btn-rename-skill').disabled = (len !== 1);
    document.getElementById('btn-merge-skills').disabled = (len < 1); // Can technically "merge" 1 to itself/rename, but usually N>1
    document.getElementById('btn-split-skill').disabled = (len !== 1);
    document.getElementById('btn-delete-skill').disabled = (len !== 1);
}

function setupSkillActions() {
    document.getElementById('btn-rename-skill')?.addEventListener('click', async () => {
        const sel = getSelectedSkills();
        if (sel.length !== 1) return;
        const oldName = sel[0];
        const newName = prompt(`Rename "${oldName}" to:`, oldName);
        if (!newName || newName.trim() === '' || newName === oldName) return;

        try {
            const res = await fetch('/api/admin/skills/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ oldName, newName: newName.trim() })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Renamed "${oldName}" to "${newName}" (${data.affectedCount} submissions updated)`);
                loadCatalogSkills();
            } else throw new Error(data.error);
        } catch (e) {
            showToast(e.message, true);
        }
    });

    document.getElementById('btn-merge-skills')?.addEventListener('click', async () => {
        const sel = getSelectedSkills();
        if (sel.length < 1) return;
        const targetSkill = prompt(`Merge ${sel.length} skills into which canonical name?`, sel[0]);
        if (!targetSkill || targetSkill.trim() === '') return;

        if (!confirm(`Are you sure you want to merge:\n\n${sel.join('\n')}\n\nInto: "${targetSkill}"?`)) return;

        try {
            const res = await fetch('/api/admin/skills/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ targetSkill: targetSkill.trim(), sourceSkills: sel })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Merged into "${targetSkill}" (${data.affectedCount} specific skill updates made)`);
                loadCatalogSkills();
            } else throw new Error(data.error);
        } catch (e) {
            showToast(e.message, true);
        }
    });

    document.getElementById('btn-split-skill')?.addEventListener('click', async () => {
        const sel = getSelectedSkills();
        if (sel.length !== 1) return;
        const originalSkill = sel[0];

        const newSkillsStr = prompt(`Split "${originalSkill}" into multiple skills (comma separated):`);
        if (!newSkillsStr) return;

        const newSkills = newSkillsStr.split(',').map(s => s.trim()).filter(s => s);
        if (newSkills.length < 2) {
            showToast('Please provide at least two skills separated by commas.', true);
            return;
        }

        if (!confirm(`Are you sure you want to split "${originalSkill}" into:\n\n${newSkills.map(s => '- ' + s).join('\n')}\n?`)) return;

        try {
            const res = await fetch('/api/admin/skills/split', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ originalSkill, newSkills })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Split "${originalSkill}" into ${newSkills.length} skills (${data.affectedCount} specific instances updated)`);
                loadCatalogSkills();
            } else throw new Error(data.error);
        } catch (e) {
            showToast(e.message, true);
        }
    });

    document.getElementById('btn-delete-skill')?.addEventListener('click', async () => {
        const sel = getSelectedSkills();
        if (sel.length !== 1) return;
        const skillName = sel[0];
        if (!confirm(`Are you sure you want to DELETE all instances of "${skillName}"? This cannot be undone.`)) return;

        try {
            const res = await fetch('/api/admin/skills', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ skillName })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Deleted "${skillName}" (${data.deletedCount} instances removed)`);
                loadCatalogSkills();
            } else throw new Error(data.error);
        } catch (e) {
            showToast(e.message, true);
        }
    });
}
