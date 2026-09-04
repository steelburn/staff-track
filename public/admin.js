'use strict';

const authUser = requireAuth();
requireAdmin(authUser);


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
            window.StaffTrackAuth.apiFetch('/api/catalog/staff'),
            window.StaffTrackAuth.apiFetch('/api/admin/roles')
        ]);

        if (staffRes.ok) staffData = await staffRes.json();

        if (rolesRes.ok) {
            const overrides = await rolesRes.json();
            overrides.forEach(r => {
                roleOverrides.set(r.email.toLowerCase(), {
                    is_admin: r.role === 'admin',
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
        tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No matching staff found.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((s, i) => {
        const email = (s.email || '').toLowerCase();
        if (!email) return '';
        const role = roleOverrides.get(email) || { is_admin: false, is_hr: false, is_coordinator: false };

        return `<tr data-email="${email}">
          <td style="font-weight:600">${s.name}</td>
          <td style="color:var(--text-secondary);font-size:.85rem">${s.title || '—'}</td>
          <td style="color:var(--text-secondary);font-size:.85rem">${s.email}</td>
          <td style="text-align:center"><input type="checkbox" class="cb-admin" ${role.is_admin ? 'checked' : ''}></td>
          <td style="text-align:center"><input type="checkbox" class="cb-hr" ${role.is_hr ? 'checked' : ''}></td>
          <td style="text-align:center"><input type="checkbox" class="cb-coord" ${role.is_coordinator ? 'checked' : ''}></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
        const email = tr.dataset.email;
        const cbAdmin = tr.querySelector('.cb-admin');
        const cbHr = tr.querySelector('.cb-hr');
        const cbCoord = tr.querySelector('.cb-coord');

        const onChange = () => updateRole(email, cbAdmin.checked, cbHr.checked, cbCoord.checked);
        cbAdmin?.addEventListener('change', onChange);
        cbHr?.addEventListener('change', onChange);
        cbCoord?.addEventListener('change', onChange);
    });
}

async function updateRole(email, is_admin, is_hr, is_coordinator) {
    try {
        // Determine the primary role string based on flags
        // Priority: admin > hr > coordinator > staff
        let role = 'staff';
        if (is_admin) {
            role = 'admin';
        } else if (is_hr) {
            role = 'hr';
        } else if (is_coordinator) {
            role = 'coordinator';
        }

        // Send both the role string AND the boolean flags to the backend
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, role, is_hr, is_coordinator, is_active: true })
        });
        if (!res.ok) throw new Error('Save failed');
        roleOverrides.set(email, { is_admin, is_hr, is_coordinator });
        showToast(`Saved roles for ${email} ✓`);
    } catch (err) {
        showToast('Failed to update role', true);
        renderRoles();
    }
}

// ── API Tokens Oversight ──────────────────────────────────────────────────────
let adminTokens = [];
let adminTokenSearchQ = '';

function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(String(v).replace(' ', 'T'));
    return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadAdminTokens() {
    const tbody = document.getElementById('api-admin-tbody');
    const countEl = document.getElementById('api-admin-count');
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/api-tokens/admin/all');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const { tokens } = await res.json();
        adminTokens = tokens;
        const active = tokens.filter(t => !t.revokedAt).length;
        if (countEl) countEl.textContent = active + ' active / ' + tokens.length + ' total (last 500)';
        renderAdminTokens();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="8" style="color:var(--color-danger);">Failed to load tokens: ' + esc(err.message) + '</td></tr>';
        if (countEl) countEl.textContent = 'Failed to load';
    }
}

function renderAdminTokens() {
    const tbody = document.getElementById('api-admin-tbody');
    const q = adminTokenSearchQ.toLowerCase();
    const rows = adminTokens.filter(t =>
        !q || t.user_email.toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q)
    );
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="color:var(--color-text-muted); text-align:center; padding: var(--space-5);">No tokens match.</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(t => {
        const scopeBadge = t.readOnly ? '<span class="badge badge-info">Read-only</span>' : '<span class="badge badge-success">Full</span>';
        const status = t.revokedAt
            ? '<span class="badge badge-neutral">Revoked ' + esc(fmtDate(t.revokedAt)) + '</span>'
            : (t.expiresAt && new Date(String(t.expiresAt).replace(' ', 'T')).getTime() < Date.now()
                ? '<span class="badge badge-danger">Expired</span>'
                : '<span class="badge badge-success">Active</span>');
        const canRevoke = !t.revokedAt && (!t.expiresAt || new Date(String(t.expiresAt).replace(' ', 'T')).getTime() >= Date.now());
        return `<tr data-id="${esc(t.id)}" data-email="${esc(t.user_email)}">
            <td>${esc(t.name)}</td>
            <td>${esc(t.user_email)}</td>
            <td>${scopeBadge}</td>
            <td>${esc(fmtDate(t.createdAt))}</td>
            <td>${t.expiresAt ? esc(fmtDate(t.expiresAt)) : '<span class="badge badge-neutral">Never</span>'}</td>
            <td>${esc(fmtDate(t.lastUsedAt))}</td>
            <td>${status}</td>
            <td style="text-align:right;">
                <button class="btn btn-danger btn-sm api-admin-revoke" ${canRevoke ? '' : 'disabled'}>Force revoke</button>
            </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.api-admin-revoke').forEach(btn => {
        btn.addEventListener('click', async () => {
            const tr = btn.closest('tr');
            const id = tr.dataset.id;
            const email = tr.dataset.email;
            const name = tr.querySelector('td').textContent.trim();
            if (!confirm('Force-revoke token "' + name + '" owned by ' + email + '?')) return;
            const res = await window.StaffTrackAuth.apiFetch('/api/api-tokens/admin/' + id, { method: 'DELETE' });
            if (res.ok) {
                showToast('Token force-revoked');
                loadAdminTokens();
            } else {
                const data = await res.json().catch(() => ({}));
                showToast('Revoke failed: ' + (data.error || res.status), true);
            }
        });
    });
}

// ── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Initialize sidebar navigation
    if (typeof renderSidebarNav === 'function') {
        renderSidebarNav('admin');
    } else if (typeof renderNav === 'function') {
        renderNav();
    }
    // Initialize theme toggle
    if (typeof ThemeManager !== 'undefined') {
        ThemeManager.updateToggleButtons();
    }
    // Initialize toast
    if (typeof Toast !== 'undefined') {
        Toast.init();
    }
    loadData();
    loadAdminTokens();

    // API token search + refresh
    const apiAdminSearch = document.getElementById('api-admin-search');
    if (apiAdminSearch) {
        apiAdminSearch.addEventListener('input', e => {
            adminTokenSearchQ = e.target.value.trim();
            renderAdminTokens();
        });
    }
    const apiAdminRefresh = document.getElementById('api-admin-refresh');
    if (apiAdminRefresh) {
        apiAdminRefresh.addEventListener('click', loadAdminTokens);
    }

    // Roles Search
    const adminSearch = document.getElementById('admin-search');
    if (adminSearch) {
        adminSearch.addEventListener('input', e => {
            roleSearchQ = e.target.value.trim();
            renderRoles();
        });
    }
});
