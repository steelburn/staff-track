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
});
