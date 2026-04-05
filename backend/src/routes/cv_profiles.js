import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { verifyToken, requireRole } from './auth.js';
import path from 'path';
import fs from 'fs';
import multer from 'multer';

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

// ── CV Templates Routes ────────────────────────────────────────────────────────

// GET /templates - List all CV templates
router.get('/templates', verifyToken, async (_req, res) => {
    try {
        const db = await getDb();
        const [templates] = await db.query('SELECT * FROM cv_templates ORDER BY is_default DESC, name ASC');
        res.json(templates);
    } catch (err) {
        console.error('Error fetching templates:', err);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

// POST /templates - Create new CV template
router.post('/templates', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const { name, markdown_template, css_styles, is_default } = req.body;
        if (!name) return res.status(400).json({ error: 'Template name is required' });

        const db = await getDb();
        const id = uuidv4();
        await db.query(
            `INSERT INTO cv_templates (id, name, markdown_template, css_styles, is_default) 
             VALUES (?, ?, ?, ?, ?)`,
            [id, name, markdown_template || '', css_styles || '', is_default ? 1 : 0]
        );
        res.json({ id, name, markdown_template, css_styles, is_default });
    } catch (err) {
        console.error('Error creating template:', err);
        res.status(500).json({ error: 'Failed to create template' });
    }
});

// PUT /templates/:id - Update CV template
router.put('/templates/:id', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, markdown_template, css_styles, is_default } = req.body;
        if (!name) return res.status(400).json({ error: 'Template name is required' });

        // Prevent editing built-in templates
        if (['classic', 'modern', 'minimal'].includes(id)) {
            return res.status(403).json({ error: 'Built-in templates cannot be edited' });
        }

        const db = await getDb();
        await db.query(
            `UPDATE cv_templates SET name = ?, markdown_template = ?, css_styles = ?, is_default = ? WHERE id = ?`,
            [name, markdown_template || '', css_styles || '', is_default ? 1 : 0, id]
        );
        res.json({ id, name, markdown_template, css_styles, is_default });
    } catch (err) {
        console.error('Error updating template:', err);
        res.status(500).json({ error: 'Failed to update template' });
    }
});

// DELETE /templates/:id - Delete CV template
router.delete('/templates/:id', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;

        // Prevent deleting built-in templates
        if (['classic', 'modern', 'minimal'].includes(id)) {
            return res.status(403).json({ error: 'Built-in templates cannot be deleted' });
        }

        const db = await getDb();
        await db.query('DELETE FROM cv_templates WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting template:', err);
        res.status(500).json({ error: 'Failed to delete template' });
    }
});

// ── Admin Routes ───────────────────────────────────────────────────────────────

// GET /admin - Fetch admin profile data
router.get('/admin', verifyToken, requireRole('admin'), async (_req, res) => {
    try {
        const db = await getDb();
        const [adminData] = await db.query('SELECT * FROM admin_profiles');
        res.json(adminData);
    } catch (err) {
        console.error('Error fetching admin data:', err);
        res.status(500).json({ error: 'Failed to fetch admin data' });
    }
});

// GET /admin/snapshots - Fetch admin snapshots
router.get('/admin/snapshots', verifyToken, requireRole('admin'), async (_req, res) => {
    try {
        const db = await getDb();
        const [snapshots] = await db.query('SELECT * FROM admin_snapshots');
        res.json(snapshots);
    } catch (err) {
        console.error('Error fetching admin snapshots:', err);
        res.status(500).json({ error: 'Failed to fetch admin snapshots' });
    }
});

// POST / - Create new CV profile
router.post('/', verifyToken, async (req, res) => {
    try {
        const { staff_email, summary, phone, linkedin, location } = req.body;

        if (!staff_email) {
            return res.status(400).json({ error: 'staff_email is required' });
        }

        const db = await getDb();
        const id = uuidv4();
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

        // Check if profile already exists
        const [existing] = await db.query(
            'SELECT id FROM cv_profiles WHERE LOWER(staff_email) = ?',
            [staff_email.toLowerCase()]
        );

        if (existing.length > 0) {
            return res.status(409).json({ error: 'Profile already exists for this email' });
        }

        await db.query(
            `INSERT INTO cv_profiles (id, staff_email, summary, phone, linkedin, location, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, staff_email.toLowerCase(), summary || null, phone || null, linkedin || null, location || null, now, now]
        );

        res.json({ id, staff_email: staff_email.toLowerCase() });
    } catch (err) {
        console.error('Error creating CV profile:', err);
        res.status(500).json({ error: 'Failed to create CV profile' });
    }
});

// PUT /:email - Update CV profile
router.put('/:email', verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        const { summary, phone, linkedin, location } = req.body;

        const db = await getDb();
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

        // Check if profile exists
        const [existing] = await db.query(
            'SELECT id FROM cv_profiles WHERE LOWER(staff_email) = ?',
            [email.toLowerCase()]
        );

        if (!existing.length) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        await db.query(
            `UPDATE cv_profiles SET summary = ?, phone = ?, linkedin = ?, location = ?, updated_at = ?
             WHERE LOWER(staff_email) = ?`,
            [summary || null, phone || null, linkedin || null, location || null, now, email.toLowerCase()]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Error updating CV profile:', err);
        res.status(500).json({ error: 'Failed to update CV profile' });
    }
});

// GET /:email - Fetch CV profile and all related data
router.get('/:email', verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        const db = await getDb();

        // Fetch main profile
        const [profiles] = await db.query(
            'SELECT id, staff_email, summary, phone, linkedin, location, photo_path FROM cv_profiles WHERE LOWER(staff_email) = ? LIMIT 1',
            [email.toLowerCase()]
        );
        const profile = profiles[0] || null;

        // Fetch education
        let education = [];
        try {
            const [eduRows] = await db.query(
                'SELECT id, institution, degree, field, start_year, end_year, description, proof_path FROM education WHERE LOWER(staff_email) = ? ORDER BY start_year DESC',
                [email.toLowerCase()]
            );
            education = eduRows;
        } catch (e) {
            console.log('Education table query failed:', e.code);
        }

        // Fetch certifications
        let certifications = [];
        try {
            const [certRows] = await db.query(
                'SELECT id, name, issuer, date_obtained, expiry_date, credential_id, description, proof_path FROM certifications WHERE LOWER(staff_email) = ? ORDER BY date_obtained DESC',
                [email.toLowerCase()]
            );
            certifications = certRows;
        } catch (e) {
            console.log('Certifications table query failed:', e.code);
        }

        // Fetch work history (using correct column names: employer, job_title)
        let workHistory = [];
        try {
            const [histRows] = await db.query(
                'SELECT id, employer, job_title, start_date, end_date, description, is_current FROM work_history WHERE LOWER(staff_email) = ? ORDER BY start_date DESC',
                [email.toLowerCase()]
            );
            workHistory = histRows;
        } catch (e) {
            console.log('Work history query failed:', e.code);
        }

        // Fetch past projects (table may not exist)
        let pastProjects = [];
        try {
            const [projRows] = await db.query(
                'SELECT id, project_name, description, role, start_date, end_date, technologies FROM cv_past_projects WHERE LOWER(staff_email) = ? ORDER BY start_date DESC',
                [email.toLowerCase()]
            );
            pastProjects = projRows;
        } catch (e) {
            console.log('Past projects table not available:', e.code);
        }

        res.json({
            profile,
            education,
            certifications,
            workHistory,
            pastProjects
        });
    } catch (err) {
        console.error('Error fetching CV profile:', err);
        res.status(500).json({ error: 'Failed to fetch CV profile' });
    }
});

// GET /:email/snapshots - Fetch CV snapshots for an email
router.get('/:email/snapshots', verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        const db = await getDb();

        // Try to fetch snapshots, but return empty array if table doesn't exist
        let snapshots = [];
        try {
            const [snapshotRows] = await db.query(
                'SELECT id, staff_email, generated_by, template_id, template_name, snapshot_html, snapshot_data, created_at FROM cv_snapshots WHERE LOWER(staff_email) = ? ORDER BY created_at DESC',
                [email.toLowerCase()]
            );
            snapshots = snapshotRows;
        } catch (e) {
            if (e.code === 'ER_NO_SUCH_TABLE') {
                console.log('cv_snapshots table not available');
                snapshots = [];
            } else {
                throw e;
            }
        }

        res.json(snapshots);
    } catch (err) {
        console.error('Error fetching CV snapshots:', err);
        res.status(500).json({ error: 'Failed to fetch CV snapshots' });
    }
});

// GET /:email/snapshots/:snapshot_id - Get a specific CV snapshot
router.get('/:email/snapshots/:snapshot_id', verifyToken, async (req, res) => {
    try {
        const { snapshot_id } = req.params;
        const db = await getDb();

        const [snapshots] = await db.query(
            'SELECT id, staff_email, generated_by, template_id, template_name, snapshot_html, created_at FROM cv_snapshots WHERE id = ? LIMIT 1',
            [snapshot_id]
        );

        if (!snapshots || snapshots.length === 0) {
            return res.status(404).json({ error: 'Snapshot not found' });
        }

        res.json(snapshots[0]);
    } catch (err) {
        console.error('Error fetching snapshot:', err);
        res.status(500).json({ error: 'Failed to fetch snapshot' });
    }
});

// ── Template Processing Helper ──────────────────────────────────────────────────

/**
 * Simple template processor for CV generation
 * Supports:
 * - {{variable}} replacements
 * - {{#array}}...{{/array}} loops
 * - {{section:name}}...{{/section:name}} conditional sections
 */
function processTemplate(template, data) {
    let result = template;

    // Process conditional sections: {{section:name}}...{{/section:name}}
    const sectionRegex = /\{\{section:(\w+)\}\}([\s\S]*?)\{\{\/section:\1\}\}/g;
    result = result.replace(sectionRegex, (match, sectionName, content) => {
        // Check if the data has this section and it's not empty
        const sectionData = data[sectionName];
        if (sectionData && ((Array.isArray(sectionData) && sectionData.length > 0) || (typeof sectionData === 'string' && sectionData.trim()))) {
            return content;
        }
        return ''; // Remove section if data doesn't exist
    });

    // Process arrays and boolean conditionals: {{#arrayName}}...{{/arrayName}}
    const arrayRegex = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
    result = result.replace(arrayRegex, (match, arrayName, content) => {
        const value = data[arrayName];
        
        // Handle boolean/truthy values
        if (!Array.isArray(value)) {
            if (value) {
                // For non-array truthy values, just include the content as-is
                let itemContent = content;
                const varRegex = /\{\{([^}]+)\}\}/g;
                itemContent = itemContent.replace(varRegex, (varMatch, varName) => {
                    return data[varName] || varMatch;
                });
                return itemContent;
            }
            return '';
        }
        
        // Handle arrays
        if (value.length === 0) return '';
        
        return value.map(item => {
            let itemContent = content;
            // Replace variables in item context
            const varRegex = /\{\{([^}]+)\}\}/g;
            itemContent = itemContent.replace(varRegex, (varMatch, varName) => {
                return item[varName] || varMatch;
            });
            return itemContent;
        }).join('');
    });

    // Process simple variable replacements: {{variableName}}
    const varRegex = /\{\{([^}]+)\}\}/g;
    result = result.replace(varRegex, (match, varName) => {
        // Handle nested properties like {{staff.name}}
        const parts = varName.split('.');
        let value = data;
        for (const part of parts) {
            value = value[part] || '';
        }
        return value || '';
    });

    return result;
}

/**
 * Convert markdown-like formatting to HTML
 */
function markdownToHtml(markdown) {
    let html = markdown;
    
    // Preserve existing HTML tags (like <div class="cv-photo">...) by storing them temporarily
    const htmlChunks = [];
    const htmlPlaceholder = /(<[^>]+>)/g;
    html = html.replace(htmlPlaceholder, (match) => {
        htmlChunks.push(match);
        return `__HTML_${htmlChunks.length - 1}__`;
    });

    // Escape HTML characters (now safe since we removed actual HTML tags)
    html = html.replace(/&/g, '&amp;');

    // Headers: ## Title → <h2>Title</h2>
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

    // Bold: **text** → <strong>text</strong>
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Italic: *text* → <em>text</em>
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Horizontal rules: --- or *** → <hr>
    html = html.replace(/^(\-{3,}|\*{3,})$/gm, '<hr style="margin: 16px 0; border: none; border-top: 1px solid #e5e7eb;">');

    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraphs
    const lines = html.split('</p><p>');
    html = lines.map(line => {
        // Don't wrap headers, HR, or list items in <p>
        if (line.match(/^<h[1-3]>|^<hr|^<ul>|^<ol>|^<li>|^<table>/)) {
            return line;
        }
        if (line.trim() && !line.match(/^<p>/)) {
            return `<p>${line}</p>`;
        }
        return line;
    }).join('');

    // Tables: pipe-based markdown tables
    html = html.replace(/^\|(.+)\|$/gm, (match) => {
        const rows = html.match(/^\|(.+)\|$/gm) || [];
        // Simple table handling - just format as-is for now
        return match;
    });

    // Lists: - item → <li>item</li>
    html = html.replace(/^\s*- (.*?)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>)/s, '<ul>$1</ul>');

    // Remove double wrapping
    html = html.replace(/<p><\/p>/g, '');
    
    // Restore preserved HTML chunks
    htmlChunks.forEach((chunk, index) => {
        html = html.replace(`__HTML_${index}__`, chunk);
    });

    return html;
}

// POST /:email/generate - Generate CV HTML from template
router.post('/:email/generate', verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        const { template_id } = req.body;
        const db = await getDb();

        // Fetch CV profile and related data
        const [profiles] = await db.query(
            'SELECT id, staff_email, summary, phone, linkedin, location, photo_path FROM cv_profiles WHERE LOWER(staff_email) = ? LIMIT 1',
            [email.toLowerCase()]
        );
        const profile = profiles[0];

        if (!profile) {
            return res.status(404).json({ error: 'CV profile not found' });
        }

        // Fetch related data
        let education = [];
        try {
            const [eduRows] = await db.query(
                'SELECT id, institution, degree, field, start_year, end_year, description FROM education WHERE LOWER(staff_email) = ? ORDER BY start_year DESC',
                [email.toLowerCase()]
            );
            education = eduRows || [];
        } catch (e) {
            console.log('Education fetch failed:', e.code);
        }

        let certifications = [];
        try {
            const [certRows] = await db.query(
                'SELECT id, name, issuer, date_obtained, expiry_date, credential_id FROM certifications WHERE LOWER(staff_email) = ? ORDER BY date_obtained DESC',
                [email.toLowerCase()]
            );
            certifications = certRows || [];
        } catch (e) {
            console.log('Certifications fetch failed:', e.code);
        }

        let workHistory = [];
        try {
            const [histRows] = await db.query(
                'SELECT id, employer, job_title, start_date, end_date, description, is_current FROM work_history WHERE LOWER(staff_email) = ? ORDER BY start_date DESC',
                [email.toLowerCase()]
            );
            workHistory = histRows || [];
        } catch (e) {
            console.log('Work history fetch failed:', e.code);
        }

        let pastProjects = [];
        try {
            const [projRows] = await db.query(
                'SELECT id, project_name, description, role, start_date, end_date, technologies FROM cv_past_projects WHERE LOWER(staff_email) = ? ORDER BY start_date DESC',
                [email.toLowerCase()]
            );
            pastProjects = projRows || [];
        } catch (e) {
            console.log('Past projects fetch failed:', e.code);
        }

        // Fetch staff data from submissions/catalog for additional fields
        let staffName = email;
        let staffTitle = '';
        let staffDepartment = '';
        try {
            const [staffRows] = await db.query(
                'SELECT staff_name, title, department FROM submissions WHERE LOWER(staff_email) = ? LIMIT 1',
                [email.toLowerCase()]
            );
            if (staffRows[0]) {
                staffName = staffRows[0].staff_name || email;
                staffTitle = staffRows[0].title || '';
                staffDepartment = staffRows[0].department || '';
            }
        } catch (e) {
            console.log('Staff data fetch failed:', e.code);
        }

        // Select template
        let template;
        if (template_id) {
            const [templates] = await db.query('SELECT * FROM cv_templates WHERE id = ?', [template_id]);
            template = templates[0];
        } else {
            // Get default template
            const [templates] = await db.query('SELECT * FROM cv_templates WHERE is_default = 1 LIMIT 1');
            template = templates[0];
        }

        if (!template) {
            return res.status(400).json({ error: 'Template not found' });
        }

        // Fetch submission data for skills and projects
        let submissionSkills = [];
        let submissionProjects = [];
        try {
            const [submissions] = await db.query(
                'SELECT id FROM submissions WHERE LOWER(staff_email) = ? LIMIT 1',
                [email.toLowerCase()]
            );
            if (submissions && submissions[0]) {
                const submissionId = submissions[0].id;

                // Fetch skills
                try {
                    const [skillRows] = await db.query(
                        'SELECT skill, rating FROM submission_skills WHERE submission_id = ? ORDER BY rating DESC',
                        [submissionId]
                    );
                    submissionSkills = (skillRows || []).map(s => ({
                        skill: s.skill,
                        rating: s.rating || 0
                    }));
                } catch (e) {
                    console.log('Skills fetch failed:', e.code);
                }

                // Fetch projects
                try {
                    const [projRows] = await db.query(
                        'SELECT project_name, customer, role, start_date, end_date, description, technologies_used FROM submission_projects WHERE submission_id = ? ORDER BY start_date DESC',
                        [submissionId]
                    );
                    submissionProjects = (projRows || []).map(p => ({
                        project_name: p.project_name,
                        customer: p.customer,
                        role: p.role,
                        start_date: p.start_date,
                        end_date: p.end_date,
                        description: p.description,
                        technologies: p.technologies_used
                    }));
                } catch (e) {
                    console.log('Projects fetch failed:', e.code);
                }
            }
        } catch (e) {
            console.log('Submission fetch failed:', e.code);
        }

        // Prepare data object for template processing
        const templateData = {
            name: staffName,
            email: profile.staff_email,
            phone: profile.phone || '',
            linkedin: profile.linkedin || '',
            location: profile.location || '',
            title: staffTitle,
            department: staffDepartment,
            summary: profile.summary || '',
            generatedAt: new Date().toLocaleDateString(),
            education,
            certifications,
            workHistory,
            projects: submissionProjects.length > 0 ? submissionProjects : pastProjects,
            skills: submissionSkills,
            photo: profile.photo_path ? true : false,
            photo_path: profile.photo_path || undefined
        };

        // Process template
        let htmlContent = processTemplate(template.markdown_template, templateData);
        htmlContent = markdownToHtml(htmlContent);

        // Wrap in complete HTML document with CSS
        const htmlDocument = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CV - ${staffName}</title>
    <style>
        ${template.css_styles || `
            body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; color: #111; }
            .cv-body { max-width: 860px; margin: 0 auto; padding: 32px; }
            h1 { font-size: 2rem; margin: 0 0 4px; }
            h2 { color: #1d4ed8; border-bottom: 2px solid #1d4ed8; padding-bottom: 4px; margin-top: 1.5rem; }
            hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.25rem 0; }
            ul { padding-left: 1.2rem; }
            table { border-collapse: collapse; width: 100%; }
            th { background: #f3f4f6; text-align: left; }
            th, td { padding: 6px 10px; border: 1px solid #e5e7eb; }
        `}
    </style>
</head>
<body>
    <div class="cv-body">
        ${htmlContent}
    </div>
</body>
</html>`;

        res.json({ html: htmlDocument, template_name: template.name });
    } catch (err) {
        console.error('Error generating CV:', err);
        res.status(500).json({ error: 'Failed to generate CV' });
    }
});

// POST /:email/snapshots - Save CV snapshot
router.post('/:email/snapshots', verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        const { snapshot_html, template_id, template_name } = req.body;

        if (!snapshot_html) {
            return res.status(400).json({ error: 'Snapshot HTML is required' });
        }

        const db = await getDb();
        const id = uuidv4();
        const generated_by = req.user?.email || 'system';

        // Check if cv_snapshots table exists, create if not
        try {
            await db.query(`
                CREATE TABLE IF NOT EXISTS cv_snapshots (
                    id VARCHAR(36) PRIMARY KEY,
                    staff_email VARCHAR(255) NOT NULL,
                    generated_by VARCHAR(255),
                    template_id VARCHAR(36),
                    template_name VARCHAR(255),
                    snapshot_html LONGTEXT NOT NULL,
                    snapshot_data JSON,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX (staff_email),
                    INDEX (created_at)
                )
            `);
        } catch (e) {
            console.log('cv_snapshots table already exists or creation failed:', e.code);
        }

        // Insert snapshot
        await db.query(
            `INSERT INTO cv_snapshots (id, staff_email, generated_by, template_id, template_name, snapshot_html, snapshot_data, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [id, email.toLowerCase(), generated_by, template_id || null, template_name || 'Unknown', snapshot_html, null]
        );

        res.json({ id, snapshot_html, template_name, created_at: new Date().toISOString() });
    } catch (err) {
        console.error('Error saving CV snapshot:', err);
        res.status(500).json({ error: 'Failed to save snapshot' });
    }
});

// DELETE /:email/snapshots/:snapshot_id - Delete a specific CV snapshot
router.delete('/:email/snapshots/:snapshot_id', verifyToken, async (req, res) => {
    try {
        const { snapshot_id } = req.params;
        const db = await getDb();

        await db.query('DELETE FROM cv_snapshots WHERE id = ?', [snapshot_id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting snapshot:', err);
        res.status(500).json({ error: 'Failed to delete snapshot' });
    }
});

// DELETE /:email/snapshots - Delete all CV snapshots for an email
router.delete('/:email/snapshots', verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        const db = await getDb();

        await db.query('DELETE FROM cv_snapshots WHERE LOWER(staff_email) = ?', [email.toLowerCase()]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error clearing snapshots:', err);
        res.status(500).json({ error: 'Failed to clear snapshots' });
    }
});

// POST /:email/photo - Upload profile photo
router.post('/:email/photo', verifyToken, upload.single('photo'), async (req, res) => {
    try {
        const { email } = req.params;
        const db = await getDb();

        if (!req.file) {
            console.log('No file in request');
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const photoPath = `/uploads/photos/${req.file.filename}`;
        console.log(`Photo uploaded: ${photoPath}, updating for email: ${email}`);

        // First check if profile exists
        const [existing] = await db.query(
            'SELECT id FROM cv_profiles WHERE LOWER(staff_email) = ?',
            [email.toLowerCase()]
        );

        if (!existing || existing.length === 0) {
            console.log(`No profile found for email: ${email}`);
            return res.status(404).json({ error: 'CV profile not found for this email' });
        }

        // Update cv_profiles table with photo path
        const updateResult = await db.query(
            'UPDATE cv_profiles SET photo_path = ? WHERE LOWER(staff_email) = ?',
            [photoPath, email.toLowerCase()]
        );
        
        console.log(`Update result: ${JSON.stringify(updateResult)}`);
        res.json({ photo_path: photoPath });
    } catch (err) {
        console.error('Error uploading photo:', err);
        res.status(500).json({ error: 'Failed to upload photo: ' + err.message });
    }
});

// GET /:email/photo - Get profile photo
router.get('/:email/photo', verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        const db = await getDb();

        const [photos] = await db.query(
            'SELECT photo_path FROM cv_profiles WHERE LOWER(staff_email) = ? LIMIT 1',
            [email.toLowerCase()]
        );

        if (!photos || !photos[0] || !photos[0].photo_path) {
            return res.status(404).json({ error: 'Photo not found' });
        }

        res.json({ photo_path: photos[0].photo_path });
    } catch (err) {
        console.error('Error fetching photo:', err);
        res.status(500).json({ error: 'Failed to fetch photo' });
    }
});

// POST /:email/education - Add education record
router.post('/:email/education', verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        const { institution, degree, field, start_year, end_year, description } = req.body;
        const db = await getDb();

        const id = uuidv4();
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await db.query(
            `INSERT INTO education (id, staff_email, institution, degree, field, start_year, end_year, description, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, email.toLowerCase(), institution || null, degree || null, field || null, start_year || null, end_year || null, description || null, now]
        );

        res.json({ id });
    } catch (err) {
        console.error('Error adding education:', err);
        res.status(500).json({ error: 'Failed to add education' });
    }
});

// POST /:email/certifications - Add certification record
router.post('/:email/certifications', verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        const { name, issuer, date_obtained, expiry_date, credential_id, description } = req.body;
        const db = await getDb();

        const id = uuidv4();
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await db.query(
            `INSERT INTO certifications (id, staff_email, name, issuer, date_obtained, expiry_date, credential_id, description, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, email.toLowerCase(), name || null, issuer || null, date_obtained || null, expiry_date || null, credential_id || null, description || null, now]
        );

        res.json({ id });
    } catch (err) {
        console.error('Error adding certification:', err);
        res.status(500).json({ error: 'Failed to add certification' });
    }
});

// POST /:email/work-history - Add work history record
router.post('/:email/work-history', verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        const { employer, job_title, start_date, end_date, description, is_current } = req.body;
        const db = await getDb();

        const id = uuidv4();
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await db.query(
            `INSERT INTO work_history (id, staff_email, employer, job_title, start_date, end_date, description, is_current, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, email.toLowerCase(), employer || null, job_title || null, start_date || null, end_date || null, description || null, is_current || 0, now]
        );

        res.json({ id });
    } catch (err) {
        console.error('Error adding work history:', err);
        res.status(500).json({ error: 'Failed to add work history' });
    }
});

// POST /:email/past-projects - Add past project record
router.post('/:email/past-projects', verifyToken, async (req, res) => {
    try {
        const { email } = req.params;
        const { project_name, work_history_id, role, start_date, end_date, description, technologies } = req.body;
        const db = await getDb();

        // Create table if it doesn't exist
        try {
            await db.query(`
                CREATE TABLE IF NOT EXISTS cv_past_projects (
                    id VARCHAR(36) PRIMARY KEY,
                    staff_email VARCHAR(255) NOT NULL,
                    project_name VARCHAR(255) NOT NULL,
                    work_history_id VARCHAR(36),
                    role VARCHAR(255),
                    start_date VARCHAR(50),
                    end_date VARCHAR(50),
                    description LONGTEXT,
                    technologies VARCHAR(500),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX (staff_email)
                )
            `);
        } catch (e) {
            // Table already exists
        }

        const id = uuidv4();
        await db.query(
            `INSERT INTO cv_past_projects (id, staff_email, project_name, work_history_id, role, start_date, end_date, description, technologies)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, email.toLowerCase(), project_name || null, work_history_id || null, role || null, start_date || null, end_date || null, description || null, technologies || null]
        );

        res.json({ id });
    } catch (err) {
        console.error('Error adding past project:', err);
        res.status(500).json({ error: 'Failed to add past project' });
    }
});

export { router };

