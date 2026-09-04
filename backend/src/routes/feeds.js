import express from 'express';
import { getDb } from '../db.js';
import { verifyToken } from './auth.js';
import { getUserSubordinates } from './reports.js';
import { toCsv } from '../utils/csv.js';

const router = express.Router();

function hasFullAccess(user) {
    return user.isAdmin === true
        || user.is_hr === 1 || user.is_hr === true
        || user.is_coordinator === 1 || user.is_coordinator === true;
}

// { scope: 'all' | 'subordinates' | 'none', emails?: string[] }
async function resolveFeedScope(db, user) {
    if (hasFullAccess(user)) return { scope: 'all', emails: null };
    const emails = await getUserSubordinates(db, String(user.email || '').toLowerCase());
    if (emails.length > 0) return { scope: 'subordinates', emails };
    return { scope: 'none', emails: null };
}

function requireScope(scope) {
    if (scope.scope === 'none') {
        const err = new Error('Insufficient permissions for this feed');
        err.status = 403;
        throw err;
    }
}

function scopeClause(scope, alias, col = 'email') {
    if (scope.scope === 'all') return { sql: '', params: [] };
    const ph = scope.emails.map(() => '?').join(',');
    return { sql: ` AND LOWER(${alias}.${col}) IN (${ph})`, params: scope.emails };
}

// Build WHERE/ORDER/LIMIT from the uniform feed grammar.
// def: { filterable: {key:'qualified.col', ...}, searchable: {key:'qualified.col', ...},
//        boolean: [keys], sortable: {key:'qualified.col', ...}, defaultSort: 'key',
//        searchKeys: ['qualified.col'], orderByAlias: true }  (orderByAlias: sort on SELECT alias)
function parseFeedQuery(req, def) {
    const q = req.query || {};
    const limit = Math.min(parseInt(q.limit, 10) || 50, 500);
    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const format = (q.format === 'csv' || String(req.headers.accept || '').includes('text/csv')) ? 'csv' : 'json';
    const sortKey = def.sortable && Object.prototype.hasOwnProperty.call(def.sortable, q.sort) ? q.sort : (def.defaultSort || null);
    const order = q.order === 'desc' ? 'DESC' : 'ASC';

    const where = [];
    const params = [];

    const filters = q.filter && typeof q.filter === 'object' ? q.filter : {};
    for (const key of Object.keys(filters)) {
        if (def.extra && def.extra.includes(key)) continue; // handled by the route itself
        if (!def.filterable || !Object.prototype.hasOwnProperty.call(def.filterable, key)) {
            const allowed = def.filterable ? Object.keys(def.filterable).join(', ') : '';
            const err = new Error(`Unsupported filter '${key}'. Allowed: ${allowed}`);
            err.status = 400;
            throw err;
        }
        const col = def.filterable[key];
        const raw = String(filters[key]);
        let val = raw;
        if (def.boolean && def.boolean.includes(key)) {
            val = (raw === 'true' || raw === '1') ? '1' : '0';
            where.push(`${col} = ?`);
            params.push(val);
        } else if (raw.startsWith('~')) {
            where.push(`LOWER(${col}) LIKE ?`);
            params.push('%' + raw.slice(1).toLowerCase().replace(/[\\%_]/g, '\\$&') + '%');
        } else {
            where.push(`LOWER(${col}) = LOWER(?)`);
            params.push(raw);
        }
    }

    const search = q.q ? String(q.q).trim() : '';
    if (search && def.searchKeys && def.searchKeys.length > 0) {
        const ors = def.searchKeys.map(k => `LOWER(${k}) LIKE ?`).join(' OR ');
        where.push(`(${ors})`);
        const like = '%' + search.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%';
        def.searchKeys.forEach(() => params.push(like));
    }

    return {
        limit, page, offset: (page - 1) * limit, format,
        sortKey, order, where, params,
        selectCols(colMap) { // colMap: {key:'alias', ...} of this feed's SELECT projection
            if (!q.fields) return Object.values(colMap);
            const chosen = String(q.fields).split(',').map(s => s.trim()).filter(s => s && Object.prototype.hasOwnProperty.call(colMap, s));
            return chosen.length > 0 ? chosen.map(k => colMap[k]) : Object.values(colMap);
        },
    };
}

function respondFeed(res, { rows, total, page, limit, format, filename, columns }) {
    if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(toCsv(rows, columns));
    }
    res.json({ data: rows, meta: { page, limit, total, returned: rows.length } });
}

function handleError(res, err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Feeds error:', err);
    res.status(500).json({ error: 'Internal server error' });
}

// ── GET /feeds/me ─────────────────────────────────────────────────────────────
router.get('/me', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const email = String(req.user.email || '').toLowerCase();
        const format = (req.query.format === 'csv' || String(req.headers.accept || '').includes('text/csv')) ? 'csv' : 'json';
        const [rows] = await db.query(
            `WITH latest AS (
                SELECT id FROM submissions
                WHERE LOWER(staff_email) = LOWER(?)
                ORDER BY updated_at DESC LIMIT 1
             )
             SELECT s.email AS email, s.name AS name, s.title AS title, s.department AS department,
                    s.manager_name AS manager_name,
                    (SELECT COUNT(*) FROM submission_skills sk JOIN latest l ON sk.submission_id = l.id) AS skill_count,
                    (SELECT COUNT(*) FROM submission_projects sp JOIN latest l ON sp.submission_id = l.id) AS project_count,
                    (SELECT COUNT(*) FROM certifications c WHERE LOWER(c.staff_email) = LOWER(s.email)) AS certification_count
             FROM staff s
             WHERE LOWER(s.email) = LOWER(?)`,
            [email, email]
        );
        const row = rows[0] || null;
        if (!row) return res.status(404).json({ error: 'No staff record for this account' });
        respondFeed(res, { rows: [row], total: row ? 1 : 0, page: 1, limit: 1, format, filename: 'me.csv', columns: Object.keys(row) });
    } catch (err) {
        handleError(res, err);
    }
});

// ── GET /feeds/staff ──────────────────────────────────────────────────────────
const STAFF_FIELDS = { email: 's.email AS email', name: 's.name AS name', title: 's.title AS title', department: 's.department AS department', manager_name: 's.manager_name AS manager_name', active: '(ur.is_active = 1) AS active' };
router.get('/staff', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const scope = await resolveFeedScope(db, req.user);
        requireScope(scope);
        const def = {
            filterable: { department: 's.department', manager_name: 's.manager_name', active: 'ur.is_active' },
            boolean: ['active'],
            searchKeys: ['s.name', 's.email'],
            defaultSort: 'name',
            sortable: { name: 's.name', email: 's.email', department: 's.department' },
        };
        const f = parseFeedQuery(req, def);
        const hasActiveFilter = req.query.filter && Object.prototype.hasOwnProperty.call(req.query.filter, 'active');
        const where = f.where.slice();
        const params = f.params.slice();
        if (!hasActiveFilter) { where.push('ur.is_active = 1'); }
        const sc = scopeClause(scope, 's');
        if (sc.sql) { where.push(sc.sql); params.push(...sc.params); }
        const sel = f.selectCols(STAFF_FIELDS).join(', ');
        const sql = `SELECT ${sel}, COUNT(*) OVER() AS _total
                     FROM staff s
                     INNER JOIN user_roles ur ON ur.email = s.email
                     WHERE ${where.length ? where.join(' AND ') : '1=1'}
                     ORDER BY ${def.sortable[f.sortKey]} ${f.order}
                     LIMIT ${f.limit} OFFSET ${f.offset}`;
        const [rows] = await db.query(sql, params);
        const total = rows.length ? rows[0]._total : 0;
        const clean = rows.map(r => { delete r._total; return r; });
        respondFeed(res, { rows: clean, total, page: f.page, limit: f.limit, format: f.format, filename: 'staff.csv', columns: f.selectCols(STAFF_FIELDS).map(c => c.split(' AS ')[1]) });
    } catch (err) {
        handleError(res, err);
    }
});

// ── GET /feeds/staff/:email ───────────────────────────────────────────────────
router.get('/staff/:email', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const target = String(req.params.email || '').toLowerCase();
        const scope = await resolveFeedScope(db, req.user);
        const self = String(req.user.email || '').toLowerCase() === target;
        const inScope = scope.scope === 'all' || self || (scope.scope === 'subordinates' && scope.emails.includes(target));
        if (!inScope) return res.status(403).json({ error: 'Insufficient permissions for this record' });

        const [rows] = await db.query(
            `SELECT s.email AS email, s.name AS name, s.title AS title, s.department AS department,
                    s.manager_name AS manager_name, (ur.is_active = 1) AS active,
                    (SELECT COUNT(*) FROM certifications c WHERE LOWER(c.staff_email) = LOWER(s.email)) AS certification_count
             FROM staff s
             INNER JOIN user_roles ur ON ur.email = s.email
             WHERE LOWER(s.email) = LOWER(?)`,
            [target]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Staff record not found' });
        const row = rows[0];
        const format = (req.query.format === 'csv' || String(req.headers.accept || '').includes('text/csv')) ? 'csv' : 'json';
        respondFeed(res, { rows: [row], total: 1, page: 1, limit: 1, format, filename: `staff-${target}.csv`, columns: Object.keys(row) });
    } catch (err) {
        handleError(res, err);
    }
});

// ── GET /feeds/projects ───────────────────────────────────────────────────────
const PROJECT_FIELDS = { id: 'mp.id AS id', soc: 'mp.soc AS soc', project_name: 'mp.project_name AS project_name', customer: 'mp.customer AS customer', type_infra: '(mp.type_infra = 1) AS type_infra', type_software: '(mp.type_software = 1) AS type_software', type_infra_support: '(mp.type_infra_support = 1) AS type_infra_support', type_software_support: '(mp.type_software_support = 1) AS type_software_support', start_date: 'mp.start_date AS start_date', end_date: 'mp.end_date AS end_date', coordinator_email: 'mp.coordinator_email AS coordinator_email', staff_count: '(SELECT COUNT(DISTINCT sub.staff_email) FROM submission_projects sp JOIN submissions sub ON sub.id = sp.submission_id WHERE LOWER(sp.project_name) = LOWER(mp.project_name)) AS staff_count' };
router.get('/projects', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const scope = await resolveFeedScope(db, req.user);
        requireScope(scope);
        const def = {
            filterable: { customer: 'mp.customer', soc: 'mp.soc', project_name: 'mp.project_name' },
            searchKeys: ['mp.project_name', 'mp.customer'],
            defaultSort: 'project_name',
            sortable: { project_name: 'mp.project_name', customer: 'mp.customer', soc: 'mp.soc', end_date: 'mp.end_date' },
        };
        const f = parseFeedQuery(req, def);
        const where = f.where.slice();
        const params = f.params.slice();
        const sc = scope.scope === 'subordinates'
            ? { sql: ` AND LOWER(mp.coordinator_email) IN (${scope.emails.map(() => '?').join(',')})`, params: scope.emails }
            : { sql: '', params: [] };
        if (sc.sql) { where.push(sc.sql); params.push(...sc.params); }
        const sel = f.selectCols(PROJECT_FIELDS).join(', ');
        const sql = `SELECT ${sel}, COUNT(*) OVER() AS _total
                     FROM managed_projects mp
                     WHERE ${where.length ? where.join(' AND ') : '1=1'}
                     ORDER BY ${def.sortable[f.sortKey]} ${f.order}
                     LIMIT ${f.limit} OFFSET ${f.offset}`;
        const [rows] = await db.query(sql, params);
        const total = rows.length ? rows[0]._total : 0;
        const clean = rows.map(r => { delete r._total; return r; });
        respondFeed(res, { rows: clean, total, page: f.page, limit: f.limit, format: f.format, filename: 'projects.csv', columns: f.selectCols(PROJECT_FIELDS).map(c => c.split(' AS ')[1]) });
    } catch (err) {
        handleError(res, err);
    }
});

// ── GET /feeds/skills ─────────────────────────────────────────────────────────
// One row per (staff, skill) from each person's LATEST submission.
const SKILL_FIELDS = { email: 'r.email AS email', skill: 'r.skill AS skill', rating: 'r.rating AS rating' };
router.get('/skills', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const scope = await resolveFeedScope(db, req.user);
        requireScope(scope);
        const def = {
            filterable: { skill: 'r.skill' },
            searchKeys: ['r.skill'],
            defaultSort: 'skill',
            sortable: { skill: 'r.skill', email: 'r.email', rating: 'r.rating' },
        };
        const f = parseFeedQuery(req, def);
        const where = f.where.slice();
        const params = f.params.slice();
        const sc = scopeClause(scope, 'r');
        if (sc.sql) { where.push(sc.sql); params.push(...sc.params); }
        const sel = f.selectCols(SKILL_FIELDS).join(', ');
        const sql = `SELECT ${sel}, COUNT(*) OVER() AS _total
                     FROM (
                        SELECT sub.staff_email AS email, sk.skill AS skill, sk.rating AS rating,
                               ROW_NUMBER() OVER (PARTITION BY LOWER(sub.staff_email) ORDER BY sub.updated_at DESC) AS rn
                        FROM submissions sub
                        JOIN submission_skills sk ON sk.submission_id = sub.id
                     ) r
                     WHERE r.rn = 1${where.length ? ' AND ' + where.join(' AND ') : ''}
                     ORDER BY ${def.sortable[f.sortKey]} ${f.order}
                     LIMIT ${f.limit} OFFSET ${f.offset}`;
        const [rows] = await db.query(sql, params);
        const total = rows.length ? rows[0]._total : 0;
        const clean = rows.map(r => { delete r._total; return r; });
        respondFeed(res, { rows: clean, total, page: f.page, limit: f.limit, format: f.format, filename: 'skills.csv', columns: f.selectCols(SKILL_FIELDS).map(c => c.split(' AS ')[1]) });
    } catch (err) {
        handleError(res, err);
    }
});

// ── GET /feeds/certifications ─────────────────────────────────────────────────
const CERT_FIELDS = { email: 'c.staff_email AS email', name: 'c.name AS name', issuer: 'c.issuer AS issuer', date_obtained: 'c.date_obtained AS date_obtained', expiry_date: 'c.expiry_date AS expiry_date', credential_id: 'c.credential_id AS credential_id', status: `CASE WHEN c.expiry_date IS NULL THEN 'Valid' WHEN c.expiry_date < CURDATE() THEN 'Expired' WHEN c.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY) THEN 'Expiring' ELSE 'Valid' END AS status` };
router.get('/certifications', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const isAdminHr = req.user.isAdmin === true || req.user.is_hr === 1 || req.user.is_hr === true;
        if (!isAdminHr) return res.status(403).json({ error: 'Insufficient permissions for this feed' });
        const def = {
            filterable: { email: 'c.staff_email', name: 'c.name', issuer: 'c.issuer' },
            extra: ['status'],
            searchKeys: ['c.name', 'c.issuer', 'c.staff_email'],
            defaultSort: 'email',
            sortable: { email: 'c.staff_email', name: 'c.name', issuer: 'c.issuer', expiry_date: 'c.expiry_date' },
        };
        // filter[status]=valid|expiring|expired handled here (computed column)
        const f = parseFeedQuery(req, def);
        const where = f.where.slice();
        const params = f.params.slice();
        const hasStatusFilter = req.query.filter && Object.prototype.hasOwnProperty.call(req.query.filter, 'status');
        if (hasStatusFilter) {
            const want = String(req.query.filter.status).toLowerCase();
            const cond = want === 'expired' ? 'c.expiry_date IS NOT NULL AND c.expiry_date < CURDATE()'
                : want === 'expiring' ? 'c.expiry_date IS NOT NULL AND c.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)'
                : want === 'valid' ? '(c.expiry_date IS NULL OR c.expiry_date >= DATE_ADD(CURDATE(), INTERVAL 90 DAY))'
                : '1=1';
            where.push(`(${cond})`);
        }
        const sel = f.selectCols(CERT_FIELDS).join(', ');
        const sql = `SELECT ${sel}, COUNT(*) OVER() AS _total
                     FROM certifications c
                     WHERE ${where.length ? where.join(' AND ') : '1=1'}
                     ORDER BY ${def.sortable[f.sortKey]} ${f.order}
                     LIMIT ${f.limit} OFFSET ${f.offset}`;
        const [rows] = await db.query(sql, params);
        const total = rows.length ? rows[0]._total : 0;
        const clean = rows.map(r => { delete r._total; return r; });
        respondFeed(res, { rows: clean, total, page: f.page, limit: f.limit, format: f.format, filename: 'certifications.csv', columns: f.selectCols(CERT_FIELDS).map(c => c.split(' AS ')[1]) });
    } catch (err) {
        handleError(res, err);
    }
});

// ── GET /feeds/summary — curated KPI single row ───────────────────────────────
router.get('/summary', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const scope = await resolveFeedScope(db, req.user);
        requireScope(scope);
        const emails = scope.scope === 'all' ? [] : scope.emails;
        // Each metric runs as its own query so placeholder counts always match
        // (one IN-list per query, bound to its own copy of emails).
        const IN = (col) => emails.length > 0 ? ` LOWER(${col}) IN (${emails.map(() => '?').join(',')})` : '1=1';
        const count = async (sql) => {
            const [r] = await db.query(sql, emails);
            return Number(r[0].n);
        };
        const [totalStaff, activeStaff, withSubmission, distinctSkills, certs, expiring] = await Promise.all([
            count(`SELECT COUNT(*) AS n FROM staff s WHERE ${IN('s.email')}`),
            count(`SELECT COUNT(*) AS n FROM staff s JOIN user_roles ur ON ur.email = s.email AND ur.is_active = 1 WHERE ${IN('s.email')}`),
            count(`SELECT COUNT(DISTINCT LOWER(sub.staff_email)) AS n FROM submissions sub WHERE ${IN('sub.staff_email')}`),
            count(`SELECT COUNT(DISTINCT sk.skill) AS n FROM submission_skills sk JOIN submissions sub ON sub.id = sk.submission_id WHERE ${IN('sub.staff_email')}`),
            count(`SELECT COUNT(*) AS n FROM certifications c WHERE ${IN('c.staff_email')}`),
            count(`SELECT COUNT(*) AS n FROM certifications c WHERE c.expiry_date IS NOT NULL AND c.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY) AND ${IN('c.staff_email')}`),
        ]);
        const row = {
            total_staff: totalStaff, active_staff: activeStaff, staff_with_submission: withSubmission,
            distinct_skills: distinctSkills, total_certifications: certs, expiring_certifications: expiring,
        };
        const format = (req.query.format === 'csv' || String(req.headers.accept || '').includes('text/csv')) ? 'csv' : 'json';
        respondFeed(res, { rows: [row], total: 1, page: 1, limit: 1, format, filename: 'summary.csv', columns: Object.keys(row) });
    } catch (err) {
        handleError(res, err);
    }
});

export { router };