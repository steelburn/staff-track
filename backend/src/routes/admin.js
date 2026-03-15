'use strict';
const express = require('express');
const { getDb } = require('../db');
const { verifyToken, requireRole } = require('./auth');
const { parseCSV } = require('../utils');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// requireAdmin must include verifyToken so req.user is populated
const requireAdmin = [verifyToken, requireRole('admin')];

// ── GET /admin/roles ──────────────────────────────────────────────────────────
// Get all users with their roles
router.get('/roles', verifyToken, requireRole('admin'), (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT * FROM user_roles ORDER BY email').all();
        res.json(rows);
    } catch (err) {
        console.error('GET /admin/roles error:', err);
        res.status(500).json({ error: 'Failed to fetch roles' });
    }
});

// ── POST /admin/roles ─────────────────────────────────────────────────────────
// Create or update a user's role
router.post('/roles', verifyToken, requireRole('admin'), (req, res) => {
    try {
        const db = getDb();
        const { email, role, is_active = true } = req.body;

        if (!email) return res.status(400).json({ error: 'email is required' });
        if (!role) return res.status(400).json({ error: 'role is required' });

        // Validate role
        const validRoles = ['admin', 'hr', 'coordinator', 'sa', 'sales', 'staff'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Must be one of: ' + validRoles.join(', ') });
        }

        let is_hr = 0;
        let is_coordinator = 0;
        
        if (role === 'admin') {
            is_hr = 1;
            is_coordinator = 1;
        } else if (role === 'hr') {
            is_hr = 1;
        } else if (role === 'coordinator') {
            is_coordinator = 1;
        }

        const key = email.trim().toLowerCase();
        const now = new Date().toISOString();

        const existing = db.prepare('SELECT * FROM user_roles WHERE email = ?').get(key);

        if (existing) {
            db.prepare('UPDATE user_roles SET role = ?, is_hr = ?, is_coordinator = ?, is_active = ?, updated_at = ? WHERE email = ?')
                .run(role, is_hr, is_coordinator, is_active ? 1 : 0, now, key);
        } else {
            db.prepare('INSERT INTO user_roles (email, role, is_hr, is_coordinator, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(key, role, is_hr, is_coordinator, is_active ? 1 : 0, now, now);
        }

        res.json({ success: true, email: key, role, is_hr, is_coordinator, is_active });
    } catch (err) {
        console.error('POST /admin/roles error:', err);
        res.status(500).json({ error: 'Failed to update roles' });
    }
});

// ── DELETE /admin/roles/:email ─────────────────────────────────────────────────
// Remove a user's role (deactivate)
router.delete('/roles/:email', verifyToken, requireRole('admin'), (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        const existing = db.prepare('SELECT * FROM user_roles WHERE email = ?').get(email);
        if (!existing) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Don't allow deleting admin
        if (existing.role === 'admin') {
            return res.status(400).json({ error: 'Cannot deactivate admin user' });
        }

        db.prepare('UPDATE user_roles SET is_active = 0, updated_at = ? WHERE email = ?')
            .run(new Date().toISOString(), email);

        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /admin/roles/:email error:', err);
        res.status(500).json({ error: 'Failed to deactivate user' });
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

// ── GET /admin/skills ─────────────────────────────────────────────────────────
router.get('/skills', requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare(`
            SELECT skill as name, COUNT(*) as count 
            FROM submission_skills 
            GROUP BY skill 
            ORDER BY count DESC, name ASC
        `).all();
        res.json(rows);
    } catch (err) {
        console.error('GET /admin/skills error:', err);
        res.status(500).json({ error: 'Failed to fetch skills' });
    }
});

// ── POST /admin/skills/merge ──────────────────────────────────────────────────
router.post('/skills/merge', requireAdmin, (req, res) => {
    try {
        const { targetSkill, sourceSkills } = req.body;
        if (!targetSkill || !Array.isArray(sourceSkills) || sourceSkills.length === 0) {
            return res.status(400).json({ error: 'targetSkill and array of sourceSkills required' });
        }

        const db = getDb();
        const mergeBy = req.user.email;

        let affectedCount = 0;
        const tx = db.transaction(() => {
            const placeholders = sourceSkills.map(() => '?').join(',');
            const updateStmt = db.prepare(`
                UPDATE submission_skills 
                SET skill = ? 
                WHERE skill IN (${placeholders})
            `);
            const info = updateStmt.run(targetSkill, ...sourceSkills);
            affectedCount = info.changes;

            db.prepare('INSERT OR IGNORE INTO skills_catalog (id, name, is_active) VALUES (?, ?, 1)')
                .run(uuidv4(), targetSkill);

            const logInsert = db.prepare(`
                INSERT INTO skill_merge_log (id, from_name, to_name, affected_count, merged_by, merged_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            const now = new Date().toISOString();
            for (const source of sourceSkills) {
                logInsert.run(uuidv4(), source, targetSkill, 0, mergeBy, now);
            }

            // Deduplicate: if a user now has multiple entries for targetSkill, keep the one with highest rating
            db.prepare(`
                DELETE FROM submission_skills
                WHERE id IN (
                    SELECT id FROM (
                        SELECT id, ROW_NUMBER() OVER (PARTITION BY submission_id, skill ORDER BY rating DESC) as rn
                        FROM submission_skills
                        WHERE skill = ?
                    )
                    WHERE rn > 1
                )
            `).run(targetSkill);
        });

        tx();
        res.json({ success: true, targetSkill, affectedCount });
    } catch (err) {
        console.error('POST /admin/skills/merge error:', err);
        res.status(500).json({ error: 'Failed to merge skills' });
    }
});

// ── POST /admin/skills/rename ─────────────────────────────────────────────────
router.post('/skills/rename', requireAdmin, (req, res) => {
    try {
        const { oldName, newName } = req.body;
        if (!oldName || !newName) {
            return res.status(400).json({ error: 'oldName and newName required' });
        }

        const db = getDb();
        const mergeBy = req.user.email;

        let affectedCount = 0;
        const tx = db.transaction(() => {
            const info = db.prepare('UPDATE submission_skills SET skill = ? WHERE skill = ?')
                .run(newName, oldName);
            affectedCount = info.changes;

            db.prepare('INSERT OR IGNORE INTO skills_catalog (id, name, is_active) VALUES (?, ?, 1)')
                .run(uuidv4(), newName);

            db.prepare(`
                INSERT INTO skill_merge_log (id, from_name, to_name, affected_count, merged_by, merged_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(uuidv4(), oldName, newName, affectedCount, mergeBy, new Date().toISOString());

            db.prepare(`
                DELETE FROM submission_skills
                WHERE id IN (
                    SELECT id FROM (
                        SELECT id, ROW_NUMBER() OVER (PARTITION BY submission_id, skill ORDER BY rating DESC) as rn
                        FROM submission_skills
                        WHERE skill = ?
                    )
                    WHERE rn > 1
                )
            `).run(newName);
        });

        tx();
        res.json({ success: true, oldName, newName, affectedCount });
    } catch (err) {
        console.error('POST /admin/skills/rename error:', err);
        res.status(500).json({ error: 'Failed to rename skill' });
    }
});

// ── POST /admin/skills/split ──────────────────────────────────────────────────
router.post('/skills/split', requireAdmin, (req, res) => {
    try {
        const { originalSkill, newSkills } = req.body;
        if (!originalSkill || !Array.isArray(newSkills) || newSkills.length < 2) {
            return res.status(400).json({ error: 'originalSkill and array of at least 2 newSkills required' });
        }

        const db = getDb();
        const mergeBy = req.user.email;

        let affectedCount = 0;
        const tx = db.transaction(() => {
            const instances = db.prepare('SELECT * FROM submission_skills WHERE skill = ?').all(originalSkill);
            affectedCount = instances.length;

            if (affectedCount === 0) return;

            const insertSkill = db.prepare(`
                INSERT INTO submission_skills (id, submission_id, skill, rating)
                VALUES (?, ?, ?, ?)
            `);

            const deleteOldSkill = db.prepare('DELETE FROM submission_skills WHERE id = ?');

            for (const instance of instances) {
                for (const newSkill of newSkills) {
                    insertSkill.run(uuidv4(), instance.submission_id, newSkill.trim(), instance.rating);
                }
                // Safely delete the exact original row, so we don't accidentally delete our newly inserted rows 
                // if the user included the original skill name in the new splits list.
                deleteOldSkill.run(instance.id);
            }

            const now = new Date().toISOString();
            const logInsert = db.prepare(`
                INSERT INTO skill_merge_log (id, from_name, to_name, affected_count, merged_by, merged_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `);

            for (const newSkill of newSkills) {
                const trimmedNewSkill = newSkill.trim();
                db.prepare('INSERT OR IGNORE INTO skills_catalog (id, name, is_active) VALUES (?, ?, 1)')
                    .run(uuidv4(), trimmedNewSkill);

                logInsert.run(uuidv4(), originalSkill, trimmedNewSkill, affectedCount, mergeBy, now);

                db.prepare(`
                    DELETE FROM submission_skills
                    WHERE id IN (
                        SELECT id FROM (
                            SELECT id, ROW_NUMBER() OVER (PARTITION BY submission_id, skill ORDER BY rating DESC) as rn
                            FROM submission_skills
                            WHERE skill = ?
                        )
                        WHERE rn > 1
                    )
                `).run(trimmedNewSkill);
            }
        });

        tx();
        res.json({ success: true, originalSkill, newSkills, affectedCount });
    } catch (err) {
        console.error('POST /admin/skills/split error:', err);
        res.status(500).json({ error: 'Failed to split skill' });
    }
});

// ── DELETE /admin/skills ──────────────────────────────────────────────────────
router.delete('/skills', requireAdmin, (req, res) => {
    try {
        const { skillName } = req.body;
        if (!skillName) return res.status(400).json({ error: 'skillName required' });

        const db = getDb();
        const info = db.prepare('DELETE FROM submission_skills WHERE skill = ?').run(skillName);

        res.json({ success: true, deletedCount: info.changes });
    } catch (err) {
        console.error('DELETE /admin/skills error:', err);
        res.status(500).json({ error: 'Failed to delete skill' });
    }
});

module.exports = router;
