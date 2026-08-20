/**
 * StaffTrack Toast Notification Component
 * 
 * Provides toast notifications for user feedback.
 * Supports different types: success, error, warning, info.
 */

'use strict';

const Toast = {
    /** Default duration in milliseconds */
    DEFAULT_DURATION: 3000,

    /** Container element */
    container: null,

    /**
     * Initialize the toast system
     */
    init() {
        // Create container if it doesn't exist
        this.container = document.getElementById('toast-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    },

    /**
     * Show a toast notification
     * 
     * @param {Object} options - Toast options
     * @param {string} options.type - 'success', 'error', 'warning', 'info'
     * @param {string} options.title - Toast title
     * @param {string} [options.message] - Optional message
     * @param {number} [options.duration] - Duration in ms (0 = no auto-close)
     * @param {boolean} [options.closable] - Show close button (default: true)
     * @returns {HTMLElement} The toast element
     */
    show(options) {
        if (!this.container) {
            this.init();
        }

        const {
            type = 'info',
            title = '',
            message = '',
            duration = this.DEFAULT_DURATION,
            closable = true
        } = options;

        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        // Icon mapping
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        // Build toast HTML
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                ${message ? `<div class="toast-message">${message}</div>` : ''}
            </div>
            ${closable ? `
                <button class="toast-close" aria-label="Close notification">✕</button>
            ` : ''}
        `;

        // Bind close button
        if (closable) {
            const closeBtn = toast.querySelector('.toast-close');
            closeBtn.addEventListener('click', () => this.dismiss(toast));
        }

        // Add to container
        this.container.appendChild(toast);

        // Auto-dismiss
        if (duration > 0) {
            setTimeout(() => this.dismiss(toast), duration);
        }

        return toast;
    },

    /**
     * Dismiss a toast notification
     * 
     * @param {HTMLElement} toast - The toast element to dismiss
     */
    dismiss(toast) {
        if (!toast || !toast.parentNode) return;

        toast.classList.add('hiding');
        
        // Remove after animation
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    },

    /**
     * Show a success toast
     * 
     * @param {string} title - Toast title
     * @param {string} [message] - Optional message
     * @param {number} [duration] - Duration in ms
     */
    success(title, message, duration) {
        return this.show({ type: 'success', title, message, duration });
    },

    /**
     * Show an error toast
     * 
     * @param {string} title - Toast title
     * @param {string} [message] - Optional message
     * @param {number} [duration] - Duration in ms (0 = no auto-close)
     */
    error(title, message, duration = 0) {
        return this.show({ type: 'error', title, message, duration });
    },

    /**
     * Show a warning toast
     * 
     * @param {string} title - Toast title
     * @param {string} [message] - Optional message
     * @param {number} [duration] - Duration in ms
     */
    warning(title, message, duration) {
        return this.show({ type: 'warning', title, message, duration });
    },

    /**
     * Show an info toast
     * 
     * @param {string} title - Toast title
     * @param {string} [message] - Optional message
     * @param {number} [duration] - Duration in ms
     */
    info(title, message, duration) {
        return this.show({ type: 'info', title, message, duration });
    },

    /**
     * Clear all toast notifications
     */
    clearAll() {
        if (!this.container) return;
        
        const toasts = this.container.querySelectorAll('.toast');
        toasts.forEach(toast => this.dismiss(toast));
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    Toast.init();
});
