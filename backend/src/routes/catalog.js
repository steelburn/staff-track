import express from 'express';
import { getDb } from '../db.js';
import { verifyToken, requireRole } from './auth.js';

const router = express.Router();

// Coordinator or admin can update projects
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

// ── GET /catalog/staff ────────────────────────────────────────────────────────
// Returns baseline staff info from CSV
router.get('/staff', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const [rows] = await db.query('SELECT email, name, title, department, manager_name FROM staff ORDER BY name ASC');
        res.json(rows);
    } catch (err) {
        console.error('GET /catalog/staff error:', err);
        res.status(500).json({ error: 'Failed to retrieve staff catalog' });
    }
});

// ── GET /catalog/projects ─────────────────────────────────────────────────────
// Returns baseline projects from CSV
router.get('/projects', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const [rows] = await db.query('SELECT id, soc, project_name, customer, end_date FROM projects_catalog ORDER BY project_name ASC');
        res.json(rows);
    } catch (err) {
        console.error('GET /catalog/projects error:', err);
        res.status(500).json({ error: 'Failed to retrieve projects catalog' });
    }
});

export { router };
