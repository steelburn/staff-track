'use strict';
const express = require('express');
const { getDb } = require('../db');
const { verifyToken, requireRole } = require('./auth');

const router = express.Router();

// Coordinator or admin can update projects
const requireCoordinator = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!['admin', 'coordinator'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden: Requires Coordinator role' });
    }
    next();
};

// ── GET /catalog/staff ────────────────────────────────────────────────────────
// Returns baseline staff info from CSV
router.get('/staff', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT email, name, title, department, manager_name FROM staff ORDER BY name ASC').all();
        res.json(rows);
    } catch (err) {
        console.error('GET /catalog/staff error:', err);
        res.status(500).json({ error: 'Failed to retrieve staff catalog' });
    }
});

// ── GET /catalog/projects ─────────────────────────────────────────────────────
// Returns baseline projects from CSV
router.get('/projects', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT id, soc, project_name, customer, end_date FROM projects_catalog ORDER BY project_name ASC').all();
        res.json(rows);
    } catch (err) {
        console.error('GET /catalog/projects error:', err);
        res.status(500).json({ error: 'Failed to retrieve projects catalog' });
    }
});

// ── PUT /catalog/projects/:id ─────────────────────────────────────────────
// Allows coordinators to update a project's general end date
router.put('/projects/:id', verifyToken, requireCoordinator, (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const { end_date } = req.body;

        const info = db.prepare('UPDATE projects_catalog SET end_date = ? WHERE id = ?').run(end_date || null, id);
        if (info.changes === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json({ success: true, id, end_date });
    } catch (err) {
        console.error('PUT /catalog/projects/:id error:', err);
        res.status(500).json({ error: 'Failed to update catalog project end date' });
    }
});

module.exports = router;
