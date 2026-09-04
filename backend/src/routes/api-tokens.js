import express from 'express';
import { getDb } from '../db.js';
import { verifyToken, requireRole, logAuthEvent } from './auth.js';
import { v4 as uuidv4 } from 'uuid';
import { generateApiTokenSecret, hashApiToken, maskTokenHash } from '../utils/tokens.js';

const router = express.Router();

const MAX_ACTIVE_TOKENS = 20;
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// Token-management endpoints require an interactive (JWT) session — an API
// token must never be able to mint or administer other tokens.
function requireSession(req, res, next) {
    if (req.user && req.user.authMode === 'jwt') return next();
    return res.status(403).json({ error: 'API tokens cannot manage tokens. Use a browser session.' });
}

function toView(r) {
    return {
        id: r.id,
        name: r.name,
        readOnly: !!(r.read_only === 1 || r.read_only === true),
        mask: r.mask || maskTokenHash(r.token_hash),
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        lastUsedAt: r.last_used_at,
        revokedAt: r.revoked_at || null,
    };
}

// ── POST /api-tokens — create ────────────────────────────────────────────────
// Body: { name: string <=100, readOnly?: bool (default true), expiresInDays?: int 1..3650 | null }
router.post('/', verifyToken, requireSession, async (req, res) => {
    try {
        const db = await getDb();
        const { name, readOnly = true, expiresInDays = null } = req.body || {};
        const email = String(req.user.email || '').toLowerCase();

        if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
            return res.status(400).json({ error: 'name is required (max 100 chars)' });
        }

        const readOnlyFlag = (readOnly === false || readOnly === 'false') ? 0 : 1;

        let expiresAt = null;
        if (expiresInDays !== null && expiresInDays !== undefined && expiresInDays !== 0) {
            const days = parseInt(expiresInDays, 10);
            if (!Number.isInteger(days) || days < 1 || days > 3650) {
                return res.status(400).json({ error: 'expiresInDays must be an integer between 1 and 3650, or null' });
            }
            expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
        }

        const [[{ cnt }]] = await db.query(
            'SELECT COUNT(*) AS cnt FROM api_tokens WHERE user_email = ? AND revoked_at IS NULL',
            [email]
        );
        if (cnt >= MAX_ACTIVE_TOKENS) {
            return res.status(400).json({ error: `Token limit reached: max ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.` });
        }

        const id = uuidv4();
        const secret = generateApiTokenSecret();
        const hash = hashApiToken(secret);
        await db.query(
            `INSERT INTO api_tokens (id, user_email, name, token_hash, read_only, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, email, name.trim(), hash, readOnlyFlag, expiresAt, nowSql()]
        );
        await logAuthEvent(db, email, 'api_token_created', true, req);

        // `token` is the ONLY time the plaintext secret is returned.
        res.status(201).json({
            id, name: name.trim(), readOnly: readOnlyFlag === 1,
            expiresAt, mask: maskTokenHash(hash), token: secret,
        });
    } catch (err) {
        console.error('POST /api-tokens error:', err);
        res.status(500).json({ error: 'Failed to create API token' });
    }
});

// ── GET /api-tokens — list own active tokens (masked) ────────────────────────
router.get('/', verifyToken, requireSession, async (req, res) => {
    try {
        const db = await getDb();
        const email = String(req.user.email || '').toLowerCase();
        const [rows] = await db.query(
            `SELECT id, name, read_only, expires_at, last_used_at, created_at,
                    CONCAT('st_…', RIGHT(token_hash, 4)) AS mask
             FROM api_tokens
             WHERE user_email = ? AND revoked_at IS NULL
             ORDER BY created_at DESC`,
            [email]
        );
        res.json({ tokens: rows.map(toView) });
    } catch (err) {
        console.error('GET /api-tokens error:', err);
        res.status(500).json({ error: 'Failed to list API tokens' });
    }
});

// ── DELETE /api-tokens/:id — revoke own token (soft) ─────────────────────────
router.delete('/:id', verifyToken, requireSession, async (req, res) => {
    try {
        const db = await getDb();
        const email = String(req.user.email || '').toLowerCase();
        const [result] = await db.query(
            `UPDATE api_tokens SET revoked_at = ?
             WHERE id = ? AND user_email = ? AND revoked_at IS NULL`,
            [nowSql(), req.params.id, email]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Token not found or already revoked' });
        }
        await logAuthEvent(db, email, 'api_token_revoked', true, req);
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api-tokens/:id error:', err);
        res.status(500).json({ error: 'Failed to revoke API token' });
    }
});

// ── GET /api-tokens/admin/all — org-wide overview (admin only) ───────────────
router.get('/admin/all', verifyToken, requireSession, requireRole('admin'), async (req, res) => {
    try {
        const db = await getDb();
        const [rows] = await db.query(
            `SELECT id, user_email, name, read_only, expires_at, last_used_at, created_at, revoked_at,
                    CONCAT('st_…', RIGHT(token_hash, 4)) AS mask
             FROM api_tokens
             ORDER BY created_at DESC
             LIMIT 500`
        );
        res.json({ tokens: rows.map(toView) });
    } catch (err) {
        console.error('GET /api-tokens/admin/all error:', err);
        res.status(500).json({ error: 'Failed to list API tokens' });
    }
});

// ── DELETE /api-tokens/admin/:id — force-revoke any token (admin only) ───────
router.delete('/admin/:id', verifyToken, requireSession, requireRole('admin'), async (req, res) => {
    try {
        const db = await getDb();
        const [result] = await db.query(
            'UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
            [nowSql(), req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Token not found or already revoked' });
        }
        await logAuthEvent(db, 'admin', 'api_token_admin_revoked', true, req);
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api-tokens/admin/:id error:', err);
        res.status(500).json({ error: 'Failed to revoke API token' });
    }
});

export { router };
