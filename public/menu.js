'use strict';

/**
 * Shared Menu Component
 * Renders the navigation menu based on user role and permissions.
 * Use this instead of defining renderNav in each page's JS file.
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
    const showSkills = isAdmin || isHR || isCoordinator;
    const showStaff = isAdmin || isHR;

    let html = '';

    // My CV - visible to all roles
    html += `<a href="/cv-profile.html" class="nav-link ${activeTab === 'cv-profile' ? 'active' : ''}">📄 My CV</a>`;

    // Common links
    html += `<a href="/projects.html" class="nav-link ${activeTab === 'projects' ? 'active' : ''}">🗂 Projects</a>`;
    html += `<a href="/orgchart.html" class="nav-link ${activeTab === 'orgchart' ? 'active' : ''}">🌳 Org Chart</a>`;
    if (showStaff) {
        html += `<a href="/gantt.html" class="nav-link ${activeTab === 'gantt' ? 'active' : ''}">📊 Gantt Charts</a>`;
    }

    // Skills link - visible to admin, HR, coordinator
    if (showSkills) {
        html += `<a href="/skills.html" class="nav-link ${activeTab === 'skills' ? 'active' : ''}">📊 Skills</a>`;
    }

    // All Staff link - visible to admin and HR
    if (showStaff) {
        html += `<a href="/staff-view.html" class="nav-link ${activeTab === 'staff' ? 'active' : ''}">👥 All Staff</a>`;
    }

    // Admin-only section (with visual separator)
    if (isAdmin) {
        html += `<span style="width:1px; height:24px; background:var(--border); margin:0 0.25rem; display:inline-block; vertical-align:middle; opacity:0.5;"></span>`;
        html += `<a href="/catalog.html" class="nav-link ${activeTab === 'catalog' ? 'active' : ''}">⚙️ Catalog</a>`;
        html += `<a href="/cv-template-editor.html" class="nav-link ${activeTab === 'cv-template-editor' ? 'active' : ''}">📋 CV Templates</a>`;
        html += `<a href="/system.html" class="nav-link ${activeTab === 'system' ? 'active' : ''}">💻 System</a>`;
        html += `<a href="/admin.html" class="nav-link ${activeTab === 'admin' ? 'active' : ''}">🛡️ Admin</a>`;
    }

    // Right-aligned user info and logout
    html += `<div style="margin-left:auto;display:flex;align-items:center;gap:1rem">
      <span style="font-size:0.8rem;color:var(--text-secondary)">${authUser.email}</span>
      <button class="btn-secondary" id="btn-logout" style="padding:.3rem .6rem;font-size:0.75rem">Logout</button>
    </div>`;

    nav.innerHTML = html;

    // Attach logout handler
    document.getElementById('btn-logout')?.addEventListener('click', () => {
        sessionStorage.clear();
        location.href = '/login.html';
    });
}

/**
 * Check authentication and redirect if not logged in.
 * Call this at the start of each page's JS file.
 * 
 * @returns {Object|null} The authenticated user object, or null if not authenticated
 */
function requireAuth() {
    const token = sessionStorage.getItem('st_token');
    const userStr = sessionStorage.getItem('st_user');

    if (!token || !userStr) {
        location.href = '/login.html';
        return null;
    }

    try {
        return JSON.parse(userStr);
    } catch {
        location.href = '/login.html';
        return null;
    }
}

/**
 * Check if user has admin role and redirect if not.
 * 
 * @param {Object} authUser - The authenticated user object
 * @returns {boolean} True if user is admin, false otherwise
 */
function requireAdmin(authUser) {
    if (!authUser || !authUser.isAdmin) {
        location.href = '/';
        return false;
    }
    return true;
}

/**
 * Check if user has required permissions (admin, HR, or coordinator).
 * Redirects if user doesn't have any of the specified roles.
 * 
 * @param {Object} authUser - The authenticated user object
 * @param {string[]} requiredRoles - Array of roles to check ('admin', 'hr', 'coordinator')
 * @returns {boolean} True if user has required permission, false otherwise
 */
function requirePermission(authUser, requiredRoles = []) {
    if (!authUser) {
        location.href = '/login.html';
        return false;
    }

    const hasRole = requiredRoles.some(role => {
        switch (role) {
            case 'admin':
                return authUser.isAdmin === true;
            case 'hr':
                return authUser.is_hr === true || authUser.is_hr === 1;
            case 'coordinator':
                return authUser.is_coordinator === true || authUser.is_coordinator === 1;
            default:
                return false;
        }
    });

    if (!hasRole && requiredRoles.length > 0) {
        location.href = '/';
        return false;
    }

    return true;
}
