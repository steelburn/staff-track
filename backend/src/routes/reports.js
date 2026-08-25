import express from 'express';
import { getDb } from '../db.js';
import { verifyToken, requireRole } from './auth.js';

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

// All report routes require authentication and a reporting role
// Also allow users who have subordinates (manager role)
const requireReporterOrManager = [verifyToken]; // We'll check roles manually for flexibility

// ── Helper: Check if user has any subordinates ─────────────────────────────
async function getUserSubordinates(db, userEmail) {
    // Get the user's name from staff table
    const [userRows] = await db.query('SELECT name FROM staff WHERE email = ?', [userEmail]);
    if (userRows.length === 0) return [];
    
    const userName = userRows[0].name;
    if (!userName) return [];

    // Recursive CTE to find all subordinates (direct and indirect)
    const query = `
        WITH RECURSIVE subordinates AS (
            -- Base case: direct subordinates
            SELECT email, name, manager_name
            FROM staff
            WHERE manager_name = ?
            
            UNION ALL
            
            -- Recursive case: subordinates of subordinates
            SELECT s.email, s.name, s.manager_name
            FROM staff s
            INNER JOIN subordinates sub ON s.manager_name = sub.name
        )
        SELECT email FROM subordinates
    `;
    
    const [rows] = await db.query(query, [userName]);
    return rows.map(r => r.email.toLowerCase());
}

// ── Helper: Check if user has required access ──────────────────────────────
function hasReportAccess(user) {
    if (!user) return false;
    const isAdmin = user.isAdmin === true;
    const isHR = user.is_hr === 1 || user.is_hr === true;
    const isCoordinator = user.is_coordinator === 1 || user.is_coordinator === true;
    return isAdmin || isHR || isCoordinator;
}

// ── GET /reports/my-subordinates ─────────────────────────────────────────────
// Returns list of subordinate emails for the current user
router.get('/my-subordinates', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const email = req.user.email.toLowerCase();
        
        const subordinates = await getUserSubordinates(db, email);
        res.json({ subordinates, count: subordinates.length });
    } catch (err) {
        console.error('GET /reports/my-subordinates error:', err);
        res.status(500).json({ error: 'Failed to fetch subordinates' });
    }
});

// ── GET /reports/staff ────────────────────────────────────────────────────────
router.get('/staff', requireReporterOrManager, async (req, res) => {
    try {
        const db = await getDb();
        const includeInactive = req.query.include_inactive === 'true';
        const subordinatesOnly = req.query.subordinates_only === 'true';
        
        // Check access: admin/hr/coordinator can see all, managers can only see subordinates
        const userHasFullAccess = hasReportAccess(req.user);
        
        let subordinateEmails = [];
        if (subordinatesOnly && !userHasFullAccess) {
            subordinateEmails = await getUserSubordinates(db, req.user.email.toLowerCase());
            if (subordinateEmails.length === 0) {
                return res.json([]);
            }
        }
        
        // Get all staff with their projects and skills
        const joinClause = includeInactive 
            ? 'LEFT JOIN user_roles ur ON s.staff_email = ur.email' 
            : 'INNER JOIN user_roles ur ON s.staff_email = ur.email AND ur.is_active = 1';
        
        let query = `
            SELECT 
                s.id,
                s.staff_name,
                s.staff_email,
                s.title,
                s.department,
                s.manager_name,
                s.updated_at,
                s.updated_by_staff,
                p.id as project_id,
                p.soc,
                p.project_name,
                p.customer,
                p.role,
                p.start_date,
                p.end_date,
                mp.type_infra,
                mp.type_software,
                mp.type_infra_support,
                mp.type_software_support,
                sk.skill,
                sk.rating
            FROM submissions s
            ${joinClause}
            LEFT JOIN submission_projects p ON s.id = p.submission_id
            LEFT JOIN managed_projects mp ON (mp.soc = p.soc OR (p.soc IS NULL AND mp.project_name = p.project_name))
            LEFT JOIN submission_skills sk ON s.id = sk.submission_id
        `;
        
        const params = [];
        if (subordinatesOnly && !userHasFullAccess && subordinateEmails.length > 0) {
            query += ` WHERE LOWER(s.staff_email) IN (${subordinateEmails.map(() => '?').join(',')})`;
            params.push(...subordinateEmails);
        }
        
        query += ` ORDER BY s.staff_name ASC, p.soc ASC, sk.skill ASC`;

        const [rows] = await db.query(query, params);

        // Group by staff
        const staffMap = new Map();
        rows.forEach(row => {
            if (!staffMap.has(row.id)) {
                staffMap.set(row.id, {
                    id: row.id,
                    staffName: row.staff_name || '',
                    email: row.staff_email,
                    title: row.title || '',
                    department: row.department || '',
                    managerName: row.manager_name || '',
                    updatedAt: row.updated_at,
                    updatedByStaff: row.updated_by_staff,
                    projects: [],
                    skills: []
                });
            }

            const staff = staffMap.get(row.id);

            // Add project if not already added
            if (row.project_id && !staff.projects.find(p => p.id === row.project_id)) {
                staff.projects.push({
                    id: row.project_id,
                    soc: row.soc,
                    projectName: row.project_name,
                    customer: row.customer,
                    role: row.role,
                    startDate: formatDate(row.start_date),
                    endDate: formatDate(row.end_date),
                    type_infra: row.type_infra,
                    type_software: row.type_software,
                    type_infra_support: row.type_infra_support,
                    type_software_support: row.type_software_support
                });
            }

            // Add skill if not already added
            if (row.skill && !staff.skills.find(sk => sk.skill === row.skill)) {
                staff.skills.push({
                    skill: row.skill,
                    rating: row.rating
                });
            }
        });

        res.json(Array.from(staffMap.values()));
    } catch (err) {
        console.error('GET /reports/staff error:', err);
        res.status(500).json({ error: 'Failed to fetch staff report' });
    }
});

// ── GET /reports/projects ─────────────────────────────────────────────────────
router.get('/projects', requireReporterOrManager, async (req, res) => {
    try {
        const db = await getDb();

        const isAdminOrHR = req.user.isAdmin === true || req.user.is_hr === 1 || req.user.is_hr === true;
        const email = req.user.email.toLowerCase();

        let query = `
      SELECT
        p.id as assignment_id, p.id as id, p.soc, p.project_name, p.customer, p.role, p.start_date, p.end_date as staff_end_date,
        s.staff_name, s.staff_email, s.id as submission_id,
        mp.type_infra, mp.type_software, mp.type_infra_support, mp.type_software_support,
        mp.coordinator_email
      FROM submission_projects p
      JOIN submissions s ON p.submission_id = s.id
      LEFT JOIN managed_projects mp ON (mp.soc = p.soc OR (p.soc IS NULL AND mp.project_name = p.project_name))
    `;

        let params = [];
        if (!isAdminOrHR) {
            // Coordinator: Only show projects where they are in the coordinators list
            query += ` WHERE mp.coordinator_email LIKE ? OR mp.coordinator_email = ?`;
            params = ['%"' + email + '"%', email];
        }

        const [rows] = await db.query(query, params);

        const projectMap = new Map();

        rows.forEach(row => {
            const key = row.soc || row.project_name || '(unknown)';
            if (!projectMap.has(key)) {
                projectMap.set(key, {
                    ...row,
                    start_date: formatDate(row.start_date),
                    staff_end_date: formatDate(row.staff_end_date),
                    submissions: []
                });
            }
            // Format dates for each submission
            const formattedRow = {
                ...row,
                start_date: formatDate(row.start_date),
                staff_end_date: formatDate(row.staff_end_date)
            };
            projectMap.get(key).submissions.push(formattedRow);
        });

        res.json(Array.from(projectMap.values()));
    } catch (err) {
        console.error('GET /reports/projects error:', err);
        res.status(500).json({ error: 'Failed to fetch projects report' });
    }
});

// ── GET /reports/skills ───────────────────────────────────────────────────────
router.get('/skills', requireReporterOrManager, async (req, res) => {
    try {
        const db = await getDb();
        const subordinatesOnly = req.query.subordinates_only === 'true';
        
        // Check access: admin/hr/coordinator can see all, managers can only see subordinates
        const userHasFullAccess = hasReportAccess(req.user);
        
        let subordinateEmails = [];
        if (subordinatesOnly && !userHasFullAccess) {
            subordinateEmails = await getUserSubordinates(db, req.user.email.toLowerCase());
            if (subordinateEmails.length === 0) {
                return res.json([]);
            }
        }

        // Get all unique skills with staff members who have them
        let query = `
            SELECT 
                sk.skill,
                sk.rating,
                s.staff_name,
                s.staff_email,
                s.title,
                s.department,
                s.id as submission_id
            FROM submission_skills sk
            JOIN submissions s ON sk.submission_id = s.id
        `;
        
        const params = [];
        if (subordinatesOnly && !userHasFullAccess && subordinateEmails.length > 0) {
            query += ` WHERE LOWER(s.staff_email) IN (${subordinateEmails.map(() => '?').join(',')})`;
            params.push(...subordinateEmails);
        }
        
        query += ` ORDER BY sk.skill ASC, sk.rating DESC`;

        const [rows] = await db.query(query, params);

        // Group by skill, normalizing case + whitespace so ".NET" / ".net" /
        // ".NET " (trailing space) collapse into one catalog entry. The display
        // label is the most common spelling; staff lists are merged.
        const normalizeSkill = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

        const skillGroups = new Map(); // normKey -> { variants: Map<label,count>, staff: [] }
        rows.forEach(row => {
            const raw = (row.skill || '').trim();
            const key = normalizeSkill(raw);
            if (!skillGroups.has(key)) skillGroups.set(key, { variants: new Map(), staff: [] });
            const g = skillGroups.get(key);
            g.variants.set(raw, (g.variants.get(raw) || 0) + 1);
            g.staff.push({
                name: row.staff_name,
                email: row.staff_email,
                title: row.title,
                department: row.department,
                rating: row.rating,
                submissionId: row.submission_id
            });
        });

        const result = [];
        for (const [key, g] of skillGroups) {
            let label = key;
            let bestCount = -1;
            for (const [variant, count] of g.variants) {
                if (count > bestCount || (count === bestCount && variant.length < label.length)) {
                    label = variant;
                    bestCount = count;
                }
            }
            result.push({ skill: label, staff: g.staff });
        }
        result.sort((a, b) => a.skill.localeCompare(b.skill, undefined, { sensitivity: 'base' }));

        res.json(result);
    } catch (err) {
        console.error('GET /reports/skills error:', err);
        res.status(500).json({ error: 'Failed to fetch skills report' });
    }
});

// ── GET /reports/staff-search ──────────────────────────────────────────────────
router.get('/staff-search', requireReporterOrManager, async (req, res) => {
    try {
        const db = await getDb();
        const subordinatesOnly = req.query.subordinates_only === 'true';
        
        // Check access: admin/hr/coordinator can see all, managers can only see subordinates
        const userHasFullAccess = hasReportAccess(req.user);
        
        let subordinateEmails = [];
        if (subordinatesOnly && !userHasFullAccess) {
            subordinateEmails = await getUserSubordinates(db, req.user.email.toLowerCase());
            if (subordinateEmails.length === 0) {
                return res.json([]);
            }
        }
        
        // Parse skill filters from query parameter
        const skillFilters = req.query.skills ? JSON.parse(decodeURIComponent(req.query.skills)) : [];
        
        // Build subordinate filter clause
        const subordinateFilter = subordinateEmails.length > 0
            ? ` LOWER(s.staff_email) IN (${subordinateEmails.map(() => '?').join(',')})`
            : null;
        
        if (skillFilters.length === 0) {
            // If no filters, return all staff with their skills
            let query = `
                SELECT 
                    s.id,
                    s.staff_name,
                    s.staff_email,
                    s.title,
                    s.department,
                    s.manager_name,
                    sk.skill,
                    sk.rating
                FROM submissions s
                LEFT JOIN submission_skills sk ON s.id = sk.submission_id
            `;
            
            const params = [];
            if (subordinatesOnly && !userHasFullAccess && subordinateFilter) {
                query += ` WHERE ${subordinateFilter}`;
                params.push(...subordinateEmails);
            }
            query += ` ORDER BY s.staff_name ASC, sk.skill ASC`;
            
            const [rows] = await db.query(query, params);
            
            // Group by staff member
            const staffMap = new Map();
            rows.forEach(row => {
                if (!staffMap.has(row.id)) {
                    staffMap.set(row.id, {
                        id: row.id,
                        staffName: row.staff_name,
                        staffEmail: row.staff_email,
                        title: row.title,
                        department: row.department,
                        managerName: row.manager_name,
                        skills: []
                    });
                }
                if (row.skill) {
                    staffMap.get(row.id).skills.push({
                        skill: row.skill,
                        rating: row.rating
                    });
                }
            });
            
            return res.json(Array.from(staffMap.values()));
        }
        
        // Build dynamic WHERE clause for multiple skill filters
        // We need staff who have ALL the required skills at the minimum rating
        let whereClauses = ['s.id IN ('];
        
        // Build subquery: get staff IDs that have ALL required skills
        const subqueryParts = [];
        skillFilters.forEach(filter => {
            subqueryParts.push(`
                SELECT sk.submission_id 
                FROM submission_skills sk 
                WHERE LOWER(sk.skill) = LOWER(?) AND sk.rating >= ?
            `);
        });
        
        let innerQuery = `
                SELECT submission_id 
                FROM (
        `;
        
        // Intersect all skill filters
        innerQuery += subqueryParts.join(' INTERSECT ');
        
        innerQuery += `
                ) AS matching_submissions
            )`;
        
        whereClauses.push(innerQuery);
        
        // Add subordinate filter if needed
        const params = [];
        skillFilters.forEach(filter => {
            params.push(filter.name);
            params.push(filter.minRating || 0);
        });
        
        if (subordinatesOnly && !userHasFullAccess && subordinateFilter) {
            whereClauses.push(`AND ${subordinateFilter}`);
            params.push(...subordinateEmails);
        }
        
        let query = `
            SELECT 
                s.id,
                s.staff_name,
                s.staff_email,
                s.title,
                s.department,
                s.manager_name,
                sk.skill,
                sk.rating
            FROM submissions s
            LEFT JOIN submission_skills sk ON s.id = sk.submission_id
            WHERE ${whereClauses.join(' ')}
            ORDER BY s.staff_name ASC, sk.skill ASC
        `;
        
        const [rows] = await db.query(query, params);
        
        // Group by staff member
        const staffMap = new Map();
        rows.forEach(row => {
            if (!staffMap.has(row.id)) {
                staffMap.set(row.id, {
                    id: row.id,
                    staffName: row.staff_name,
                    staffEmail: row.staff_email,
                    title: row.title,
                    department: row.department,
                    managerName: row.manager_name,
                    skills: []
                });
            }
            if (row.skill) {
                staffMap.get(row.id).skills.push({
                    skill: row.skill,
                    rating: row.rating
                });
            }
        });
        
        res.json(Array.from(staffMap.values()));
    } catch (err) {
        console.error('GET /reports/staff-search error:', err);
        res.status(500).json({ error: 'Failed to fetch staff search results' });
    }
});

export { router };
