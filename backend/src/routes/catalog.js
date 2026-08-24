import express from 'express';
import { getDb } from '../db.js';
import { verifyToken, requireRole } from './auth.js';
import axios from 'axios';

const router = express.Router();

// ── Date formatting helper ──────────────────────────────────────────────────
/**
 * Format a date value to YYYY-MM-DD string.
 */
function formatDate(dateVal) {
    if (!dateVal) return '';
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
        if (isNaN(d.getTime())) return '';
        // Use UTC to avoid timezone issues with MySQL DATE columns
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch {
        return '';
    }
}

const BEESUITE_API_BASE = process.env.BEESUITE_API_URL || 'https://appcore.beesuite.app';
const BEESUITE_EMAIL = process.env.BEESUITE_EMAIL || 'khairulnizam@zen.com.my';
const BEESUITE_PASSWORD = process.env.BEESUITE_PASSWORD || 'RXZlcnlvbmUjNzkwMTI0MDY1NDYz';

// Coordinator or admin can update projects
const requireCoordinator = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const isAdminOrCoordinator = req.user.isAdmin === true || req.user.is_coordinator === 1 || req.user.is_coordinator === true;
    if (!isAdminOrCoordinator) {
        return res.status(403).json({ error: 'Forbidden: Requires Coordinator role' });
    }
    next();
};

// Cache for SOC list to avoid frequent API calls
let socCache = null;
let socCacheTimestamp = 0;
const SOC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Get BeeSuite access token
async function getBeesuiteToken() {
    const authResponse = await axios.post(`${BEESUITE_API_BASE}/api/auth/login`, {
        email: BEESUITE_EMAIL,
        password: BEESUITE_PASSWORD
    });
    return authResponse.data.access_token;
}

router.get('/staff', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const [rows] = await db.query(`
            SELECT s.email, s.name, s.title, s.department, s.manager_name 
            FROM staff s
            INNER JOIN user_roles ur ON s.email = ur.email
            WHERE ur.is_active = 1
            ORDER BY s.name ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error('GET /catalog/staff error:', err);
        res.status(500).json({ error: 'Failed to retrieve staff catalog' });
    }
});

// ── GET /catalog/projects ─────────────────────────────────────────────────────
// Returns projects from BeeSuite AppCore /admin/soc/list endpoint
router.get('/projects', verifyToken, async (req, res) => {
    try {
        // Check cache first
        const now = Date.now();
        if (socCache && (now - socCacheTimestamp) < SOC_CACHE_TTL) {
            return res.json(socCache);
        }

        const accessToken = await getBeesuiteToken();
        if (!accessToken) {
            throw new Error('Failed to authenticate with BeeSuite API');
        }

        const response = await axios.get(`${BEESUITE_API_BASE}/admin/soc/list`, {
            headers: { 'Authorization': `JWT ${accessToken}` }
        });

        let socList = response.data;

        // Handle different response formats
        if (socList && socList.data) {
            socList = socList.data;
        }
        if (!Array.isArray(socList)) {
            socList = [];
        }

        // Map to expected format: { soc, project_name, customer, ... }
        const projects = socList.map(item => ({
            id: item.id || item.soc_id,
            soc: item.soc || item.soc_code || item.code || '',
            project_name: item.project_name || item.name || item.projectName || '',
            customer: item.customer || item.client || item.customer_name || '',
            start_date: formatDate(item.start_date || item.startDate),
            end_date: formatDate(item.end_date || item.endDate),
            technologies: item.technologies || item.tech || '',
            description: item.description || item.project_brief || ''
        })).filter(p => p.soc || p.project_name); // Filter out empty entries

        // Sort by project name
        projects.sort((a, b) => (a.project_name || a.soc || '').localeCompare(b.project_name || b.soc || ''));

        // Update cache
        socCache = projects;
        socCacheTimestamp = now;

        res.json(projects);
    } catch (err) {
        console.error('GET /catalog/projects error:', err);
        // Return empty array on error rather than failing completely
        res.json([]);
    }
});

// ── POST /catalog/projects/refresh ───────────────────────────────────────────
// Force refresh the SOC cache
router.post('/projects/refresh', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        socCache = null;
        socCacheTimestamp = 0;
        res.json({ success: true, message: 'Cache cleared' });
    } catch (err) {
        console.error('POST /catalog/projects/refresh error:', err);
        res.status(500).json({ error: 'Failed to refresh cache' });
    }
});

export { router };
