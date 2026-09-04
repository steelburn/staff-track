'use strict';

const authUser = requireAuth();

// ── Role model ─────────────────────────────────────────────────────────────────
const isAdmin = authUser.isAdmin === true;
const isHR = authUser.is_hr === true || authUser.is_hr === 1;
const isCoord = authUser.is_coordinator === true || authUser.is_coordinator === 1;
const hasFullAccess = isAdmin || isHR || isCoord;
const subordinateCount = parseInt(sessionStorage.getItem('st_subordinate_count') || '0', 10);
const isManager = hasFullAccess || subordinateCount > 0;

// ── Toast / modal helpers ──────────────────────────────────────────────────────
function toast(title, isErr) {
    if (typeof Toast !== 'undefined') {
        Toast.show({ type: isErr ? 'error' : 'success', title, closable: true });
    } else {
        alert(title);
    }
}
function openModal(id) { closeModal(); const el = document.getElementById(id); if (el) el.classList.add('active'); }
function closeModal() { document.querySelectorAll('.modal-backdrop.active').forEach(el => el.classList.remove('active')); }
function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(String(v).replace(' ', 'T'));
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Endpoint catalog ───────────────────────────────────────────────────────────
// roles: all | full | admin | hr | manager (manager = has subordinates or full)
const ENDPOINTS = [
    { id: 'feeds-me', label: 'My record — /api/feeds/me', method: 'GET', path: '/api/feeds/me', roles: 'all', kind: 'feed', filterable: [], sortable: [], feedDefaultSort: '' },
    { id: 'feeds-staff', label: 'Staff directory — /api/feeds/staff', method: 'GET', path: '/api/feeds/staff', roles: 'full,manager', kind: 'feed', filterable: ['department', 'manager_name', 'active'], sortable: ['name', 'email', 'department'], feedDefaultSort: 'name' },
    { id: 'feeds-projects', label: 'Projects — /api/feeds/projects', method: 'GET', path: '/api/feeds/projects', roles: 'full,manager', kind: 'feed', filterable: ['customer', 'soc', 'project_name'], sortable: ['project_name', 'customer', 'soc', 'end_date'], feedDefaultSort: 'project_name' },
    { id: 'feeds-skills', label: 'Skills (latest per person) — /api/feeds/skills', method: 'GET', path: '/api/feeds/skills', roles: 'full,manager', kind: 'feed', filterable: ['skill'], sortable: ['skill', 'email', 'rating'], feedDefaultSort: 'skill' },
    { id: 'feeds-certs', label: 'Certifications — /api/feeds/certifications', method: 'GET', path: '/api/feeds/certifications', roles: 'admin,hr', kind: 'feed', filterable: ['email', 'name', 'issuer', 'status'], sortable: ['email', 'name', 'issuer', 'expiry_date'], feedDefaultSort: 'email' },
    { id: 'feeds-summary', label: 'Org summary KPIs — /api/feeds/summary', method: 'GET', path: '/api/feeds/summary', roles: 'full,manager', kind: 'feed', filterable: [], sortable: [], feedDefaultSort: '' },
    { id: 'reports-mine', label: 'My subordinates — /api/reports/my-subordinates', method: 'GET', path: '/api/reports/my-subordinates', roles: 'manager', kind: 'simple' },
    { id: 'catalog-staff', label: 'Staff catalog — /api/catalog/staff', method: 'GET', path: '/api/catalog/staff', roles: 'admin,hr', kind: 'simple' },
];
const visibleEndpoints = ENDPOINTS.filter(ep => {
    const need = ep.roles.split(',');
    const have = [];
    if (isAdmin) have.push('admin');
    if (isHR) have.push('hr');
    if (hasFullAccess) have.push('full');
    if (isManager) have.push('manager');
    return need.some(r => have.includes(r));
});

// ── My Tokens ──────────────────────────────────────────────────────────────────
let lastSecret = null;   // only lives in memory right after creation

async function loadTokens() {
    const tbody = document.getElementById('api-token-tbody');
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/api-tokens');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const { tokens } = await res.json();
        const hint = document.getElementById('token-count-hint');
        if (hint) hint.textContent = tokens.length + ' / 20 active token' + (tokens.length === 1 ? '' : 's');
        renderTokens(tokens);
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--color-danger);">Failed to load tokens: ' + esc(err.message) + '</td></tr>';
    }
}

function renderTokens(tokens) {
    const tbody = document.getElementById('api-token-tbody');
    if (tokens.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--color-text-muted); text-align:center; padding: var(--space-5);">No active tokens. Create one above to call the API from scripts, cron jobs, or Power BI.</td></tr>';
        return;
    }
    tbody.innerHTML = tokens.map(t => {
        const scopeBadge = t.readOnly
            ? '<span class="badge badge-info">Read-only</span>'
            : '<span class="badge badge-success">Full access</span>';
        const expiring = t.expiresAt && new Date(String(t.expiresAt).replace(' ', 'T')).getTime() - Date.now() < 30 * 86400e3;
        const expiry = t.expiresAt
            ? (expiring ? '<span class="badge badge-warning">' + esc(fmtDate(t.expiresAt)) + '</span>' : esc(fmtDate(t.expiresAt)))
            : '<span class="badge badge-neutral">Never</span>';
        const fresh = lastSecret && t.id === lastSecret.id ? '<span class="badge badge-success">New</span> ' : '';
        return `<tr data-id="${esc(t.id)}">
            <td>${fresh}${esc(t.name)}</td>
            <td><span style="font-family:monospace;">${esc(t.mask)}</span></td>
            <td>${scopeBadge}</td>
            <td>${esc(fmtDate(t.createdAt))}</td>
            <td>${expiry}</td>
            <td>${esc(fmtDate(t.lastUsedAt))}</td>
            <td style="text-align:right; white-space:nowrap;">
                <button class="btn btn-ghost btn-sm tok-copy-curl" ${lastSecret && t.id === lastSecret.id ? '' : 'disabled'}>Copy cURL</button>
                <button class="btn btn-danger btn-sm tok-revoke">Revoke</button>
            </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.tok-revoke').forEach(btn => {
        btn.addEventListener('click', async () => {
            const tr = btn.closest('tr');
            const id = tr.dataset.id;
            const name = tr.querySelector('td').textContent.trim();
            if (!confirm('Revoke token "' + name + '"? Any script using it will stop working immediately.')) return;
            const res = await window.StaffTrackAuth.apiFetch('/api/api-tokens/' + id, { method: 'DELETE' });
            if (res.ok) {
                toast('Token revoked');
                if (lastSecret && lastSecret.id === id) lastSecret = null;
                loadTokens();
            } else {
                const data = await res.json().catch(() => ({}));
                toast('Revoke failed: ' + (data.error || res.status), true);
            }
        });
    });
    tbody.querySelectorAll('.tok-copy-curl').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!lastSecret) return;
            copyText('curl -H "Authorization: Bearer ' + lastSecret.token + '" ' + location.origin + '/api/feeds/me');
        });
    });
}

function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard')).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}
function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Copied to clipboard');
}

async function createToken() {
    const name = document.getElementById('tok-name').value.trim();
    const scope = document.querySelector('input[name="tok-scope"]:checked').value;
    const expirySel = document.getElementById('tok-expiry').value;
    if (!name) { toast('Please name your token', true); return; }
    const body = {
        name,
        readOnly: scope === 'read',
        expiresInDays: expirySel === 'never' ? null : parseInt(expirySel, 10),
    };
    const btn = document.getElementById('tok-create');
    btn.disabled = true;
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/api-tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        lastSecret = { id: data.id, token: data.token };
        document.getElementById('reveal-secret').value = data.token;
        openModal('reveal-modal');
        document.getElementById('tok-name').value = '';
        toast('Token created');
        loadTokens();
    } catch (err) {
        toast('Create failed: ' + err.message, true);
    } finally {
        btn.disabled = false;
    }
}

// ── Console ────────────────────────────────────────────────────────────────────
let activeEndpoint = visibleEndpoints[0] || null;
let filterRowCounter = 0;

function renderEndpointSelect() {
    const sel = document.getElementById('con-endpoint');
    sel.innerHTML = visibleEndpoints.map(ep => `<option value="${ep.id}">${esc(ep.label)}</option>`).join('');
    sel.addEventListener('change', () => onEndpointChange(visibleEndpoints.find(e => e.id === sel.value)));
}

function onEndpointChange(ep) {
    activeEndpoint = ep;
    const feedBox = document.getElementById('con-feed-controls');
    feedBox.style.display = ep.kind === 'feed' ? '' : 'none';
    document.getElementById('con-filter-rows').innerHTML = '';
    const sortSel = document.getElementById('con-sort');
    sortSel.innerHTML = (ep.sortable || []).map(c => `<option value="${c}">${c}</option>`).join('') || '<option value="">—</option>';
    if (ep.feedDefaultSort) sortSel.value = ep.feedDefaultSort;
    document.getElementById('con-fields').value = '';
    updateUrlPreview();
}

function addFilterRow() {
    const ep = activeEndpoint;
    if (!ep || ep.kind !== 'feed') return;
    filterRowCounter += 1;
    const id = 'flt-' + filterRowCounter;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap: var(--space-2); align-items:center;';
    row.innerHTML = `
        <select class="select flt-col" style="flex:1; min-width:120px;">${(ep.filterable || []).map(c => `<option value="${c}">${c}</option>`).join('')}</select>
        <select class="select flt-op" style="width:90px;"><option value="eq">= equals</option><option value="like">~ contains</option></select>
        <input type="text" class="input flt-val" style="flex:2;" placeholder="value">
        <button type="button" class="btn btn-ghost btn-sm flt-del" title="Remove">✕</button>
    `;
    row.querySelector('.flt-del').addEventListener('click', () => { row.remove(); updateUrlPreview(); });
    ['change', 'input'].forEach(ev => row.querySelectorAll('select, input').forEach(el => el.addEventListener(ev, updateUrlPreview)));
    document.getElementById('con-filter-rows').appendChild(row);
    updateUrlPreview();
}

function currentQuery() {
    const ep = activeEndpoint;
    const parts = [];
    if (ep.kind === 'feed') {
        const fields = document.getElementById('con-fields').value.trim();
        if (fields) parts.push('fields=' + encodeURIComponent(fields));
        document.querySelectorAll('#con-filter-rows .flt-col').forEach((sel, i) => {
            const col = sel.value, op = document.querySelectorAll('#con-filter-rows .flt-op')[i].value, val = document.querySelectorAll('#con-filter-rows .flt-val')[i].value.trim();
            if (!col || !val) return;
            const key = 'filter[' + col + ']';
            parts.push(key + '=' + encodeURIComponent((op === 'like' ? '~' : '') + val));
        });
        const sort = document.getElementById('con-sort').value;
        if (sort) parts.push('sort=' + encodeURIComponent(sort));
        const order = document.getElementById('con-order').value;
        if (order) parts.push('order=' + encodeURIComponent(order));
        const limit = document.getElementById('con-limit').value;
        if (limit) parts.push('limit=' + encodeURIComponent(limit));
    }
    return parts.join('&');
}

function updateUrlPreview() {
    const urlEl = document.getElementById('con-url');
    if (!activeEndpoint) { urlEl.textContent = ''; return; }
    urlEl.textContent = activeEndpoint.method + ' ' + activeEndpoint.path + (currentQuery() ? '?' + currentQuery() : '');
}

async function runConsole() {
    const output = document.getElementById('con-output');
    const status = document.getElementById('con-status');
    const download = document.getElementById('con-download');
    const copyCurl = document.getElementById('con-copy-curl');
    const format = document.getElementById('con-format').value;
    const authMode = document.getElementById('con-auth').value;
    const pasted = document.getElementById('con-token-paste').value.trim();
    const ep = activeEndpoint;
    if (!ep) return;

    const url = ep.path + (currentQuery() ? '?' + currentQuery() : '');
    const headers = {};
    if (authMode === 'token') {
        if (!pasted) { toast('Paste an API token first', true); return; }
        headers['Authorization'] = 'Bearer ' + pasted;
    }
    if (format === 'csv') headers['Accept'] = 'text/csv';
    else headers['Accept'] = 'application/json';

    status.textContent = 'Sending ' + ep.method + ' ' + url + ' …';
    output.style.display = 'none';
    download.style.display = 'none';
    copyCurl.disabled = true;
    const btn = document.getElementById('con-run');
    btn.disabled = true;
    try {
        const res = authMode === 'session'
            ? await window.StaffTrackAuth.apiFetch(url, { headers })
            : await fetch(url, { headers });
        const ctype = res.headers.get('content-type') || '';
        status.textContent = ep.method + ' ' + url + ' → ' + res.status + ' ' + res.statusText;
        output.style.display = '';
        if (ctype.includes('text/csv')) {
            const text = await res.text();
            output.textContent = text;
            download.style.display = '';
            download.onclick = () => {
                const blob = new Blob([text], { type: 'text/csv' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = ep.id + '.csv';
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            };
        } else {
            const data = await res.json().catch(() => null);
            output.textContent = data == null ? '(non-JSON response)' : JSON.stringify(data, null, 2);
        }
        copyCurl.disabled = false;
        copyCurl.onclick = () => {
            const token = authMode === 'token' ? pasted : (window.StaffTrackAuth.getToken ? window.StaffTrackAuth.getToken() : '');
            copyText('curl -X ' + ep.method + ' -H "Authorization: Bearer ' + token + '"' + (format === 'csv' ? ' -H "Accept: text/csv"' : '') + ' ' + location.origin + url);
        };
    } catch (err) {
        status.textContent = 'Request failed: ' + err.message;
    } finally {
        btn.disabled = false;
    }
}

// ── Warnings / wiring ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (typeof renderSidebarNav === 'function') {
        renderSidebarNav('api-access');
    } else if (typeof renderNav === 'function') {
        renderNav('api-access');
    }
    if (typeof ThemeManager !== 'undefined') ThemeManager.updateToggleButtons();
    if (typeof Toast !== 'undefined') Toast.init();

    // scope radio warning
    document.querySelectorAll('input[name="tok-scope"]').forEach(r => r.addEventListener('change', () => {
        const full = document.querySelector('input[name="tok-scope"]:checked').value === 'full';
        document.getElementById('tok-scope-warning').style.display = full ? '' : 'none';
    }));
    document.getElementById('tok-expiry').addEventListener('change', () => {
        const never = document.getElementById('tok-expiry').value === 'never';
        document.getElementById('tok-expiry-warning').style.display = never ? '' : 'none';
    });
    document.getElementById('tok-create').addEventListener('click', createToken);

    // console wiring
    renderEndpointSelect();
    if (activeEndpoint) onEndpointChange(activeEndpoint);
    document.getElementById('con-add-filter').addEventListener('click', addFilterRow);
    ['con-fields', 'con-sort', 'con-order', 'con-limit'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateUrlPreview);
    });
    document.getElementById('con-fields').addEventListener('input', updateUrlPreview);
    document.getElementById('con-run').addEventListener('click', runConsole);

    // modal helpers
    document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeModal));
    document.getElementById('reveal-copy').addEventListener('click', () => {
        const secret = document.getElementById('reveal-secret').value;
        if (secret) copyText(secret);
    });
    document.getElementById('reveal-copy-curl').addEventListener('click', () => {
        const secret = document.getElementById('reveal-secret').value;
        if (secret) copyText('curl -H "Authorization: Bearer ' + secret + '" ' + location.origin + '/api/feeds/me');
    });

    loadTokens();
});