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
        sessionStorage.setItem('st_user', JSON.stringify(user));
        
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
    refreshToken: async function() {
        var refreshToken = this.getRefreshToken();
        if (!refreshToken) {
            return null;
        }

        try {
            var res = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: refreshToken })
            });

            if (!res.ok) {
                return null;
            }

            var data = await res.json();
            this.setTokens(data.accessToken, null, data.user);
            return data.accessToken;
        } catch (err) {
            console.error('Token refresh failed:', err);
            return null;
        }
    },

    apiFetch: async function(url, options) {
        options = options || {};
        
        // Check if token needs refresh
        if (this.isTokenExpired()) {
            var newToken = await this.refreshToken();
            if (!newToken) {
                // Token refresh failed, redirect to login
                this.clearTokens();
                location.href = '/login.html';
                throw new Error('Session expired. Please log in again.');
            }
        }

        // Add authorization header if not present
        if (!options.headers) {
            options.headers = {};
        }
        if (!options.headers.Authorization) {
            options.headers.Authorization = 'Bearer ' + this.getToken();
        }

        return fetch(url, options);
    },

    // ── Initialization Check ───────────────────────────────────────────────────
    checkAuth: function() {
        var token = this.getToken();
        var userStr = sessionStorage.getItem('st_user');

        if (!token || !userStr) {
            location.href = '/login.html';
            throw new Error('Not logged in');
        }

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
