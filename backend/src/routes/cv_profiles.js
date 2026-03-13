'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { verifyToken, requireRole } = require('./auth');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const router = express.Router();

// ── Photo upload setup ────────────────────────────────────────────────────────
const UPLOAD_DIR = '/data/uploads/photos';
const PROOF_DIR = '/data/uploads/proofs';

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${req.params.email}_${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Only image files are allowed'));
    }
});

// ── Authorization helpers ─────────────────────────────────────────────────────

// Admin, HR, and Coordinator can view/manage any profile
const requireElevated = requireRole('admin', 'hr', 'coordinator');

// Check if the current user can access a profile (own profile OR elevated role)
function canAccessProfile(req, email) {
    return req.user.email === email || ['admin', 'hr', 'coordinator'].includes(req.user.role);
}

// ── GET /cv-profiles — list all CV profiles ───────────────────────────────────
router.get('/', verifyToken, requireElevated, (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT id, staff_email, summary, phone, linkedin, location, photo_path, is_visible FROM cv_profiles ORDER BY staff_email').all();
        res.json(rows);
    } catch (err) {
        console.error('GET /cv-profiles error:', err);
        res.status(500).json({ error: 'Failed to list CV profiles' });
    }
});

// ── GET /cv-profiles/templates — list all templates ──────────────────────────
router.get('/templates', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT * FROM cv_templates ORDER BY is_default DESC, name').all();
        res.json(rows);
    } catch (err) {
        console.error('GET /cv-profiles/templates error:', err);
        res.status(500).json({ error: 'Failed to list templates' });
    }
});

// ── POST /cv-profiles/templates — create new CV template ─────────────────────
router.post('/templates', verifyToken, requireRole('admin'), (req, res) => {
    try {
        const db = getDb();
        const { name, markdown_template, css_styles, company_logo_path, is_default } = req.body;

        if (!name) throw new Error('name is required');

        const id = uuidv4();

        // If setting as default, clear existing default first
        if (is_default) {
            db.prepare('UPDATE cv_templates SET is_default = 0').run();
        }

        db.prepare('INSERT INTO cv_templates (id, name, markdown_template, css_styles, company_logo_path, is_default) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, name, markdown_template || null, css_styles || null, company_logo_path || null, is_default ? 1 : 0);

        res.status(201).json({ id });
    } catch (err) {
        console.error('POST /cv-profiles/templates error:', err);
        res.status(500).json({ error: err.message || 'Failed to create template' });
    }
});

// ── PUT /cv-profiles/templates/:id — update template ─────────────────────────
router.put('/templates/:id', verifyToken, requireRole('admin'), (req, res) => {
    try {
        const db = getDb();
        const { name, markdown_template, css_styles, company_logo_path, is_default } = req.body;

        const existing = db.prepare('SELECT * FROM cv_templates WHERE id = ?').get(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Template not found' });

        const setClauses = [];
        const params = [];

        if (name !== undefined) { setClauses.push('name = ?'); params.push(name); }
        if (markdown_template !== undefined) { setClauses.push('markdown_template = ?'); params.push(markdown_template); }
        if (css_styles !== undefined) { setClauses.push('css_styles = ?'); params.push(css_styles); }
        if (company_logo_path !== undefined) { setClauses.push('company_logo_path = ?'); params.push(company_logo_path); }
        if (is_default !== undefined) {
            if (is_default) db.prepare('UPDATE cv_templates SET is_default = 0').run();
            setClauses.push('is_default = ?');
            params.push(is_default ? 1 : 0);
        }

        if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

        params.push(req.params.id);
        db.prepare(`UPDATE cv_templates SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

        const updated = db.prepare('SELECT * FROM cv_templates WHERE id = ?').get(req.params.id);
        res.json(updated);
    } catch (err) {
        console.error(`PUT /cv-profiles/templates/:id error:`, err);
        res.status(500).json({ error: 'Failed to update template' });
    }
});

// ── GET /cv-profiles/:email — fetch one CV profile ───────────────────────────
router.get('/:email', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        // Users can only view their own profile unless they have elevated role
        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden: You can only view your own profile' });
        }

        const profile = db.prepare('SELECT * FROM cv_profiles WHERE staff_email = ?').get(email);

        // Always fetch sub-resources regardless of whether a profile row exists.
        // This prevents education/certifications/work-history/past-projects from
        // appearing empty when entries were added before the profile was first saved.
        const education = db.prepare('SELECT id, institution, degree, field, start_year, end_year, description, proof_path, is_visible FROM education WHERE staff_email = ? ORDER BY end_year DESC').all(email);
        const certifications = db.prepare('SELECT id, name, issuer, date_obtained, expiry_date, credential_id, description, proof_path, is_visible FROM certifications WHERE staff_email = ? ORDER BY date_obtained DESC').all(email);
        const workHistory = db.prepare('SELECT id, employer, job_title, start_date, end_date, description, is_current, is_visible FROM work_history WHERE staff_email = ? ORDER BY start_date DESC').all(email);
        const pastProjects = db.prepare('SELECT id, work_history_id, project_name, description, role, start_date, end_date, technologies, is_visible FROM cv_past_projects WHERE staff_email = ? ORDER BY start_date DESC').all(email);

        if (!profile) {
            // Return sub-resources with a null profile so the frontend can still
            // render Education, Certifications, Work History and Past Projects.
            return res.json({ profile: null, education, certifications, workHistory, pastProjects });
        }

        res.json({ profile, education, certifications, workHistory, pastProjects });
    } catch (err) {
        console.error(`GET /cv-profiles/${req.params.email} error:`, err);
        res.status(500).json({ error: 'Failed to fetch CV profile' });
    }
});

// ── POST /cv-profiles — create new CV profile ────────────────────────────────
router.post('/', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const { staff_email, summary, phone, linkedin, location, photo_path } = req.body;

        if (!staff_email) throw new Error('staff_email is required');

        const email = staff_email.toLowerCase();

        // Only allow creating a profile for self, or if elevated role
        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden: You can only create your own profile' });
        }

        const id = uuidv4();
        const now = new Date().toISOString();

        db.prepare('INSERT INTO cv_profiles (id, staff_email, summary, phone, linkedin, location, photo_path, is_visible, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
            .run(id, email, summary || null, phone || null, linkedin || null, location || null, photo_path || null, now, now);

        res.status(201).json({ id, staff_email: email });
    } catch (err) {
        console.error('POST /cv-profiles error:', err);
        res.status(500).json({ error: err.message || 'Failed to create CV profile' });
    }
});

// ── PUT /cv-profiles/:email — update CV profile ──────────────────────────────
router.put('/:email', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();
        const now = new Date().toISOString();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden: You can only update your own profile' });
        }

        const { summary, phone, linkedin, location, photo_path, is_visible } = req.body;

        const setClauses = ['updated_at = ?'];
        const params = [now];

        if (summary !== undefined) { setClauses.push('summary = ?'); params.push(summary); }
        if (phone !== undefined) { setClauses.push('phone = ?'); params.push(phone); }
        if (linkedin !== undefined) { setClauses.push('linkedin = ?'); params.push(linkedin); }
        if (location !== undefined) { setClauses.push('location = ?'); params.push(location); }
        if (photo_path !== undefined) { setClauses.push('photo_path = ?'); params.push(photo_path); }
        if (is_visible !== undefined) { setClauses.push('is_visible = ?'); params.push(is_visible ? 1 : 0); }

        params.push(email);
        const result = db.prepare(`UPDATE cv_profiles SET ${setClauses.join(', ')} WHERE staff_email = ?`).run(...params);

        if (result.changes === 0) return res.status(404).json({ error: 'Profile not found' });

        const profile = db.prepare('SELECT * FROM cv_profiles WHERE staff_email = ?').get(email);
        res.json(profile);
    } catch (err) {
        console.error(`PUT /cv-profiles/${req.params.email} error:`, err);
        res.status(500).json({ error: 'Failed to update CV profile' });
    }
});

// ── DELETE /cv-profiles/:email — delete CV profile ───────────────────────────
router.delete('/:email', verifyToken, requireRole('admin'), (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        const result = db.prepare('DELETE FROM cv_profiles WHERE staff_email = ?').run(email);
        if (result.changes === 0) return res.status(404).json({ error: 'Profile not found' });

        db.prepare('DELETE FROM education WHERE staff_email = ?').run(email);
        db.prepare('DELETE FROM certifications WHERE staff_email = ?').run(email);
        db.prepare('DELETE FROM work_history WHERE staff_email = ?').run(email);

        res.json({ deleted: true });
    } catch (err) {
        console.error(`DELETE /cv-profiles/${req.params.email} error:`, err);
        res.status(500).json({ error: 'Failed to delete CV profile' });
    }
});

// ── POST /cv-profiles/:email/photo — upload profile photo ────────────────────
router.post('/:email/photo', verifyToken, upload.single('photo'), (req, res) => {
    try {
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden: You can only upload your own photo' });
        }

        if (!req.file) throw new Error('No photo file uploaded');

        const db = getDb();
        const photoPath = `/uploads/photos/${req.file.filename}`;
        const now = new Date().toISOString();

        db.prepare('UPDATE cv_profiles SET photo_path = ?, updated_at = ? WHERE staff_email = ?')
            .run(photoPath, now, email);

        res.json({ photo_path: photoPath });
    } catch (err) {
        console.error(`POST /cv-profiles/:email/photo error:`, err);
        res.status(500).json({ error: err.message || 'Failed to upload photo' });
    }
});

// ── POST /cv-profiles/:email/education — add education entry ─────────────────
router.post('/:email/education', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { institution, degree, field, start_year, end_year, description } = req.body;

        if (!institution) throw new Error('institution is required');

        const id = uuidv4();
        const now = new Date().toISOString();

        db.prepare('INSERT INTO education (id, staff_email, institution, degree, field, start_year, end_year, description, is_visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
            .run(id, email, institution, degree || null, field || null, start_year || null, end_year || null, description || null, now);

        res.status(201).json({ id });
    } catch (err) {
        console.error('POST /cv-profiles/:email/education error:', err);
        res.status(500).json({ error: err.message || 'Failed to add education' });
    }
});

// ── PUT /cv-profiles/:email/education/:id — update education entry ────────────
router.put('/:email/education/:id', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { institution, degree, field, start_year, end_year, description, is_visible } = req.body;

        const setClauses = [];
        const params = [];

        if (institution !== undefined) { setClauses.push('institution = ?'); params.push(institution); }
        if (degree !== undefined) { setClauses.push('degree = ?'); params.push(degree); }
        if (field !== undefined) { setClauses.push('field = ?'); params.push(field); }
        if (start_year !== undefined) { setClauses.push('start_year = ?'); params.push(start_year); }
        if (end_year !== undefined) { setClauses.push('end_year = ?'); params.push(end_year); }
        if (description !== undefined) { setClauses.push('description = ?'); params.push(description); }
        if (is_visible !== undefined) { setClauses.push('is_visible = ?'); params.push(is_visible ? 1 : 0); }

        if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

        params.push(req.params.id);
        const result = db.prepare(`UPDATE education SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

        if (result.changes === 0) return res.status(404).json({ error: 'Education entry not found' });

        const edu = db.prepare('SELECT * FROM education WHERE id = ?').get(req.params.id);
        res.json(edu);
    } catch (err) {
        console.error(`PUT /cv-profiles/:email/education/:id error:`, err);
        res.status(500).json({ error: 'Failed to update education' });
    }
});

// ── DELETE /cv-profiles/:email/education/:id — delete education entry ─────────
router.delete('/:email/education/:id', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const result = db.prepare('DELETE FROM education WHERE id = ?').run(req.params.id);

        if (result.changes === 0) return res.status(404).json({ error: 'Education entry not found' });

        res.json({ deleted: true });
    } catch (err) {
        console.error(`DELETE /cv-profiles/:email/education/:id error:`, err);
        res.status(500).json({ error: 'Failed to delete education' });
    }
});

// ── POST /cv-profiles/:email/education/:id/proof — upload proof ───────────────
router.post('/:email/education/:id/proof', verifyToken, (req, res, next) => {
    const proofUpload = multer({
        storage: multer.diskStorage({
            destination: (_req, _file, cb) => { fs.mkdirSync(PROOF_DIR, { recursive: true }); cb(null, PROOF_DIR); },
            filename: (_req, file, cb) => { const ext = path.extname(file.originalname); cb(null, `edu_${req.params.id}_${Date.now()}${ext}`); }
        }),
        limits: { fileSize: 10 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
            const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
            if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
            else cb(new Error('Only PDF and image files are allowed'));
        }
    }).single('proof');

    proofUpload(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        try {
            const email = req.params.email.toLowerCase();
            if (!canAccessProfile(req, email)) return res.status(403).json({ error: 'Forbidden' });
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const db = getDb();
            const proofPath = `/uploads/proofs/${req.file.filename}`;
            db.prepare('UPDATE education SET proof_path = ? WHERE id = ? AND staff_email = ?').run(proofPath, req.params.id, email);
            res.json({ proof_path: proofPath });
        } catch (e) {
            console.error('POST education proof error:', e);
            res.status(500).json({ error: 'Failed to upload proof' });
        }
    });
});

// ── DELETE /cv-profiles/:email/education/:id/proof — remove proof ─────────────
router.delete('/:email/education/:id/proof', verifyToken, (req, res) => {
    try {
        const email = req.params.email.toLowerCase();
        if (!canAccessProfile(req, email)) return res.status(403).json({ error: 'Forbidden' });
        const db = getDb();
        const row = db.prepare('SELECT proof_path FROM education WHERE id = ? AND staff_email = ?').get(req.params.id, email);
        if (row && row.proof_path) {
            const filePath = path.join('/data', row.proof_path);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        db.prepare('UPDATE education SET proof_path = NULL WHERE id = ? AND staff_email = ?').run(req.params.id, email);
        res.json({ deleted: true });
    } catch (e) {
        console.error('DELETE education proof error:', e);
        res.status(500).json({ error: 'Failed to remove proof' });
    }
});

// ── POST /cv-profiles/:email/certifications — add certification entry ──────────
router.post('/:email/certifications', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { name, issuer, date_obtained, expiry_date, credential_id, description } = req.body;

        if (!name) throw new Error('name is required');

        const id = uuidv4();
        const now = new Date().toISOString();

        db.prepare('INSERT INTO certifications (id, staff_email, name, issuer, date_obtained, expiry_date, credential_id, description, is_visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
            .run(id, email, name, issuer || null, date_obtained || null, expiry_date || null, credential_id || null, description || null, now);

        res.status(201).json({ id });
    } catch (err) {
        console.error('POST /cv-profiles/:email/certifications error:', err);
        res.status(500).json({ error: err.message || 'Failed to add certification' });
    }
});

// ── PUT /cv-profiles/:email/certifications/:id — update certification entry ───
router.put('/:email/certifications/:id', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { name, issuer, date_obtained, expiry_date, credential_id, description, is_visible } = req.body;

        const setClauses = [];
        const params = [];

        if (name !== undefined) { setClauses.push('name = ?'); params.push(name); }
        if (issuer !== undefined) { setClauses.push('issuer = ?'); params.push(issuer); }
        if (date_obtained !== undefined) { setClauses.push('date_obtained = ?'); params.push(date_obtained); }
        if (expiry_date !== undefined) { setClauses.push('expiry_date = ?'); params.push(expiry_date); }
        if (credential_id !== undefined) { setClauses.push('credential_id = ?'); params.push(credential_id); }
        if (description !== undefined) { setClauses.push('description = ?'); params.push(description); }
        if (is_visible !== undefined) { setClauses.push('is_visible = ?'); params.push(is_visible ? 1 : 0); }

        if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

        params.push(req.params.id);
        const result = db.prepare(`UPDATE certifications SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

        if (result.changes === 0) return res.status(404).json({ error: 'Certification entry not found' });

        const cert = db.prepare('SELECT * FROM certifications WHERE id = ?').get(req.params.id);
        res.json(cert);
    } catch (err) {
        console.error(`PUT /cv-profiles/:email/certifications/:id error:`, err);
        res.status(500).json({ error: 'Failed to update certification' });
    }
});

// ── DELETE /cv-profiles/:email/certifications/:id — delete certification entry ─
router.delete('/:email/certifications/:id', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const result = db.prepare('DELETE FROM certifications WHERE id = ?').run(req.params.id);

        if (result.changes === 0) return res.status(404).json({ error: 'Certification entry not found' });

        res.json({ deleted: true });
    } catch (err) {
        console.error(`DELETE /cv-profiles/:email/certifications/:id error:`, err);
        res.status(500).json({ error: 'Failed to delete certification' });
    }
});

// ── POST /cv-profiles/:email/certifications/:id/proof — upload proof ─────────
router.post('/:email/certifications/:id/proof', verifyToken, (req, res) => {
    const proofUpload = multer({
        storage: multer.diskStorage({
            destination: (_req, _file, cb) => { fs.mkdirSync(PROOF_DIR, { recursive: true }); cb(null, PROOF_DIR); },
            filename: (_req, file, cb) => { const ext = path.extname(file.originalname); cb(null, `cert_${req.params.id}_${Date.now()}${ext}`); }
        }),
        limits: { fileSize: 10 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
            const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
            if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
            else cb(new Error('Only PDF and image files are allowed'));
        }
    }).single('proof');

    proofUpload(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        try {
            const email = req.params.email.toLowerCase();
            if (!canAccessProfile(req, email)) return res.status(403).json({ error: 'Forbidden' });
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const db = getDb();
            const proofPath = `/uploads/proofs/${req.file.filename}`;
            db.prepare('UPDATE certifications SET proof_path = ? WHERE id = ? AND staff_email = ?').run(proofPath, req.params.id, email);
            res.json({ proof_path: proofPath });
        } catch (e) {
            console.error('POST certifications proof error:', e);
            res.status(500).json({ error: 'Failed to upload proof' });
        }
    });
});

// ── DELETE /cv-profiles/:email/certifications/:id/proof — remove proof ────────
router.delete('/:email/certifications/:id/proof', verifyToken, (req, res) => {
    try {
        const email = req.params.email.toLowerCase();
        if (!canAccessProfile(req, email)) return res.status(403).json({ error: 'Forbidden' });
        const db = getDb();
        const row = db.prepare('SELECT proof_path FROM certifications WHERE id = ? AND staff_email = ?').get(req.params.id, email);
        if (row && row.proof_path) {
            const filePath = path.join('/data', row.proof_path);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        db.prepare('UPDATE certifications SET proof_path = NULL WHERE id = ? AND staff_email = ?').run(req.params.id, email);
        res.json({ deleted: true });
    } catch (e) {
        console.error('DELETE certifications proof error:', e);
        res.status(500).json({ error: 'Failed to remove proof' });
    }
});

// ── POST /cv-profiles/:email/work-history — add work history entry ────────────
router.post('/:email/work-history', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { employer, job_title, start_date, end_date, description, is_current } = req.body;

        if (!employer) throw new Error('employer is required');

        const id = uuidv4();
        const now = new Date().toISOString();

        db.prepare('INSERT INTO work_history (id, staff_email, employer, job_title, start_date, end_date, description, is_current, is_visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
            .run(id, email, employer, job_title || null, start_date || null, end_date || null, description || null, is_current ? 1 : 0, now);

        res.status(201).json({ id });
    } catch (err) {
        console.error('POST /cv-profiles/:email/work-history error:', err);
        res.status(500).json({ error: err.message || 'Failed to add work history' });
    }
});

// ── PUT /cv-profiles/:email/work-history/:id — update work history entry ──────
router.put('/:email/work-history/:id', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { employer, job_title, start_date, end_date, description, is_current, is_visible } = req.body;

        const setClauses = [];
        const params = [];

        if (employer !== undefined) { setClauses.push('employer = ?'); params.push(employer); }
        if (job_title !== undefined) { setClauses.push('job_title = ?'); params.push(job_title); }
        if (start_date !== undefined) { setClauses.push('start_date = ?'); params.push(start_date); }
        if (end_date !== undefined) { setClauses.push('end_date = ?'); params.push(end_date); }
        if (description !== undefined) { setClauses.push('description = ?'); params.push(description); }
        if (is_current !== undefined) { setClauses.push('is_current = ?'); params.push(is_current ? 1 : 0); }
        if (is_visible !== undefined) { setClauses.push('is_visible = ?'); params.push(is_visible ? 1 : 0); }

        if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

        params.push(req.params.id);
        const result = db.prepare(`UPDATE work_history SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

        if (result.changes === 0) return res.status(404).json({ error: 'Work history entry not found' });

        const wh = db.prepare('SELECT * FROM work_history WHERE id = ?').get(req.params.id);
        res.json(wh);
    } catch (err) {
        console.error(`PUT /cv-profiles/:email/work-history/:id error:`, err);
        res.status(500).json({ error: 'Failed to update work history' });
    }
});

// ── DELETE /cv-profiles/:email/work-history/:id — delete work history entry ───
router.delete('/:email/work-history/:id', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const result = db.prepare('DELETE FROM work_history WHERE id = ?').run(req.params.id);

        if (result.changes === 0) return res.status(404).json({ error: 'Work history entry not found' });

        res.json({ deleted: true });
    } catch (err) {
        console.error(`DELETE /cv-profiles/:email/work-history/:id error:`, err);
        res.status(500).json({ error: 'Failed to delete work history' });
    }
});

// ── POST /cv-profiles/:email/past-projects — add past project ─────────────────
router.post('/:email/past-projects', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { work_history_id, project_name, description, role, start_date, end_date, technologies } = req.body;

        if (!project_name) throw new Error('project_name is required');

        const id = uuidv4();
        const now = new Date().toISOString();

        db.prepare('INSERT INTO cv_past_projects (id, staff_email, work_history_id, project_name, description, role, start_date, end_date, technologies, is_visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
            .run(id, email, work_history_id || null, project_name, description || null, role || null, start_date || null, end_date || null, technologies || null, now);

        res.status(201).json({ id });
    } catch (err) {
        console.error('POST /cv-profiles/:email/past-projects error:', err);
        res.status(500).json({ error: err.message || 'Failed to add past project' });
    }
});

// ── GET /cv-profiles/:email/past-projects — get all past projects ─────────────
router.get('/:email/past-projects', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const rows = db.prepare('SELECT id, work_history_id, project_name, description, role, start_date, end_date, technologies, is_visible, created_at FROM cv_past_projects WHERE staff_email = ? ORDER BY start_date DESC').all(email);

        res.json(rows);
    } catch (err) {
        console.error('GET /cv-profiles/:email/past-projects error:', err);
        res.status(500).json({ error: 'Failed to fetch past projects' });
    }
});

// ── PUT /cv-profiles/:email/past-projects/:id — update past project ───────────
router.put('/:email/past-projects/:id', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { work_history_id, project_name, description, role, start_date, end_date, technologies, is_visible } = req.body;

        const setClauses = [];
        const params = [];

        if (work_history_id !== undefined) { setClauses.push('work_history_id = ?'); params.push(work_history_id); }
        if (project_name !== undefined) { setClauses.push('project_name = ?'); params.push(project_name); }
        if (description !== undefined) { setClauses.push('description = ?'); params.push(description); }
        if (role !== undefined) { setClauses.push('role = ?'); params.push(role); }
        if (start_date !== undefined) { setClauses.push('start_date = ?'); params.push(start_date); }
        if (end_date !== undefined) { setClauses.push('end_date = ?'); params.push(end_date); }
        if (technologies !== undefined) { setClauses.push('technologies = ?'); params.push(technologies); }
        if (is_visible !== undefined) { setClauses.push('is_visible = ?'); params.push(is_visible ? 1 : 0); }

        if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

        params.push(req.params.id);
        const result = db.prepare(`UPDATE cv_past_projects SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

        if (result.changes === 0) return res.status(404).json({ error: 'Past project not found' });

        const project = db.prepare('SELECT * FROM cv_past_projects WHERE id = ?').get(req.params.id);
        res.json(project);
    } catch (err) {
        console.error(`PUT /cv-profiles/:email/past-projects/:id error:`, err);
        res.status(500).json({ error: 'Failed to update past project' });
    }
});

// ── DELETE /cv-profiles/:email/past-projects/:id — delete past project ─────────
router.delete('/:email/past-projects/:id', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const result = db.prepare('DELETE FROM cv_past_projects WHERE id = ?').run(req.params.id);

        if (result.changes === 0) return res.status(404).json({ error: 'Past project not found' });

        res.json({ deleted: true });
    } catch (err) {
        console.error(`DELETE /cv-profiles/:email/past-projects/:id error:`, err);
        res.status(500).json({ error: 'Failed to delete past project' });
    }
});

// ── Template Engine ────────────────────────────────────────────────────────────

/**
 * Lightweight Markdown-to-HTML converter (headings, bold, italic,
 * unordered lists, blockquotes, horizontal rules, paragraphs, links, line breaks).
 * Intentionally minimal — no new npm dependency required.
 */
/**
 * Full GFM Markdown-to-HTML converter.
 * Supports: h1-h6, bold/italic/strike/bold-italic, GFM tables with alignment,
 * ordered + unordered lists, fenced code blocks, blockquotes,
 * inline code, images, links, paragraphs.
 */
function markdownToHtml(md) {
    if (!md) return '';
    let out = md;

    // 1. Fenced code blocks
    out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `\n\n<pre><code class="language-${lang}">${escaped.trimEnd()}</code></pre>\n\n`;
    });

    // 2. GFM Tables
    out = out.replace(/((?:\|.+\|\n)+)/g, tableBlock => {
        const rows = tableBlock.trim().split('\n');
        if (rows.length < 2) return tableBlock;
        const sepRow = rows[1];
        if (!/^\|[-| :]+\|$/.test(sepRow.trim())) return tableBlock;

        const parseRow = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const aligns = parseRow(sepRow).map(c => {
            if (/^:-+:$/.test(c)) return 'center';
            if (/^-+:$/.test(c)) return 'right';
            return 'left';
        });

        const headerCells = parseRow(rows[0]).map((c, i) =>
            `<th style="text-align:${aligns[i]}">${inlineMarkdown(c)}</th>`).join('');
        const bodyRows = rows.slice(2).map(r =>
            `<tr>${parseRow(r).map((c, i) => `<td style="text-align:${aligns[i]}">${inlineMarkdown(c)}</td>`).join('')}</tr>`
        ).join('\n');

        return `\n<table>\n<thead><tr>${headerCells}</tr></thead>\n<tbody>${bodyRows}</tbody>\n</table>\n`;
    });

    // 3. Blockquotes
    out = out.replace(/^> ?(.+)$/gm, '<blockquote>$1</blockquote>');

    // 4. Headings h1-h6
    out = out.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    out = out.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    out = out.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    out = out.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    out = out.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    out = out.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // 5. Horizontal rules
    out = out.replace(/^(\*{3}|-{3}|_{3})\s*$/gm, '<hr>');

    // 6. Ordered lists
    out = out.replace(/^(\d+)\.\s+(.+)$/gm, '<li data-ol="1">$2</li>');
    out = out.replace(/(<li data-ol="1">[\s\S]*?<\/li>\n?)+/g, block =>
        `<ol>${block.replace(/ data-ol="1"/g, '')}</ol>`);

    // 7. Unordered lists
    out = out.replace(/^[ \t]*[-*+]\s+(.+)$/gm, '<li>$1</li>');
    out = out.replace(/(<li>(?:(?!data-ol)[\s\S])*?<\/li>\n?)+/g, block => `<ul>${block}</ul>`);

    // 8. Inline formatting
    out = out.replace(/~~(.+?)~~/g, '<s>$1</s>');
    out = out.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
    out = out.replace(/__(.+?)__/g, '<strong>$1</strong>');
    out = out.replace(/_(.+?)_/g, '<em>$1</em>');

    // 9. Inline code
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 10. Images and links
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;">');
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // 11. Paragraphs
    const blockTags = /^<(h[1-6]|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|pre|hr|div|section)/;
    const lines = out.split('\n');
    let result = '';
    let para = [];
    const flushPara = () => {
        if (para.length && para.some(l => l.trim())) result += `<p>${para.join(' ').trim()}</p>\n`;
        para = [];
    };
    for (const line of lines) {
        if (!line.trim()) { flushPara(); continue; }
        if (blockTags.test(line.trim())) { flushPara(); result += line + '\n'; }
        else { para.push(line); }
    }
    flushPara();
    return result;
}

function inlineMarkdown(text) {
    return text
        .replace(/~~(.+?)~~/g, '<s>$1</s>')
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * Render a Mustache-lite template with scalar variables, list blocks,
 * conditional blocks, and named section blocks for per-section CSS.
 * Supports:
 *   {{section:name}}...{{/section:name}} → <section id="name" class="cv-section">
 *   {{#list}}...{{/list}}               → array loop
 *   {{#scalar}}...{{/scalar}}           → conditional
 *   {{varname}}                          → scalar substitution
 */
function renderTemplate(template, data) {
    // 1. Named section blocks  {{section:name}}...{{/section:name}}
    template = template.replace(/\{\{section:(\w+)\}\}([\s\S]*?)\{\{\/section:\1\}\}/g, (_, name, content) => {
        return `\n\n<section id="${name}" class="cv-section">\n\n${content.trim()}\n\n</section>\n\n`;
    });

    // 2. Block sections (arrays/conditionals) — {{#key}}...{{/key}}
    template = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, block) => {
        const val = data[key];
        if (!val) return '';
        if (Array.isArray(val)) {
            return val.map(item => {
                return block.replace(/\{\{(\w+)\}\}/g, (__, field) => {
                    const v = item[field];
                    return v != null ? String(v) : '';
                }).replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (___, k2, b2) => {
                    const iv = item[k2];
                    if (!iv) return '';
                    return b2.replace(/\{\{(\w+)\}\}/g, (____, f2) => {
                        const nv = item[f2];
                        return nv != null ? String(nv) : '';
                    });
                });
            }).join('');
        }
        if (val) {
            return block.replace(/\{\{(\w+)\}\}/g, (__, field) => {
                return data[field] != null ? String(data[field]) : '';
            });
        }
        return '';
    });

    // 3. Scalar variables {{var}}
    template = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        return data[key] != null ? String(data[key]) : '';
    });

    // 4. Collapse blank lines between table rows (loop expansion adds extra newlines)
    template = template.replace(/(\|[^\n]*\|)\n\n+(\|[^\n]*\|)/g, '$1\n$2');
    template = template.replace(/(\|[^\n]*\|)\n\n+(\|[^\n]*\|)/g, '$1\n$2');

    return template;
}

/**
 * Collect all CV data for a user into a template-ready data object.
 */
function collectCvData(db, email) {
    const profile = db.prepare('SELECT * FROM cv_profiles WHERE staff_email = ?').get(email);
    const submission = db.prepare('SELECT * FROM submissions WHERE staff_email = ? ORDER BY updated_at DESC LIMIT 1').get(email);
    const skills = db.prepare('SELECT skill, rating FROM submission_skills WHERE submission_id = (SELECT id FROM submissions WHERE staff_email = ? ORDER BY updated_at DESC LIMIT 1)').all(email);
    const projects = db.prepare('SELECT soc, project_name, customer, role, end_date FROM submission_projects WHERE submission_id = (SELECT id FROM submissions WHERE staff_email = ? ORDER BY updated_at DESC LIMIT 1)').all(email);
    const education = db.prepare('SELECT * FROM education WHERE staff_email = ? ORDER BY end_year DESC').all(email);
    const certifications = db.prepare('SELECT * FROM certifications WHERE staff_email = ? ORDER BY date_obtained DESC').all(email);
    const workHistory = db.prepare('SELECT * FROM work_history WHERE staff_email = ? ORDER BY start_date DESC').all(email);
    const pastProjects = db.prepare('SELECT * FROM cv_past_projects WHERE staff_email = ? ORDER BY start_date DESC').all(email);
    const staffRow = db.prepare('SELECT * FROM staff WHERE email = ?').get(email);

    const name = submission?.staff_name || staffRow?.name || email;
    const title = submission?.title || staffRow?.title || '';
    const department = submission?.department || staffRow?.department || '';
    const managerName = submission?.manager_name || staffRow?.manager_name || '';

    return {
        name, email, title, department, managerName,
        phone: profile?.phone || '',
        linkedin: profile?.linkedin || '',
        location: profile?.location || '',
        summary: profile?.summary || '',
        photoPath: profile?.photo_path || '',
        generatedAt: new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }),
        skills: skills.map(s => ({ skill: s.skill, rating: s.rating || '' })),
        projects: projects.map(p => ({ soc: p.soc || '', project_name: p.project_name || '', customer: p.customer || '', role: p.role || '', end_date: p.end_date || '' })),
        education: education.map(e => ({ institution: e.institution || '', degree: e.degree || '', field: e.field || '', start_year: e.start_year || '', end_year: e.end_year || '', description: e.description || '' })),
        certifications: certifications.map(c => ({ name: c.name || '', issuer: c.issuer || '', date_obtained: c.date_obtained || '', expiry_date: c.expiry_date || '', credential_id: c.credential_id || '', description: c.description || '' })),
        workHistory: workHistory.map(w => ({ employer: w.employer || '', job_title: w.job_title || '', start_date: w.start_date || '', end_date: w.is_current ? 'Present' : (w.end_date || ''), description: w.description || '' })),
        pastProjects: pastProjects.map(p => ({ project_name: p.project_name || '', role: p.role || '', start_date: p.start_date || '', end_date: p.end_date || '', description: p.description || '', technologies: p.technologies || '' })),
    };
}

/**
 * Render a full standalone HTML document from template + data.
 */
function renderCvHtml(template, cvData) {
    const rendered = renderTemplate(template.markdown_template || '', cvData);
    const htmlBody = markdownToHtml(rendered);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CV — ${cvData.name}</title>
<style>
${template.css_styles || ''}
</style>
</head>
<body>
<div class="cv-body">
${htmlBody}
</div>
</body>
</html>`;
}

// ── DELETE /cv-profiles/templates/:id — delete a template ─────────────────────
router.delete('/templates/:id', verifyToken, requireRole('admin'), (req, res) => {
    try {
        const db = getDb();
        const tmpl = db.prepare('SELECT * FROM cv_templates WHERE id = ?').get(req.params.id);
        if (!tmpl) return res.status(404).json({ error: 'Template not found' });
        if (tmpl.is_default) return res.status(400).json({ error: 'Cannot delete the default template. Set another template as default first.' });
        db.prepare('DELETE FROM cv_templates WHERE id = ?').run(req.params.id);
        res.json({ deleted: true });
    } catch (err) {
        console.error('DELETE /cv-profiles/templates/:id error:', err);
        res.status(500).json({ error: 'Failed to delete template' });
    }
});

// ── POST /cv-profiles/:email/generate — generate CV & save snapshot ────────────
router.post('/:email/generate', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden: You can only generate your own CV' });
        }

        const { template_id } = req.body;

        // Resolve template
        let template;
        if (template_id) {
            template = db.prepare('SELECT * FROM cv_templates WHERE id = ?').get(template_id);
            if (!template) return res.status(404).json({ error: 'Template not found' });
        } else {
            template = db.prepare('SELECT * FROM cv_templates WHERE is_default = 1 LIMIT 1').get()
                || db.prepare('SELECT * FROM cv_templates LIMIT 1').get();
        }

        if (!template) return res.status(500).json({ error: 'No CV template available' });

        // Collect data & render
        const cvData = collectCvData(db, email);
        const snapshotHtml = renderCvHtml(template, cvData);

        // Save snapshot
        const id = uuidv4();
        const now = new Date().toISOString();
        db.prepare('INSERT INTO cv_snapshots (id, staff_email, generated_by, template_id, template_name, snapshot_html, snapshot_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, email, req.user.email, template.id, template.name, snapshotHtml, JSON.stringify(cvData), now);

        res.json({ snapshot_id: id, html: snapshotHtml, template_name: template.name });
    } catch (err) {
        console.error('POST /cv-profiles/:email/generate error:', err);
        res.status(500).json({ error: err.message || 'Failed to generate CV' });
    }
});

// ── GET /cv-profiles/:email/snapshots — list snapshots ────────────────────────
router.get('/:email/snapshots', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const rows = db.prepare(
            'SELECT id, staff_email, generated_by, template_id, template_name, created_at FROM cv_snapshots WHERE staff_email = ? ORDER BY created_at DESC'
        ).all(email);

        res.json(rows);
    } catch (err) {
        console.error('GET /cv-profiles/:email/snapshots error:', err);
        res.status(500).json({ error: 'Failed to fetch snapshots' });
    }
});

// ── GET /cv-profiles/:email/snapshots/:id — get snapshot HTML ─────────────────
router.get('/:email/snapshots/:id', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();

        if (!canAccessProfile(req, email)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const row = db.prepare('SELECT * FROM cv_snapshots WHERE id = ? AND staff_email = ?').get(req.params.id, email);
        if (!row) return res.status(404).json({ error: 'Snapshot not found' });

        res.json(row);
    } catch (err) {
        console.error('GET /cv-profiles/:email/snapshots/:id error:', err);
        res.status(500).json({ error: 'Failed to fetch snapshot' });
    }
});

// ── DELETE /cv-profiles/:email/snapshots/:id — delete one snapshot ─────────────────
router.delete('/:email/snapshots/:id', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();
        const { role } = req.user;
        const isOwnProfile = req.user.email.toLowerCase() === email;

        // HR can only delete their own snapshots
        if ((role === 'hr' || req.user.is_hr) && !isOwnProfile) {
            return res.status(403).json({ error: 'Forbidden: HR users cannot delete other users\' CV snapshots' });
        }

        // Staff can only delete own
        if (role === 'staff' && !isOwnProfile) {
            return res.status(403).json({ error: 'Forbidden: You can only delete your own snapshots' });
        }

        const result = db.prepare('DELETE FROM cv_snapshots WHERE id = ? AND staff_email = ?').run(req.params.id, email);
        if (result.changes === 0) return res.status(404).json({ error: 'Snapshot not found' });

        res.json({ deleted: true });
    } catch (err) {
        console.error('DELETE /cv-profiles/:email/snapshots/:id error:', err);
        res.status(500).json({ error: 'Failed to delete snapshot' });
    }
});

// ── DELETE /cv-profiles/:email/snapshots — clear all snapshots ──────────────────
router.delete('/:email/snapshots', verifyToken, (req, res) => {
    try {
        const db = getDb();
        const email = req.params.email.toLowerCase();
        const { role } = req.user;
        const isOwnProfile = req.user.email.toLowerCase() === email;

        // HR can only clear their own snapshots
        if ((role === 'hr' || req.user.is_hr) && !isOwnProfile) {
            return res.status(403).json({ error: 'Forbidden: HR users cannot clear other users\' CV snapshots' });
        }

        // Staff can only clear own
        if (role === 'staff' && !isOwnProfile) {
            return res.status(403).json({ error: 'Forbidden: You can only clear your own snapshots' });
        }

        const result = db.prepare('DELETE FROM cv_snapshots WHERE staff_email = ?').run(email);
        res.json({ deleted: result.changes });
    } catch (err) {
        console.error('DELETE /cv-profiles/:email/snapshots error:', err);
        res.status(500).json({ error: 'Failed to clear snapshots' });
    }
});

module.exports = router;

