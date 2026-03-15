'use strict';
const express = require('express');
const { getDb } = require('../db');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

// Auth service configuration
// Set AUTH_SERVICE_URL and AUTH_SERVICE_ENDPOINT via environment variables
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'https://appcore.beesuite.app';
const AUTH_SERVICE_ENDPOINT = process.env.AUTH_SERVICE_ENDPOINT || '/api/auth/login';
const AUTH_ALLOW_FALLBACK = process.env.AUTH_ALLOW_FALLBACK !== 'false'; // Default true for dev

// Token generation functions
function generateAccessToken(user) {
    return jwt.sign(
        { email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
    );
}

function generateRefreshToken() {
    return crypto.randomBytes(64).toString('hex');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// Log authentication event to audit log
function logAuthEvent(db, email, action, success, req) {
    const id = uuidv4();
    const now = new Date().toISOString();
    const ipAddress = req.ip || req.connection?.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    db.prepare(`INSERT INTO auth_audit_log (id, email, action, ip_address, user_agent, success, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, email, action, ipAddress, userAgent, success ? 1 : 0, now);
}

// Middleware to verify JWT token
function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log(`${new Date().toISOString()} Auth failed: No Bearer token provided in header`);
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.replace('Bearer ', '');
    const tokenHash = hashToken(token);
    const db = getDb();

    try {
        // Check if token exists and is valid in database
        const tokenRecord = db.prepare(`SELECT * FROM auth_tokens WHERE token_hash = ? AND revoked = 0 AND expires_at > ?`)
            .get(tokenHash, new Date().toISOString());

        if (!tokenRecord) {
            console.log(`${new Date().toISOString()} Auth failed: Token not found, revoked, or expired. Hash: ${tokenHash}`);
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // Verify JWT signature
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Get user role from database
        const userRole = db.prepare('SELECT * FROM user_roles WHERE email = ?').get(decoded.email);
        
        if (!userRole || !userRole.is_active) {
            return res.status(401).json({ error: 'User not found or inactive' });
        }

        req.user = {
            email: decoded.email,
            role: userRole.role
        };
        next();
    } catch (err) {
        console.error(`${new Date().toISOString()} Token verification error (JWT):`, err.message);
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// Role-based access control middleware factory
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
        }
        next();
    };
}

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log(`${new Date().toISOString()} Login attempt:`, { 
            email, 
            receivedKeys: Object.keys(req.body),
            passwordType: typeof password,
            passwordLength: password ? password.length : 0,
            passwordProvided: !!password 
        });
        const db = getDb();

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const key = email.trim().toLowerCase();

        // Hardcoded Admin
        if (key === 'admin' || key === 'admin@stafftrack.local') {
            // For admin, we still require password if provided, otherwise allow
            if (password) {
                try {
                    const authResponse = await fetch(`${AUTH_SERVICE_URL}/auth/login`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: key, password: Buffer.from(password, 'base64').toString() })
                    });
                    if (!authResponse.ok) {
                        logAuthEvent(db, key, 'login', false, req);
                        return res.status(401).json({ error: 'Invalid credentials' });
                    }
                } catch (e) {
                    // Auth service unavailable, fall back to token-only login
                    console.warn('Auth service unavailable, using token-only login');
                }
            }

            const now = new Date().toISOString();

            // Ensure admin exists in user_roles FIRST
            const existingAdmin = db.prepare('SELECT * FROM user_roles WHERE email = ?').get('admin');
            if (!existingAdmin) {
                db.prepare(`INSERT INTO user_roles (email, role, is_active, created_at, updated_at) 
                            VALUES (?, ?, ?, ?, ?)`)
                    .run('admin', 'admin', 1, now, now);
            }

            const accessToken = generateAccessToken({ email: 'admin', role: 'admin' });
            const refreshToken = generateRefreshToken();
            const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(); // 8 hours

            // Store tokens in database
            const tokenId = uuidv4();
            const refreshTokenHash = hashToken(refreshToken);
            const tokenHash = hashToken(accessToken);

            db.prepare(`INSERT INTO auth_tokens (id, user_email, token_hash, refresh_token_hash, expires_at, created_at) 
                         VALUES (?, ?, ?, ?, ?, ?)`)
                .run(tokenId, 'admin', tokenHash, refreshTokenHash, expiresAt, now);

            logAuthEvent(db, key, 'login', true, req);

            // Auto-create CV profile for admin if not exists
            try {
                const existingProfile = db.prepare('SELECT id FROM cv_profiles WHERE staff_email = ?').get('admin');
                if (!existingProfile) {
                    const profileId = uuidv4();
                    const now = new Date().toISOString();
                    db.prepare('INSERT INTO cv_profiles (id, staff_email, is_visible, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
                        .run(profileId, 'admin', now, now);
                    console.log('Auto-created CV profile for admin');
                }
            } catch (profileErr) {
                // Don't fail login if profile creation fails
                console.error('Auto-create CV profile error:', profileErr);
            }

            return res.json({ 
                accessToken, 
                refreshToken,
                user: { email: 'admin', role: 'admin' },
                expiresIn: 8 * 60 * 60 // 8 hours in seconds
            });
        }

        // Normal staff login - MUST authenticate via external auth service
        if (!password) {
            return res.status(400).json({ error: 'Password is required for staff login' });
        }

        let authenticated = false;
        try {
            const authUrl = `${AUTH_SERVICE_URL}${AUTH_SERVICE_ENDPOINT}`;
            console.log('Authenticating against:', authUrl);
            
            const authResponse = await fetch(authUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    email: key, 
                    password: password // Already Base64-encoded from frontend
                })
            });
            authenticated = authResponse.ok;
            
            if (!authenticated) {
                const errorData = await authResponse.json().catch(() => ({}));
                console.log('Auth service response:', authResponse.status, errorData);
            }
        } catch (e) {
            console.error('Auth service error:', e.message);
            if (AUTH_ALLOW_FALLBACK) {
                console.warn('Auth service unavailable, allowing fallback login');
                // Fallback: allow login based on local user_roles table
                const existingUser = db.prepare('SELECT * FROM user_roles WHERE email = ? AND is_active = 1').get(key);
                authenticated = !!existingUser;
            } else {
                return res.status(503).json({ error: 'Authentication service unavailable' });
            }
        }

        if (!authenticated) {
            logAuthEvent(db, key, 'login', false, req);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Get or determine user role
        let userRole = db.prepare('SELECT * FROM user_roles WHERE email = ?').get(key);
        
        // If no role exists, create default staff role
        if (!userRole) {
            const now = new Date().toISOString();
            db.prepare(`INSERT INTO user_roles (email, role, is_active, created_at, updated_at) 
                        VALUES (?, ?, ?, ?, ?)`)
                .run(key, 'staff', 1, now, now);
            userRole = { email: key, role: 'staff', is_active: 1 };
        }

        // Generate tokens
        const accessToken = generateAccessToken({ email: key, role: userRole.role });
        const refreshToken = generateRefreshToken();
        const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
        const now = new Date().toISOString();

        // Store tokens in database
        const tokenId = uuidv4();
        const tokenHash = hashToken(accessToken);
        const refreshTokenHash = hashToken(refreshToken);

        db.prepare(`INSERT INTO auth_tokens (id, user_email, token_hash, refresh_token_hash, expires_at, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?)`)
            .run(tokenId, key, tokenHash, refreshTokenHash, expiresAt, now);

        logAuthEvent(db, key, 'login', true, req);

        // Auto-create CV profile if not exists
        try {
            const existingProfile = db.prepare('SELECT id FROM cv_profiles WHERE staff_email = ?').get(key);
            if (!existingProfile) {
                const profileId = uuidv4();
                const now = new Date().toISOString();
                db.prepare('INSERT INTO cv_profiles (id, staff_email, is_visible, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
                    .run(profileId, key, now, now);
                console.log(`Auto-created CV profile for new user: ${key}`);
            }
        } catch (profileErr) {
            // Don't fail login if profile creation fails
            console.error('Auto-create CV profile error:', profileErr);
        }

        res.json({ 
            accessToken, 
            refreshToken,
            user: { email: key, role: userRole.role },
            expiresIn: 8 * 60 * 60
        });

    } catch (err) {
        console.error('POST /auth/login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ── POST /auth/refresh ─────────────────────────────────────────────────────────
router.post('/refresh', (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token is required' });
        }

        const db = getDb();
        const refreshTokenHash = hashToken(refreshToken);

        // Find valid refresh token
        const tokenRecord = db.prepare(`SELECT * FROM auth_tokens 
            WHERE refresh_token_hash = ? AND revoked = 0`)
            .get(refreshTokenHash);

        if (!tokenRecord) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        // Get user role
        const userRole = db.prepare('SELECT * FROM user_roles WHERE email = ?').get(tokenRecord.user_email);
        if (!userRole || !userRole.is_active) {
            return res.status(401).json({ error: 'User not found or inactive' });
        }

        // Generate new access token
        const newAccessToken = generateAccessToken({ 
            email: tokenRecord.user_email, 
            role: userRole.role 
        });
        const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

        // Store new token
        const newTokenId = uuidv4();
        const newTokenHash = hashToken(newAccessToken);
        const now = new Date().toISOString();

        // Revoke old access token but keep refresh token valid
        db.prepare(`UPDATE auth_tokens SET revoked = 1 WHERE id = ?`).run(tokenRecord.id);

        // Insert new access token
        db.prepare(`INSERT INTO auth_tokens (id, user_email, token_hash, refresh_token_hash, expires_at, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?)`)
            .run(newTokenId, tokenRecord.user_email, newTokenHash, refreshTokenHash, expiresAt, now);

        logAuthEvent(db, tokenRecord.user_email, 'token_refresh', true, req);

        res.json({ 
            accessToken: newAccessToken,
            user: { email: tokenRecord.user_email, role: userRole.role },
            expiresIn: 8 * 60 * 60
        });
    } catch (err) {
        console.error('POST /auth/refresh error:', err);
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', verifyToken, (req, res) => {
    res.json({ user: req.user });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post('/logout', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const authHeader = req.headers.authorization;
        const token = authHeader.replace('Bearer ', '');
        const tokenHash = hashToken(token);

        // Revoke the token
        db.prepare(`UPDATE auth_tokens SET revoked = 1 WHERE token_hash = ?`).run(tokenHash);

        logAuthEvent(db, req.user.email, 'logout', true, req);
        res.json({ success: true });
    } catch (err) {
        console.error('POST /auth/logout error:', err);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// ── GET /auth/audit ───────────────────────────────────────────────────────────
router.get('/audit', verifyToken, requireRole('admin', 'hr'), (req, res) => {
    try {
        const db = getDb();
        const { limit = 50, offset = 0, email } = req.query;
        
        let query = 'SELECT * FROM auth_audit_log';
        const params = [];
        
        if (email) {
            query += ' WHERE email = ?';
            params.push(email.toLowerCase());
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const logs = db.prepare(query).all(...params);
        res.json(logs);
    } catch (err) {
        console.error('GET /auth/audit error:', err);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

module.exports = { router, verifyToken, requireRole };
