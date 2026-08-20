/**
 * StaffTrack Theme Manager
 * 
 * Handles dark/light mode toggle with localStorage persistence.
 * Initialize theme ASAP to prevent flash of wrong theme.
 */

'use strict';

const ThemeManager = {
    /** Storage key for theme preference */
    STORAGE_KEY: 'stafftrack_theme',

    /** Current theme */
    currentTheme: 'light',

    /**
     * Initialize the theme manager
     * Should be called as early as possible to prevent FOUC
     */
    init() {
        this.currentTheme = this.get();
        this.apply(this.currentTheme);
    },

    /**
     * Apply theme to document
     * 
     * @param {string} theme - 'light' or 'dark'
     */
    apply(theme) {
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        this.currentTheme = theme;
        this.updateToggleButtons();
    },

    /**
     * Get current theme from localStorage
     * 
     * @returns {string} 'light' or 'dark'
     */
    get() {
        return localStorage.getItem(this.STORAGE_KEY) || 'light';
    },

    /**
     * Toggle between light and dark mode
     * 
     * @returns {string} The new theme
     */
    toggle() {
        const next = this.currentTheme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(this.STORAGE_KEY, next);
        this.apply(next);
        return next;
    },

    /**
     * Set a specific theme
     * 
     * @param {string} theme - 'light' or 'dark'
     */
    set(theme) {
        if (theme !== 'light' && theme !== 'dark') return;
        localStorage.setItem(this.STORAGE_KEY, theme);
        this.apply(theme);
    },

    /**
     * Update all theme toggle buttons to reflect current state
     */
    updateToggleButtons() {
        const isDark = this.currentTheme === 'dark';
        
        // Update all theme toggle buttons
        document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
            const icon = btn.querySelector('.theme-icon');
            const label = btn.querySelector('.theme-label');
            
            if (icon) {
                icon.textContent = isDark ? '☀️' : '🌙';
            }
            if (label) {
                label.textContent = isDark ? 'Light' : 'Dark';
            }
            btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
        });

        // Legacy support - update old theme toggle button
        const legacyBtn = document.getElementById('theme-toggle');
        if (legacyBtn) {
            legacyBtn.innerHTML = isDark ? '☀️' : '🌙';
            legacyBtn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
        }
    },

    /**
     * Check if current theme is dark
     * 
     * @returns {boolean}
     */
    isDark() {
        return this.currentTheme === 'dark';
    },

    /**
     * Check system preference for dark mode
     * 
     * @returns {boolean}
     */
    prefersDark() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    },

    /**
     * Listen for system theme changes
     * 
     * @param {Function} callback - Called when system theme changes
     */
    onSystemThemeChange(callback) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            callback(e.matches ? 'dark' : 'light');
        });
    }
};

// Apply theme immediately (before DOMContentLoaded) to prevent flash
ThemeManager.init();
