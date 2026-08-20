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

        let html = '';

        // Main Section
        html += `
            <div class="nav-section">
                <div class="nav-section-label">Main</div>
                ${this.renderNavItem('📄', 'My CV', '/cv-profile.html', activeTab === 'cv-profile')}
                ${this.renderNavItem('📋', 'My Projects', '/index.html', activeTab === 'index')}
                ${this.renderNavItem('🗂', 'Projects', '/projects.html', activeTab === 'projects', 12)}
                ${this.renderNavItem('📊', 'Skills', '/skills.html', activeTab === 'skills')}
                ${this.renderNavItem('🌳', 'Org Chart', '/orgchart.html', activeTab === 'orgchart')}
                ${hasFullAccess ? this.renderNavItem('📈', 'Gantt Charts', '/gantt.html', activeTab === 'gantt') : ''}
            </div>
        `;

        // Management Section (for authorized roles)
        if (showStaff || hasFullAccess) {
            html += '<div class="nav-divider"></div>';
            html += `
                <div class="nav-section">
                    <div class="nav-section-label">Management</div>
                    ${showStaff ? this.renderNavItem('👥', 'All Staff', '/staff-view.html', activeTab === 'staff', 48) : ''}
                    ${isAdmin ? this.renderNavItem('⚙️', 'Catalog', '/catalog.html', activeTab === 'catalog') : ''}
                    ${isAdmin ? this.renderNavItem('💻', 'System', '/system.html', activeTab === 'system') : ''}
                    ${isAdmin ? this.renderNavItem('🛡️', 'Admin', '/admin.html', activeTab === 'admin') : ''}
                </div>
            `;
        }

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
    },

    /**
     * Render a single nav item
     * 
     * @param {string} icon - Emoji icon
     * @param {string} label - Display label
     * @param {string} href - Link URL
     * @param {boolean} isActive - Whether this item is active
     * @param {number} [badge] - Optional badge count
     * @returns {string} HTML string
     */
    renderNavItem(icon, label, href, isActive, badge) {
        const activeClass = isActive ? ' active' : '';
        const badgeHtml = badge ? `<span class="nav-badge">${badge}</span>` : '';
        
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
        `;
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
