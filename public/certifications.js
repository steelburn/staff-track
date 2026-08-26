'use strict';

const authUser = requireAuth();

// Certifications catalog is HR/Admin only
const isAdmin = authUser.isAdmin === true;
const isHR = authUser.is_hr === true || authUser.is_hr === 1;
if (!isAdmin && !isHR) {
    location.href = '/';
}

// ── State ─────────────────────────────────────────────────────────────────────
let currentView = 'certs'; // 'certs' | 'staff'
let searchQuery = '';
let statusFilter = 'all'; // 'all' | 'valid' | 'expiring' | 'expired'
let currentData = []; // [{ name, staff: [{id,email,name,title,department,issuer,dateObtained,expiryDate,credentialId,description,proofPath,visible}] }]

const DAY_MS = 86400000;

// ── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize sidebar navigation
    if (typeof renderSidebarNav === 'function') {
        renderSidebarNav('certifications');
    } else if (typeof renderNav === 'function') {
        renderNav('certifications');
    }
    // Initialize theme toggle
    if (typeof ThemeManager !== 'undefined') {
        ThemeManager.updateToggleButtons();
    }
    // Initialize toast
    if (typeof Toast !== 'undefined') {
        Toast.init();
    }

    document.getElementById('cert-search').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderCurrentView();
    });

    document.getElementById('status-select').addEventListener('change', (e) => {
        statusFilter = e.target.value;
        renderCurrentView();
    });

    // View Toggles
    const btnCerts = document.getElementById('btn-view-certs');
    const btnStaff = document.getElementById('btn-view-staff');

    btnCerts.addEventListener('click', () => {
        if (currentView === 'certs') return;
        currentView = 'certs';
        toggleActiveBtn(btnCerts, btnStaff);
        renderCurrentView();
    });

    btnStaff.addEventListener('click', () => {
        if (currentView === 'staff') return;
        currentView = 'staff';
        toggleActiveBtn(btnStaff, btnCerts);
        renderCurrentView();
    });

    await fetchDataAndRender();
});

function toggleActiveBtn(activeBtn, inactiveBtn) {
    activeBtn.classList.add('active');
    activeBtn.style.background = 'white';
    activeBtn.style.color = 'var(--text-main)';
    activeBtn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';

    inactiveBtn.classList.remove('active');
    inactiveBtn.style.background = 'transparent';
    inactiveBtn.style.color = 'var(--text-muted)';
    inactiveBtn.style.boxShadow = 'none';
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function fetchDataAndRender() {
    const grid = document.getElementById('certs-grid');
    const countEl = document.getElementById('certs-count');
    countEl.textContent = 'Loading...';
    grid.innerHTML = '<p class="grid-empty">Fetching data...</p>';

    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/reports/certifications');
        if (!res.ok) throw new Error('Failed to load certifications');
        currentData = await res.json();
        renderCurrentView();
    } catch (e) {
        console.error(e);
        grid.innerHTML = '<p class="grid-empty">Error loading certifications.</p>';
        countEl.textContent = 'Error';
    }
}

// ── Filtering helpers ─────────────────────────────────────────────────────────
/**
 * Cert status relative to today:
 *   'expired'  — expiry_date in the past
 *   'expiring' — expires within 90 days (inclusive of today)
 *   'valid'    — still valid, or no expiry date (never expires)
 */
function certStatus(expiryDate) {
    if (!expiryDate) return 'valid';
    const exp = new Date(expiryDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((exp - today) / DAY_MS);
    if (days < 0) return 'expired';
    if (days <= 90) return 'expiring';
    return 'valid';
}

function daysUntil(expiryDate) {
    const exp = new Date(expiryDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((exp - today) / DAY_MS);
}

function statusMatches(inst) {
    if (statusFilter === 'all') return true;
    return certStatus(inst.expiryDate) === statusFilter;
}

function instMatchesSearch(inst, certName) {
    if (!searchQuery) return true;
    const haystack = [
        certName,
        inst.issuer,
        inst.name,
        inst.title,
        inst.department,
        inst.credentialId
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(searchQuery);
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderCurrentView() {
    if (currentView === 'certs') {
        renderCertsView();
    } else {
        renderStaffView();
    }
}

function certBadge(inst) {
    const status = certStatus(inst.expiryDate);
    if (status === 'expired') {
        return '<span class="cert-badge expired">Expired</span>';
    }
    if (status === 'expiring') {
        const d = daysUntil(inst.expiryDate);
        return `<span class="cert-badge expiring">Expires in ${d} day${d !== 1 ? 's' : ''}</span>`;
    }
    return '';
}

function renderCertsView() {
    const grid = document.getElementById('certs-grid');
    const countEl = document.getElementById('certs-count');

    grid.className = 'certs-grid';

    // Filter groups by search + status (status filters individual cert instances)
    const filtered = currentData
        .map(group => ({
            name: group.name,
            staff: group.staff.filter(inst => statusMatches(inst) && instMatchesSearch(inst, group.name))
        }))
        .filter(group => group.staff.length > 0);

    countEl.textContent = `${filtered.length} certification${filtered.length !== 1 ? 's' : ''}`;

    if (!filtered.length) {
        grid.innerHTML = `<p class="grid-empty" style="grid-column: 1 / -1">${searchQuery || statusFilter !== 'all' ? 'No certifications match the filters.' : 'No certification data available.'}</p>`;
        return;
    }

    grid.innerHTML = filtered.map(group => `
        <div class="cert-group-card">
            <div class="cert-group-header">
                <h3>${hl(group.name, searchQuery)}</h3>
                <span class="cert-group-count">${group.staff.length} holder${group.staff.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="cert-staff-list">
                ${group.staff.map(inst => `
                    <div class="cert-staff-row">
                        <div class="cert-staff-info">
                            <span class="cert-staff-name"><a href="/cv-profile.html?email=${encodeURIComponent(inst.email)}" title="View profile">${hl(inst.name, searchQuery)}</a></span>
                            <span class="cert-staff-meta">${hl(inst.title, searchQuery)}${inst.department ? ` • ${hl(inst.department, searchQuery)}` : ''}</span>
                            ${inst.issuer ? `<span class="cert-issuer">${hl(inst.issuer, searchQuery)}</span>` : ''}
                        </div>
                        <div class="cert-staff-dates">
                            ${certBadge(inst)}
                            ${inst.dateObtained ? `<span>Obtained ${inst.dateObtained}</span>` : ''}
                            ${inst.expiryDate ? `<span>Expires ${inst.expiryDate}</span>` : ''}
                            ${inst.proofPath ? `<a href="${inst.proofPath}" target="_blank" rel="noopener">📎 Proof</a>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function renderStaffView() {
    const grid = document.getElementById('certs-grid');
    const countEl = document.getElementById('certs-count');

    grid.className = 'grid-3';

    // Build staff -> certs map from all groups
    const staffMap = new Map(); // email -> { name, title, department, certs: [] }
    currentData.forEach(group => {
        group.staff.forEach(inst => {
            if (!statusMatches(inst)) return;
            if (!staffMap.has(inst.email)) {
                staffMap.set(inst.email, {
                    name: inst.name,
                    email: inst.email,
                    title: inst.title,
                    department: inst.department,
                    certs: []
                });
            }
            staffMap.get(inst.email).certs.push({ ...inst, certName: group.name });
        });
    });

    let filtered = Array.from(staffMap.values());

    // Apply text search (staff fields + cert names/issuers)
    if (searchQuery) {
        filtered = filtered.filter(staff => {
            const staffHaystack = [staff.name, staff.title, staff.department].filter(Boolean).join(' ').toLowerCase();
            if (staffHaystack.includes(searchQuery)) return true;
            return staff.certs.some(c => [c.certName, c.issuer, c.credentialId].filter(Boolean).join(' ').toLowerCase().includes(searchQuery));
        });
    }

    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

    countEl.textContent = `${filtered.length} staff found`;

    if (!filtered.length) {
        grid.innerHTML = `<p class="grid-empty" style="grid-column: 1 / -1">${searchQuery || statusFilter !== 'all' ? 'No staff match the filters.' : 'No certification data available.'}</p>`;
        return;
    }

    grid.innerHTML = filtered.map(staff => `
        <div class="section-card" style="padding:1.25rem;">
            <h3 style="margin:0 0 0.25rem 0; font-size:1.1rem; color:var(--text-main)"><a href="/cv-profile.html?email=${encodeURIComponent(staff.email)}" style="color:inherit; text-decoration:none;" onmouseover="this.style.color='var(--color-primary)'" onmouseout="this.style.color='inherit'">${hl(staff.name, searchQuery)}</a></h3>
            <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.5rem">${hl(staff.title, searchQuery)}${staff.department ? ` • ${hl(staff.department, searchQuery)}` : ''}</div>
            <div style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.75rem">${staff.certs.length} certification${staff.certs.length !== 1 ? 's' : ''}</div>
            <div class="staff-cert-list">
                ${staff.certs
                    .sort((a, b) => (a.expiryDate || '9999').localeCompare(b.expiryDate || '9999'))
                    .map(c => `
                        <div class="staff-cert-item">
                            <div style="min-width:0">
                                <div class="cert-name">${hl(c.certName, searchQuery)}</div>
                                <div class="cert-sub">${c.issuer ? hl(c.issuer, searchQuery) + ' · ' : ''}${c.dateObtained ? 'Obtained ' + c.dateObtained : ''}${c.expiryDate ? ' · Expires ' + c.expiryDate : ''}</div>
                                ${c.proofPath ? `<div class="cert-sub"><a href="${c.proofPath}" target="_blank" rel="noopener" style="color:var(--color-primary); text-decoration:none;">📎 Proof</a></div>` : ''}
                            </div>
                            ${certBadge(c)}
                        </div>
                    `).join('')}
            </div>
        </div>
    `).join('');
}

function hl(text, q) {
    if (!q || !text) return text || '';
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return text;
    return text.slice(0, i) + `<mark>${text.slice(i, i + q.length)}</mark>` + text.slice(i + q.length);
}
