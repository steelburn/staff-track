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

    // Recursive CTE to find all subordinates (direct and indirect).
    // The tree walks ALL staff regardless of is_active — activity is a per-query
    // concern (activeJoin filters results), NOT a tree property. Filtering the
    // walk by is_active hid active staff under inactive managers (e.g. active
    // Karuppasamy reports to inactive Maruthi) and could 403 a manager whose
    // whole chain is inactive, despite them having the right to a dashboard.
    // UNION (DISTINCT) doubles as a cycle guard — manager_name data contains
    // cycles (orgchart's breakCycles exists for the same reason); UNION ALL
    // loops forever and MySQL aborts at 1001 iterations (500 for any manager
    // under Yap's tree). Deduping costs nothing: the result is an email set.
    const query = `
        WITH RECURSIVE subordinates AS (
            -- Base case: direct subordinates
            SELECT s.email, s.name, s.manager_name
            FROM staff s
            WHERE s.manager_name = ?
            
            UNION
            
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

// ── Helpers: dashboard scope ───────────────────────────────────────────────
// mysql2 prepared statements do NOT expand arrays for IN (?); build placeholders.
function buildPlaceholders(arr) {
    return arr.map(() => '?').join(',');
}

// Resolve dashboard visibility. Returns { scope, emails } where emails is
// null for full-org scope and an array (lowercased) for subordinates scope.
async function resolveDashboardScope(db, user) {
    const hasFullAccess = hasReportAccess(user);
    if (hasFullAccess) return { scope: 'all', emails: null };
    const emails = await getUserSubordinates(db, user.email.toLowerCase());
    if (emails.length > 0) return { scope: 'subordinates', emails };
    return { scope: 'none', emails: null };
}

// Scope WHERE clause fragment. scopeEmails null => full org.
function scopeClause(scopeEmails, alias = 's') {
    if (!scopeEmails) return '';
    return ` AND LOWER(${alias}.email) IN (${buildPlaceholders(scopeEmails)})`;
}

// Department key: case/whitespace-insensitive (mirrors the SQL REGEXP_REPLACE
// normalization below, and the skills-catalog pattern). "PROJECT MANAGEMENT
// OFFICE" and "Project Management Office" are the SAME department.
function normDeptKey(dept) {
    return String(dept || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Department filter clause (staff aliased as s). null => all departments.
// Comparison is case/whitespace-insensitive; pass the NORMALIZED key as param.
function deptClause(deptKey) {
    if (!deptKey) return '';
    return " AND LOWER(REGEXP_REPLACE(TRIM(s.department), '[[:space:]]+', ' ')) = ?";
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
        // "All Staff" is a directory of every synced staff member (the staff
        // table, populated by the DreamFactory bulk sync), not just people who
        // have completed a submission. UNION keeps legacy submitters who have no
        // staff-table row (e.g. chen@zen.com.my) visible; LEFT JOINs mean staff
        // without submissions still appear with empty projects/skills.
        const joinClause = includeInactive 
            ? 'LEFT JOIN user_roles ur ON ur.email = people.email' 
            : 'INNER JOIN user_roles ur ON ur.email = people.email AND ur.is_active = 1';

        let query = `
            SELECT 
                people.email AS staff_email,
                COALESCE(st.name, s.staff_name) AS staff_name,
                COALESCE(st.title, s.title) AS title,
                COALESCE(st.department, s.department) AS department,
                COALESCE(st.manager_name, s.manager_name) AS manager_name,
                s.updated_at,
                s.updated_by_staff,
                s.id AS submission_id,
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
            FROM (
                SELECT email FROM staff
                UNION
                SELECT staff_email FROM submissions
            ) people
            ${joinClause}
            LEFT JOIN staff st ON LOWER(st.email) = LOWER(people.email)
            LEFT JOIN submissions s ON LOWER(s.staff_email) = LOWER(people.email)
            LEFT JOIN submission_projects p ON s.id = p.submission_id
            LEFT JOIN managed_projects mp ON (mp.soc = p.soc OR (p.soc IS NULL AND mp.project_name = p.project_name))
            LEFT JOIN submission_skills sk ON s.id = sk.submission_id
        `;
        
        const params = [];
        if (subordinatesOnly && !userHasFullAccess && subordinateEmails.length > 0) {
            query += ` WHERE LOWER(people.email) IN (${subordinateEmails.map(() => '?').join(',')})`;
            params.push(...subordinateEmails);
        }
        
        query += ` ORDER BY staff_name ASC, p.soc ASC, sk.skill ASC`;

        const [rows] = await db.query(query, params);

        // Group by person. Email is unique in the staff table and the UNION
        // dedupes, so each row maps to exactly one directory entry.
        const staffMap = new Map();
        rows.forEach(row => {
            if (!staffMap.has(row.staff_email)) {
                staffMap.set(row.staff_email, {
                    id: row.submission_id || null,
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

            const staff = staffMap.get(row.staff_email);

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
        const includeInactive = req.query.include_inactive === 'true';

        // Inactive staff (user_roles.is_active = 0) are excluded by default;
        // pass include_inactive=true to include them.
        const activeJoin = includeInactive
            ? 'LEFT JOIN user_roles ur ON s.staff_email = ur.email'
            : 'INNER JOIN user_roles ur ON s.staff_email = ur.email AND ur.is_active = 1';

        let query = `
      SELECT
        p.id as assignment_id, p.id as id, p.soc, p.project_name, p.customer, p.role, p.start_date, p.end_date as staff_end_date,
        s.staff_name, s.staff_email, s.department, s.id as submission_id,
        COALESCE(st.manager_name, s.manager_name) AS manager_name,
        mp.type_infra, mp.type_software, mp.type_infra_support, mp.type_software_support,
        mp.coordinator_email
      FROM submission_projects p
      JOIN submissions s ON p.submission_id = s.id
      ${activeJoin}
      LEFT JOIN staff st ON LOWER(st.email) = LOWER(s.staff_email)
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
        const includeInactive = req.query.include_inactive === 'true';
        
        // Check access: admin/hr/coordinator can see all, managers can only see subordinates
        const userHasFullAccess = hasReportAccess(req.user);
        
        let subordinateEmails = [];
        if (subordinatesOnly && !userHasFullAccess) {
            subordinateEmails = await getUserSubordinates(db, req.user.email.toLowerCase());
            if (subordinateEmails.length === 0) {
                return res.json([]);
            }
        }

        // Inactive staff (user_roles.is_active = 0) are excluded by default;
        // pass include_inactive=true to include them.
        const activeJoin = includeInactive
            ? 'LEFT JOIN user_roles ur ON s.staff_email = ur.email'
            : 'INNER JOIN user_roles ur ON s.staff_email = ur.email AND ur.is_active = 1';

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
            ${activeJoin}
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

// ── GET /reports/certifications ───────────────────────────────────────────────
// Org-wide certification catalog, grouped by normalized cert name (mirrors
// /reports/skills). HR and Admin only (server-enforced; managers/coordinators 403).
router.get('/certifications', verifyToken, async (req, res) => {
    try {
        const isAdmin = req.user.isAdmin === true;
        const isHR = req.user.is_hr === 1 || req.user.is_hr === true;
        if (!isAdmin && !isHR) {
            return res.status(403).json({ error: 'HR or Admin access required' });
        }

        const db = await getDb();
        const includeInactive = req.query.include_inactive === 'true';

        // Inactive staff (user_roles.is_active = 0) are excluded by default;
        // pass include_inactive=true to include them.
        const activeJoin = includeInactive
            ? 'LEFT JOIN user_roles ur ON ur.email = c.staff_email'
            : 'INNER JOIN user_roles ur ON ur.email = c.staff_email AND ur.is_active = 1';

        const query = `
            SELECT
                c.id,
                c.staff_email,
                c.name,
                c.issuer,
                c.date_obtained,
                c.expiry_date,
                c.credential_id,
                c.description,
                c.proof_path,
                c.is_visible,
                COALESCE(st.name, s.staff_name, c.staff_email) AS staff_name,
                COALESCE(st.title, s.title) AS title,
                COALESCE(st.department, s.department) AS department
            FROM certifications c
            ${activeJoin}
            LEFT JOIN staff st ON LOWER(st.email) = LOWER(c.staff_email)
            LEFT JOIN submissions s ON LOWER(s.staff_email) = LOWER(c.staff_email)
            ORDER BY c.name ASC, c.date_obtained DESC
        `;
        const [rows] = await db.query(query);

        // Group by cert name, normalizing case + whitespace so "AWS SAA" / "aws saa"
        // collapse into one catalog entry. Display label = most common spelling.
        const normalizeCert = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

        const certGroups = new Map(); // normKey -> { variants: Map<label,count>, staff: [] }
        rows.forEach(row => {
            const raw = (row.name || '').trim() || '(Untitled certification)';
            const key = normalizeCert(raw);
            if (!certGroups.has(key)) certGroups.set(key, { variants: new Map(), staff: [] });
            const g = certGroups.get(key);
            g.variants.set(raw, (g.variants.get(raw) || 0) + 1);
            g.staff.push({
                id: row.id,
                email: row.staff_email,
                name: row.staff_name,
                title: row.title || '',
                department: row.department || '',
                issuer: row.issuer || '',
                dateObtained: formatDate(row.date_obtained),
                expiryDate: formatDate(row.expiry_date),
                credentialId: row.credential_id || '',
                description: row.description || '',
                proofPath: row.proof_path || null,
                visible: row.is_visible !== 0
            });
        });

        const result = [];
        for (const [key, g] of certGroups) {
            let label = key;
            let bestCount = -1;
            for (const [variant, count] of g.variants) {
                if (count > bestCount || (count === bestCount && variant.length < label.length)) {
                    label = variant;
                    bestCount = count;
                }
            }
            result.push({ name: label, staff: g.staff });
        }
        result.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        res.json(result);
    } catch (err) {
        console.error('GET /reports/certifications error:', err);
        res.status(500).json({ error: 'Failed to fetch certifications report' });
    }
});

// ── GET /reports/staff-search ──────────────────────────────────────────────────
router.get('/staff-search', requireReporterOrManager, async (req, res) => {
    try {
        const db = await getDb();
        const subordinatesOnly = req.query.subordinates_only === 'true';
        const includeInactive = req.query.include_inactive === 'true';
        
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
        
        // Inactive staff (user_roles.is_active = 0) are excluded by default;
        // pass include_inactive=true to include them.
        const activeJoin = includeInactive
            ? 'LEFT JOIN user_roles ur ON s.staff_email = ur.email'
            : 'INNER JOIN user_roles ur ON s.staff_email = ur.email AND ur.is_active = 1';
        
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
                ${activeJoin}
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
            ${activeJoin}
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

// ── GET /reports/dashboard ───────────────────────────────────────────────────
// Aggregated org KPIs for management. Scope: all (admin/HR/coordinator),
// subordinates (managers, direct + indirect), or 403.
router.get('/dashboard', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const { scope, emails } = await resolveDashboardScope(db, req.user);
        if (scope === 'none') {
            return res.status(403).json({ error: 'Management dashboard access required' });
        }
        const includeInactive = req.query.include_inactive === 'true' && scope === 'all';
        const deptRaw = req.query.department ? String(req.query.department) : null;
        const deptKey = normDeptKey(deptRaw); // normalized for case-insensitive matching
        const payload = { scope, asOf: new Date().toISOString().slice(0, 10), includeInactive, department: deptKey || null };

        const activeJoin = includeInactive
            ? 'LEFT JOIN user_roles ur ON LOWER(ur.email) = LOWER(s.email)'
            : 'INNER JOIN user_roles ur ON LOWER(ur.email) = LOWER(s.email) AND ur.is_active = 1';
        const scopeEmails = emails; // may be null
        const sc = scopeClause(scopeEmails, 's');
        const dc = deptClause(deptKey);
        const params = [...(scopeEmails || []), ...(deptKey ? [deptKey] : [])];
        const deptParams = scopeEmails || []; // dept list stays unfiltered even when scoped

        // Headcount. byDepartment deliberately NOT department-filtered — it is
        // the org map (dropdown + drill-down chart stay complete while a dept
        // sub-dashboard is active). payload.departments reuses it. Case/space
        // variants of the same dept are MERGED (label = most common spelling).
        const [hcRows] = await db.query(
            `SELECT s.department AS department, COUNT(*) AS total,
                    SUM(ur.is_active = 1) AS active, SUM(ur.is_active = 0) AS inactive
             FROM staff s ${activeJoin}
             WHERE (s.department IS NOT NULL AND s.department <> '') ${sc}
             GROUP BY s.department ORDER BY active DESC, total DESC`,
            deptParams
        );
        const byDept = new Map();
        hcRows.forEach(r => {
            const k = normDeptKey(r.department);
            if (!byDept.has(k)) byDept.set(k, { department: r.department, total: 0, active: 0, inactive: 0 });
            const e = byDept.get(k);
            const prevTotal = e.total;
            e.total += Number(r.total);
            e.active += Number(r.active) || 0;
            e.inactive += Number(r.inactive) || 0;
            // most-common spelling wins the label (current row's count beats the
            // accumulated others => this spelling is the most common so far)
            if (Number(r.total) > prevTotal) e.department = r.department;
        });
        const byDepartment = [...byDept.values()]
            .sort((a, b) => b.active - a.active || b.total - a.total);

        // Resolve the requested dept to its canonical (most-common) spelling so
        // the banner + dropdown agree even when ?dept= used different casing.
        if (deptKey) {
            const match = byDepartment.find(d => normDeptKey(d.department) === deptKey);
            if (match) payload.department = match.department;
        }
        const [roleRows] = await db.query(
            `SELECT ur.role, COUNT(*) AS count FROM staff s ${activeJoin}
             WHERE ur.role IS NOT NULL ${sc} ${dc}
             GROUP BY ur.role ORDER BY count DESC`,
            params
        );
        const [totalRows] = await db.query(
            `SELECT COUNT(*) AS total, SUM(ur.is_active = 1) AS active, SUM(ur.is_active = 0) AS inactive
             FROM staff s ${activeJoin} WHERE 1=1 ${sc} ${dc}`,
            params
        );
        const hc = totalRows[0];
        payload.headcount = {
            total: hc.total, active: Number(hc.active) || 0, inactive: Number(hc.inactive) || 0,
            byDepartment,
            byRole: roleRows.map(r => ({ role: r.role, count: r.count }))
        };
        payload.departments = payload.headcount.byDepartment;

        // Org structure
        const [mgrRows] = await db.query(
            `SELECT s.manager_name AS name, COUNT(*) AS directReports,
                    COUNT(DISTINCT LOWER(REGEXP_REPLACE(TRIM(s.department), '[[:space:]]+', ' '))) AS departments
             FROM staff s ${activeJoin}
             WHERE s.manager_name IS NOT NULL AND s.manager_name <> '' ${sc} ${dc}
             GROUP BY s.manager_name ORDER BY directReports DESC LIMIT 20`,
            params
        );
        const [noMgrRows] = await db.query(
            `SELECT s.email, s.name, s.department, s.title
             FROM staff s ${activeJoin}
             WHERE (s.manager_name IS NULL OR s.manager_name = '') ${sc} ${dc}
             ORDER BY s.name`,
            params
        );
        const [orphanRows] = await db.query(
            `SELECT s.email, s.name, s.department, s.title, s.manager_name
             FROM staff s ${activeJoin}
             LEFT JOIN staff m ON m.name = s.manager_name AND m.email <> s.email
             WHERE (s.manager_name IS NOT NULL AND s.manager_name <> '') AND m.email IS NULL ${sc} ${dc}
             ORDER BY s.name`,
            params
        );
        payload.org = {
            managers: mgrRows,
            orphans: orphanRows.length,
            noManager: noMgrRows.length,
            topSpan: mgrRows.length ? mgrRows[0].directReports : 0,
            noManagerStaff: noMgrRows,
            orphanStaff: orphanRows
        };

        // Profile completeness (per active staff)
        const [compRows] = await db.query(
            `SELECT s.email, s.name, s.department,
                    (cp.id IS NOT NULL) AS hasProfile,
                    (cp.summary IS NOT NULL AND cp.summary <> '') AS hasSummary,
                    (SELECT COUNT(*) FROM submission_skills sk
                       JOIN submissions su ON su.id = sk.submission_id
                      WHERE LOWER(su.staff_email) = LOWER(s.email)) AS skillCount,
                    (SELECT COUNT(*) FROM education e WHERE LOWER(e.staff_email) = LOWER(s.email)) AS eduCount,
                    (SELECT COUNT(*) FROM certifications c WHERE LOWER(c.staff_email) = LOWER(s.email)) AS certCount,
                    (SELECT COUNT(*) FROM work_history w WHERE LOWER(w.staff_email) = LOWER(s.email)) AS whCount,
                    (SELECT COUNT(*) FROM cv_past_projects p WHERE LOWER(p.staff_email) = LOWER(s.email)) AS ppCount,
                    COALESCE(su.updated_by_staff, 0) AS updatedByStaff
             FROM staff s ${activeJoin}
             LEFT JOIN cv_profiles cp ON LOWER(cp.staff_email) = LOWER(s.email)
             LEFT JOIN submissions su ON LOWER(su.staff_email) = LOWER(s.email)
             WHERE 1=1 ${sc} ${dc}`,
            params
        );
        const buckets = { '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0 };
        let staffWithProfile = 0, staffWithSummary = 0, zeroSkill = 0, skillTotal = 0;
        const completenessRows = [];
        for (const r of compRows) {
            // Weighted: profile row 20, summary 20, skills 20, edu 10, certs 10, work history 10, past projects 10
            const score = Math.min(100,
                (r.hasProfile ? 20 : 0) + (r.hasSummary ? 20 : 0)
                + (r.skillCount > 0 ? 20 : 0) + (r.eduCount > 0 ? 10 : 0)
                + (r.certCount > 0 ? 10 : 0) + (r.whCount > 0 ? 10 : 0)
                + (r.ppCount > 0 ? 10 : 0));
            const key = score <= 20 ? '0-20' : score <= 40 ? '21-40' : score <= 60 ? '41-60' : score <= 80 ? '61-80' : '81-100';
            buckets[key]++;
            if (r.hasProfile) staffWithProfile++;
            if (r.hasSummary) staffWithSummary++;
            if (!r.skillCount) zeroSkill++;
            skillTotal += Number(r.skillCount) || 0;
            completenessRows.push({ name: r.name, email: r.email, department: r.department, score, updatedByStaff: r.updatedByStaff === 1 || r.updatedByStaff === true });
        }
        payload.completeness = {
            staffWithProfile, staffWithSummary,
            avgSkillCount: compRows.length ? +(skillTotal / compRows.length).toFixed(1) : 0,
            zeroSkillStaff: zeroSkill,
            buckets: Object.entries(buckets).map(([bucket, count]) => ({ bucket, count })),
            lowest: completenessRows.sort((a, b) => a.score - b.score).slice(0, 10).map(({ name, email, score }) => ({ name, email, score }))
        };

        // Engagement
        const [engRows] = await db.query(
            `SELECT COUNT(*) AS updatedCount FROM submissions su
             JOIN staff s ON LOWER(s.email) = LOWER(su.staff_email)
             ${includeInactive ? '' : "JOIN user_roles ur ON LOWER(ur.email) = LOWER(su.staff_email) AND ur.is_active = 1"}
             WHERE su.updated_by_staff = 1 ${sc} ${dc}`,
            params
        );
        // Activity series is scoped like the rest of the dashboard (staff join
        // for scope/department; active filter mirrors staffUpdatedCount).
        // NOTE: profile_audit_log was created utf8mb4_unicode_ci while staff/
        // user_roles are utf8mb4_0900_ai_ci — COLLATE forces the join (migration
        // 0012 normalises the columns; keep the COLLATE as belt-and-braces).
        const [seriesRows] = await db.query(
            `SELECT DATE(pal.created_at) AS d, COUNT(*) AS c
             FROM profile_audit_log pal
             JOIN staff s ON LOWER(s.email) = LOWER(pal.staff_email) COLLATE utf8mb4_0900_ai_ci
             ${includeInactive ? '' : "JOIN user_roles ur ON LOWER(ur.email) = LOWER(pal.staff_email) COLLATE utf8mb4_0900_ai_ci AND ur.is_active = 1"}
             WHERE pal.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) ${sc} ${dc}
             GROUP BY DATE(pal.created_at) ORDER BY d`,
            params
        );
        payload.engagement = {
            staffUpdatedCount: engRows[0] ? engRows[0].updatedCount : 0,
            edits30d: seriesRows.reduce((sum, r) => sum + r.c, 0),
            series: seriesRows.map(r => ({ date: formatDate(r.d), count: r.c }))
        };

        // Skills (top N by staff count, normalized case/whitespace like /reports/skills)
        const [skillRows] = await db.query(
            `SELECT REGEXP_REPLACE(TRIM(sk.skill), '[[:space:]]+', ' ') AS norm,
                    COUNT(DISTINCT LOWER(su.staff_email)) AS staffCount
             FROM submission_skills sk
             JOIN submissions su ON su.id = sk.submission_id
             JOIN staff s ON LOWER(s.email) = LOWER(su.staff_email)
             ${includeInactive ? '' : 'JOIN user_roles ur ON LOWER(ur.email) = LOWER(su.staff_email) AND ur.is_active = 1'}
             WHERE 1=1 ${sc} ${dc}
             GROUP BY norm ORDER BY staffCount DESC LIMIT 10`,
            params
        );
        payload.skills = { top: skillRows.map(r => ({ name: r.norm, staff: r.staffCount })) };

        // Projects
        const [catRows] = await db.query(`SELECT COUNT(*) AS n FROM projects_catalog`, []);
        const [manRows] = await db.query(`SELECT COUNT(*) AS n FROM managed_projects`, []);
        const [projCovRows] = await db.query(
            `SELECT COUNT(DISTINCT LOWER(su.staff_email)) AS staffWithProjects,
                    COUNT(DISTINCT sp.id) AS projectLinks
             FROM submission_projects sp
             JOIN submissions su ON su.id = sp.submission_id
             JOIN staff s ON LOWER(s.email) = LOWER(su.staff_email)
             ${includeInactive ? '' : 'JOIN user_roles ur ON LOWER(ur.email) = LOWER(su.staff_email) AND ur.is_active = 1'}
             WHERE 1=1 ${sc} ${dc}`,
            params
        );
        payload.projects = {
            catalogTotal: catRows[0].n,
            managedTotal: manRows[0].n,
            staffWithProjects: projCovRows[0] ? projCovRows[0].staffWithProjects : 0,
            projectLinks: projCovRows[0] ? projCovRows[0].projectLinks : 0
        };

        // Certifications (expiry status — same day-boundary logic as /reports/certifications).
        // Fetches detail rows so the frontend can drill down into expired/expiring lists.
        // Day boundaries come from the DB (CURDATE) to stay TZ-consistent with the old SUM query;
        // YYYY-MM-DD strings compare lexicographically.
        const [certRows] = await db.query(
            `SELECT c.staff_email, c.name, c.issuer, c.date_obtained, c.expiry_date, c.credential_id,
                    COALESCE(st.name, c.staff_email) AS staff_name,
                    CURDATE() AS today,
                    DATE_ADD(CURDATE(), INTERVAL 90 DAY) AS plus90
             FROM certifications c
             JOIN staff st ON LOWER(st.email) = LOWER(c.staff_email)
             JOIN staff s ON LOWER(s.email) = LOWER(c.staff_email)
             ${includeInactive ? '' : 'JOIN user_roles ur ON LOWER(ur.email) = LOWER(c.staff_email) AND ur.is_active = 1'}
             WHERE 1=1 ${sc} ${dc}`,
            params
        );
        const todayStr = formatDate(certRows[0] && certRows[0].today);
        const plus90Str = formatDate(certRows[0] && certRows[0].plus90);
        const expiredCerts = [], expiringCerts = [];
        for (const r of certRows) {
            const expiryStr = formatDate(r.expiry_date);
            if (!expiryStr) continue; // no expiry = valid
            const rec = {
                certName: r.name,
                staffName: r.staff_name,
                email: r.staff_email,
                issuer: r.issuer || '',
                credentialId: r.credential_id || '',
                dateObtained: formatDate(r.date_obtained),
                expiryDate: expiryStr
            };
            if (expiryStr < todayStr) expiredCerts.push(rec);
            else if (expiryStr <= plus90Str) expiringCerts.push(rec);
        }
        const sortByExpiry = (a, b) => (a.expiryDate < b.expiryDate ? -1 : 1);
        expiredCerts.sort(sortByExpiry);
        expiringCerts.sort(sortByExpiry);
        // Popular certifications: normalize case/whitespace like /reports/certifications
        // (label = most common spelling), count DISTINCT staff per normalized name.
        const normCert = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const certGroups = new Map(); // normKey -> { variants: Map<label,count>, staff: Set }
        for (const r of certRows) {
            const raw = (r.name || '').trim() || '(Untitled certification)';
            const key = normCert(raw);
            if (!certGroups.has(key)) certGroups.set(key, { variants: new Map(), staff: new Set() });
            const g = certGroups.get(key);
            g.variants.set(raw, (g.variants.get(raw) || 0) + 1);
            g.staff.add(r.staff_email.toLowerCase());
        }
        const popular = [];
        for (const [, g] of certGroups) {
            let label = null, bestCount = -1;
            for (const [variant, count] of g.variants) {
                if (count > bestCount || (count === bestCount && (!label || variant.length < label.length))) {
                    label = variant;
                    bestCount = count;
                }
            }
            popular.push({ name: label, staff: g.staff.size });
        }
        popular.sort((a, b) => b.staff - a.staff || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        payload.certifications = {
            total: certRows.length,
            expired: expiredCerts.length,
            expiring90d: expiringCerts.length,
            expiredCerts,
            expiringCerts,
            popular: popular.slice(0, 10)
        };

        res.json(payload);
    } catch (err) {
        console.error('GET /reports/dashboard error:', err);
        res.status(500).json({ error: 'Failed to fetch dashboard' });
    }
});

export { router };
