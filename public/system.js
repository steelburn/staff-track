'use strict';

// Use auth module functions


const authUser = requireAuth();


// ── Helper ───────────────────────────────────────────────────────────────────
function showToast(msg, isErr = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' toast-err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 400); }, 3200);
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

const SYNC_PHASE_LABELS = {
    'login': 'Logging in to BeeSuite…',
    'fetch-details': 'Fetching employment details',
    'update-db': 'Updating database',
    'deactivate': 'Deactivating stale accounts',
    'done': 'Complete',
    'error': 'Failed'
};

function renderSyncProgress(status) {
    const btn = document.getElementById('btn-do-sync-staff');
    const statusDiv = document.getElementById('staff-sync-status');
    const wrap = document.getElementById('staff-sync-progress-wrap');
    const bar = document.getElementById('staff-sync-progress');
    const phaseEl = document.getElementById('staff-sync-phase');
    const pct = typeof status.percent === 'number' ? status.percent : 0;
    const label = SYNC_PHASE_LABELS[status.phase] || 'Syncing…';

    if (wrap) wrap.style.display = 'block';
    if (bar) { bar.value = pct; }
    if (phaseEl) {
        phaseEl.textContent = `${label} — ${status.currentStaff || '…'} (${status.progress}/${status.total})`;
    }
    if (btn) btn.textContent = `⏳ ${pct}%`;
    if (statusDiv) statusDiv.textContent = `${label} (${status.progress}/${status.total})`;
}

function renderSyncComplete(status) {
    const statusDiv = document.getElementById('staff-sync-status');
    const statsCard = document.getElementById('import-stats-card');
    const resultsBody = document.getElementById('import-results-body');
    const bar = document.getElementById('staff-sync-progress');
    const phaseEl = document.getElementById('staff-sync-phase');
    if (bar) { bar.value = 100; }
    if (phaseEl) { phaseEl.textContent = 'Complete'; }

    const result = status.result;
    if (result && result.success) {
        showToast(`Sync Success: ${result.count} added, ${result.updated} updated`);
        if (statusDiv) statusDiv.textContent = `Last sync: ${new Date().toLocaleString()}`;
        if (statsCard) statsCard.style.display = 'block';
        if (resultsBody) {
            let detailsHtml = `
                <div style="color:var(--accent-blue);font-weight:600">Sync Complete</div>
                <div>✅ New staff added: <b>${result.count}</b></div>
                <div>🔄 Staff updated: <b>${result.updated}</b></div>
                <div>⏭️ Skipped: <b>${result.skipped}</b></div>
            `;
            if (result.inactiveSkipped > 0) detailsHtml += `<div>🚫 Inactive users: <b>${result.inactiveSkipped}</b></div>`;
            if (result.resignedSkipped > 0) detailsHtml += `<div>📅 Resigned users: <b>${result.resignedSkipped}</b></div>`;
            if (result.wrongTenantDeactivated > 0) detailsHtml += `<div>🏢 Wrong tenant deactivated: <b>${result.wrongTenantDeactivated}</b></div>`;
            if (result.detailFailures > 0) detailsHtml += `<div>⚠️ Detail fetch failures (kept old manager data): <b>${result.detailFailures}</b></div>`;
            detailsHtml += `<div style="margin-top:.5rem;font-size:.75rem">Staff catalog is now up to date.</div>`;
            resultsBody.innerHTML = detailsHtml;
        }
    } else {
        showToast((result && result.error) || 'Sync failed', true);
        if (statusDiv) statusDiv.textContent = 'Sync failed. Please try again.';
    }
}

// Poll until the background sync completes. Budget is 30 minutes (was 3 min —
// a full 300+ staff sync routinely exceeded the old cap, so the UI bailed out
// mid-run and the results were lost even though the backend kept going).
async function pollSyncUntilDone() {
    const maxPolls = 1800;
    let status = null;
    for (let pollCount = 0; pollCount < maxPolls; pollCount++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            const statusRes = await window.StaffTrackAuth.apiFetch('/api/admin/sync-staff/status');
            if (!statusRes.ok) continue;
            status = await statusRes.json();
        } catch (e) {
            continue; // transient network blip — keep polling
        }
        if (status.completed) {
            renderSyncComplete(status);
            return;
        }
        if (status.inProgress) {
            renderSyncProgress(status);
        }
    }
    // Hard ceiling reached — the backend is likely still running; stay calm.
    showToast('Sync still running after 30 minutes — check back later.', true);
    const statusDiv = document.getElementById('staff-sync-status');
    if (statusDiv && status && status.inProgress) {
        statusDiv.textContent = 'Sync still in progress…';
    }
}

async function handleSyncStaff() {
    const btn = document.getElementById('btn-do-sync-staff');
    const statusDiv = document.getElementById('staff-sync-status');

    if (!btn) return;

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '⌛ Starting...';
    if (statusDiv) statusDiv.textContent = 'Starting sync...';

    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/sync-staff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.started) {
            if (statusDiv) statusDiv.textContent = 'Syncing staff... please wait';
            btn.textContent = '⏳ Syncing...';
            await pollSyncUntilDone();
        } else {
            throw new Error(data.error || 'Failed to start sync');
        }
    } catch (e) {
        showToast(e.message, true);
        if (statusDiv) statusDiv.textContent = 'Sync failed. Please try again.';
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// If a sync is already running in the backend (page reload mid-sync, or a sync
// started from another tab), resume monitoring instead of showing the idle UI.
async function resumeSyncMonitor() {
    const btn = document.getElementById('btn-do-sync-staff');
    if (!btn || btn.disabled) return;
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/sync-staff/status');
        if (!res.ok) return;
        const status = await res.json();
        if (status.inProgress && !status.completed) {
            btn.disabled = true;
            const statusDiv = document.getElementById('staff-sync-status');
            if (statusDiv) statusDiv.textContent = 'Sync already running — monitoring…';
            renderSyncProgress(status);
            await pollSyncUntilDone();
            btn.disabled = false;
            btn.textContent = '🔄 Sync Staff';
        }
    } catch (e) { /* ignore */ }
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize sidebar navigation
    if (typeof renderSidebarNav === 'function') {
        renderSidebarNav('system');
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

    const syncStaffBtn = document.getElementById('btn-do-sync-staff');
    if (syncStaffBtn) {
        syncStaffBtn.addEventListener('click', handleSyncStaff);
        resumeSyncMonitor();
    }

    const syncProjectsBtn = document.getElementById('btn-do-sync-projects');
    if (syncProjectsBtn) {
        syncProjectsBtn.addEventListener('click', handleSyncProjects);
    }

    initSkillConsolidation();
});

// ── Project Sync from BeeSuite ───────────────────────────────────────────────
async function handleSyncProjects() {
    const btn = document.getElementById('btn-do-sync-projects');
    const statusDiv = document.getElementById('projects-sync-status');

    if (!btn) return;

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = '⏳ Syncing...';
    if (statusDiv) statusDiv.textContent = 'Syncing projects from BeeSuite...';

    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/sync-projects-catalog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.success) {
            showToast(data.message || 'Sync complete');
            if (statusDiv) statusDiv.textContent = `Last sync: ${new Date().toLocaleString()}`;

            const statsCard = document.getElementById('import-stats-card');
            const resultsBody = document.getElementById('import-results-body');
            if (statsCard) statsCard.style.display = 'block';
            if (resultsBody && data.stats) {
                resultsBody.innerHTML = `
                    <div style="color:var(--accent-blue);font-weight:600">Sync Complete</div>
                    <div>➕ New projects: <b>${data.stats.added}</b></div>
                    <div>🔄 Updated: <b>${data.stats.updated}</b></div>
                    <div>✅ Unchanged: <b>${data.stats.unchanged}</b></div>
                    <div>⏭️ Skipped: <b>${data.stats.skipped}</b></div>
                    <div style="margin-top:.5rem;font-size:.75rem">Total from BeeSuite: ${data.stats.total}</div>
                `;
            }
        } else {
            throw new Error(data.error || 'Sync failed');
        }
    } catch (e) {
        showToast(e.message, true);
        if (statusDiv) statusDiv.textContent = 'Sync failed. Please try again.';
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// ── Skill Consolidation Logic ─────────────────────────────────────────────────
let catalog = { skills: [], proposals: [] }; // GET /api/admin/skills payload
let skillSearchQ = '';
let selectedSkills = new Set();              // checked skill names (main table)
let undoInfo = null;                         // GET /api/admin/skills/undo payload

const catalogIndex = new Map();              // name -> skill entry (by display name)

function getSkill(name) {
    return catalogIndex.get(name);
}

async function loadCatalogSkills() {
    const tbody = document.getElementById('skills-catalog-tbody');
    if (!tbody) return;

    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills');
        if (!res.ok) throw new Error('Failed to load skills');
        catalog = await res.json();
        catalog.skills = catalog.skills || [];
        catalog.proposals = catalog.proposals || [];
        catalogIndex.clear();
        catalog.skills.forEach(s => catalogIndex.set(s.name, s));
        renderCatalogSkills();
        renderDuplicatesPanel();
        updateSummary();
        await refreshUndoState();
    } catch (e) {
        showToast(e.message, true);
        tbody.innerHTML = `<tr><td colspan="4" style="padding:1rem;color:var(--danger)">Error loading skills.</td></tr>`;
    }
}

function updateSummary() {
    const el = document.getElementById('skills-summary');
    if (!el) return;
    const variantCount = catalog.skills.reduce((n, s) => n + s.variants.length, 0);
    const propCount = catalog.proposals.length;
    el.textContent = `${catalog.skills.length} skills · ${variantCount} spelling variants · ${propCount} suggested merge groups.`;
}

// A skill participates in a suggested merge group (for the 🔁 badge).
function inProposal(name) {
    return catalog.proposals.some(p => p.members.some(m => m.name === name));
}

function renderCatalogSkills() {
    const tbody = document.getElementById('skills-catalog-tbody');
    if (!tbody) return;

    let list = catalog.skills;
    const q = skillSearchQ.toLowerCase();

    if (q) {
        list = list.filter(s => (s.name || '').toLowerCase().includes(q)
            || (s.variants || []).some(v => v.name.toLowerCase().includes(q)));
    }

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="padding:1rem;color:var(--text-muted);text-align:center">${skillSearchQ ? 'No matching skills found.' : 'No skills found.'}</td></tr>`;
        updateSkillButtons();
        return;
    }

    tbody.innerHTML = list.map(s => {
        const variants = (s.variants || []).length
            ? `<div class="skill-variants">variants: ${s.variants.map(v => `${esc(v.name)} <b>×${v.instances}</b>`).join(' · ')}</div>`
            : '';
        const dupBadge = inProposal(s.name)
            ? '<span class="dup-badge" title="Appears in a suggested merge group">🔁</span>'
            : '';
        return `
        <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:.5rem"><input type="checkbox" class="chk-skill" data-name="${esc(s.name)}" ${selectedSkills.has(s.name) ? 'checked' : ''}></td>
            <td style="padding:.5rem">
                <div style="font-weight:500;display:flex;align-items:center;gap:.35rem">${esc(s.name)} ${dupBadge}</div>
                ${variants}
            </td>
            <td style="padding:.5rem"><span class="skill-count-pill" style="display:inline-block;padding:.1rem .5rem;background:var(--bg-hover);border-radius:1rem;font-size:.75rem">${s.count}</span></td>
            <td style="padding:.5rem;color:var(--color-text-secondary);font-size:.8rem">${s.instances}</td>
        </tr>`;
    }).join('');

    document.querySelectorAll('.chk-skill').forEach(chk => {
        chk.addEventListener('change', () => {
            if (chk.checked) selectedSkills.add(chk.dataset.name);
            else selectedSkills.delete(chk.dataset.name);
            updateSkillButtons();
        });
    });
    updateSkillButtons();
}

function getSelectedSkills() {
    return [...selectedSkills];
}

function updateSkillButtons() {
    const n = selectedSkills.size;
    document.getElementById('btn-rename-skill').disabled = (n !== 1);
    document.getElementById('btn-merge-skills').disabled = (n < 2);
    document.getElementById('btn-split-skill').disabled = (n !== 1);
    document.getElementById('btn-delete-skill').disabled = (n !== 1);
}

// ── Modals ───────────────────────────────────────────────────────────────────
function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
}

function closeAllModals() {
    document.querySelectorAll('.modal-backdrop.active').forEach(el => el.classList.remove('active'));
}

// ── Duplicate proposals panel ────────────────────────────────────────────────
function renderDuplicatesPanel() {
    const panel = document.getElementById('duplicates-panel');
    if (!panel) return;
    if (panel.style.display === 'none') return;

    const list = document.getElementById('duplicates-list');
    const subtitle = document.getElementById('duplicates-subtitle');

    if (!catalog.proposals.length) {
        subtitle.textContent = 'No duplicate groups found — the catalog is clean.';
        list.innerHTML = '';
        return;
    }

    subtitle.textContent = `${catalog.proposals.length} machine-suggested groups (${catalog.proposals.reduce((n, p) => n + p.members.length, 0)} skill names). Review each group, then merge.`;
    list.innerHTML = catalog.proposals.map((p, i) => {
        const memberChips = p.members.map(m => {
            const pct = Math.round((m.score || 1) * 100);
            return m.isTarget
                ? `<span class="dupe-chip dupe-chip-target" title="Merge target (canonical name)">${esc(m.name)} <b>×${m.instances}</b></span>`
                : `<span class="dupe-chip" title="~${pct}% similar">${esc(m.name)} <b>×${m.instances}</b> <em>${pct}%</em></span>`;
        }).join('');
        return `
        <div class="dupe-group">
            <div class="dupe-group-head">
                <div class="dupe-group-members">${memberChips}</div>
                <div style="display:flex;gap:var(--space-2);align-items:center;flex:none;">
                    <button class="btn btn-primary btn-sm btn-merge-group" data-group="${i}">🔗 Merge group</button>
                </div>
            </div>
            <div class="dupe-group-foot">Merge into <b>${esc(p.target)}</b> — ${p.groupCount} submissions · ${p.groupInstances} instances affected</div>
        </div>`;
    }).join('');

    list.querySelectorAll('.btn-merge-group').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = catalog.proposals[+btn.dataset.group];
            if (!p) return;
            // Sources = non-target members; target stays in the target field.
            openMergeModal(p.members.filter(m => !m.isTarget).map(m => m.name), p.target);
        });
    });
}

// ── Merge modal ──────────────────────────────────────────────────────────────
let mergeSources = [];
let mergePreviewTimer = null;

function openMergeModal(sources, target) {
    mergeSources = [...new Set(sources.map(s => s.trim()).filter(Boolean))];
    const chipsEl = document.getElementById('merge-sources');
    const targetEl = document.getElementById('merge-target');
    const datalist = document.getElementById('merge-target-datalist');

    if (chipsEl) {
        chipsEl.innerHTML = mergeSources.map(s => {
            const skill = getSkill(s);
            return `<span class="dupe-chip">${esc(s)} <b>×${skill ? skill.instances : '?'}</b></span>`;
        }).join('');
    }
    if (datalist) {
        datalist.innerHTML = catalog.skills.map(s => `<option value="${esc(s.name)}"></option>`).join('');
    }
    if (targetEl) {
        targetEl.value = target || (getSkill(mergeSources[0]) ? mergeSources[0] : '');
    }

    openModal('merge-modal');
    loadMergePreview();
}

async function loadMergePreview() {
    const target = (document.getElementById('merge-target')?.value || '').trim();
    const previewEl = document.getElementById('merge-preview');
    if (!previewEl) return;

    if (!target || mergeSources.length === 0) {
        previewEl.innerHTML = '<p class="form-hint">Enter a target skill name to preview what will change.</p>';
        return;
    }

    previewEl.innerHTML = '<div class="loading-state" style="padding: var(--space-4);"><div class="spinner"></div><p>Loading preview…</p></div>';

    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceSkills: mergeSources, targetSkill: target })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Preview failed');

        const s = data.summary;
        let html = `<div class="preview-summary">`;
        html += `<span>⬆️ <b>${s.affectedRows}</b> skill instance${s.affectedRows === 1 ? '' : 's'} across <b>${s.affectedSubmissions}</b> submission${s.affectedSubmissions === 1 ? '' : 's'}</span>`;
        if (s.dedupeRows > 0) {
            html += `<span class="preview-warn">⚠️ <b>${s.dedupeRows}</b> duplicate row${s.dedupeRows === 1 ? '' : 's'} will be collapsed (staff who already have the target keep the highest rating)</span>`;
        }
        html += `</div>`;

        if (data.rows.length > 0) {
            const MAX_ROWS = 40;
            const shown = data.rows.slice(0, MAX_ROWS);
            html += `<div class="table-scroll" style="max-height:260px;overflow-y:auto;margin-top:var(--space-3);"><table class="table table-sm">`;
            html += `<thead><tr><th>Staff</th><th>Current Skill</th><th>Rating</th><th></th><th>Target</th></tr></thead><tbody>`;
            html += shown.map(r => `
                <tr>
                    <td>${esc(r.staffName || r.staffEmail)}</td>
                    <td>${esc(r.skill)}</td>
                    <td>${r.rating || '—'}</td>
                    <td style="color:var(--color-text-secondary)">→</td>
                    <td>${esc(r.newSkill)}${r.willDedupe ? ' <span class="preview-warn" title="This submission also has the target skill — rows will be deduped">⚠</span>' : ''}</td>
                </tr>`).join('');
            if (data.rows.length > MAX_ROWS) {
                html += `<tr><td colspan="5" style="color:var(--color-text-secondary)">…and ${data.rows.length - MAX_ROWS} more</td></tr>`;
            }
            html += `</tbody></table></div>`;
        } else {
            html += '<p class="form-hint" style="margin-top:var(--space-2)">No existing instances of the source skills — nothing will change.</p>';
        }
        previewEl.innerHTML = html;
    } catch (e) {
        previewEl.innerHTML = `<p class="form-hint" style="color:var(--danger)">${esc(e.message)}</p>`;
    }
}

async function applyMerge() {
    const target = (document.getElementById('merge-target')?.value || '').trim();
    if (!target) {
        showToast('Enter a target skill name.', true);
        return;
    }
    const btn = document.getElementById('btn-apply-merge');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⏳ Merging...';

    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills/merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetSkill: target, sourceSkills: mergeSources })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Merge failed');

        showToast(`${data.message} — ↩️ Undo available`);
        closeModal('merge-modal');
        await loadCatalogSkills();
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

// ── Rename modal ─────────────────────────────────────────────────────────────
let renameOldName = '';

function openRenameModal(name) {
    renameOldName = name;
    const oldEl = document.getElementById('rename-old');
    const newEl = document.getElementById('rename-new');
    const hint = document.getElementById('rename-hint');
    if (oldEl) oldEl.innerHTML = `<span class="dupe-chip">${esc(name)} <b>×${getSkill(name)?.instances || '?'}</b></span>`;
    if (newEl) { newEl.value = name; newEl.focus(); newEl.select(); }
    if (hint) hint.textContent = `Renaming updates all ${getSkill(name)?.count || 0} submissions using this skill.`;
    openModal('rename-modal');
}

async function applyRename() {
    const oldName = renameOldName;
    const newName = (document.getElementById('rename-new')?.value || '').trim();
    if (!newName) {
        showToast('Enter a new name.', true);
        return;
    }
    const btn = document.getElementById('btn-apply-rename');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⏳ Renaming...';

    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName, newName })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Rename failed');

        showToast(`${data.message} — ↩️ Undo available`);
        closeModal('rename-modal');
        await loadCatalogSkills();
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

// ── Split modal ──────────────────────────────────────────────────────────────
let splitOriginalName = '';

function openSplitModal(name) {
    splitOriginalName = name;
    const origEl = document.getElementById('split-original');
    const newEl = document.getElementById('split-new');
    if (origEl) origEl.innerHTML = `<span class="dupe-chip">${esc(name)} <b>×${getSkill(name)?.instances || '?'}</b></span>`;
    if (newEl) { newEl.value = ''; newEl.focus(); }
    openModal('split-modal');
}

async function applySplit() {
    const originalName = splitOriginalName;
    const raw = (document.getElementById('split-new')?.value || '');
    const newSkills = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (newSkills.length < 2) {
        showToast('Provide at least two comma-separated skill names.', true);
        return;
    }
    const btn = document.getElementById('btn-apply-split');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⏳ Splitting...';

    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills/split', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ originalSkill: originalName, newSkills })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Split failed');

        showToast(`${data.message} — ↩️ Undo available`);
        closeModal('split-modal');
        await loadCatalogSkills();
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

// ── Delete modal ─────────────────────────────────────────────────────────────
let deleteSkillName = '';

function openDeleteModal(name) {
    deleteSkillName = name;
    const nameEl = document.getElementById('delete-name');
    const hint = document.getElementById('delete-hint');
    const skill = getSkill(name);
    if (nameEl) nameEl.innerHTML = `<span class="dupe-chip">${esc(name)} <b>×${skill?.instances || '?'}</b></span>`;
    if (hint) hint.textContent = `Deletes ${skill?.count || 0} submission instance${skill?.count === 1 ? '' : 's'}. ↩️ Undo can restore it.`;
    openModal('delete-modal');
}

async function applyDelete() {
    const skillName = deleteSkillName;
    const btn = document.getElementById('btn-apply-delete');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⏳ Deleting...';

    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skillName })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Delete failed');

        showToast(`${data.message} — ↩️ Undo available`);
        closeModal('delete-modal');
        await loadCatalogSkills();
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

// ── Undo ─────────────────────────────────────────────────────────────────────
async function refreshUndoState() {
    const btn = document.getElementById('btn-undo-skill');
    if (!btn) return;
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills/undo');
        if (!res.ok) { btn.disabled = true; return; }
        undoInfo = await res.json();
        btn.disabled = !undoInfo.available;
        btn.title = undoInfo.available
            ? `Undo: ${undoInfo.summary || undoInfo.action} (${undoInfo.affected} records)`
            : 'No operation to undo';
    } catch {
        btn.disabled = true;
    }
}

async function doUndo() {
    if (!undoInfo || !undoInfo.available) return;
    if (!confirm(`Undo the last skill consolidation operation?\n\n${undoInfo.summary || undoInfo.action} (${undoInfo.affected} records)`)) return;

    const btn = document.getElementById('btn-undo-skill');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⏳ Restoring...';

    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills/undo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Undo failed');

        showToast(data.message);
        await loadCatalogSkills();
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = original;
        refreshUndoState();
    }
}

// ── Wiring ───────────────────────────────────────────────────────────────────
function setupSkillActions() {
    // Search
    document.getElementById('skill-search')?.addEventListener('input', e => {
        skillSearchQ = e.target.value.trim();
        renderCatalogSkills();
    });

    // Find Duplicates: toggle the proposals panel
    document.getElementById('btn-find-duplicates')?.addEventListener('click', () => {
        const panel = document.getElementById('duplicates-panel');
        if (!panel) return;
        const isHidden = panel.style.display === 'none';
        panel.style.display = isHidden ? 'block' : 'none';
        if (isHidden) renderDuplicatesPanel();
        const btn = document.getElementById('btn-find-duplicates');
        if (btn) btn.textContent = isHidden ? '🔍 Hide Duplicates' : '🔎 Find Duplicates';
    });
    document.getElementById('btn-close-duplicates')?.addEventListener('click', () => {
        const panel = document.getElementById('duplicates-panel');
        if (panel) panel.style.display = 'none';
        const btn = document.getElementById('btn-find-duplicates');
        if (btn) btn.textContent = '🔎 Find Duplicates';
    });

    // Rename
    document.getElementById('btn-rename-skill')?.addEventListener('click', () => {
        if (selectedSkills.size !== 1) return;
        openRenameModal([...selectedSkills][0]);
    });

    // Merge (toolbar — needs 2+ checked)
    document.getElementById('btn-merge-skills')?.addEventListener('click', () => {
        if (selectedSkills.size < 2) return;
        const sources = getSelectedSkills();
        // Default target = the most-used selected skill
        const target = sources.slice().sort((a, b) =>
            (getSkill(b)?.instances || 0) - (getSkill(a)?.instances || 0))[0];
        openMergeModal(sources, target);
    });

    // Split
    document.getElementById('btn-split-skill')?.addEventListener('click', () => {
        if (selectedSkills.size !== 1) return;
        openSplitModal([...selectedSkills][0]);
    });

    // Delete
    document.getElementById('btn-delete-skill')?.addEventListener('click', () => {
        if (selectedSkills.size !== 1) return;
        openDeleteModal([...selectedSkills][0]);
    });

    // Undo
    document.getElementById('btn-undo-skill')?.addEventListener('click', doUndo);

    // Modal close wiring (delegated)
    document.addEventListener('click', e => {
        const closer = e.target.closest('[data-close-modal]');
        if (closer) {
            closeModal(closer.dataset.closeModal);
            return;
        }
        // Click on the backdrop (not the modal card) closes it
        if (e.target.classList.contains('modal-backdrop')) {
            e.target.classList.remove('active');
        }
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeAllModals();
    });

    // Merge modal: live preview on target change
    document.getElementById('merge-target')?.addEventListener('input', () => {
        clearTimeout(mergePreviewTimer);
        mergePreviewTimer = setTimeout(loadMergePreview, 400);
    });
    document.getElementById('btn-apply-merge')?.addEventListener('click', applyMerge);
    document.getElementById('btn-apply-rename')?.addEventListener('click', applyRename);
    document.getElementById('btn-apply-split')?.addEventListener('click', applySplit);
    document.getElementById('btn-apply-delete')?.addEventListener('click', applyDelete);
}

async function initSkillConsolidation() {
    setupSkillActions();
    await loadCatalogSkills();
}
