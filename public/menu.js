'use strict';

/**
 * Shared Menu Component (Legacy Support)
 * 
 * Renders the navigation menu based on user role and permissions.
 * This file provides backward compatibility with existing pages.
 * New pages should use the Sidebar component directly.
 * 
 * @param {string} activeTab - The currently active tab/page identifier
 */
function renderNav(activeTab) {
    const nav = document.getElementById('main-nav');
    if (!nav) return;

    // Get user from session
    const userStr = sessionStorage.getItem('st_user');
    if (!userStr) return;

    let authUser;
    try {
        authUser = JSON.parse(userStr);
    } catch {
        return;
    }

    const isAdmin = authUser.isAdmin === true;
    const isHR = authUser.is_hr === true || authUser.is_hr === 1;
    const isCoordinator = authUser.is_coordinator === true || authUser.is_coordinator === 1;
    const hasFullAccess = isAdmin || isHR || isCoordinator;
    const showStaff = isAdmin || isHR;
    
    // Check if user has subordinates (stored in session)
    const subordinateCount = parseInt(sessionStorage.getItem('st_subordinate_count') || '0', 10);
    const showSkills = hasFullAccess || subordinateCount > 0;

    let html = '';

    // My CV - visible to all roles
    html += `<a href="/cv-profile.html" class="nav-link ${activeTab === 'cv-profile' ? 'active' : ''}">📄 My CV</a>`;

    // Common links
    html += `<a href="/projects.html" class="nav-link ${activeTab === 'projects' ? 'active' : ''}">🗂 Projects</a>`;
    html += `<a href="/orgchart.html" class="nav-link ${activeTab === 'orgchart' ? 'active' : ''}">🌳 Org Chart</a>`;
    // Reporting Dashboard - admin, HR, coordinator, or users with subordinates
    if (hasFullAccess || subordinateCount > 0) {
        html += `<a href="/reporting.html" class="nav-link ${activeTab === 'reporting' ? 'active' : ''}">📊 Dashboard</a>`;
    }
    if (showStaff) {
        html += `<a href="/gantt.html" class="nav-link ${activeTab === 'gantt' ? 'active' : ''}">📊 Gantt Charts</a>`;
        html += `<a href="/dept-project-map.html" class="nav-link ${activeTab === 'dept-project-map' ? 'active' : ''}">🗺️ Department × Project Analysis</a>`;
    }

    // Skills link - visible to admin, HR, coordinator, or users with subordinates
    if (showSkills) {
        const skillsLabel = hasFullAccess ? '📊 Skills' : '📊 My Team Skills';
        html += `<a href="/skills.html" class="nav-link ${activeTab === 'skills' ? 'active' : ''}">${skillsLabel}</a>`;
    }

    // All Staff link - visible to admin and HR
    if (showStaff) {
        html += `<a href="/staff-view.html" class="nav-link ${activeTab === 'staff' ? 'active' : ''}">👥 All Staff</a>`;
        html += `<a href="/certifications.html" class="nav-link ${activeTab === 'certifications' ? 'active' : ''}">🏅 Certifications</a>`;
    }

    // Admin-only section (with visual separator)
    if (isAdmin) {
        html += `<span style="width:1px; height:24px; background:var(--border); margin:0 0.25rem; display:inline-block; vertical-align:middle; opacity:0.5;"></span>`;
        html += `<a href="/catalog.html" class="nav-link ${activeTab === 'catalog' ? 'active' : ''}">⚙️ Catalog</a>`;
        html += `<a href="/cv-template-editor.html" class="nav-link ${activeTab === 'cv-template-editor' ? 'active' : ''}">📋 CV Templates</a>`;
        html += `<a href="/system.html" class="nav-link ${activeTab === 'system' ? 'active' : ''}">💻 System</a>`;
        html += `<a href="/admin.html" class="nav-link ${activeTab === 'admin' ? 'active' : ''}">🛡️ Admin</a>`;
    }

    // Right-aligned theme toggle, user info and logout
    const isDark = ThemeManager.isDark();
    const themeIcon = isDark ? '☀️' : '🌙';
    const themeTitle = isDark ? 'Switch to light mode' : 'Switch to dark mode';

    html += `<div style="margin-left:auto;display:flex;align-items:center;gap:1rem">
      <button class="btn-secondary" id="theme-toggle" title="${themeTitle}" style="padding:.3rem .6rem;font-size:0.85rem;line-height:1;border-radius:6px;min-width:34px;display:flex;align-items:center;justify-content:center">${themeIcon}</button>
      <span style="font-size:0.8rem;color:var(--text-secondary)">${authUser.email}</span>
      <button class="btn-secondary" id="btn-logout" style="padding:.3rem .6rem;font-size:0.75rem">Logout</button>
    </div>`;

    nav.innerHTML = html;

    // Attach logout handler
    document.getElementById('btn-logout')?.addEventListener('click', () => {
        sessionStorage.clear();
        location.href = '/login.html';
    });

    // Attach theme toggle handler
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
        ThemeManager.toggle();
    });
}



/**
 * Fetch and cache the user's subordinate count in session storage.
 * Call this on login or page load to enable the Skills page for managers.
 * 
 * @returns {Promise<number>} The number of subordinates
 */
async function fetchSubordinateCount() {
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/reports/my-subordinates');
        if (res.ok) {
            const data = await res.json();
            const count = data.count || 0;
            sessionStorage.setItem('st_subordinate_count', count.toString());
            return count;
        }
    } catch (err) {
        console.error('Failed to fetch subordinate count:', err);
    }
    return 0;
}




/**
 * Render sidebar navigation for new layout
 * This function bridges the old auth system with the new sidebar
 * 
 * @param {string} activeTab - The currently active tab/page
 */
function renderSidebarNav(activeTab) {
    const userStr = sessionStorage.getItem('st_user');
    if (!userStr) return;

    let authUser;
    try {
        authUser = JSON.parse(userStr);
    } catch {
        return;
    }

    // Use the new Sidebar component
    if (typeof Sidebar !== 'undefined') {
        Sidebar.render(authUser, activeTab);
        Sidebar.renderUserCard(authUser);
    }
}
