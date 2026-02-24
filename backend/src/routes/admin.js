'use strict';
const express = require('express');
const { getDb } = require('../db');
const { sessions } = require('./auth');
const { parseCSV } = require('../utils');
const { v4: uuidv4 } = require('uuid');

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

// ── POST /admin/import-staff ──────────────────────────────────────────────────
router.post('/import-staff', requireAdmin, (req, res) => {
    try {
        const { csv } = req.body;
        if (!csv) return res.status(400).json({ error: 'csv content is required' });

        const list = parseCSV(csv);
        const db = getDb();

        const insert = db.prepare(`
            INSERT INTO staff (email, name, title, department, manager_name) 
            VALUES (@email, @name, @title, @department, @manager_name)
        `);

        let added = 0;
        let skipped = 0;

        const tx = db.transaction((data) => {
            for (const s of data) {
                // Support multiple CSV formats: "EmailAddress" or "Email" or "UserLogonName"
                let email = (s.EmailAddress || s.Email || '').trim();
                if (!email && s.UserLogonName) {
                    email = s.UserLogonName.trim() + '@zen.com.my';
                }
                if (!email) continue;

                const key = email.trim().toLowerCase();
                const existing = db.prepare('SELECT email FROM staff WHERE email = ?').get(key);

                if (existing) {
                    skipped++;
                    continue;
                }

                // Handle ManagerDN parsing for AD format
                let mName = s.ManagerName || '';
                if (!mName && s.ManagerDN) {
                    const match = s.ManagerDN.match(/CN=([^,]+)/);
                    if (match) mName = match[1];
                }

                insert.run({
                    email: key,
                    name: s.Name || '',
                    title: s.Title || '',
                    department: s.Department || '',
                    manager_name: mName
                });
                added++;
            }
        });

        tx(list);
        res.json({ success: true, count: added, skipped });
    } catch (err) {
        console.error('POST /admin/import-staff error:', err);
        res.status(500).json({ error: 'Failed to import staff: ' + err.message });
    }
});

// ── GET /admin/catalog/staff ──────────────────────────────────────────────────
router.get('/catalog/staff', requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT * FROM staff ORDER BY name ASC').all();
        res.json(rows);
    } catch (err) {
        console.error('GET /admin/catalog/staff error:', err);
        res.status(500).json({ error: 'Failed to fetch staff catalog' });
    }
});

// ── DELETE /admin/staff/:email ────────────────────────────────────────────────
router.delete('/staff/:email', requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { email } = req.params;
        db.prepare('DELETE FROM staff WHERE email = ?').run(email.toLowerCase());
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /admin/staff error:', err);
        res.status(500).json({ error: 'Failed to delete staff member' });
    }
});

// ── POST /admin/import-projects ────────────────────────────────────────────────
router.post('/import-projects', requireAdmin, (req, res) => {
    try {
        const { csv } = req.body;
        if (!csv) return res.status(400).json({ error: 'csv content is required' });

        const list = parseCSV(csv);
        const db = getDb();

        const insert = db.prepare(`
            INSERT INTO projects_catalog (id, soc, project_name, customer, end_date) 
            VALUES (@id, @soc, @project_name, @customer, @end_date)
        `);

        let added = 0;
        let skipped = 0;

        const tx = db.transaction((data) => {
            for (const p of data) {
                const name = p['Project Name'];
                if (!name) continue;

                const soc = p.SOC || '';
                let existing;
                if (soc) {
                    existing = db.prepare('SELECT soc FROM projects_catalog WHERE soc = ?').get(soc);
                } else {
                    existing = db.prepare('SELECT project_name FROM projects_catalog WHERE project_name = ? AND (soc IS NULL OR soc = "")').get(name);
                }

                if (existing) {
                    skipped++;
                    continue;
                }

                insert.run({
                    id: uuidv4(),
                    soc: soc,
                    project_name: name,
                    customer: p.Customer || '',
                    end_date: null
                });
                added++;
            }
        });

        tx(list);
        res.json({ success: true, count: added, skipped });
    } catch (err) {
        console.error('POST /admin/import-projects error:', err);
        res.status(500).json({ error: 'Failed to import projects: ' + err.message });
    }
});

// ── GET /admin/catalog/projects ───────────────────────────────────────────────
router.get('/catalog/projects', requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT * FROM projects_catalog ORDER BY project_name ASC').all();
        res.json(rows);
    } catch (err) {
        console.error('GET /admin/catalog/projects error:', err);
        res.status(500).json({ error: 'Failed to fetch project catalog' });
    }
});

// ── DELETE /admin/projects/:id ───────────────────────────────────────────────
router.delete('/projects/:id', requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        db.prepare('DELETE FROM projects_catalog WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /admin/projects error:', err);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

module.exports = router;
