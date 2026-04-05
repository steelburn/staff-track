import express from 'express';
import { getDb } from '../db.js';
import { verifyToken, requireRole } from './auth.js';

const router = express.Router();

// All report routes require authentication and a reporting role
const requireReporter = [verifyToken, requireRole('admin', 'hr', 'coordinator')];

// ── GET /reports/staff ────────────────────────────────────────────────────────
router.get('/staff', requireReporter, async (req, res) => {
    try {
        const db = await getDb();

        // Get all staff with their projects and skills
        const query = `
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
                p.end_date,
                mp.type_infra,
                mp.type_software,
                mp.type_infra_support,
                mp.type_software_support,
                sk.skill,
                sk.rating
            FROM submissions s
            LEFT JOIN submission_projects p ON s.id = p.submission_id
            LEFT JOIN managed_projects mp ON (mp.soc = p.soc OR (p.soc IS NULL AND mp.project_name = p.project_name))
            LEFT JOIN submission_skills sk ON s.id = sk.submission_id
            ORDER BY s.staff_name ASC, p.soc ASC, sk.skill ASC
        `;

        const [rows] = await db.query(query);

        // Group by staff
        const staffMap = new Map();
        rows.forEach(row => {
            if (!staffMap.has(row.id)) {
                staffMap.set(row.id, {
                    staffName: row.staff_name,
                    email: row.staff_email,
                    title: row.title,
                    department: row.department,
                    managerName: row.manager_name,
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
                    endDate: row.end_date,
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
router.get('/projects', requireReporter, async (req, res) => {
    try {
        const db = await getDb();

        const isAdminOrHR = req.user.isAdmin === true || req.user.is_hr === 1 || req.user.is_hr === true;
        const email = req.user.email.toLowerCase();

        let query = `
      SELECT 
        p.id as assignment_id, p.soc, p.project_name, p.customer, p.role, p.end_date as staff_end_date,
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
                    submissions: []
                });
            }
            projectMap.get(key).submissions.push(row);
        });

        res.json(Array.from(projectMap.values()));
    } catch (err) {
        console.error('GET /reports/projects error:', err);
        res.status(500).json({ error: 'Failed to fetch projects report' });
    }
});

// ── GET /reports/skills ───────────────────────────────────────────────────────
router.get('/skills', requireReporter, async (req, res) => {
    try {
        const db = await getDb();

        // Get all unique skills with staff members who have them
        const query = `
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
            ORDER BY sk.skill ASC, sk.rating DESC
        `;

        const [rows] = await db.query(query);

        // Group by skill
        const skillMap = new Map();
        rows.forEach(row => {
            if (!skillMap.has(row.skill)) {
                skillMap.set(row.skill, []);
            }
            skillMap.get(row.skill).push({
                name: row.staff_name,
                email: row.staff_email,
                title: row.title,
                department: row.department,
                rating: row.rating,
                submissionId: row.submission_id
            });
        });

        // Convert to array format
        const result = Array.from(skillMap.entries()).map(([skill, staff]) => ({
            skill,
            staff
        }));

        res.json(result);
    } catch (err) {
        console.error('GET /reports/skills error:', err);
        res.status(500).json({ error: 'Failed to fetch skills report' });
    }
});

// ── GET /reports/staff-search ──────────────────────────────────────────────────
router.get('/staff-search', requireReporter, async (req, res) => {
    try {
        const db = await getDb();
        
        // Parse skill filters from query parameter
        const skillFilters = req.query.skills ? JSON.parse(decodeURIComponent(req.query.skills)) : [];
        
        if (skillFilters.length === 0) {
            // If no filters, return all staff with their skills
            const query = `
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
                ORDER BY s.staff_name ASC, sk.skill ASC
            `;
            
            const [rows] = await db.query(query);
            
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
            WHERE s.id IN (
        `;
        
        // Build subquery: get staff IDs that have ALL required skills
        const subqueryParts = [];
        skillFilters.forEach(filter => {
            subqueryParts.push(`
                SELECT sk.submission_id 
                FROM submission_skills sk 
                WHERE LOWER(sk.skill) = LOWER(?) AND sk.rating >= ?
            `);
        });
        
        query += `
                SELECT submission_id 
                FROM (
        `;
        
        // Intersect all skill filters
        query += subqueryParts.join(' INTERSECT ');
        
        query += `
                ) AS matching_submissions
            )
            ORDER BY s.staff_name ASC, sk.skill ASC
        `;
        
        // Flatten parameters
        const params = [];
        skillFilters.forEach(filter => {
            params.push(filter.name);
            params.push(filter.minRating || 0);
        });
        
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
