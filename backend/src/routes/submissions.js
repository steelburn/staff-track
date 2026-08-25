import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { verifyToken, requireRole } from './auth.js';
import { logAudit, markStaffUpdated, diffByKey } from '../utils/audit.js';

const router = express.Router();

// ── Date formatting helper ──────────────────────────────────────────────────
/**
 * Format a date value to YYYY-MM-DD string.
 * Handles Date objects, strings, and null/undefined.
 */
function formatDate(dateVal) {
    if (!dateVal) return null;
    if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
        return dateVal;
    }
    // Handle datetime strings like "2023-01-01 00:00:00" or "2023-01-01T00:00:00.000Z"
    if (typeof dateVal === 'string') {
        const dateMatch = dateVal.match(/^(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
            return dateMatch[1];
        }
    }
    try {
        const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
        if (isNaN(d.getTime())) return null;
        // Use UTC to avoid timezone issues with MySQL DATE columns
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch {
        return null;
    }
}

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

        const [skillRows] = await db.query('SELECT id, skill, rating FROM submission_skills WHERE submission_id = ?', [sub.id]);
        const [projectRows] = await db.query('SELECT id, soc, project_name AS projectName, customer, role, start_date AS startDate, end_date AS endDate, description, technologies_used AS technologies FROM submission_projects WHERE submission_id = ?', [sub.id]);

        // Format dates in project rows
        const formattedProjects = projectRows.map(p => ({
            ...p,
            startDate: formatDate(p.startDate),
            endDate: formatDate(p.endDate)
        }));

        res.json({
            id: sub.id,
            createdAt: sub.created_at,
            updatedAt: sub.updated_at,
            staffEmail: sub.staff_email,
            staffName: sub.staff_name,
            skills: skillRows,
            projects: formattedProjects
        });
    } catch (err) {
        console.error('GET /submissions/me error:', err);
        res.status(500).json({ error: 'Failed to fetch submission' });
    }
});

// ── GET /email/admin — fetch submissions for admin ───────────────────────────
router.get('/email/admin', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const db = await getDb();
        // Only the admin account's OWN submissions — never the whole table (that
        // leaked every staff's data into the admin CV page).
        const [rows] = await db.query('SELECT * FROM submissions WHERE LOWER(staff_email) = ? ORDER BY updated_at DESC', [req.user.email.toLowerCase()]);
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
            'SELECT id, skill, rating FROM submission_skills WHERE submission_id = ?',
            [id]
        );

        // Fetch projects
        const [projectRows] = await db.query(
            'SELECT id, soc, project_name AS projectName, customer, role, start_date AS startDate, end_date AS endDate, description, technologies_used AS technologies FROM submission_projects WHERE submission_id = ?',
            [id]
        );

        // Format dates in project rows
        const formattedProjects = projectRows.map(p => ({
            ...p,
            startDate: formatDate(p.startDate),
            endDate: formatDate(p.endDate)
        }));

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
            projects: formattedProjects,
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

        // Ownership: a submission always belongs to the caller. Never trust the
        // client-supplied email — the frontend historically forced authUser.email
        // into the payload, and a mismatched load could write rows under the wrong
        // email (this is how another staff's CV data ended up on KN's page).
        const staffEmail = (req.user.email || staffData.email || '').toLowerCase();

        // Guard: never persist an email address as the display name. The frontend
        // falls back to the identity email when its catalog lookup misses (and the
        // catalog itself once held email-as-name), so an empty name or a name that
        // equals the email is always an artifact — substitute the catalog name.
        let finalStaffName = (staffName || '').trim();
        if (!finalStaffName || finalStaffName.toLowerCase() === staffEmail) {
            const [catalogRow] = await db.query('SELECT name FROM staff WHERE LOWER(email) = ?', [staffEmail]);
            if (catalogRow.length && catalogRow[0].name) finalStaffName = catalogRow[0].name;
        }

        const title = staffData.title;
        const department = staffData.department;
        const managerName = staffData.managerName;

        if (!staffEmail || !finalStaffName) {
            return res.status(400).json({ error: 'staffEmail and staffName are required' });
        }

        // Idempotency guard: if this staff already has a submission row, update
        // that row instead of INSERTing a duplicate. Lost sessionStorage ids used
        // to cause a double-POST → two submission rows per email → the same staff
        // listed twice in All Staff.
        const [existingSubs] = await db.query(
            'SELECT id FROM submissions WHERE LOWER(staff_email) = ? ORDER BY updated_at DESC LIMIT 1',
            [staffEmail.toLowerCase()]
        );
        if (existingSubs.length) {
            const existingId = existingSubs[0].id;
            await applySubmissionUpdate(db, existingId, {
                staffName: finalStaffName,
                staffData,
                editedFields,
                skills,
                projects
            }, req.user.email, staffEmail);
            return res.json({ id: existingId });
        }

        const id = uuidv4();
        const now = new Date().toISOString().slice(0, 19) + 'Z';
        const editedFieldsJson = JSON.stringify(editedFields || []);

        // Insert main submission
        await db.query(
            `INSERT INTO submissions (id, staff_email, staff_name, title, department, manager_name, edited_fields, created_at, updated_at, updated_by_staff)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [id, staffEmail.toLowerCase(), finalStaffName, title || null, department || null, managerName || null, editedFieldsJson, now, now]
        );

        // Insert skills
        for (const skill of skills) {
            if (skill.skill && skill.rating !== undefined) {
                await db.query(
                    'INSERT INTO submission_skills (id, submission_id, skill, rating) VALUES (?, ?, ?, ?)',
                    [uuidv4(), id, skill.skill, skill.rating]
                );
            }
        }

        // Insert projects
        for (const project of projects) {
            const projectName = project.projectName || project.project_name;
            if (projectName) {
                await db.query(
                    `INSERT INTO submission_projects (id, submission_id, soc, project_name, customer, role, start_date, end_date, description, technologies_used)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        uuidv4(),
                        id,
                        project.soc || null,
                        projectName,
                        project.customer || null,
                        project.role || null,
                        project.startDate || project.start_date || null,
                        project.endDate || project.end_date || null,
                        project.description || null,
                        project.technologies || project.technologies_used || null
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

// ── Helper: audit one submission save (staff details + skills + active projects) ──
// Rows are canonicalized before diffing: DB rows carry nulls/DATE objects while
// frontend payloads carry undefined/'' — comparing raw JSON would log phantom
// "changed" rows on every untouched autosave.
function normVal(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }
function normDateVal(v) { return v ? String(v).slice(0, 10) : ''; }

function canonSkills(rows) {
    return rows.map(s => ({ skill: normVal(s.skill), rating: (s.rating === undefined || s.rating === null) ? '' : String(s.rating) }));
}

function canonProjects(rows) {
    return rows.map(p => ({
        project_name: normVal(p.project_name || p.projectName),
        soc: normVal(p.soc),
        customer: normVal(p.customer),
        role: normVal(p.role),
        start_date: normDateVal(p.start_date || p.startDate),
        end_date: normDateVal(p.end_date || p.endDate),
        description: normVal(p.description),
        technologies: normVal(p.technologies || p.technologies_used)
    }));
}

async function auditSubmissionSave(db, { staffEmail, actorEmail, id, editedFields, oldSkills, newSkills, oldProjects, newProjects }) {
    const ef = (editedFields || []).filter(f => typeof f === 'string' && f.trim());
    if (ef.length) {
        await logAudit(db, { staffEmail, actorEmail, section: 'staff_details', action: 'update', summary: `Updated: ${ef.join(', ')}`, details: { fields: ef } });
    }

    const sDiff = diffByKey(canonSkills(oldSkills), canonSkills(newSkills), s => s.skill, s => s.skill);
    if (sDiff.changed) {
        await logAudit(db, {
            staffEmail, actorEmail, section: 'skills', action: 'update',
            summary: `Skills: +${sDiff.added.length} added, -${sDiff.removed.length} removed, ~${sDiff.updated.length} changed`,
            details: sDiff
        });
    }

    const pDiff = diffByKey(canonProjects(oldProjects), canonProjects(newProjects), p => p.project_name, p => p.project_name);
    if (pDiff.changed) {
        await logAudit(db, {
            staffEmail, actorEmail, section: 'projects', action: 'update',
            summary: `Active projects: +${pDiff.added.length} added, -${pDiff.removed.length} removed, ~${pDiff.updated.length} changed`,
            details: pDiff
        });
    }
}

// ── Incremental merge helpers (PUT must never rewrite untouched rows) ─────
/**
 * Normalize a project payload into { name, soc, customer, role, startDate, endDate, description, technologies }.
 * Returns null when the project has no name (skip empty rows).
 */
function normalizeProject(p) {
    const name = String(p.projectName || p.project_name || '').trim();
    if (!name) return null;
    return {
        name,
        soc: p.soc || null,
        customer: p.customer || null,
        role: p.role || null,
        startDate: p.startDate || p.start_date || null,
        endDate: p.endDate || p.end_date || null,
        description: p.description || null,
        technologies: p.technologies || p.technologies_used || null,
    };
}

/**
 * Merge the submitted skills into the DB.
 * Only INSERTS new rows and UPDATES changed ratings. NEVER deletes — a stale or
 * partial client state must never be allowed to remove rows from the DB.
 * Row removal is an explicit DELETE (see DELETE /:id/skills/:skillId).
 * Matching is case-insensitive on trimmed names, and each payload row consumes at most one DB row,
 * so duplicate names in the payload map one-to-one to duplicate DB rows (no spurious churn).
 */
async function mergeSkills(db, submissionId, skills) {
    const [existing] = await db.query(
        'SELECT id, skill, rating FROM submission_skills WHERE submission_id = ?',
        [submissionId]
    );
    const used = new Set();

    for (const sk of skills) {
        const skillName = String(sk.skill || '').trim();
        if (!skillName || sk.rating === undefined) continue;

        const match = existing.find(e =>
            !used.has(e.id) && String(e.skill || '').trim().toLowerCase() === skillName.toLowerCase()
        );

        if (match) {
            used.add(match.id);
            if (Number(match.rating) !== Number(sk.rating)) {
                await db.query('UPDATE submission_skills SET rating = ? WHERE id = ?', [sk.rating, match.id]);
            }
        } else {
            await db.query(
                'INSERT INTO submission_skills (id, submission_id, skill, rating) VALUES (?, ?, ?, ?)',
                [uuidv4(), submissionId, skillName, sk.rating]
            );
        }
    }
}

/**
 * Merge the submitted projects into the DB.
 * Only INSERTS new rows and UPDATES changed fields. NEVER deletes — a stale or
 * partial client state must never be allowed to remove rows from the DB.
 * Row removal is an explicit DELETE (see DELETE /:id/projects/:projectId).
 * Projects are matched by project name (the frontend already prevents duplicate names per submission).
 */
async function mergeProjects(db, submissionId, projects) {
    const [existing] = await db.query(
        `SELECT id, soc, project_name, customer, role, start_date, end_date, description, technologies_used
         FROM submission_projects WHERE submission_id = ?`,
        [submissionId]
    );
    const used = new Set();

    for (const p of projects) {
        const np = normalizeProject(p);
        if (!np) continue;

        const match = existing.find(e =>
            !used.has(e.id) && String(e.project_name || '').trim().toLowerCase() === np.name.toLowerCase()
        );

        if (match) {
            used.add(match.id);
            const changed =
                (match.soc || null) !== np.soc ||
                (match.customer || null) !== np.customer ||
                (match.role || null) !== np.role ||
                (formatDate(match.start_date) || null) !== np.startDate ||
                (formatDate(match.end_date) || null) !== np.endDate ||
                (match.description || null) !== np.description ||
                (match.technologies_used || null) !== np.technologies;
            if (changed) {
                await db.query(
                    `UPDATE submission_projects
                     SET soc = ?, customer = ?, role = ?, start_date = ?, end_date = ?, description = ?, technologies_used = ?
                     WHERE id = ?`,
                    [np.soc, np.customer, np.role, np.startDate, np.endDate, np.description, np.technologies, match.id]
                );
            }
        } else {
            await db.query(
                `INSERT INTO submission_projects (id, submission_id, soc, project_name, customer, role, start_date, end_date, description, technologies_used)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), submissionId, np.soc, np.name, np.customer, np.role, np.startDate, np.endDate, np.description, np.technologies]
            );
        }
    }
}

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

        // Ownership: a submission always belongs to the caller. Never trust the
        // client-supplied email — the frontend historically forced authUser.email
        // into the payload, and a mismatched load could write rows under the wrong
        // email (this is how another staff's CV data ended up on KN's page).
        const staffEmail = (req.user.email || staffData.email || '').toLowerCase();

        // Guard: never persist an email address as the display name (see POST).
        let finalStaffName = (staffName || '').trim();
        if (!finalStaffName || finalStaffName.toLowerCase() === staffEmail) {
            const [catalogRow] = await db.query('SELECT name FROM staff WHERE LOWER(email) = ?', [staffEmail]);
            if (catalogRow.length && catalogRow[0].name) finalStaffName = catalogRow[0].name;
        }

        // Verify submission exists and belongs to the caller. Without this guard a
        // user could rewrite another staff's submission (payload email is client-controlled).
        const [existing] = await db.query('SELECT id, staff_email FROM submissions WHERE id = ?', [id]);
        if (!existing.length) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        if ((existing[0].staff_email || '').toLowerCase() !== (req.user.email || '').toLowerCase()) {
            return res.status(403).json({ error: 'You can only edit your own submission' });
        }

        await applySubmissionUpdate(db, id, {
            staffName: finalStaffName,
            staffData,
            editedFields,
            skills,
            projects
        }, req.user.email, staffEmail);

        res.json({ success: true });
    } catch (err) {
        console.error('PUT /:id error:', err);
        res.status(500).json({ error: 'Failed to update submission' });
    }
});

// ── Shared update path (used by PUT /:id and the POST idempotency guard) ─────
// Snapshots current rows, updates the submission, merges skills/projects, flips
// the staff-updated flag and writes the audit trail.
async function applySubmissionUpdate(db, id, { staffName, staffData = {}, editedFields, skills = [], projects = [] }, actorEmail, staffEmail) {
    const now = new Date().toISOString().slice(0, 19) + 'Z';
    const editedFieldsJson = JSON.stringify(editedFields || []);

    // Snapshot current skills/projects before merging so the audit log can
    // report what actually changed (added / removed / updated).
    const [oldSkillRows] = await db.query(
        'SELECT skill, rating FROM submission_skills WHERE submission_id = ?', [id]);
    const [oldProjectRows] = await db.query(
        `SELECT soc, project_name, customer, role, start_date, end_date, description, technologies_used
         FROM submission_projects WHERE submission_id = ?`, [id]);

    // Update main submission — any staff save counts as "staff updated",
    // regardless of which field changed.
    await db.query(
        `UPDATE submissions SET staff_email = ?, staff_name = ?, title = ?, department = ?, manager_name = ?, edited_fields = ?, updated_at = ?, updated_by_staff = 1
         WHERE id = ?`,
        [(staffEmail || '').toLowerCase(), staffName, staffData.title || null, staffData.department || null, staffData.managerName || null, editedFieldsJson, now, id]
    );

    // Merge skills & projects incrementally — untouched rows are never rewritten
    await mergeSkills(db, id, skills);
    await mergeProjects(db, id, projects);

    await markStaffUpdated(db, staffEmail);
    await auditSubmissionSave(db, {
        staffEmail,
        actorEmail,
        id,
        editedFields,
        oldSkills: oldSkillRows,
        newSkills: skills.map(({ skill, rating }) => ({ skill, rating })),
        oldProjects: oldProjectRows,
        newProjects: projects
    });
}

// ── DELETE /:id/skills/:skillId — Remove one skill row (explicit) ────────────
router.delete('/:id/skills/:skillId', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const { id, skillId } = req.params;
        const [rows] = await db.query(
            'SELECT skill FROM submission_skills WHERE id = ? AND submission_id = ?',
            [skillId, id]
        );
        const [result] = await db.query(
            'DELETE FROM submission_skills WHERE id = ? AND submission_id = ?',
            [skillId, id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Skill row not found' });
        }
        const staffEmail = req.user.email || '';
        await markStaffUpdated(db, staffEmail);
        await logAudit(db, {
            staffEmail,
            actorEmail: staffEmail,
            section: 'skills',
            action: 'delete',
            summary: `Removed skill: ${rows[0] ? rows[0].skill : skillId}`
        });
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE skill error:', err);
        res.status(500).json({ error: 'Failed to remove skill' });
    }
});

// ── DELETE /:id/projects/:projectId — Remove one project row (explicit) ──────
router.delete('/:id/projects/:projectId', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const { id, projectId } = req.params;
        const [rows] = await db.query(
            'SELECT project_name FROM submission_projects WHERE id = ? AND submission_id = ?',
            [projectId, id]
        );
        const [result] = await db.query(
            'DELETE FROM submission_projects WHERE id = ? AND submission_id = ?',
            [projectId, id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Project row not found' });
        }
        const staffEmail = req.user.email || '';
        await markStaffUpdated(db, staffEmail);
        await logAudit(db, {
            staffEmail,
            actorEmail: staffEmail,
            section: 'projects',
            action: 'delete',
            summary: `Removed active project: ${rows[0] ? rows[0].project_name : projectId}`
        });
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE project error:', err);
        res.status(500).json({ error: 'Failed to remove project' });
    }
});

export { router };
