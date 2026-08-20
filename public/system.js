'use strict';

// Use auth module functions


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

async function handleSyncStaff() {
    const btn = document.getElementById('btn-do-sync-staff');
    const statusDiv = document.getElementById('staff-sync-status');
    const statsCard = document.getElementById('import-stats-card');
    const resultsBody = document.getElementById('import-results-body');

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
            
            // Poll for status until complete
            let pollCount = 0;
            const maxPolls = 180; // 3 minutes max
            while (pollCount < maxPolls) {
                await new Promise(r => setTimeout(r, 1000));
                
                const statusRes = await window.StaffTrackAuth.apiFetch('/api/admin/sync-staff/status');
                if (statusRes.ok) {
                    const status = await statusRes.json();
                    
                    if (status.completed) {
                        const result = status.result;
                        if (result.success) {
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
                                detailsHtml += `<div style="margin-top:.5rem;font-size:.75rem">Staff catalog is now up to date.</div>`;
                                resultsBody.innerHTML = detailsHtml;
                            }
                        } else {
                            throw new Error(result.error || 'Sync failed');
                        }
                        break;
                    } else if (status.inProgress) {
                        const pct = status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0;
                        btn.textContent = `⏳ ${status.progress}/${status.total} (${pct}%)`;
                        if (statusDiv) statusDiv.textContent = `Syncing: ${status.currentStaff || 'loading...'} (${status.progress}/${status.total})`;
                    }
                }
                pollCount++;
            }
            
            if (pollCount >= maxPolls && !status.completed) {
                showToast('Sync timed out. Check status later.', true);
            }
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
let catalogSkills = [];

async function initSkillConsolidation() {
    await loadCatalogSkills();
    setupSkillActions();
}

let skillSearchQ = '';

async function loadCatalogSkills() {
    const tbody = document.getElementById('skills-catalog-tbody');
    if (!tbody) return;

    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills');
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

    let list = catalogSkills;
    const q = skillSearchQ.toLowerCase();

    if (q) {
        list = list.filter(s => (s.name || '').toLowerCase().includes(q));
    }

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="3" style="padding:1rem;color:var(--text-muted);text-align:center">${skillSearchQ ? 'No matching skills found.' : 'No skills found.'}</td></tr>`;
        updateSkillButtons();
        return;
    }

    tbody.innerHTML = list.map((s, i) => `
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
    // Search
    document.getElementById('skill-search')?.addEventListener('input', e => {
        skillSearchQ = e.target.value.trim();
        renderCatalogSkills();
    });

    // Propose Merges
    document.getElementById('btn-propose-merges')?.addEventListener('click', () => {
        // Normalize skill name for grouping: trim, collapse spaces, lowercase
        function normalizeForGrouping(name) {
            return name.trim().replace(/\s+/g, ' ').toLowerCase();
        }
        
        const map = new Map(); // normalized -> array of original names
        catalogSkills.forEach(s => {
            const key = normalizeForGrouping(s.name);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(s.name);
        });

        const toCheck = new Set();
        let proposedGroups = 0;

        for (const [low, names] of map.entries()) {
            if (names.length > 1) {
                names.forEach(n => toCheck.add(n));
                proposedGroups++;
            }
        }

        if (proposedGroups === 0) {
            showToast('No case-based duplicates found.');
            return;
        }

        let checkedCount = 0;
        document.querySelectorAll('.chk-skill').forEach(chk => {
            if (toCheck.has(chk.dataset.name)) {
                chk.checked = true;
                checkedCount++;
            } else {
                chk.checked = false;
            }
        });

        updateSkillButtons();
        showToast(`Proposed ${proposedGroups} groups for merging (${checkedCount} skills selected)`);
    });

    document.getElementById('btn-rename-skill')?.addEventListener('click', async () => {
        const sel = getSelectedSkills();
        if (sel.length !== 1) return;
        const oldName = sel[0];
        const newName = prompt(`Rename "${oldName}" to:`, oldName);
        if (!newName || newName.trim() === '' || newName === oldName) return;

        try {
            const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills/split', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            const res = await window.StaffTrackAuth.apiFetch('/api/admin/skills', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
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
