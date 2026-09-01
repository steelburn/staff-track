import express from 'express';
import { getDb } from '../db.js';
import { verifyToken, requireRole } from './auth.js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { logAudit } from '../utils/audit.js';
import { skillCharNorm, buildProposals, buildSplitProposals, pickCanonical } from '../utils/skillMatching.js';

const router = express.Router();

// ── Date formatting helper ──────────────────────────────────────────────────
/**
 * Format a date value to YYYY-MM-DD string.
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

// requireAdmin must include verifyToken so req.user is populated
const requireAdmin = [verifyToken, requireRole('admin')];

const BEESUITE_API_BASE = process.env.BEESUITE_API_URL || 'https://appcore.beesuite.app';
// ZCS DreamFactory (same backend DB as AppCore, but a single bulk query replaces
// ~306 per-staff employment-detail calls). Key lives in the host .env (ZCS_API_KEY).
const ZCS_API_BASE = process.env.ZCS_API_URL || 'https://api.zen.com.my/api/v2/zcs_v2';
const ZCS_API_KEY = process.env.ZCS_API_KEY || '';

// ── GET /admin/roles ──────────────────────────────────────────────────────────
// Get all users with their roles
router.get('/roles', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const db = await getDb();
        const [rows] = await db.query('SELECT email, role, is_hr, is_coordinator, is_active FROM user_roles ORDER BY email');
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
        const { email, role, is_hr, is_coordinator, is_active = true } = req.body;

        if (!email) return res.status(400).json({ error: 'email is required' });
        if (!role) return res.status(400).json({ error: 'role is required' });

        // Validate role
        const validRoles = ['admin', 'hr', 'coordinator', 'sa', 'sales', 'staff'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Must be one of: ' + validRoles.join(', ') });
        }

        // Determine is_hr and is_coordinator flags
        // If explicit flags are provided, use them; otherwise derive from role
        let hrFlag = is_hr !== undefined ? (is_hr ? 1 : 0) : (role === 'hr' || role === 'admin' ? 1 : 0);
        let coordFlag = is_coordinator !== undefined ? (is_coordinator ? 1 : 0) : (role === 'coordinator' || role === 'admin' ? 1 : 0);

        // When admin role is explicitly set, ensure both flags are set
        if (role === 'admin') {
            hrFlag = 1;
            coordFlag = 1;
        }

        // Insert or update role with flags
        await db.query(
            `INSERT INTO user_roles (email, role, is_hr, is_coordinator, is_active) 
             VALUES (?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE 
                role = VALUES(role), 
                is_hr = VALUES(is_hr), 
                is_coordinator = VALUES(is_coordinator), 
                is_active = VALUES(is_active)`,
            [email, role, hrFlag, coordFlag, is_active]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('POST /admin/roles error:', err);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

// ── Skill consolidation helpers ──────────────────────────────────────────────
// NOTE: db.query() wraps mysql2 connection.execute() (prepared statements),
// which does NOT expand arrays for `IN (?)` — build the placeholders manually.
function inPlaceholders(arr) {
    return arr.map(() => '?').join(',');
}

// Snapshot the full before-state of affected rows so the latest op per actor
// can be rolled back exactly (see GET/POST /admin/skills/undo below).
async function snapshotSkillRows(db, skillNames, actorEmail, action, summary) {
    const [rows] = await db.query(
        `SELECT id, submission_id, skill, rating FROM submission_skills
         WHERE skill IN (${inPlaceholders(skillNames)})`,
        skillNames
    );
    await db.query(
        `INSERT INTO skill_undo_log (actor_email, action, summary, before_state, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [(actorEmail || '').toLowerCase(), action, summary || null,
         JSON.stringify(rows), new Date().toISOString().slice(0, 19).replace('T', ' ')]
    );
    return rows.length;
}

async function restoreSnapshot(db, beforeState) {
    for (const row of beforeState) {
        const [exists] = await db.query('SELECT id FROM submission_skills WHERE id = ?', [row.id]);
        if (exists.length > 0) {
            await db.query('UPDATE submission_skills SET skill = ?, rating = ? WHERE id = ?',
                [row.skill, row.rating, row.id]);
        } else {
            await db.query(
                'INSERT INTO submission_skills (id, submission_id, skill, rating) VALUES (?, ?, ?, ?)',
                [row.id, row.submission_id, row.skill, row.rating]
            );
        }
    }
}

// Collapse duplicate (submission_id, skill) rows left behind by a merge:
// keep the highest rating per submission, ties keep the lowest id.
async function dedupeSkillRows(db, skillName) {
    const [result] = await db.query(
        `DELETE d FROM submission_skills d
         JOIN submission_skills k
           ON k.submission_id = d.submission_id AND k.skill = d.skill
           AND (k.rating > d.rating OR (k.rating = d.rating AND k.id < d.id))
         WHERE d.skill = ?`,
        [skillName]
    );
    return result.affectedRows;
}

// ── GET /admin/skills ────────────────────────────────────────────────────────
// Full skill catalog for the consolidation UI: every distinct skill grouped by
// normalized spelling (variants listed), plus machine-suggested duplicate
// groups for human review.
router.get('/skills', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const db = await getDb();
        const [rows] = await db.query('SELECT skill, submission_id FROM submission_skills');

        // Group by char-normalized key; variants = alternate spellings.
        const groupsMap = new Map(); // key -> { key, variants: Map<name,instances>, subs: Set, instances }
        for (const row of rows) {
            const key = skillCharNorm(row.skill);
            let g = groupsMap.get(key);
            if (!g) {
                g = { key, variants: new Map(), subs: new Set(), instances: 0 };
                groupsMap.set(key, g);
            }
            g.instances++;
            g.variants.set(row.skill, (g.variants.get(row.skill) || 0) + 1);
            g.subs.add(row.submission_id);
        }

        const skills = [...groupsMap.values()].map(g => {
            const variants = [...g.variants.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
            const [label] = variants[0];
            return {
                name: label,
                count: g.subs.size,
                instances: g.instances,
                variants: variants.slice(1).map(([name, n]) => ({ name, instances: n }))
            };
        }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

        const groupRecords = [...groupsMap.values()].map(g => {
            const variants = [...g.variants.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
            return { key: g.key, label: variants[0][0], count: g.subs.size, instances: g.instances };
        });

        const proposals = buildProposals(Object.fromEntries(groupRecords.map(g => [g.key, g])));
        const splitProposals = buildSplitProposals(Object.fromEntries(groupRecords.map(g => [g.key, g])));

        res.json({ skills, proposals, splitProposals });
    } catch (err) {
        console.error('GET /admin/skills error:', err);
        res.status(500).json({ error: 'Failed to fetch skills' });
    }
});

// ── POST /admin/skills/preview ───────────────────────────────────────────────
// Dry-run for a merge: which staff submissions would change and which would
// collide (dedupe). Powers the confirmation modal on the System page.
router.post('/skills/preview', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const { sourceSkills, targetSkill } = req.body;
        if (!targetSkill || !targetSkill.trim()) {
            return res.status(400).json({ error: 'targetSkill is required' });
        }
        if (!Array.isArray(sourceSkills) || sourceSkills.length === 0) {
            return res.status(400).json({ error: 'sourceSkills array is required' });
        }

        const db = await getDb();
        const target = targetSkill.trim();
        const sources = [...new Set(sourceSkills.map(s => s.trim())
            .filter(s => s && s.toLowerCase() !== target.toLowerCase()))];
        if (sources.length === 0) {
            return res.status(400).json({ error: 'No source skills to merge (all equal the target)' });
        }

        const [rows] = await db.query(
            `SELECT sk.id, sk.submission_id, sk.skill, sk.rating,
                    s.staff_name, s.staff_email
             FROM submission_skills sk
             JOIN submissions s ON sk.submission_id = s.id
             WHERE sk.skill IN (${inPlaceholders(sources)})
             ORDER BY sk.skill, s.staff_name`,
            sources
        );

        // Submissions that also carry the target (or two source skills) will
        // produce duplicate rows after the merge and get deduped.
        const [targetRows] = await db.query(
            'SELECT DISTINCT submission_id FROM submission_skills WHERE skill = ?', [target]
        );
        const targetSubs = new Set(targetRows.map(r => r.submission_id));

        const bySub = new Map();
        rows.forEach(r => {
            if (!bySub.has(r.submission_id)) bySub.set(r.submission_id, []);
            bySub.get(r.submission_id).push(r);
        });

        let dedupeRows = 0;
        for (const [subId, subRows] of bySub) {
            const totalAfter = subRows.length + (targetSubs.has(subId) ? 1 : 0);
            if (totalAfter > 1) dedupeRows += totalAfter - 1;
        }

        const outRows = rows.map(r => ({
            submissionId: r.submission_id,
            staffName: r.staff_name,
            staffEmail: r.staff_email,
            skill: r.skill,
            rating: r.rating,
            newSkill: target,
            willDedupe: (bySub.get(r.submission_id).length > 1 || targetSubs.has(r.submission_id))
        }));

        res.json({
            success: true,
            rows: outRows,
            summary: {
                sourceCount: sources.length,
                affectedRows: outRows.length,
                affectedSubmissions: bySub.size,
                dedupeRows
            }
        });
    } catch (err) {
        console.error('POST /admin/skills/preview error:', err);
        res.status(500).json({ error: 'Failed to preview merge: ' + err.message });
    }
});

// ── POST /admin/skills/merge ─────────────────────────────────────────────────
router.post('/skills/merge', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const { targetSkill, sourceSkills } = req.body;

        if (!targetSkill || !targetSkill.trim()) {
            return res.status(400).json({ error: 'targetSkill is required' });
        }
        if (!Array.isArray(sourceSkills) || sourceSkills.length === 0) {
            return res.status(400).json({ error: 'sourceSkills array is required' });
        }

        const db = await getDb();
        const trimmedTarget = targetSkill.trim();
        const sources = [...new Set(sourceSkills.map(s => s.trim())
            .filter(s => s && s.toLowerCase() !== trimmedTarget.toLowerCase()))];

        if (sources.length === 0) {
            return res.status(400).json({ error: 'No source skills to merge (all equal the target)' });
        }

        const [existRows] = await db.query(
            `SELECT DISTINCT skill FROM submission_skills WHERE skill IN (${inPlaceholders(sources)})`,
            sources
        );
        if (existRows.length === 0) {
            return res.status(404).json({ error: 'None of the selected skills exist.' });
        }

        const actor = (req.user || {}).email || 'unknown';
        await snapshotSkillRows(db, [...sources, trimmedTarget], actor, 'merge',
            `Merged ${sources.length} skills into "${trimmedTarget}"`);

        let totalAffected = 0;
        for (const sourceSkill of sources) {
            const [result] = await db.query(
                'UPDATE submission_skills SET skill = ? WHERE skill = ?',
                [trimmedTarget, sourceSkill]
            );
            totalAffected += result.affectedRows;
        }
        const deduped = await dedupeSkillRows(db, trimmedTarget);

        await logAudit(db, {
            staffEmail: null, actorEmail: actor, section: 'skills_admin', action: 'merge',
            summary: `Merged ${sources.length} skills into "${trimmedTarget}" (${totalAffected} rows, ${deduped} deduped)`,
            details: { sourceSkills: sources, targetSkill: trimmedTarget, affectedCount: totalAffected, dedupedCount: deduped }
        });

        console.log(`Merged ${sources.length} skills into "${trimmedTarget}": ${totalAffected} records updated, ${deduped} deduped`);
        res.json({
            success: true,
            affectedCount: totalAffected,
            dedupedCount: deduped,
            undoAvailable: true,
            message: `Merged into "${trimmedTarget}" (${totalAffected} records updated${deduped ? `, ${deduped} duplicate rows removed` : ''})`
        });
    } catch (err) {
        console.error('POST /admin/skills/merge error:', err);
        res.status(500).json({ error: 'Failed to merge skills: ' + err.message });
    }
});

// ── POST /admin/skills/rename ────────────────────────────────────────────────
router.post('/skills/rename', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const { oldName, newName } = req.body;

        if (!oldName || !oldName.trim()) {
            return res.status(400).json({ error: 'oldName is required' });
        }
        if (!newName || !newName.trim()) {
            return res.status(400).json({ error: 'newName is required' });
        }

        const db = await getDb();
        const trimmedOld = oldName.trim();
        const trimmedNew = newName.trim();

        if (trimmedOld.toLowerCase() === trimmedNew.toLowerCase()) {
            return res.status(400).json({ error: 'Old name and new name are the same' });
        }

        // Check if new name already exists (case-insensitive collation)
        const [existing] = await db.query(
            'SELECT COUNT(*) as cnt FROM submission_skills WHERE skill = ?',
            [trimmedNew]
        );
        if (existing[0].cnt > 0) {
            return res.status(400).json({ error: `Skill "${trimmedNew}" already exists. Use merge instead.` });
        }

        const actor = (req.user || {}).email || 'unknown';
        await snapshotSkillRows(db, [trimmedOld], actor, 'rename',
            `Renamed "${trimmedOld}" to "${trimmedNew}"`);

        const [result] = await db.query(
            'UPDATE submission_skills SET skill = ? WHERE skill = ?',
            [trimmedNew, trimmedOld]
        );

        await logAudit(db, {
            staffEmail: null, actorEmail: actor, section: 'skills_admin', action: 'rename',
            summary: `Renamed "${trimmedOld}" to "${trimmedNew}" (${result.affectedRows} rows)`,
            details: { oldName: trimmedOld, newName: trimmedNew, affectedCount: result.affectedRows }
        });

        console.log(`Renamed skill "${trimmedOld}" to "${trimmedNew}": ${result.affectedRows} records updated`);
        res.json({
            success: true,
            affectedCount: result.affectedRows,
            undoAvailable: true,
            message: `Renamed "${trimmedOld}" to "${trimmedNew}" (${result.affectedRows} records updated)`
        });
    } catch (err) {
        console.error('POST /admin/skills/rename error:', err);
        res.status(500).json({ error: 'Failed to rename skill: ' + err.message });
    }
});

// ── POST /admin/skills/standardize ──────────────────────────────────────────
// Merge all spelling variants of a skill group (same normalized spelling,
// e.g. "PowerBI" / "Power BI") into one canonical spelling. The canonical
// name must be one of the existing spellings — renaming to a brand-new name
// belongs to /skills/rename.
router.post('/skills/standardize', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const { skillName, canonical } = req.body;
        if (!skillName || !skillName.trim()) {
            return res.status(400).json({ error: 'skillName is required' });
        }

        const db = await getDb();
        const key = skillCharNorm(skillName.trim());

        // All spellings in this normalized group, with instance counts.
        // COLLATE utf8mb4_bin is required — the skill column uses a
        // case-insensitive collation (utf8mb4_0900_ai_ci), so a plain GROUP BY
        // would collapse "MySQL" / "mysql" / "MySql" into one row and hide
        // the variants. (BINARY would work but returns Buffers, not strings.)
        const [groupRows] = await db.query(
            'SELECT skill COLLATE utf8mb4_bin AS skill, COUNT(*) AS instances FROM submission_skills GROUP BY skill COLLATE utf8mb4_bin'
        );
        const spellings = groupRows
            .filter(r => skillCharNorm(r.skill) === key)
            .map(r => ({ name: r.skill, instances: r.instances }))
            .sort((a, b) => b.instances - a.instances || a.name.localeCompare(b.name));
        if (spellings.length < 2) {
            return res.status(400).json({ error: `No spelling variants found for "${skillName.trim()}"` });
        }

        const canonicalName = (canonical && canonical.trim()) ? canonical.trim() : pickCanonical(spellings);
        // Standardization is about case/accent variants, so the canonical must
        // match one of the spellings EXACTLY (case-sensitive) — the whole point
        // is that "MySql" and "MySQL" are different spellings of one skill.
        if (!spellings.some(s => s.name === canonicalName)) {
            return res.status(400).json({ error: `"${canonicalName}" is not an exact spelling of this skill group — use Rename to introduce a new name` });
        }

        const sources = spellings.filter(s => s.name !== canonicalName);
        if (sources.length === 0) {
            return res.status(400).json({ error: 'No variants to standardize' });
        }

        const actor = (req.user || {}).email || 'unknown';
        await snapshotSkillRows(db, [...sources.map(s => s.name), canonicalName], actor, 'standardize',
            `Standardized ${spellings.length} spellings into "${canonicalName}"`);

        let totalAffected = 0;
        for (const src of sources) {
            // Exact (binary) match — the skill column is case-insensitive, so a
            // plain "WHERE skill = ?" would re-match every case variant of the
            // canonical and inflate the affected count.
            const [result] = await db.query(
                'UPDATE submission_skills SET skill = ? WHERE skill COLLATE utf8mb4_bin = ?',
                [canonicalName, src.name]
            );
            totalAffected += result.affectedRows;
        }
        const deduped = await dedupeSkillRows(db, canonicalName);

        await logAudit(db, {
            staffEmail: null, actorEmail: actor, section: 'skills_admin', action: 'standardize',
            summary: `Standardized ${spellings.length} spellings into "${canonicalName}" (${totalAffected} rows, ${deduped} deduped)`,
            details: { variants: spellings.map(s => s.name), canonical: canonicalName, affectedCount: totalAffected, dedupedCount: deduped }
        });

        console.log(`Standardized skill group into "${canonicalName}": ${totalAffected} records updated, ${deduped} deduped`);
        res.json({
            success: true,
            affectedCount: totalAffected,
            dedupedCount: deduped,
            undoAvailable: true,
            message: `Standardized "${canonicalName}" (${totalAffected} records updated${deduped ? `, ${deduped} duplicate rows removed` : ''})`
        });
    } catch (err) {
        console.error('POST /admin/skills/standardize error:', err);
        res.status(500).json({ error: 'Failed to standardize skill: ' + err.message });
    }
});

// ── POST /admin/skills/split ─────────────────────────────────────────────────
// Split a skill into multiple new skills (distributes staff submissions round-robin)
router.post('/skills/split', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const { originalSkill, newSkills } = req.body;

        if (!originalSkill || !originalSkill.trim()) {
            return res.status(400).json({ error: 'originalSkill is required' });
        }
        if (!Array.isArray(newSkills) || newSkills.length < 2) {
            return res.status(400).json({ error: 'newSkills must be an array with at least 2 items' });
        }

        const db = await getDb();
        const trimmedOriginal = originalSkill.trim();
        const trimmedNewSkills = newSkills.map(s => s.trim()).filter(s => s);

        if (trimmedNewSkills.length < 2) {
            return res.status(400).json({ error: 'Please provide at least two valid new skill names' });
        }

        const [submissions] = await db.query(
            'SELECT id, submission_id, rating FROM submission_skills WHERE skill = ?',
            [trimmedOriginal]
        );

        if (submissions.length === 0) {
            return res.status(404).json({ error: `No submissions found with skill "${trimmedOriginal}"` });
        }

        const actor = (req.user || {}).email || 'unknown';
        await snapshotSkillRows(db, [trimmedOriginal], actor, 'split',
            `Split "${trimmedOriginal}" into ${trimmedNewSkills.length} skills`);

        let totalAffected = 0;
        for (let i = 0; i < submissions.length; i++) {
            const newSkillName = trimmedNewSkills[i % trimmedNewSkills.length];
            await db.query(
                'UPDATE submission_skills SET skill = ? WHERE id = ?',
                [newSkillName, submissions[i].id]
            );
            totalAffected++;
        }

        // When a proposed part already exists in the catalog (e.g. splitting
        // "HTML / CSS" into "HTML" and "CSS"), the round-robin above can create
        // within-submission duplicates. Collapse them, keeping the highest
        // rating — identical semantics to the merge endpoint.
        let totalDeduped = 0;
        for (const ns of trimmedNewSkills) {
            totalDeduped += await dedupeSkillRows(db, ns);
        }

        await logAudit(db, {
            staffEmail: null, actorEmail: actor, section: 'skills_admin', action: 'split',
            summary: `Split "${trimmedOriginal}" into ${trimmedNewSkills.length} skills (${totalAffected} rows${totalDeduped ? `, ${totalDeduped} deduped` : ''})`,
            details: { originalSkill: trimmedOriginal, newSkills: trimmedNewSkills, affectedCount: totalAffected, dedupedCount: totalDeduped }
        });

        console.log(`Split skill "${trimmedOriginal}" into ${trimmedNewSkills.length} skills: ${totalAffected} records updated${totalDeduped ? `, ${totalDeduped} deduped` : ''}`);
        res.json({
            success: true,
            affectedCount: totalAffected,
            dedupedCount: totalDeduped,
            undoAvailable: true,
            message: `Split "${trimmedOriginal}" into ${trimmedNewSkills.length} skills (${totalAffected} records updated${totalDeduped ? `, ${totalDeduped} duplicate rows removed` : ''})`
        });
    } catch (err) {
        console.error('POST /admin/skills/split error:', err);
        res.status(500).json({ error: 'Failed to split skill: ' + err.message });
    }
});

// ── DELETE /admin/skills ─────────────────────────────────────────────────────
// Delete all instances of a skill
router.delete('/skills', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const { skillName } = req.body;

        if (!skillName || !skillName.trim()) {
            return res.status(400).json({ error: 'skillName is required' });
        }

        const db = await getDb();
        const trimmedName = skillName.trim();

        const actor = (req.user || {}).email || 'unknown';
        await snapshotSkillRows(db, [trimmedName], actor, 'delete',
            `Deleted "${trimmedName}"`);

        const [result] = await db.query(
            'DELETE FROM submission_skills WHERE skill = ?',
            [trimmedName]
        );

        await logAudit(db, {
            staffEmail: null, actorEmail: actor, section: 'skills_admin', action: 'delete',
            summary: `Deleted "${trimmedName}" (${result.affectedRows} rows)`,
            details: { skillName: trimmedName, deletedCount: result.affectedRows }
        });

        console.log(`Deleted skill "${trimmedName}": ${result.affectedRows} records removed`);
        res.json({
            success: true,
            deletedCount: result.affectedRows,
            undoAvailable: true,
            message: `Deleted "${trimmedName}" (${result.affectedRows} records removed)`
        });
    } catch (err) {
        console.error('DELETE /admin/skills error:', err);
        res.status(500).json({ error: 'Failed to delete skill: ' + err.message });
    }
});

// ── GET /admin/skills/undo ───────────────────────────────────────────────────
// Is there a skill consolidation operation to undo for this actor?
router.get('/skills/undo', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const db = await getDb();
        const actor = (req.user || {}).email || 'unknown';
        const [rows] = await db.query(
            `SELECT id, action, summary, JSON_LENGTH(before_state) AS affected, created_at
             FROM skill_undo_log
             WHERE actor_email = ?
             ORDER BY id DESC LIMIT 1`,
            [actor.toLowerCase()]
        );
        if (rows.length === 0) return res.json({ available: false });
        res.json({
            available: true,
            id: rows[0].id,
            action: rows[0].action,
            summary: rows[0].summary,
            affected: rows[0].affected,
            createdAt: rows[0].created_at
        });
    } catch (err) {
        console.error('GET /admin/skills/undo error:', err);
        res.status(500).json({ error: 'Failed to fetch undo state' });
    }
});

// ── POST /admin/skills/undo ──────────────────────────────────────────────────
// Roll back the most recent skill consolidation op for this actor.
router.post('/skills/undo', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const db = await getDb();
        const actor = (req.user || {}).email || 'unknown';
        const [rows] = await db.query(
            'SELECT * FROM skill_undo_log WHERE actor_email = ? ORDER BY id DESC LIMIT 1',
            [actor.toLowerCase()]
        );
        if (rows.length === 0) {
            return res.status(400).json({ error: 'Nothing to undo' });
        }

        const undo = rows[0];
        // mysql2 auto-parses JSON columns — before_state may already be an object.
        let beforeState = undo.before_state;
        if (typeof beforeState === 'string') {
            try {
                beforeState = JSON.parse(beforeState);
            } catch {
                return res.status(500).json({ error: 'Stored undo snapshot is corrupt' });
            }
        }
        if (!Array.isArray(beforeState)) {
            return res.status(500).json({ error: 'Stored undo snapshot is corrupt' });
        }

        await restoreSnapshot(db, beforeState);
        await db.query('DELETE FROM skill_undo_log WHERE id = ?', [undo.id]);

        await logAudit(db, {
            staffEmail: null, actorEmail: actor, section: 'skills_admin', action: 'undo',
            summary: `Undid ${undo.action}: ${undo.summary}`,
            details: { restored: beforeState.length, action: undo.action }
        });

        console.log(`Undid ${undo.action} (${undo.summary}): ${beforeState.length} records restored`);
        res.json({
            success: true,
            restored: beforeState.length,
            action: undo.action,
            message: `Undid ${undo.action} — ${beforeState.length} records restored`
        });
    } catch (err) {
        console.error('POST /admin/skills/undo error:', err);
        res.status(500).json({ error: 'Failed to undo: ' + err.message });
    }
});

router.delete('/staff/:email', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const db = await getDb();
        const { email } = req.params;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        
        const [existing] = await db.query('SELECT email FROM staff WHERE email = ?', [email]);
        
        if (existing.length === 0) {
            return res.status(404).json({ error: 'Staff member not found' });
        }
        
        await db.query(
            'UPDATE user_roles SET is_active = 0, updated_at = ? WHERE email = ?',
            [new Date().toISOString().slice(0, 19).replace('T', ' '), email]
        );
        
        res.json({ success: true, message: `Staff member ${email} has been deactivated` });
    } catch (err) {
        console.error('DELETE /admin/staff/:email error:', err);
        res.status(500).json({ error: 'Failed to deactivate staff member' });
    }
});

// In-memory sync status (resets on restart)
const syncStatus = {
    inProgress: false,
    startedAt: null,
    phase: '',           // 'login' | 'fetch-details' | 'update-db' | 'deactivate' | 'done' | 'error'
    percent: 0,          // weighted 0-100 overall progress (login 0-5, fetch 5-65, db 65-95, deactivate 95-100)
    progress: 0,
    total: 0,
    currentStaff: '',
    stats: { added: 0, updated: 0, skipped: 0, inactiveSkipped: 0, resignedSkipped: 0, wrongTenantDeactivated: 0, detailFailures: 0 },
    errors: [],
    completed: false,
    result: null
};

// Run async work over items with limited concurrency (worker pool). A hung
// BeeSuite call only occupies one worker instead of stalling the whole sync.
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return results;
}

// Fetch one staff's employment detail with timeout + retries so a single
// hung/throttled BeeSuite request can't stall the whole sync forever.
async function fetchEmploymentDetail(staff, accessToken, maxAttempts = 3) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await axios.get(
                `${BEESUITE_API_BASE}/api/admin/user-info-details/employment-detail/${staff.id}`,
                { headers: { 'Authorization': `JWT ${accessToken}` }, timeout: 15000 }
            );
            return res.data?.employmentDetail || null;
        } catch (err) {
            lastErr = err;
            if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 400 * attempt)); // 400ms, 800ms backoff
            }
        }
    }
    throw lastErr;
}

router.get('/sync-staff/status', verifyToken, requireRole('admin'), async (req, res) => {
    res.json({
        inProgress: syncStatus.inProgress,
        phase: syncStatus.phase,
        percent: syncStatus.percent,
        progress: syncStatus.progress,
        total: syncStatus.total,
        currentStaff: syncStatus.currentStaff,
        stats: syncStatus.stats,
        completed: syncStatus.completed,
        result: syncStatus.result
    });
});

router.post('/sync-staff', verifyToken, requireRole('admin'), async (req, res) => {
    if (syncStatus.inProgress) {
        return res.status(409).json({ error: 'Sync already in progress', startedAt: syncStatus.startedAt });
    }
    
    syncStatus.inProgress = true;
    syncStatus.startedAt = new Date().toISOString();
    syncStatus.phase = 'login';
    syncStatus.percent = 0;
    syncStatus.progress = 0;
    syncStatus.total = 0;
    syncStatus.currentStaff = '';
    syncStatus.stats = { added: 0, updated: 0, skipped: 0, inactiveSkipped: 0, resignedSkipped: 0, wrongTenantDeactivated: 0, detailFailures: 0 };
    syncStatus.errors = [];
    syncStatus.completed = false;
    syncStatus.result = null;
    
    res.json({ started: true, message: 'Sync started in background', syncId: syncStatus.startedAt });
    
    setImmediate(async () => {
        try {
            const db = await getDb();
            
            const BEESUITE_EMAIL = process.env.BEESUITE_EMAIL || 'khairulnizam@zen.com.my';
            const BEESUITE_PASSWORD = process.env.BEESUITE_PASSWORD || 'RXZlcnlvbmUjNzkwMTI0MDY1NDYz';
            
            const authResponse = await axios.post(`${BEESUITE_API_BASE}/api/auth/login`, {
                email: BEESUITE_EMAIL,
                password: BEESUITE_PASSWORD
            }, { timeout: 20000 });

            const accessToken = authResponse.data.access_token;

            if (!accessToken) {
                throw new Error('Failed to authenticate with BeeSuite API');
            }

            const staffResponse = await axios.get(`${BEESUITE_API_BASE}/api/users/staff`, {
                headers: { 'Authorization': `JWT ${accessToken}` },
                timeout: 30000
            });

            let staffList = staffResponse.data;

            if (!Array.isArray(staffList)) {
                throw new Error('Invalid response format from BeeSuite API');
            }

            const referenceCompanyId = staffList.length > 0 ? staffList[0].companyId : null;
            const filteredStaffList = staffList.filter(s => s.companyId === referenceCompanyId);
            const validEmails = new Set(filteredStaffList.map(s => s.email?.toLowerCase()).filter(Boolean));

            syncStatus.total = filteredStaffList.length;

            // ── Phase 1: fetch employment details ──
            // One DreamFactory bulk query returns the latest user_info for every
            // staff (manager GUID → name + PROPERTIES_XML dateOfResignation) in
            // ~0.3s, vs ~46s of per-staff AppCore employment-detail calls. Falls
            // back to the per-staff AppCore path (8 workers, timeout + retry) when
            // the bulk query is unavailable (no ZCS_API_KEY / API error) or for
            // staff the bulk dump doesn't cover.
            syncStatus.phase = 'fetch-details';
            const details = new Map(); // email(lowercase) -> {reportingToName, dateOfResignation}

            const xmlResignationDate = (xml) => {
                const m = String(xml || '').match(/<dateOfResignation>([^<]*)<\/dateOfResignation>/);
                const v = m && m[1] ? m[1].trim() : '';
                return (v && !/^invalid/i.test(v)) ? v : null;
            };

            let unmatchedStaff = filteredStaffList;
            if (ZCS_API_KEY) {
                try {
                    const dfRes = await axios.get(`${ZCS_API_BASE}/_table/user_info`, {
                        headers: { 'X-DreamFactory-API-Key': ZCS_API_KEY },
                        params: {
                            fields: 'USER_INFO_GUID,USER_GUID,FULLNAME,MANAGER_USER_GUID,RESIGNATION_DATE,UPDATE_TS,PROPERTIES_XML',
                            limit: 2000
                        },
                        timeout: 60000
                    });
                    const rows = dfRes.data?.resource;
                    if (Array.isArray(rows)) {
                        const byInfoGuid = new Map();   // USER_INFO_GUID -> record (staff.id == USER_INFO_GUID)
                        const latestByUser = new Map(); // USER_GUID -> latest record by UPDATE_TS
                        for (const r of rows) {
                            byInfoGuid.set(r.USER_INFO_GUID, r);
                            const prev = latestByUser.get(r.USER_GUID);
                            if (!prev || (r.UPDATE_TS || '') > (prev.UPDATE_TS || '')) latestByUser.set(r.USER_GUID, r);
                        }
                        unmatchedStaff = [];
                        for (const staff of filteredStaffList) {
                            if (!staff.email) continue;
                            syncStatus.currentStaff = staff.email;
                            syncStatus.progress++;
                            syncStatus.percent = 5 + Math.round((syncStatus.progress / Math.max(syncStatus.total, 1)) * 60);
                            const rec = byInfoGuid.get(staff.id);
                            if (!rec) { unmatchedStaff.push(staff); continue; }
                            const mgrGuid = rec.MANAGER_USER_GUID;
                            const detail = {
                                reportingToName: (mgrGuid && latestByUser.get(mgrGuid)?.FULLNAME) || null,
                                dateOfResignation: xmlResignationDate(rec.PROPERTIES_XML) || rec.RESIGNATION_DATE || null
                            };
                            if (detail.reportingToName || detail.dateOfResignation) {
                                details.set(staff.email.toLowerCase(), detail);
                            } else {
                                unmatchedStaff.push(staff); // nothing usable — let AppCore try
                            }
                        }
                    }
                } catch (err) {
                    // bulk path failed — fall back to per-staff AppCore for everyone
                    unmatchedStaff = filteredStaffList;
                    if (syncStatus.errors.length < 100) {
                        syncStatus.errors.push({ staff: 'bulk', error: `user_info bulk: ${err.message}` });
                    }
                }
            }

            if (unmatchedStaff.length > 0) {
                // Per-staff AppCore fallback (8 parallel workers, 15s timeout +
                // 3 attempts + backoff). A hung BeeSuite call only occupies one
                // worker instead of stalling the whole sync.
                await mapLimit(unmatchedStaff, 8, async (staff) => {
                    if (!staff.email) return;
                    syncStatus.currentStaff = staff.email;
                    syncStatus.progress++;
                    syncStatus.percent = 5 + Math.round((syncStatus.progress / Math.max(syncStatus.total, 1)) * 60);
                    try {
                        const detail = await fetchEmploymentDetail(staff, accessToken);
                        if (detail) details.set(staff.email.toLowerCase(), detail);
                    } catch (err) {
                        syncStatus.stats.detailFailures++;
                        if (syncStatus.errors.length < 100) {
                            syncStatus.errors.push({ staff: staff.email, error: `employment-detail: ${err.message}` });
                        }
                    }
                });
            }

            let added = 0, updated = 0, skipped = 0, inactiveSkipped = 0, resignedSkipped = 0, wrongTenantDeactivated = 0;

            // ── Phase 2: upsert staff + roles (sequential local DB writes) ──
            syncStatus.phase = 'update-db';
            syncStatus.progress = 0;
            for (let i = 0; i < filteredStaffList.length; i++) {
                const staff = filteredStaffList[i];
                const email = staff.email;
                const name = staff.employeeName;
                const title = staff.designation;
                const department = staff.department;
                syncStatus.currentStaff = email || 'Unknown';
                syncStatus.progress = i + 1;
                syncStatus.percent = 65 + Math.round(((i + 1) / Math.max(filteredStaffList.length, 1)) * 30);

                try {
                    if (!email || !name) {
                        skipped++;
                        continue;
                    }

                    const emp = details.get(email.toLowerCase());
                    let managerName = null;
                    let isResigned = false;

                    if (emp) {
                        managerName = emp.reportingToName || null;

                        if (emp.dateOfResignation && emp.dateOfResignation !== 'Invalid Date' && emp.dateOfResignation !== 'Invalid date') {
                            const resDate = new Date(emp.dateOfResignation);
                            if (!isNaN(resDate.getTime()) && resDate < new Date()) {
                                isResigned = true;
                            }
                        }
                    }

                    const [existing] = await db.query('SELECT email, manager_name FROM staff WHERE email = ?', [email]);
                    if (!managerName && existing.length > 0) {
                        managerName = existing[0].manager_name;
                    }

                    const shouldDeactivate = staff.status !== 'Active' || isResigned;

                    if (shouldDeactivate) {
                        if (existing.length > 0) {
                            await db.query('UPDATE user_roles SET is_active = 0, updated_at = ? WHERE email = ?',
                                [new Date().toISOString().slice(0, 19).replace('T', ' '), email]);
                            if (staff.status !== 'Active') inactiveSkipped++;
                            else resignedSkipped++;
                            updated++;
                        } else {
                            if (staff.status !== 'Active') inactiveSkipped++;
                            else resignedSkipped++;
                            skipped++;
                        }
                        continue;
                    }

                    if (existing.length > 0) {
                        await db.query('UPDATE staff SET name = ?, title = ?, department = ?, manager_name = ? WHERE email = ?',
                            [name, title, department, managerName, email]);
                        updated++;
                    } else {
                        await db.query('INSERT INTO staff (email, name, title, department, manager_name) VALUES (?, ?, ?, ?, ?)',
                            [email, name, title, department, managerName]);
                        added++;
                    }

                    const [existingRole] = await db.query('SELECT email FROM user_roles WHERE email = ?', [email]);
                    if (existingRole.length === 0) {
                        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
                        await db.query('INSERT INTO user_roles (email, role, is_hr, is_coordinator, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [email, 'staff', 0, 0, 1, now, now]);
                    } else {
                        // Staff is active in BeeSuite (this loop only reaches here when
                        // shouldDeactivate is false) — make sure the local role is active too.
                        // Previously the sync only ever deactivated roles and never
                        // reactivated them, leaving active staff invisible (e.g. is_active=0
                        // stuck from an older deactivation).
                        await db.query('UPDATE user_roles SET is_active = 1, updated_at = ? WHERE email = ? AND is_active = 0',
                            [new Date().toISOString().slice(0, 19).replace('T', ' '), email]);
                    }
                } catch (err) {
                    if (syncStatus.errors.length < 100) {
                        syncStatus.errors.push({ staff: staff.email || staff.name, error: err.message });
                    }
                    skipped++;
                }
            }

            // ── Phase 3: deactivate wrong-tenant accounts ──
            syncStatus.phase = 'deactivate';
            syncStatus.percent = 96;
            // Get local staff emails to identify wrong-tenant users
            const [localStaffRows] = await db.query('SELECT email FROM staff WHERE email IS NOT NULL');
            const localEmails = localStaffRows.map(r => r.email?.toLowerCase()).filter(Boolean);
            const wrongTenantEmails = localEmails.filter(e => !validEmails.has(e));
            for (const email of wrongTenantEmails) {
                await db.query('UPDATE user_roles SET is_active = 0, updated_at = ? WHERE email = ? AND is_active = 1',
                    [new Date().toISOString().slice(0, 19).replace('T', ' '), email]);
                wrongTenantDeactivated++;
            }

            syncStatus.stats = { added, updated, skipped, inactiveSkipped, resignedSkipped, wrongTenantDeactivated, detailFailures: syncStatus.stats.detailFailures };
            syncStatus.phase = 'done';
            syncStatus.percent = 100;
            syncStatus.completed = true;
            syncStatus.result = {
                success: true,
                count: added,
                updated,
                skipped,
                inactiveSkipped,
                resignedSkipped,
                wrongTenantDeactivated,
                detailFailures: syncStatus.stats.detailFailures,
                message: `Sync complete: ${added} added, ${updated} updated, ${skipped} skipped (${inactiveSkipped} inactive, ${resignedSkipped} resigned, ${wrongTenantDeactivated} wrong tenant)`
            };
        } catch (err) {
            syncStatus.phase = 'error';
            syncStatus.result = { success: false, error: err.message };
        } finally {
            syncStatus.inProgress = false;
        }
    });
});

// ── POST /admin/sync-projects-catalog ──────────────────────────────────────
// Sync projects from BeeSuite AppCore /admin/soc/list endpoint
const BEESUITE_EMAIL = process.env.BEESUITE_EMAIL || 'khairulnizam@zen.com.my';
const BEESUITE_PASSWORD = process.env.BEESUITE_PASSWORD || 'RXZlcnlvbmUjNzkwMTI0MDY1NDYz';

router.post('/sync-projects-catalog', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const db = await getDb();

        // Authenticate with BeeSuite API
        const authResponse = await axios.post(`${BEESUITE_API_BASE}/api/auth/login`, {
            email: BEESUITE_EMAIL,
            password: BEESUITE_PASSWORD
        });
        const accessToken = authResponse.data.access_token;

        if (!accessToken) {
            throw new Error('Failed to authenticate with BeeSuite API');
        }

        // Fetch SOC list from BeeSuite
        const response = await axios.get(`${BEESUITE_API_BASE}/admin/soc/list`, {
            headers: { 'Authorization': `JWT ${accessToken}` }
        });

        let socList = response.data;

        // Handle different response formats
        if (socList && socList.data) {
            socList = socList.data;
        }
        if (!Array.isArray(socList)) {
            throw new Error('Invalid response format from BeeSuite API');
        }

        let added = 0, updated = 0, skipped = 0, unchanged = 0;

        for (const item of socList) {
            // Extract project info from SOC item
            const soc = item.soc || item.soc_code || item.code || '';
            const projectName = item.project_name || item.name || item.projectName || '';
            const customer = item.customer || item.client || item.customer_name || '';
            const startDate = item.start_date || item.startDate || null;
            const endDate = item.end_date || item.endDate || null;
            const technologies = item.technologies || item.tech || '';
            const description = item.description || item.project_brief || '';

            if (!soc && !projectName) {
                skipped++;
                continue;
            }

            // Check if project exists by SOC or project_name
            const [existing] = await db.query(
                'SELECT id, soc, project_name, customer, end_date FROM projects_catalog WHERE soc = ? OR project_name = ?',
                [soc, projectName]
            );

            if (existing && existing.length > 0) {
                // Check if anything changed
                const e = existing[0];
                const hasChanges = 
                    e.soc !== soc || 
                    e.project_name !== projectName || 
                    e.customer !== customer ||
                    e.end_date !== endDate;

                if (hasChanges) {
                    await db.query(
                        `UPDATE projects_catalog 
                         SET soc = ?, project_name = ?, customer = ?, end_date = ?
                         WHERE id = ?`,
                        [soc, projectName, customer, endDate, e.id]
                    );
                    updated++;
                } else {
                    unchanged++;
                }
            } else {
                await db.query(
                    `INSERT INTO projects_catalog (id, soc, project_name, customer, start_date, end_date)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [uuidv4(), soc, projectName, customer, startDate, endDate]
                );
                added++;
            }
        }

        console.log(`BeeSuite sync: ${added} added, ${updated} updated, ${unchanged} unchanged, ${skipped} skipped`);
        res.json({
            success: true,
            message: `Sync complete: ${added} added, ${updated} updated, ${unchanged} unchanged, ${skipped} skipped`,
            stats: { added, updated, unchanged, skipped, total: socList.length }
        });
    } catch (err) {
        console.error('BeeSuite sync error:', err);
        res.status(500).json({ error: 'Failed to sync from BeeSuite: ' + err.message });
    }
});

// ── GET /admin/projects-catalog ──────────────────────────────────────────────
// Get all projects from local database (for admin view)
router.get('/projects-catalog', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const db = await getDb();
        const [rows] = await db.query(
            'SELECT id, soc, project_name, customer, start_date, end_date FROM projects_catalog ORDER BY project_name'
        );
        // Format dates before returning
        const formattedRows = rows.map(r => ({
            ...r,
            start_date: formatDate(r.start_date),
            end_date: formatDate(r.end_date)
        }));
        res.json(formattedRows);
    } catch (err) {
        console.error('GET /admin/projects-catalog error:', err);
        res.status(500).json({ error: 'Failed to fetch projects catalog' });
    }
});

export { router };
