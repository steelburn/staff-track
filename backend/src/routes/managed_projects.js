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
        const {
            project_name, name: legacyName,
            soc, customer,
            type_infra, type_software, type_infra_support, type_software_support,
            start_date, end_date,
            technologies, description,
            coordinator_email
        } = req.body;

        const projectName = project_name || legacyName;
        if (!projectName) {
            return res.status(400).json({ error: 'Project name is required' });
        }

        // Date validation
        if (start_date && end_date && start_date > end_date) {
            return res.status(400).json({ error: 'End date must be on or after the start date' });
        }

        // Validate date formats (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (start_date && !dateRegex.test(start_date)) {
            return res.status(400).json({ error: 'Invalid start_date format. Use YYYY-MM-DD' });
        }
        if (end_date && !dateRegex.test(end_date)) {
            return res.status(400).json({ error: 'Invalid end_date format. Use YYYY-MM-DD' });
        }

        const id = uuidv4();
        const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const coordEmail = coordinator_email || req.user.email;

        // Handle technologies - store as JSON array if comma-separated string
        let techJson = null;
        if (technologies) {
            if (typeof technologies === 'string') {
                techJson = JSON.stringify(technologies.split(',').map(t => t.trim()).filter(t => t));
            } else if (Array.isArray(technologies)) {
                techJson = JSON.stringify(technologies);
            }
        }

        await db.query(
            `INSERT INTO managed_projects (id, soc, project_name, customer, type_infra, type_software, type_infra_support, type_software_support, start_date, end_date, technologies, description, coordinator_email, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                soc || null,
                projectName,
                customer || null,
                type_infra ? 1 : 0,
                type_software ? 1 : 0,
                type_infra_support ? 1 : 0,
                type_software_support ? 1 : 0,
                start_date || null,
                end_date || null,
                techJson,
                description || null,
                coordEmail,
                createdAt
            ]
        );

        res.status(201).json({ id, project_name: projectName, soc, customer, created_at: createdAt });
    } catch (err) {
        console.error('POST /managed-projects error:', err);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

export { router };
