'use strict';
const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

// Session secret + very simple in-memory session (acceptable since we just need basic auth context for prototype)
// For a production app, we would use JWT or a proper session store hooked into SQLite.
// Since the frontend is a SPA without a build step, returning a token is easiest.
const sessions = new Map(); // token -> user data

function generateToken() {
    return require('crypto').randomBytes(32).toString('hex');
}

function requireCoordinator(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = sessions.get(token);
    if (user.role !== 'admin' && user.role !== 'coordinator' && !user.is_coordinator) {
        return res.status(403).json({ error: 'Forbidden: Requires Coordinator role' });
    }
    req.user = user;
    next();
}

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const key = email.trim().toLowerCase();

        // Hardcoded Admin
        if (key === 'admin' || key === 'admin@stafftrack.local') {
            const token = generateToken();
            const user = { email: 'admin', role: 'admin' };
            sessions.set(token, user);
            return res.json({ token, user });
        }

        // Normal staff login (we check user_roles table if they have HR/Coord overrides)
        const db = getDb();
        const roleRow = db.prepare('SELECT * FROM user_roles WHERE email = ?').get(key);

        let is_hr = false;
        let is_coordinator = false;

        if (roleRow) {
            is_hr = !!roleRow.is_hr;
            is_coordinator = !!roleRow.is_coordinator;
        }

        const token = generateToken();
        const user = {
            email: key,
            role: is_hr ? 'hr' : (is_coordinator ? 'coordinator' : 'staff'),
            is_hr,
            is_coordinator
        };

        sessions.set(token, user);
        res.json({ token, user });

    } catch (err) {
        console.error('POST /auth/login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.json({ user: sessions.get(token) });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) sessions.delete(token);
    res.json({ success: true });
});

module.exports = { router, sessions, requireCoordinator };
