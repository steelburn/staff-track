import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { verifyToken, requireRole } from './auth.js';

const router = express.Router();

// Coordinator or admin can manage projects
const requireCoordinator = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const isAdminOrCoordinator = req.user.isAdmin === true || req.user.is_coordinator === 1 || req.user.is_coordinator === true;
    if (!isAdminOrCoordinator) {
        return res.status(403).json({ error: 'Forbidden: Requires Coordinator role' });
    }
    next();
};

// ── GET /managed-projects ─────────────────────────────────────────────────────
router.get('/', verifyToken, requireCoordinator, async (req, res) => {
    try {
        const db = await getDb();
        let rows;
        let params = [];
        let query = 'SELECT * FROM managed_projects';
        
        if (req.user.isAdmin === true) {
            query += ' ORDER BY created_at DESC';
        } else {
            query += ' WHERE coordinator_email LIKE ? OR coordinator_email = ? ORDER BY created_at DESC';
            params = ['%"' + req.user.email + '"%', req.user.email];
        }
        
        const [rows_result] = await db.query(query, params);
        rows = rows_result;
        res.json(rows);
    } catch (err) {
        console.error('GET /managed-projects error:', err);
        res.status(500).json({ error: 'Failed to fetch' });
    }
});

// ── POST /managed-projects ────────────────────────────────────────────────────
router.post('/', verifyToken, requireCoordinator, async (req, res) => {
    try {
        const db = await getDb();
        const { name, description, coordinator_email } = req.body;
        const id = uuidv4();
        const createdAt = new Date().toISOString();

        await db.query('INSERT INTO managed_projects (id, name, description, coordinator_email, created_at) VALUES (?, ?, ?, ?, ?)', [id, name, description, coordinator_email, createdAt]);

        res.status(201).json({ id, name, description, coordinator_email, created_at: createdAt });
    } catch (err) {
        console.error('POST /managed-projects error:', err);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

export { router };
