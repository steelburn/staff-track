'use strict';
const express = require('express');
const { getDb } = require('../db');
const { verifyToken, requireRole } = require('./auth');

const router = express.Router();

// All report routes require authentication and a reporting role
const requireReporter = [verifyToken, requireRole('admin', 'hr', 'coordinator')];

// ── GET /reports/projects ─────────────────────────────────────────────────────
router.get('/projects', requireReporter, (req, res) => {
    try {
        const db = getDb();

        const isAdminOrHR = ['admin', 'hr'].includes(req.user.role);
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

        if (!isAdminOrHR) {
            // Coordinator: Only show projects where they are in the coordinators list
            query += ` WHERE mp.coordinator_email LIKE ? OR mp.coordinator_email = ?`;
        }

        const rows = db.prepare(query).all(!isAdminOrHR ? ['%"' + email + '"%', email] : []);

        const projectMap = new Map();

        rows.forEach(row => {
            const key = row.soc || row.project_name || '(unknown)';
            if (!projectMap.has(key)) {
                projectMap.set(key, {
                    soc: row.soc || '',
                    projectName: row.project_name || '',
                    customer: row.customer || '',
                    type_infra: !!row.type_infra,
                    type_software: !!row.type_software,
                    type_infra_support: !!row.type_infra_support,
                    type_software_support: !!row.type_software_support,
                    staff: [],
                });
            }
            projectMap.get(key).staff.push({
                assignmentId: row.assignment_id,
                name: row.staff_name,
                email: row.staff_email || '',
                role: row.role || '',
                endDate: row.staff_end_date || '', // End date specific to that staff member's assignment
                submissionId: row.submission_id,
            });
        });

        const result = [...projectMap.values()].sort((a, b) =>
            (a.projectName || a.soc).localeCompare(b.projectName || b.soc)
        );

        res.json(result);
    } catch (err) {
        console.error('GET /reports/projects error:', err);
        res.status(500).json({ error: 'Failed to aggregate projects' });
    }
});

// ── GET /reports/staff ────────────────────────────────────────────────────────
router.get('/staff', requireReporter, (req, res) => {
    try {
        const db = getDb();

        const isAdminOrHR = ['admin', 'hr'].includes(req.user.role);
        const email = req.user.email.toLowerCase();

        let subQuery = 'SELECT id, staff_email, staff_name, title, department, manager_name, updated_at, updated_by_staff FROM submissions';
        let projQuery = `
          SELECT 
            p.submission_id, p.soc, p.project_name as projectName, p.customer, p.role, p.end_date as endDate,
            mp.type_infra, mp.type_software, mp.type_infra_support, mp.type_software_support,
            mp.coordinator_email
          FROM submission_projects p
          LEFT JOIN managed_projects mp ON (mp.soc = p.soc OR (p.soc IS NULL AND mp.project_name = p.project_name))
        `;

        if (!isAdminOrHR) {
            // Coordinator: only see staff assigned to their managed projects
            subQuery = `
                SELECT DISTINCT s.id, s.staff_email, s.staff_name, s.title, s.department, s.manager_name, s.updated_at, s.updated_by_staff
                FROM submissions s
                JOIN submission_projects sp ON sp.submission_id = s.id
                LEFT JOIN managed_projects mp ON (mp.soc = sp.soc OR (sp.soc IS NULL AND mp.project_name = sp.project_name))
                WHERE mp.coordinator_email LIKE ? OR mp.coordinator_email = ?
            `;
            projQuery += ` WHERE mp.coordinator_email LIKE ? OR mp.coordinator_email = ?`;
        }

        const subs = db.prepare(subQuery + ' ORDER BY staff_name').all(!isAdminOrHR ? ['%"' + email + '"%', email] : []);
        const skills = db.prepare('SELECT submission_id, skill, rating FROM submission_skills').all();
        const projects = db.prepare(projQuery).all(!isAdminOrHR ? ['%"' + email + '"%', email] : []);

        // Group relations
        const skillMap = new Map();
        skills.forEach(s => {
            if (!skillMap.has(s.submission_id)) skillMap.set(s.submission_id, []);
            skillMap.get(s.submission_id).push({ skill: s.skill, rating: s.rating });
        });

        const projMap = new Map();
        projects.forEach(p => {
            if (!projMap.has(p.submission_id)) projMap.set(p.submission_id, []);
            projMap.get(p.submission_id).push({
                soc: p.soc,
                projectName: p.projectName,
                customer: p.customer,
                role: p.role,
                endDate: p.endDate,
                type_infra: !!p.type_infra,
                type_software: !!p.type_software,
                type_infra_support: !!p.type_infra_support,
                type_software_support: !!p.type_software_support
            });
        });

        const result = subs.map(row => ({
            id: row.id,
            staffName: row.staff_name,
            title: row.title || '',
            department: row.department || '',
            email: row.staff_email || '',
            managerName: row.manager_name || '',
            updatedAt: row.updated_at,
            updatedByStaff: !!row.updated_by_staff,
            skills: skillMap.get(row.id) || [],
            projects: projMap.get(row.id) || [],
        }));

        res.json(result);
    } catch (err) {
        console.error('GET /reports/staff error:', err);
        res.status(500).json({ error: 'Failed to fetch staff report' });
    }
});

// ── GET /reports/skills ───────────────────────────────────────────────────────
router.get('/skills', requireReporter, (req, res) => {
    try {
        const db = getDb();

        const skills = db.prepare(`
            WITH LatestSubmissions AS (
                SELECT id, staff_email, staff_name, title, department
                FROM submissions
                WHERE (staff_email, updated_at) IN (
                    SELECT staff_email, MAX(updated_at)
                    FROM submissions
                    GROUP BY staff_email
                )
            )
            SELECT 
                sk.skill, sk.rating,
                s.staff_name, s.staff_email, s.title, s.department
            FROM submission_skills sk
            JOIN LatestSubmissions s ON sk.submission_id = s.id
            ORDER BY sk.skill COLLATE NOCASE ASC, sk.rating DESC
        `).all();

        const skillMap = new Map();

        skills.forEach(row => {
            const skillName = row.skill.trim();
            const key = skillName.toLowerCase();
            if (!skillMap.has(key)) {
                skillMap.set(key, {
                    skill: skillName, // Use first casing encountered
                    staff: []
                });
            }
            skillMap.get(key).staff.push({
                name: row.staff_name,
                email: row.staff_email,
                title: row.title || '',
                department: row.department || '',
                rating: row.rating
            });
        });

        const result = [...skillMap.values()];
        res.json(result);
    } catch (err) {
        console.error('GET /reports/skills error:', err);
        res.status(500).json({ error: 'Failed to fetch skills report' });
    }
});

// ── GET /reports/staff-search ─────────────────────────────────────────────────
router.get('/staff-search', requireReporter, (req, res) => {
    try {
        const { skills } = req.query; // Expects JSON array string: [{"name":"Python","minRating":3}]
        let filterSkills = [];
        if (skills) {
            try {
                filterSkills = JSON.parse(skills);
            } catch (e) {
                return res.status(400).json({ error: 'Invalid skills parameter JSON' });
            }
        }

        const db = getDb();

        const subs = db.prepare(`
            SELECT id, staff_email, staff_name, title, department, updated_at
            FROM submissions 
            WHERE (staff_email, updated_at) IN (
                SELECT staff_email, MAX(updated_at)
                FROM submissions
                GROUP BY staff_email
            )
            ORDER BY staff_name
        `).all();

        const allSkills = db.prepare('SELECT submission_id, skill, rating FROM submission_skills').all();

        const skillMap = new Map();
        allSkills.forEach(s => {
            if (!skillMap.has(s.submission_id)) skillMap.set(s.submission_id, []);
            skillMap.get(s.submission_id).push({ skill: s.skill, rating: s.rating });
        });

        // Filter submissions
        let matchedSubs = subs;
        if (filterSkills.length > 0) {
            matchedSubs = subs.filter(sub => {
                const staffSkills = skillMap.get(sub.id) || [];
                // Must have ALL required skills at or above minRating
                return filterSkills.every(reqSkill => {
                    const found = staffSkills.find(s => s.skill.toLowerCase() === reqSkill.name.toLowerCase());
                    return found && found.rating >= (reqSkill.minRating || 1);
                });
            });
        }

        const result = matchedSubs.map(row => ({
            id: row.id,
            staffName: row.staff_name,
            title: row.title || '',
            department: row.department || '',
            email: row.staff_email || '',
            updatedAt: row.updated_at,
            skills: skillMap.get(row.id) || []
        }));

        res.json(result);
    } catch (err) {
        console.error('GET /reports/staff-search error:', err);
        res.status(500).json({ error: 'Failed to search staff' });
    }
});

module.exports = router;
