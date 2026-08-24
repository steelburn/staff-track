'use strict';

// ── Token Management ────────────────────────────────────────────────────────────
window.StaffTrackAuth = {
    getToken: function() {
        return sessionStorage.getItem('st_token');
    },

    getRefreshToken: function() {
        return sessionStorage.getItem('st_refresh_token');
    },

    getUser: function() {
        var userStr = sessionStorage.getItem('st_user');
        if (!userStr) return null;
        try {
            return JSON.parse(userStr);
        } catch {
            return null;
        }
    },

    setTokens: function(accessToken, refreshToken, user) {
        sessionStorage.setItem('st_token', accessToken);
        if (refreshToken) {
            sessionStorage.setItem('st_refresh_token', refreshToken);
        }
        // Preserve existing user data (like name) if not provided in new user object
        const existingUser = this.getUser();
        const mergedUser = Object.assign({}, existingUser || {}, user);
        sessionStorage.setItem('st_user', JSON.stringify(mergedUser));
        
        // Store expiry time (7 hours from now - gives 1 hour buffer before actual 8h expiry)
        var expiresAt = Date.now() + (7 * 60 * 60 * 1000);
        sessionStorage.setItem('st_token_expires_at', expiresAt.toString());
    },

    clearTokens: function() {
        sessionStorage.removeItem('st_token');
        sessionStorage.removeItem('st_refresh_token');
        sessionStorage.removeItem('st_user');
        sessionStorage.removeItem('st_token_expires_at');
    },

    isTokenExpired: function() {
        var expiresAt = sessionStorage.getItem('st_token_expires_at');
        if (!expiresAt) return true;
        return Date.now() > parseInt(expiresAt);
    },

    // ── API Helper ──────────────────────────────────────────────────────────────
    _refreshPromise: null,

    refreshToken: async function() {
        if (this._refreshPromise) return this._refreshPromise;

        var refreshToken = this.getRefreshToken();
        if (!refreshToken) {
            return null;
        }

        console.log('Refreshing token...');
        this._refreshPromise = (async () => {
            try {
                var res = await fetch('/api/auth/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken: refreshToken })
                });

                if (!res.ok) {
                    console.error('Token refresh request failed');
                    return null;
                }

                var data = await res.json();
                console.log('Token refresh successful');
                this.setTokens(data.accessToken, null, data.user);
                return data.accessToken;
            } catch (err) {
                console.error('Token refresh failed:', err);
                return null;
            } finally {
                this._refreshPromise = null;
            }
        })();

        return this._refreshPromise;
    },

    apiFetch: async function(url, options) {
        options = options || {};
        
        // Check if token needs refresh
        if (this.isTokenExpired()) {
            console.log('Token expired or missing, attempting refresh for:', url);
            var newToken = await this.refreshToken();
            if (!newToken) {
                // Token refresh failed, redirect to login
                console.warn('Token refresh failed, redirecting to login');
                this.clearTokens();
                location.href = '/login.html';
                throw new Error('Session expired. Please log in again.');
            }
        }

        // Add authorization header if not present
        if (!options.headers) {
            options.headers = {};
        }
        
        // Case-insensitive check for Authorization header
        const hasAuth = Object.keys(options.headers).some(k => k.toLowerCase() === 'authorization');
        
        if (!hasAuth) {
            const token = this.getToken();
            console.log('Adding Auth Header for URL:', url, 'Token exists:', !!token);
            options.headers['Authorization'] = 'Bearer ' + token;
        }

        console.log('Final Fetch Headers for:', url, options.headers);
        return fetch(url, options);
    },

    // ── Initialization Check ───────────────────────────────────────────────────
    checkAuth: function() {
        var token = this.getToken();
        var userStr = sessionStorage.getItem('st_user');

        try {
            var user = JSON.parse(userStr);
            if (user.role !== 'admin') {
                location.href = '/';
                throw new Error('Not admin');
            }
        } catch {
            location.href = '/login.html';
            throw new Error('Invalid user data');
        }
    }
};

// ── Legacy Auth Helpers ────────────────────────────────────────────────────────
// Global functions for backward compatibility with pages using requireAuth/requireAdmin

/**
 * Check authentication and redirect if not logged in.
 * @returns {Object|null} The authenticated user object, or null if not authenticated
 */
function requireAuth() {
    var token = sessionStorage.getItem('st_token');
    var userStr = sessionStorage.getItem('st_user');

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
