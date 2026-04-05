import express from 'express';
import { getDb } from '../db.js';
import { verifyToken, requireRole } from './auth.js';
import { parseCSV } from '../utils.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// requireAdmin must include verifyToken so req.user is populated
const requireAdmin = [verifyToken, requireRole('admin')];

// ── GET /admin/roles ──────────────────────────────────────────────────────────
// Get all users with their roles
router.get('/roles', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const db = await getDb();
        const [rows] = await db.query('SELECT * FROM user_roles ORDER BY email');
        res.json(rows);
    } catch (err) {
        console.error('GET /admin/roles error:', err);
        res.status(500).json({ error: 'Failed to fetch roles' });
    }
});

// ── POST /admin/roles ─────────────────────────────────────────────────────────
// Create or update a user's role
router.post('/roles', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const db = await getDb();
        const { email, role, is_active = true } = req.body;

        if (!email) return res.status(400).json({ error: 'email is required' });
        if (!role) return res.status(400).json({ error: 'role is required' });

        // Validate role
        const validRoles = ['admin', 'hr', 'coordinator', 'sa', 'sales', 'staff'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Must be one of: ' + validRoles.join(', ') });
        }

        // Insert or update role
        await db.query('INSERT INTO user_roles (email, role, is_active) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = VALUES(is_active)', [email, role, is_active]);

        res.json({ success: true });
    } catch (err) {
        console.error('POST /admin/roles error:', err);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

// ── GET /admin/skills ────────────────────────────────────────────────────────
// Get all unique skills with counts for skill management UI
// Allows both admin and HR users to view and manage skills
router.get('/skills', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const db = await getDb();
        const query = `
            SELECT 
                sk.skill as name,
                COUNT(DISTINCT sk.submission_id) as count
            FROM submission_skills sk
            GROUP BY sk.skill
            ORDER BY count DESC, sk.skill ASC
        `;
        const [rows] = await db.query(query);
        res.json(rows);
    } catch (err) {
        console.error('GET /admin/skills error:', err);
        res.status(500).json({ error: 'Failed to fetch skills' });
    }
});

export { router };
