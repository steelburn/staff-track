import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { verifyToken, requireRole } from './auth.js';

const router = express.Router();

// ── GET /submissions — list all ──────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const db = await getDb();
        const [rows] = await db.query('SELECT id, staff_email, staff_name, created_at, updated_at FROM submissions ORDER BY updated_at DESC');
        res.json(rows.map(r => ({
            id: r.id,
            staffEmail: r.staff_email,
            staffName: r.staff_name,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        })));
    } catch (err) {
        console.error('GET /submissions error:', err);
        res.status(500).json({ error: 'Failed to list submissions' });
    }
});

// ── GET /submissions/me — fetch the calling user's own submission ──────────────
router.get('/me', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const email = req.user.email.toLowerCase();
        const [rows] = await db.query('SELECT * FROM submissions WHERE LOWER(staff_email) = ? ORDER BY updated_at DESC LIMIT 1', [email]);
        const sub = rows[0];
        if (!sub) return res.status(404).json({ error: 'No submission found' });

        const [skillRows] = await db.query('SELECT skill, rating FROM submission_skills WHERE submission_id = ?', [sub.id]);
        const [projectRows] = await db.query('SELECT soc, project_name AS projectName, customer, role, start_date AS startDate, end_date AS endDate, description, technologies_used AS technologies FROM submission_projects WHERE submission_id = ?', [sub.id]);

        res.json({
            id: sub.id,
            createdAt: sub.created_at,
            updatedAt: sub.updated_at,
            staffEmail: sub.staff_email,
            staffName: sub.staff_name,
            skills: skillRows,
            projects: projectRows
        });
    } catch (err) {
        console.error('GET /submissions/me error:', err);
        res.status(500).json({ error: 'Failed to fetch submission' });
    }
});

// ── GET /email/admin — fetch submissions for admin ───────────────────────────
router.get('/email/admin', verifyToken, requireRole('admin'), async (_req, res) => {
    try {
        const db = await getDb();
        const [rows] = await db.query('SELECT * FROM submissions ORDER BY updated_at DESC');
        res.json(rows);
    } catch (err) {
        console.error('GET /email/admin error:', err);
        res.status(500).json({ error: 'Failed to fetch admin submissions' });
    }
});

// ── GET /email/:email — fetch submissions for a specific email ─────────────────
router.get('/email/:email', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const { email } = req.params;
        const [rows] = await db.query(
            'SELECT * FROM submissions WHERE LOWER(staff_email) = ? ORDER BY updated_at DESC',
            [email.toLowerCase()]
        );
        res.json(rows);
    } catch (err) {
        console.error('GET /email/:email error:', err);
        res.status(500).json({ error: 'Failed to fetch submissions by email' });
    }
});

// ── GET /:id — fetch a single submission by ID ───────────────────────────────
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const { id } = req.params;
        
        // Fetch the main submission
        const [rows] = await db.query('SELECT * FROM submissions WHERE id = ?', [id]);
        if (!rows.length) return res.status(404).json({ error: 'Submission not found' });
        
        const sub = rows[0];

        // Fetch skills
        const [skillRows] = await db.query(
            'SELECT skill, rating FROM submission_skills WHERE submission_id = ?',
            [id]
        );

        // Fetch projects
        const [projectRows] = await db.query(
            'SELECT soc, project_name AS projectName, customer, role, start_date AS startDate, end_date AS endDate, description, technologies_used AS technologies FROM submission_projects WHERE submission_id = ?',
            [id]
        );

        // Parse edited_fields JSON safely
        let editedFields = [];
        try {
            if (sub.edited_fields) {
                editedFields = JSON.parse(sub.edited_fields);
            }
        } catch (e) {
            console.log('Invalid edited_fields JSON:', e.message);
        }

        res.json({
            id: sub.id,
            staffName: sub.staff_name,
            staffEmail: sub.staff_email,
            staffData: {
                name: sub.staff_name,
                email: sub.staff_email,
                title: sub.title,
                department: sub.department,
                managerName: sub.manager_name
            },
            editedFields: editedFields,
            skills: skillRows,
            projects: projectRows,
            createdAt: sub.created_at,
            updatedAt: sub.updated_at
        });
    } catch (err) {
        console.error('GET /:id error:', err);
        res.status(500).json({ error: 'Failed to fetch submission' });
    }
});

// ── POST / — Create a new submission ──────────────────────────────────────────
router.post('/', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const {
            staffName,
            staffData = {},
            editedFields,
            skills = [],
            projects = []
        } = req.body;

        const staffEmail = staffData.email;
        const title = staffData.title;
        const department = staffData.department;
        const managerName = staffData.managerName;

        if (!staffEmail || !staffName) {
            return res.status(400).json({ error: 'staffEmail and staffName are required' });
        }

        const id = uuidv4();
        const now = new Date().toISOString().slice(0, 19) + 'Z';
        const editedFieldsJson = JSON.stringify(editedFields || []);

        // Insert main submission
        await db.query(
            `INSERT INTO submissions (id, staff_email, staff_name, title, department, manager_name, edited_fields, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, staffEmail.toLowerCase(), staffName, title || null, department || null, managerName || null, editedFieldsJson, now, now]
        );

        // Insert skills
        for (const skill of skills) {
            if (skill.skill && skill.rating !== undefined) {
                await db.query(
                    'INSERT INTO submission_skills (submission_id, skill, rating) VALUES (?, ?, ?)',
                    [id, skill.skill, skill.rating]
                );
            }
        }

        // Insert projects
        for (const project of projects) {
            if (project.project_name) {
                await db.query(
                    `INSERT INTO submission_projects (submission_id, soc, project_name, customer, role, start_date, end_date, description, technologies_used)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id,
                        project.soc || null,
                        project.project_name,
                        project.customer || null,
                        project.role || null,
                        project.startDate || null,
                        project.endDate || null,
                        project.description || null,
                        project.technologies || null
                    ]
                );
            }
        }

        res.json({ id });
    } catch (err) {
        console.error('POST / error:', err);
        res.status(500).json({ error: 'Failed to create submission' });
    }
});

// ── PUT /:id — Update an existing submission ──────────────────────────────────
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const { id } = req.params;
        const {
            staffName,
            staffData = {},
            editedFields,
            skills = [],
            projects = []
        } = req.body;

        const staffEmail = staffData.email;
        const title = staffData.title;
        const department = staffData.department;
        const managerName = staffData.managerName;

        // Verify submission exists
        const [existing] = await db.query('SELECT id FROM submissions WHERE id = ?', [id]);
        if (!existing.length) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        const now = new Date().toISOString().slice(0, 19) + 'Z';
        const editedFieldsJson = JSON.stringify(editedFields || []);

        // Update main submission
        await db.query(
            `UPDATE submissions SET staff_email = ?, staff_name = ?, title = ?, department = ?, manager_name = ?, edited_fields = ?, updated_at = ?
             WHERE id = ?`,
            [staffEmail.toLowerCase(), staffName, title || null, department || null, managerName || null, editedFieldsJson, now, id]
        );

        // Clear and re-insert skills
        await db.query('DELETE FROM submission_skills WHERE submission_id = ?', [id]);
        for (const skill of skills) {
            if (skill.skill && skill.rating !== undefined) {
                await db.query(
                    'INSERT INTO submission_skills (submission_id, skill, rating) VALUES (?, ?, ?)',
                    [id, skill.skill, skill.rating]
                );
            }
        }

        // Clear and re-insert projects
        await db.query('DELETE FROM submission_projects WHERE submission_id = ?', [id]);
        for (const project of projects) {
            if (project.project_name) {
                await db.query(
                    `INSERT INTO submission_projects (submission_id, soc, project_name, customer, role, start_date, end_date, description, technologies_used)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id,
                        project.soc || null,
                        project.project_name,
                        project.customer || null,
                        project.role || null,
                        project.startDate || null,
                        project.endDate || null,
                        project.description || null,
                        project.technologies || null
                    ]
                );
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('PUT /:id error:', err);
        res.status(500).json({ error: 'Failed to update submission' });
    }
});

export { router };
