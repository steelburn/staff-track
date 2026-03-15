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
