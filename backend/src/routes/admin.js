'use strict';
const express = require('express');
const { getDb } = require('../db');
const { sessions } = require('./auth');

const router = express.Router();

function requireAdmin(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const user = sessions.get(token);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Requires Admin role' });
    }
    next();
}

// ── GET /admin/roles ──────────────────────────────────────────────────────────
// Get the overrides mapping for HR and Coordinators
router.get('/roles', requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT * FROM user_roles').all();
        res.json(rows);
    } catch (err) {
        console.error('GET /admin/roles error:', err);
        res.status(500).json({ error: 'Failed to fetch roles' });
    }
});

// ── POST /admin/roles ─────────────────────────────────────────────────────────
// Update overrides for an email
router.post('/roles', requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { email, is_hr, is_coordinator } = req.body;

        if (!email) return res.status(400).json({ error: 'email is required' });
        const key = email.trim().toLowerCase();

        const existing = db.prepare('SELECT email FROM user_roles WHERE email = ?').get(key);

        if (existing) {
            db.prepare('UPDATE user_roles SET is_hr = ?, is_coordinator = ? WHERE email = ?')
                .run(is_hr ? 1 : 0, is_coordinator ? 1 : 0, key);
        } else {
            db.prepare('INSERT INTO user_roles (email, is_hr, is_coordinator) VALUES (?, ?, ?)')
                .run(key, is_hr ? 1 : 0, is_coordinator ? 1 : 0);
        }

        // Clean up empty rows if they have no roles (to keep DB clean)
        db.prepare('DELETE FROM user_roles WHERE is_hr = 0 AND is_coordinator = 0').run();

        res.json({ success: true, email: key, is_hr, is_coordinator });
    } catch (err) {
        console.error('POST /admin/roles error:', err);
        res.status(500).json({ error: 'Failed to update roles' });
    }
});

module.exports = router;
