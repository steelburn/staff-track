import express from 'express';
import { getDb } from '../db.js';
import { verifyToken, requireRole } from './auth.js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

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

// ── POST /admin/skills/merge ─────────────────────────────────────────────────
// Merge multiple skills into a single target skill
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
        let totalAffected = 0;

        // For each source skill, update all submission_skills to point to the target skill
        for (const sourceSkill of sourceSkills) {
            const trimmedSource = sourceSkill.trim();
            
            // Skip if source equals target (case-insensitive)
            if (trimmedSource.toLowerCase() === trimmedTarget.toLowerCase()) {
                continue;
            }

            // Update all submission_skills entries from source to target
            const [result] = await db.query(
                'UPDATE submission_skills SET skill = ? WHERE skill = ?',
                [trimmedTarget, trimmedSource]
            );
            totalAffected += result.affectedRows;
        }

        console.log(`Merged ${sourceSkills.length} skills into "${trimmedTarget}": ${totalAffected} records updated`);
        res.json({ 
            success: true, 
            affectedCount: totalAffected,
            message: `Merged into "${trimmedTarget}" (${totalAffected} records updated)`
        });
    } catch (err) {
        console.error('POST /admin/skills/merge error:', err);
        res.status(500).json({ error: 'Failed to merge skills: ' + err.message });
    }
});

// ── POST /admin/skills/rename ────────────────────────────────────────────────
// Rename a skill
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

        if (trimmedOld === trimmedNew) {
            return res.status(400).json({ error: 'Old name and new name are the same' });
        }

        // Check if new name already exists
        const [existing] = await db.query(
            'SELECT COUNT(*) as cnt FROM submission_skills WHERE skill = ?',
            [trimmedNew]
        );
        if (existing[0].cnt > 0) {
            return res.status(400).json({ error: `Skill "${trimmedNew}" already exists. Use merge instead.` });
        }

        // Update all submission_skills entries
        const [result] = await db.query(
            'UPDATE submission_skills SET skill = ? WHERE skill = ?',
            [trimmedNew, trimmedOld]
        );

        console.log(`Renamed skill "${trimmedOld}" to "${trimmedNew}": ${result.affectedRows} records updated`);
        res.json({ 
            success: true, 
            affectedCount: result.affectedRows,
            message: `Renamed "${trimmedOld}" to "${trimmedNew}" (${result.affectedRows} records updated)`
        });
    } catch (err) {
        console.error('POST /admin/skills/rename error:', err);
        res.status(500).json({ error: 'Failed to rename skill: ' + err.message });
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

        // Get all submissions with the original skill
        const [submissions] = await db.query(
            'SELECT id, submission_id, rating FROM submission_skills WHERE skill = ?',
            [trimmedOriginal]
        );

        if (submissions.length === 0) {
            return res.status(404).json({ error: `No submissions found with skill "${trimmedOriginal}"` });
        }

        let totalAffected = 0;

        // Distribute submissions round-robin among new skills
        for (let i = 0; i < submissions.length; i++) {
            const newSkillName = trimmedNewSkills[i % trimmedNewSkills.length];
            
            await db.query(
                'UPDATE submission_skills SET skill = ? WHERE id = ?',
                [newSkillName, submissions[i].id]
            );
            totalAffected++;
        }

        console.log(`Split skill "${trimmedOriginal}" into ${trimmedNewSkills.length} skills: ${totalAffected} records updated`);
        res.json({ 
            success: true, 
            affectedCount: totalAffected,
            message: `Split "${trimmedOriginal}" into ${trimmedNewSkills.length} skills (${totalAffected} records updated)`
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

        // Delete all submission_skills entries with this skill name
        const [result] = await db.query(
            'DELETE FROM submission_skills WHERE skill = ?',
            [trimmedName]
        );

        console.log(`Deleted skill "${trimmedName}": ${result.affectedRows} records removed`);
        res.json({ 
            success: true, 
            deletedCount: result.affectedRows,
            message: `Deleted "${trimmedName}" (${result.affectedRows} records removed)`
        });
    } catch (err) {
        console.error('DELETE /admin/skills error:', err);
        res.status(500).json({ error: 'Failed to delete skill: ' + err.message });
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
    progress: 0,
    total: 0,
    currentStaff: '',
    stats: { added: 0, updated: 0, skipped: 0, inactiveSkipped: 0, resignedSkipped: 0, wrongTenantDeactivated: 0 },
    errors: [],
    completed: false,
    result: null
};

router.get('/sync-staff/status', verifyToken, requireRole('admin'), async (req, res) => {
    res.json({
        inProgress: syncStatus.inProgress,
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
    syncStatus.progress = 0;
    syncStatus.total = 0;
    syncStatus.currentStaff = '';
    syncStatus.stats = { added: 0, updated: 0, skipped: 0, inactiveSkipped: 0, resignedSkipped: 0, wrongTenantDeactivated: 0 };
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
            });

            const accessToken = authResponse.data.access_token;

            if (!accessToken) {
                throw new Error('Failed to authenticate with BeeSuite API');
            }

            const staffResponse = await axios.get(`${BEESUITE_API_BASE}/api/users/staff`, {
                headers: { 'Authorization': `JWT ${accessToken}` }
            });

            let staffList = staffResponse.data;

            if (!Array.isArray(staffList)) {
                throw new Error('Invalid response format from BeeSuite API');
            }

            const referenceCompanyId = staffList.length > 0 ? staffList[0].companyId : null;
            const filteredStaffList = staffList.filter(s => s.companyId === referenceCompanyId);
            const validEmails = new Set(filteredStaffList.map(s => s.email?.toLowerCase()).filter(Boolean));

            let added = 0, updated = 0, skipped = 0, inactiveSkipped = 0, resignedSkipped = 0, wrongTenantDeactivated = 0;
            syncStatus.total = filteredStaffList.length;

            for (let i = 0; i < filteredStaffList.length; i++) {
                const staff = filteredStaffList[i];
                const staffName = staff.email || 'Unknown';
                syncStatus.currentStaff = staffName;
                syncStatus.progress = i + 1;

                try {
                    const email = staff.email;
                    const name = staff.employeeName;
                    const title = staff.designation;
                    const department = staff.department;

                    if (!email || !name) {
                        skipped++;
                        continue;
                    }

                    const [existing] = await db.query('SELECT email, manager_name FROM staff WHERE email = ?', [email]);
                    const isNewStaff = existing.length === 0;

                    let managerName = existing.length > 0 ? existing[0].manager_name : null;
                    let isResigned = false;

                    try {
                        const empRes = await axios.get(
                            `${BEESUITE_API_BASE}/api/admin/user-info-details/employment-detail/${staff.id}`,
                            { headers: { 'Authorization': `JWT ${accessToken}` } }
                        );

                        if (empRes.data?.employmentDetail) {
                            const emp = empRes.data.employmentDetail;
                            managerName = emp.reportingToName;

                            if (emp.dateOfResignation && emp.dateOfResignation !== 'Invalid Date' && emp.dateOfResignation !== 'Invalid date') {
                                const resDate = new Date(emp.dateOfResignation);
                                if (!isNaN(resDate.getTime()) && resDate < new Date()) {
                                    isResigned = true;
                                }
                            }
                        }
                    } catch (empErr) {
                        syncStatus.errors.push({ staff: email, error: empErr.message });
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
                    syncStatus.errors.push({ staff: staff.email || staff.name, error: err.message });
                    skipped++;
                }
            }

            // Get local staff emails to identify wrong-tenant users
            const [localStaffRows] = await db.query('SELECT email FROM staff WHERE email IS NOT NULL');
            const localEmails = localStaffRows.map(r => r.email?.toLowerCase()).filter(Boolean);
            const wrongTenantEmails = localEmails.filter(e => !validEmails.has(e));
            for (const email of wrongTenantEmails) {
                await db.query('UPDATE user_roles SET is_active = 0, updated_at = ? WHERE email = ? AND is_active = 1',
                    [new Date().toISOString().slice(0, 19).replace('T', ' '), email]);
                wrongTenantDeactivated++;
            }

            syncStatus.stats = { added, updated, skipped, inactiveSkipped, resignedSkipped, wrongTenantDeactivated };
            syncStatus.completed = true;
            syncStatus.result = {
                success: true,
                count: added,
                updated,
                skipped,
                inactiveSkipped,
                resignedSkipped,
                wrongTenantDeactivated,
                message: `Sync complete: ${added} added, ${updated} updated, ${skipped} skipped (${inactiveSkipped} inactive, ${resignedSkipped} resigned, ${wrongTenantDeactivated} wrong tenant)`
            };
        } catch (err) {
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
