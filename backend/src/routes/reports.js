'use strict';
const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

// ── GET /reports/projects ─────────────────────────────────────────────────────
// Returns every unique project found in submissions, with the list of staff
// assigned to it.
router.get('/projects', (req, res) => {
    try {
        const db = getDb();

        const rows = db.prepare(`
      SELECT 
        p.id as assignment_id, p.soc, p.project_name, p.customer, p.role, p.end_date as staff_end_date,
        s.staff_name, s.staff_email, s.id as submission_id,
        mp.type_infra, mp.type_software, mp.type_infra_support, mp.type_software_support
      FROM submission_projects p
      JOIN submissions s ON p.submission_id = s.id
      LEFT JOIN managed_projects mp ON (mp.soc = p.soc OR (p.soc IS NULL AND mp.name = p.project_name))
    `).all();

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
// Returns all submissions with staff info and their project list.
router.get('/staff', (req, res) => {
    try {
        const db = getDb();

        const subs = db.prepare('SELECT id, staff_email, staff_name, title, department FROM submissions ORDER BY staff_name').all();
        const skills = db.prepare('SELECT submission_id, skill, rating FROM submission_skills').all();
        const projects = db.prepare(`
          SELECT 
            p.submission_id, p.soc, p.project_name as projectName, p.customer, p.role, p.end_date as endDate,
            mp.type_infra, mp.type_software, mp.type_infra_support, mp.type_software_support
          FROM submission_projects p
          LEFT JOIN managed_projects mp ON (mp.soc = p.soc OR (p.soc IS NULL AND mp.name = p.project_name))
        `).all();

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
// Returns all unique skills with the list of staff who possess them.
router.get('/skills', (req, res) => {
    try {
        const db = getDb();

        const skills = db.prepare(`
            SELECT 
                sk.skill, sk.rating,
                s.staff_name, s.staff_email, s.title, s.department
            FROM submission_skills sk
            JOIN submissions s ON sk.submission_id = s.id
            ORDER BY sk.skill ASC, sk.rating DESC
        `).all();

        const skillMap = new Map();

        skills.forEach(row => {
            const key = row.skill.trim();
            if (!skillMap.has(key)) {
                skillMap.set(key, {
                    skill: key,
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

module.exports = router;
