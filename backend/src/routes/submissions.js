'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

const router = express.Router();

// ── GET /submissions — list all ──────────────────────────────────────────────
router.get('/', (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT id, staff_email, staff_name, created_at, updated_at FROM submissions ORDER BY updated_at DESC').all();
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

// ── GET /submissions/:id — fetch one ─────────────────────────────────────────
router.get('/:id', (req, res) => {
    try {
        const db = getDb();
        const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
        if (!sub) return res.status(404).json({ error: 'Not found' });

        const skills = db.prepare('SELECT skill, rating FROM submission_skills WHERE submission_id = ?').all(sub.id);
        const projects = db.prepare('SELECT soc, project_name AS projectName, customer, role, end_date AS endDate FROM submission_projects WHERE submission_id = ?').all(sub.id);

        res.json({
            id: sub.id,
            createdAt: sub.created_at,
            updatedAt: sub.updated_at,
            staffName: sub.staff_name,
            staffData: {
                email: sub.staff_email,
                title: sub.title || '',
                department: sub.department || '',
                managerName: sub.manager_name || ''
            },
            editedFields: JSON.parse(sub.edited_fields || '[]'),
            skills,
            projects
        });
    } catch (err) {
        console.error(`GET /submissions/${req.params.id} error:`, err);
        res.status(500).json({ error: 'Failed to fetch submission' });
    }
});

// ── POST /submissions — create new ───────────────────────────────────────────
router.post('/', (req, res) => {
    try {
        const db = getDb();
        const id = uuidv4();
        const now = new Date().toISOString();
        upsertSubmission(db, id, req.body, now, now);
        res.status(201).json({ id });
    } catch (err) {
        console.error('POST /submissions error:', err);
        res.status(500).json({ error: 'Failed to create submission' });
    }
});

// ── PUT /submissions/:id — update existing ───────────────────────────────────
router.put('/:id', (req, res) => {
    try {
        const db = getDb();
        const id = req.params.id;
        const now = new Date().toISOString();

        // Check if exists
        const existing = db.prepare('SELECT created_at FROM submissions WHERE id = ?').get(id);
        const createdAt = existing ? existing.created_at : now;

        upsertSubmission(db, id, req.body, now, createdAt);
        res.json({ id, updatedAt: now });
    } catch (err) {
        console.error(`PUT /submissions/${req.params.id} error:`, err);
        res.status(500).json({ error: 'Failed to update submission' });
    }
});

// ── Shared Upsert Logic (runs in Transaction) ───────────────────────────────
function upsertSubmission(db, id, body, updatedAt, createdAt) {
    const staffData = body.staffData || {};
    const email = (staffData.email || body.staffName || '').toLowerCase(); // fallback to name if missing

    const insertMain = db.prepare(`
    INSERT INTO submissions (id, staff_email, staff_name, title, department, manager_name, edited_fields, created_at, updated_at)
    VALUES (@id, @staff_email, @staff_name, @title, @department, @manager_name, @edited_fields, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET 
      staff_email = excluded.staff_email,
      staff_name = excluded.staff_name,
      title = excluded.title,
      department = excluded.department,
      manager_name = excluded.manager_name,
      edited_fields = excluded.edited_fields,
      updated_at = excluded.updated_at
  `);

    const tx = db.transaction(() => {
        insertMain.run({
            id,
            staff_email: email,
            staff_name: body.staffName || '',
            title: staffData.title || '',
            department: staffData.department || '',
            manager_name: staffData.managerName || '',
            edited_fields: JSON.stringify(body.editedFields || []),
            created_at: createdAt,
            updated_at: updatedAt
        });

        // Wipe old skills/projects to recreate cleanly
        db.prepare('DELETE FROM submission_skills WHERE submission_id = ?').run(id);
        db.prepare('DELETE FROM submission_projects WHERE submission_id = ?').run(id);

        // Insert new skills
        const insertSkill = db.prepare('INSERT INTO submission_skills (id, submission_id, skill, rating) VALUES (?, ?, ?, ?)');
        (body.skills || []).forEach(s => {
            if (!s.skill) return;
            insertSkill.run(uuidv4(), id, s.skill, s.rating || 0);
        });

        // Insert new projects
        const insertProj = db.prepare('INSERT INTO submission_projects (id, submission_id, soc, project_name, customer, role, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)');
        (body.projects || []).forEach(p => {
            if (!p.soc && !p.projectName) return;
            insertProj.run(uuidv4(), id, p.soc || '', p.projectName || '', p.customer || '', p.role || '', p.endDate || null);
        });
    });

    tx();
}

// ── POST /submissions/assign-project — add project to a staff member ──────────
router.post('/assign-project', (req, res) => {
    try {
        const db = getDb();
        const { staffName, staffData, project } = req.body;
        if (!project) return res.status(400).json({ error: 'Project is required' });

        const email = (staffData?.email || staffName).toLowerCase();
        const now = new Date().toISOString();

        const tx = db.transaction(() => {
            let sub = db.prepare('SELECT id FROM submissions WHERE staff_email = ? ORDER BY updated_at DESC LIMIT 1').get(email);
            let subId;

            if (!sub) {
                // Create new blank submission if they don't have one
                subId = uuidv4();
                db.prepare(`
          INSERT INTO submissions (id, staff_email, staff_name, title, department, manager_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(subId, email, staffName, staffData?.title || '', staffData?.department || '', staffData?.managerName || '', now, now);
            } else {
                subId = sub.id;
            }

            // Check dup
            const isAssigned = db.prepare('SELECT 1 FROM submission_projects WHERE submission_id = ? AND (soc = ? OR project_name = ?)').get(subId, project.soc || '', project.projectName || '');
            if (isAssigned) {
                throw new Error('DUPLICATE');
            }

            db.prepare('INSERT INTO submission_projects (id, submission_id, soc, project_name, customer, role, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(uuidv4(), subId, project.soc || '', project.projectName || '', project.customer || '', project.role || '', project.endDate || null);

            db.prepare('UPDATE submissions SET updated_at = ? WHERE id = ?').run(now, subId);
            return subId;
        });

        let id;
        try {
            id = tx();
        } catch (e) {
            if (e.message === 'DUPLICATE') return res.status(409).json({ error: 'Staff already assigned to this project' });
            throw e;
        }

        res.json({ id, action: 'updated' });
    } catch (err) {
        console.error('POST /submissions/assign-project error:', err);
        res.status(500).json({ error: 'Failed to assign project' });
    }
});

// ── PUT /submissions/assign-project/:assignId — edit project assignment ───────────────────
router.put('/assign-project/:assignId', (req, res) => {
    try {
        const db = getDb();
        const { role, endDate } = req.body;
        const assignId = req.params.assignId;

        const info = db.prepare('UPDATE submission_projects SET role = ?, end_date = ? WHERE id = ?').run(role || '', endDate || null, assignId);

        if (info.changes === 0) return res.status(404).json({ error: 'Assignment not found' });

        // Also update the parent submission's updated_at
        const subIdInfo = db.prepare('SELECT submission_id FROM submission_projects WHERE id = ?').get(assignId);
        if (subIdInfo) {
            db.prepare('UPDATE submissions SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), subIdInfo.submission_id);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('PUT /submissions/assign-project error:', err);
        res.status(500).json({ error: 'Failed to update assignment' });
    }
});

// ── DELETE /submissions/assign-project/:assignId — unassign project ──────────────────────
router.delete('/assign-project/:assignId', (req, res) => {
    try {
        const db = getDb();
        const assignId = req.params.assignId;

        const subIdInfo = db.prepare('SELECT submission_id FROM submission_projects WHERE id = ?').get(assignId);

        const info = db.prepare('DELETE FROM submission_projects WHERE id = ?').run(assignId);

        if (info.changes === 0) return res.status(404).json({ error: 'Assignment not found' });

        if (subIdInfo) {
            db.prepare('UPDATE submissions SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), subIdInfo.submission_id);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /submissions/assign-project error:', err);
        res.status(500).json({ error: 'Failed to remove assignment' });
    }
});

// ── DELETE /submissions/:id ───────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
    try {
        const db = getDb();
        // Cascade delete will handle skills/projects
        const result = db.prepare('DELETE FROM submissions WHERE id = ?').run(req.params.id);
        if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ deleted: true });
    } catch (err) {
        console.error(`DELETE /submissions/${req.params.id} error:`, err);
        res.status(500).json({ error: 'Failed to delete submission' });
    }
});

module.exports = router;
