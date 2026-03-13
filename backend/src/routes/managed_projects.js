'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { verifyToken, requireRole } = require('./auth');

const router = express.Router();

// Coordinator or admin can manage projects
const requireCoordinator = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!['admin', 'coordinator'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden: Requires Coordinator role' });
    }
    next();
};

// ── GET /managed-projects ─────────────────────────────────────────────────────
router.get('/', verifyToken, requireCoordinator, (req, res) => {
    try {
        const db = getDb();
        let rows;
        if (req.user.role === 'admin') {
            rows = db.prepare('SELECT * FROM managed_projects ORDER BY created_at DESC').all();
        } else {
            rows = db.prepare('SELECT * FROM managed_projects WHERE coordinator_email LIKE ? OR coordinator_email = ? ORDER BY created_at DESC').all('%"' + req.user.email + '"%', req.user.email);
        }
        // parse boolean ints implicitly to true/false for frontend if needed, but direct map is fine
        res.json(rows);
    } catch (err) {
        console.error('GET /managed-projects error:', err);
        res.status(500).json({ error: 'Failed to fetch' });
    }
});

// ── POST /managed-projects ────────────────────────────────────────────────────
router.post('/', verifyToken, requireCoordinator, (req, res) => {
    try {
        const db = getDb();
        const { soc, name, customer, type_infra, type_software, type_infra_support, type_software_support, end_date } = req.body;

        if (!name) return res.status(400).json({ error: 'Project name is required' });

        let existing;
        if (soc) {
            existing = db.prepare('SELECT * FROM managed_projects WHERE soc = ?').get(soc);
        }
        if (!existing) {
            existing = db.prepare("SELECT * FROM managed_projects WHERE name = ? AND (soc IS NULL OR soc = '')").get(name);
        }

        const email = req.user.email;
        const now = new Date().toISOString();
        let id;

        if (existing) {
            // Project exists. Parse coordinators.
            let coordinators = [];
            try {
                coordinators = JSON.parse(existing.coordinator_email);
                if (!Array.isArray(coordinators)) coordinators = [existing.coordinator_email];
            } catch {
                coordinators = [existing.coordinator_email];
            }

            if (!coordinators.includes(email)) {
                coordinators.push(email);
                db.prepare('UPDATE managed_projects SET coordinator_email = ? WHERE id = ?').run(JSON.stringify(coordinators), existing.id);
            }
            // we return existing fields to avoid overwriting front-end representation
            id = existing.id;
        } else {
            id = uuidv4();
            db.prepare(`
      INSERT INTO managed_projects (
        id, soc, name, customer, 
        type_infra, type_software, type_infra_support, type_software_support, 
        end_date, coordinator_email, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
                id, soc || '', name, customer || '',
                type_infra ? 1 : 0, type_software ? 1 : 0,
                type_infra_support ? 1 : 0, type_software_support ? 1 : 0,
                end_date || null, JSON.stringify([email]), now
            );
        }

        res.status(201).json({ id, soc, name, customer });
    } catch (err) {
        console.error('POST /managed-projects error:', err);
        res.status(500).json({ error: 'Failed to create managed project' });
    }
});

// ── PUT /managed-projects/:id ─────────────────────────────────────────────────
router.put('/:id', verifyToken, requireCoordinator, (req, res) => {
    try {
        const db = getDb();
        const { soc, name, customer, type_infra, type_software, type_infra_support, type_software_support, end_date } = req.body;
        const id = req.params.id;

        if (!name) return res.status(400).json({ error: 'Project name is required' });

        const info = db.prepare(`
            UPDATE managed_projects SET 
                soc = ?, 
                name = ?, 
                customer = ?, 
                type_infra = ?, 
                type_software = ?, 
                type_infra_support = ?, 
                type_software_support = ?, 
                end_date = ?
            WHERE id = ?
        `).run(
            soc || '', name, customer || '',
            type_infra ? 1 : 0, type_software ? 1 : 0,
            type_infra_support ? 1 : 0, type_software_support ? 1 : 0,
            end_date || null, id
        );

        if (info.changes === 0) return res.status(404).json({ error: 'Project not found' });

        res.json({ success: true });
    } catch (err) {
        console.error('PUT /managed-projects/:id error:', err);
        res.status(500).json({ error: 'Failed to update managed project' });
    }
});

module.exports = router;
