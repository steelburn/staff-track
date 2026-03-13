'use strict';

// Use auth module functions
const token = window.StaffTrackAuth.getToken();
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


// ── State ─────────────────────────────────────────────────────────────────────
let currentView = 'skills'; // 'skills' | 'staff'
let activeFilters = []; // { name, minRating }
let searchQuery = '';
let currentData = [];

// ── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    renderNav('skills');

    document.getElementById('btn-add-filter').addEventListener('click', addFilter);
    document.getElementById('skill-search').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderCurrentView();
    });

    // Handle Enter key in input
    document.getElementById('skill-search').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addFilter();
        }
    });

    // View Toggles
    const btnSkills = document.getElementById('btn-view-skills');
    const btnStaff = document.getElementById('btn-view-staff');

    btnSkills.addEventListener('click', () => {
        if (currentView === 'skills') return;
        currentView = 'skills';
        toggleActiveBtn(btnSkills, btnStaff);
        fetchDataAndRender();
    });

    btnStaff.addEventListener('click', () => {
        if (currentView === 'staff') return;
        currentView = 'staff';
        toggleActiveBtn(btnStaff, btnSkills);
        fetchDataAndRender();
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

function addFilter() {
    const input = document.getElementById('skill-search');
    const val = input.value.trim();
    if (!val) return;

    const rating = parseInt(document.getElementById('min-rating-select').value, 10);

    // Check if already exists, then update rating
    const existingIdx = activeFilters.findIndex(f => f.name.toLowerCase() === val.toLowerCase());
    if (existingIdx >= 0) {
        activeFilters[existingIdx].minRating = rating;
    } else {
        activeFilters.push({ name: val, minRating: rating });
    }

    input.value = '';
    searchQuery = '';
    renderActiveFilters();

    // If we add an advanced filter, it usually means we are looking for a specific staff member. Switch to Staff view.
    if (currentView === 'skills') {
        document.getElementById('btn-view-staff').click(); // This will trigger fetch
    } else {
        fetchDataAndRender();
    }
}

window.removeFilter = function (index) {
    activeFilters.splice(index, 1);
    renderActiveFilters();
    fetchDataAndRender();
};

function renderActiveFilters() {
    const container = document.getElementById('active-filters');
    if (!activeFilters.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = activeFilters.map((f, i) => `
        <div style="display:flex; align-items:center; gap:0.25rem; background:var(--bg-hover); padding:0.25rem 0.5rem; border-radius:1rem; border:1px solid var(--border); font-size:0.8rem">
            <span style="font-weight:500">${f.name}</span>
            <span style="color:var(--text-muted)">≥ ${f.minRating}★</span>
            <button onclick="removeFilter(${i})" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-weight:bold; margin-left:0.25rem">&times;</button>
        </div>
    `).join('');
}

async function fetchDataAndRender() {
    const grid = document.getElementById('skills-grid');
    const countEl = document.getElementById('skills-count');
    countEl.textContent = 'Loading...';
    grid.innerHTML = '<p class="grid-empty">Fetching data...</p>';

    try {
        if (currentView === 'skills') {
            const res = await window.StaffTrackAuth.apiFetch('/api/reports/skills');
            if (!res.ok) throw new Error('Failed to load skills');
            currentData = await res.json();
        } else {
            const qs = activeFilters.length ? `?skills=${encodeURIComponent(JSON.stringify(activeFilters))}` : '';
            const res = await window.StaffTrackAuth.apiFetch(`/api/reports/staff-search${qs}`);
            if (!res.ok) throw new Error('Failed to load staff');
            currentData = await res.json();

            // Sort staff intelligently: highest sum of required skills first
            if (activeFilters.length > 0) {
                currentData.sort((a, b) => {
                    const sumA = activeFilters.reduce((sum, f) => {
                        const sk = a.skills?.find(s => s.skill.toLowerCase() === f.name.toLowerCase());
                        return sum + (sk ? sk.rating : 0);
                    }, 0);
                    const sumB = activeFilters.reduce((sum, f) => {
                        const sk = b.skills?.find(s => s.skill.toLowerCase() === f.name.toLowerCase());
                        return sum + (sk ? sk.rating : 0);
                    }, 0);
                    return sumB - sumA;
                });
            }
        }
        renderCurrentView();
    } catch (e) {
        console.error(e);
        grid.innerHTML = `<p class="grid-empty">Error loading report.</p>`;
        countEl.textContent = 'Error';
    }
}

function renderCurrentView() {
    if (currentView === 'skills') {
        renderSkillsView();
    } else {
        renderStaffView();
    }
}

function renderSkillsView() {
    const grid = document.getElementById('skills-grid');
    const countEl = document.getElementById('skills-count');

    grid.className = 'skills-catalog-grid';

    // Apply text search filter
    const filtered = currentData.filter(item =>
        item.skill.toLowerCase().includes(searchQuery) ||
        item.staff.some(s => s.name.toLowerCase().includes(searchQuery))
    );

    countEl.textContent = `${filtered.length} unique skill${filtered.length !== 1 ? 's' : ''}`;

    if (!filtered.length) {
        grid.innerHTML = `<p class="grid-empty">${searchQuery ? 'No matching skills found.' : 'No skills data available.'}</p>`;
        return;
    }

    grid.innerHTML = filtered.map(item => `
        <div class="skill-group-card">
            <div class="skill-group-header">
                <h3>${hl(item.skill, searchQuery)}</h3>
                <span class="skill-count-pill">${item.staff.length} staff</span>
            </div>
            <div class="skill-staff-list">
                ${item.staff.map(s => `
                    <div class="skill-staff-row">
                        <div class="staff-info">
                            <span class="staff-name">${hl(s.name, searchQuery)}</span>
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

function renderStaffView() {
    const grid = document.getElementById('skills-grid');
    const countEl = document.getElementById('skills-count');

    // Switch to a grid layout for staff cards
    grid.className = 'grid-3';

    // Apply text search filter
    const filtered = currentData.filter(staff =>
        staff.staffName.toLowerCase().includes(searchQuery) ||
        (staff.title && staff.title.toLowerCase().includes(searchQuery)) ||
        (staff.department && staff.department.toLowerCase().includes(searchQuery)) ||
        (staff.skills && staff.skills.some(s => s.skill.toLowerCase().includes(searchQuery)))
    );

    countEl.textContent = `${filtered.length} staff found`;

    if (!filtered.length) {
        grid.innerHTML = `<p class="grid-empty" style="grid-column: 1 / -1">${searchQuery || activeFilters.length ? 'No staff match the criteria.' : 'No staff data available.'}</p>`;
        return;
    }

    grid.innerHTML = filtered.map(staff => `
        <div class="section-card" style="padding:1.25rem;">
            <h3 style="margin:0 0 0.25rem 0; font-size:1.1rem; color:var(--text-main)">${hl(staff.staffName, searchQuery)}</h3>
            <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:1rem">${hl(staff.title, searchQuery)} • ${hl(staff.department, searchQuery)}</div>
            
            <div style="border-top:1px solid var(--border); padding-top:0.75rem;">
                <h4 style="margin:0 0 0.5rem 0; font-size:0.8rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-secondary)">Top Skills</h4>
                <div style="display:flex; flex-direction:column; gap:0.4rem;">
                    ${(staff.skills || [])
            .sort((a, b) => b.rating - a.rating)
            .slice(0, 5) // Show top 5 skills
            .map(s => {
                // Highlight if it's one of the active filters
                const isRequired = activeFilters.some(f => f.name.toLowerCase() === s.skill.toLowerCase());
                return `
                            <div style="display:flex; justify-content:space-between; align-items:center; ${isRequired ? 'background:var(--bg-hover); padding:2px 4px; border-radius:4px' : ''}">
                                <span style="font-size:0.85rem; ${isRequired ? 'font-weight:600' : ''}">${hl(s.skill, searchQuery)}</span>
                                ${renderStars(s.rating)}
                            </div>
                        `}).join('')}
                    ${staff.skills?.length > 5 ? `<div style="font-size:0.75rem; color:var(--text-muted); text-align:center; margin-top:0.25rem">+ ${staff.skills.length - 5} more skills</div>` : ''}
                </div>
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

