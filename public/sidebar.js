/**
 * StaffTrack Sidebar Component
 * 
 * Handles sidebar navigation, collapse state, mobile responsiveness,
 * and role-based menu visibility.
 */

'use strict';

const Sidebar = {
    /** Storage key for sidebar state */
    STORAGE_KEY: 'st_sidebar_collapsed',

    /** Current state */
    isCollapsed: false,
    isMobileOpen: false,

    /**
     * Initialize the sidebar
     */
    init() {
        // Load saved state
        this.isCollapsed = localStorage.getItem(this.STORAGE_KEY) === 'true';
        
        // Apply initial state
        const sidebar = document.getElementById('sidebar');
        if (sidebar && this.isCollapsed) {
            sidebar.classList.add('collapsed');
        }

        // Bind events
        this.bindEvents();
    },

    /**
     * Bind all event listeners
     */
    bindEvents() {
        // Toggle button
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggle());
        }

        // Mobile menu button
        const mobileBtn = document.getElementById('mobileMenuBtn');
        if (mobileBtn) {
            mobileBtn.addEventListener('click', () => this.toggleMobile());
        }

        // Close mobile sidebar on overlay click
        const overlay = document.getElementById('sidebarOverlay');
        if (overlay) {
            overlay.addEventListener('click', () => this.closeMobile());
        }

        // Close mobile sidebar on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isMobileOpen) {
                this.closeMobile();
            }
        });

        // Handle resize
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768 && this.isMobileOpen) {
                this.closeMobile();
            }
        });
    },

    /**
     * Toggle sidebar collapse state (desktop)
     */
    toggle() {
        const sidebar = document.getElementById('sidebar');
        const toggleBtn = document.getElementById('sidebarToggle');
        
        if (!sidebar) return;

        this.isCollapsed = !this.isCollapsed;
        sidebar.classList.toggle('collapsed', this.isCollapsed);
        
        // Update toggle button icon
        if (toggleBtn) {
            toggleBtn.textContent = this.isCollapsed ? '▶' : '◀';
        }

        // Save state
        localStorage.setItem(this.STORAGE_KEY, this.isCollapsed);
    },

    /**
     * Toggle mobile sidebar
     */
    toggleMobile() {
        if (this.isMobileOpen) {
            this.closeMobile();
        } else {
            this.openMobile();
        }
    },

    /**
     * Open mobile sidebar
     */
    openMobile() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        this.isMobileOpen = true;
        sidebar.classList.add('mobile-open');
        document.body.style.overflow = 'hidden';
    },

    /**
     * Close mobile sidebar
     */
    closeMobile() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        this.isMobileOpen = false;
        sidebar.classList.remove('mobile-open');
        document.body.style.overflow = '';
    },

    /**
     * Render the sidebar navigation based on user role
     * 
     * @param {Object} user - The authenticated user object
     * @param {string} activeTab - The currently active tab/page
     */
    render(user, activeTab) {
        const nav = document.getElementById('sidebar-nav');
        if (!nav || !user) return;

        const isAdmin = user.isAdmin === true;
        const isHR = user.is_hr === true || user.is_hr === 1;
        const isCoordinator = user.is_coordinator === true || user.is_coordinator === 1;
        const hasFullAccess = isAdmin || isHR || isCoordinator;
        const showStaff = isAdmin || isHR;
        // Cached by fetchSubordinateCount() (menu.js) on login/page load; used to
        // surface manager-only nav items without an extra fetch on every render.
        const subordinateCount = parseInt(sessionStorage.getItem('st_subordinate_count') || '0', 10);

        let html = '';

        // Main Section
        html += `
            <div class="nav-section">
                <div class="nav-section-label">Main</div>
                ${this.renderNavItem('📄', 'My CV', '/cv-profile.html', activeTab === 'cv-profile')}
                ${this.renderNavItem('🗂', 'Projects', '/projects.html', activeTab === 'projects', '', 'projects')}
                ${this.renderNavItem('📊', 'Skills', '/skills.html', activeTab === 'skills')}
                ${this.renderNavItem('🌳', 'Org Chart', '/orgchart.html', activeTab === 'orgchart')}
                ${subordinateCount > 0 && !hasFullAccess ? this.renderNavItem('📈', 'Dashboard', '/reporting.html', activeTab === 'reporting') : ''}
                ${hasFullAccess ? this.renderNavItem('📈', 'Gantt Charts', '/gantt.html', activeTab === 'gantt') : ''}
            </div>
        `;

        // Management Section (for authorized roles)
        if (showStaff || hasFullAccess) {
            html += '<div class="nav-divider"></div>';
            html += `
                <div class="nav-section">
                    <div class="nav-section-label">Management</div>
                    ${(showStaff || hasFullAccess) ? this.renderNavItem('📊', 'Dashboard', '/reporting.html', activeTab === 'reporting') : ''}
                    ${(showStaff || hasFullAccess) ? this.renderNavItem('🗺️', 'Department × Project Analysis', '/dept-project-map.html', activeTab === 'dept-project-map') : ''}
                    ${showStaff ? this.renderNavItem('👥', 'All Staff', '/staff-view.html', activeTab === 'staff', '', 'staff') : ''}
                    ${showStaff ? this.renderNavItem('🏅', 'Certifications', '/certifications.html', activeTab === 'certifications') : ''}
                    ${isAdmin ? this.renderNavItem('⚙️', 'Catalog', '/catalog.html', activeTab === 'catalog') : ''}
                    ${isAdmin ? this.renderNavItem('📋', 'CV Templates', '/cv-template-editor.html', activeTab === 'cv-template-editor') : ''}
                    ${isAdmin ? this.renderNavItem('💻', 'System', '/system.html', activeTab === 'system') : ''}
                    ${isAdmin ? this.renderNavItem('🛡️', 'Admin', '/admin.html', activeTab === 'admin') : ''}
                </div>
            `;
        }

        // Bottom section — API Access is a self-service developer console; keep
        // it as the LAST nav entry (below all role/work links) for every user.
        html += '<div class="nav-divider"></div>';
        html += `
            <div class="nav-section">
                <div class="nav-section-label">Developer</div>
                ${this.renderNavItem('🔌', 'API Access', '/api-access.html', activeTab === 'api-access')}
            </div>
        `;

        nav.innerHTML = html;

        // Bind nav item clicks
        nav.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const href = item.getAttribute('href');
                if (href) {
                    window.location.href = href;
                }
            });
        });

        // Theme toggle binding for the new layout (legacy renderNav in menu.js
        // binds its own copy for old pages). Without this the [data-theme-toggle]
        // button is DEAD on every sidebar page — the button existed but nothing
        // ever wired its click (2026-08-26).
        const themeBtn = document.querySelector('[data-theme-toggle]');
        if (themeBtn && !themeBtn.dataset.stThemeBound) {
            themeBtn.dataset.stThemeBound = '1';
            themeBtn.addEventListener('click', () => {
                if (typeof ThemeManager !== 'undefined') ThemeManager.toggle();
            });
        }

        // Populate the badges with live counts (fire-and-forget)
        this.refreshBadges(user);
        // Managers (no full access) may not have the cached subordinate count yet — probe once
        this.probeManagerNav(user, activeTab);
    },

    /**
     * Fetch live counts for the nav badges:
     * - All Staff: number of staff with updated entries (updated_by_staff = 1)
     * - Projects:  total projects in the catalog
     */
    async refreshBadges(user) {
        const setBadge = (key, val) => {
            const el = document.querySelector(`[data-nav-badge="${key}"]`);
            if (el) el.textContent = val;
        };
        try {
            if (!user) return;
            const isAdmin = user.isAdmin === true;
            const isHR = user.is_hr === true || user.is_hr === 1;
            const showStaff = isAdmin || isHR;
            if (!window.StaffTrackAuth || typeof window.StaffTrackAuth.apiFetch !== 'function') return;

            if (showStaff) {
                const res = await window.StaffTrackAuth.apiFetch('/api/reports/staff');
                if (res.ok) {
                    const rows = await res.json();
                    setBadge('staff', rows.filter(r => r.updatedByStaff).length);
                }
            }

            const projRes = await window.StaffTrackAuth.apiFetch('/api/catalog/projects');
            if (projRes.ok) {
                const projects = await projRes.json();
                setBadge('projects', Array.isArray(projects) ? projects.length : 0);
            }
        } catch (err) {
            // Badges stay hidden if the fetch fails — never break the page
            console.error('Sidebar badge refresh failed:', err);
        }
    },

    /**
     * Managers without full access get the Dashboard nav item only when they
     * actually have subordinates. st_subordinate_count is cached by
     * fetchSubordinateCount() (menu.js); if it is missing/stale, probe the API
     * once and inject the item when the count resolves (fire-and-forget).
     */
    async probeManagerNav(user, activeTab) {
        if (!user) return;
        const isAdmin = user.isAdmin === true;
        const isHR = user.is_hr === true || user.is_hr === 1;
        const isCoordinator = user.is_coordinator === true || user.is_coordinator === 1;
        if (isAdmin || isHR || isCoordinator) return;
        const cached = parseInt(sessionStorage.getItem('st_subordinate_count') || '0', 10);
        if (cached > 0) return; // already rendered by render()
        try {
            const res = await window.StaffTrackAuth.apiFetch('/api/reports/my-subordinates');
            if (!res.ok) return;
            const data = await res.json();
            const count = data.count || 0;
            sessionStorage.setItem('st_subordinate_count', String(count));
            if (count > 0) {
                const nav = document.getElementById('sidebar-nav');
                const existing = nav && nav.querySelector('a[href="/reporting.html"]');
                if (nav && !existing) {
                    const section = nav.querySelector('.nav-section');
                    if (section) {
                        section.insertAdjacentHTML('beforeend',
                            this.renderNavItem('📈', 'Dashboard', '/reporting.html', activeTab === 'reporting'));
                    }
                }
            }
        } catch (err) {
            // Nav item just stays hidden — never break the page
            console.error('Sidebar manager probe failed:', err);
        }
    },

    /**
     * Render a single nav item
     * 
     * @param {string} icon - Emoji icon
     * @param {string} label - Display label
     * @param {string} href - Link URL
     * @param {boolean} isActive - Whether this item is active
     * @param {number|string} [badge] - Optional badge count (rendered when !== undefined)
     * @param {string} [badgeId] - data-nav-badge key so refreshBadges can target it
     * @returns {string} HTML string
     */
    renderNavItem(icon, label, href, isActive, badge, badgeId) {
        const activeClass = isActive ? ' active' : '';
        const badgeHtml = (badge !== undefined)
            ? `<span class="nav-badge" data-nav-badge="${badgeId || ''}">${badge || ''}</span>`
            : '';

        return `
            <a href="${href}" class="nav-item${activeClass}">
                <span class="nav-icon">${icon}</span>
                <span class="nav-label">${label}</span>
                ${badgeHtml}
            </a>
        `;
    },

    /**
     * Render the user card in sidebar footer
     * 
     * @param {Object} user - The authenticated user object
     */
    renderUserCard(user) {
        const userCard = document.getElementById('sidebar-user-card');
        if (!userCard || !user) return;

        const initials = this.getInitials(user.name || user.email);
        const role = this.getRoleLabel(user);

        userCard.innerHTML = `
            <div class="user-avatar">${initials}</div>
            <div class="user-info">
                <div class="user-name">${user.name || user.email}</div>
                <div class="user-role">${role}</div>
            </div>
            <button class="btn-logout-sidebar" id="btn-logout-sidebar" title="Logout">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
            </button>
        `;

        // Bind logout handler
        document.getElementById('btn-logout-sidebar')?.addEventListener('click', (e) => {
            e.stopPropagation();
            sessionStorage.clear();
            location.href = '/login.html';
        });
    },

    /**
     * Get initials from name or email
     * 
     * @param {string} nameOrEmail - Name or email address
     * @returns {string} Initials (max 2 characters)
     */
    getInitials(nameOrEmail) {
        if (!nameOrEmail) return '?';
        
        const parts = nameOrEmail.split(/[@.\s]+/).filter(Boolean);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return nameOrEmail.substring(0, 2).toUpperCase();
    },

    /**
     * Get human-readable role label
     * 
     * @param {Object} user - User object
     * @returns {string} Role label
     */
    getRoleLabel(user) {
        if (user.isAdmin) return 'Admin';
        if (user.is_hr) return 'HR';
        if (user.is_coordinator) return 'Coordinator';
        return 'Staff';
    }
};

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    Sidebar.init();
});
