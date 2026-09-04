import express from 'express';
import { getDb } from '../db.js';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import axios from 'axios';

const BEESUITE_API_BASE = process.env.BEESUITE_API_URL || 'https://appcore.beesuite.app';

// ── Auto-sync user from BeeSuite if not in local DB ────────────────────────
async function syncUserFromBeeSuite(db, email, beesuiteToken) {
    try {
        // Fetch staff list from BeeSuite to find this user
        const staffResponse = await axios.get(`${BEESUITE_API_BASE}/api/users/staff`, {
            headers: { 'Authorization': `JWT ${beesuiteToken}` }
        });

        let staffList = staffResponse.data;
        if (!Array.isArray(staffList)) return null;

        // Find the matching user by email
        const beesuiteUser = staffList.find(s => s.email?.toLowerCase() === email.toLowerCase());
        if (!beesuiteUser) {
            console.log(`Auto-sync: user ${email} not found in BeeSuite staff list`);
            return null;
        }

        const name = beesuiteUser.employeeName;
        const title = beesuiteUser.designation;
        const department = beesuiteUser.department;
        const staffId = beesuiteUser.id;

        if (!name) {
            console.log(`Auto-sync: user ${email} has no name in BeeSuite`);
            return null;
        }

        // Fetch employment detail for manager info
        let managerName = null;
        try {
            const empRes = await axios.get(
                `${BEESUITE_API_BASE}/api/admin/user-info-details/employment-detail/${staffId}`,
                { headers: { 'Authorization': `JWT ${beesuiteToken}` } }
            );
            if (empRes.data?.employmentDetail) {
                managerName = empRes.data.employmentDetail.reportingToName;
            }
        } catch (empErr) {
            console.log(`Auto-sync: could not fetch employment detail for ${email}:`, empErr.message);
        }

        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

        // Insert or update staff record
        const [existingStaff] = await db.query('SELECT email FROM staff WHERE email = ?', [email]);
        if (existingStaff.length === 0) {
            await db.query(
                'INSERT INTO staff (email, name, title, department, manager_name) VALUES (?, ?, ?, ?, ?)',
                [email, name, title, department, managerName]
            );
            console.log(`Auto-sync: created staff record for ${email}`);
        } else {
            await db.query(
                'UPDATE staff SET name = ?, title = ?, department = ?, manager_name = ? WHERE email = ?',
                [name, title, department, managerName, email]
            );
        }

        // Insert default user_roles if not exists
        const [existingRole] = await db.query('SELECT email FROM user_roles WHERE email = ?', [email]);
        if (existingRole.length === 0) {
            await db.query(
                'INSERT INTO user_roles (email, role, is_hr, is_coordinator, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [email, 'staff', 0, 0, 1, now, now]
            );
            console.log(`Auto-sync: created user_roles for ${email}`);
        }

        return { email, name, title, department, role: 'staff', is_hr: 0, is_coordinator: 0 };
    } catch (err) {
        console.error(`Auto-sync error for ${email}:`, err.message);
        return null;
    }
}

// Utility functions for tokens
function generateAccessToken(payload) {
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
    console.log('Generated token:', token); // Log the generated token for debugging
    return token;
}

function generateRefreshToken() {
    return uuidv4();
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// Real DB-backed auth audit trail. Never throws — audit failures must not
// break the request. Inserts into auth_audit_log (id VARCHAR(36) uuid, IP
// VARCHAR(45), user_agent TEXT).
async function logAuthEvent(db, email, action, success, req) {
    try {
        const ip = req && req.ip ? String(req.ip).slice(0, 45) : null;
        const ua = req && typeof req.get === 'function' ? String(req.get('user-agent') || '').slice(0, 500) : null;
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await db.query(
            `INSERT INTO auth_audit_log (id, email, action, ip_address, user_agent, success, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), (email || '').toLowerCase(), action, ip, ua, success ? 1 : 0, now]
        );
    } catch (err) {
        console.error('auth audit log write failed:', err.message);
    }
}

// API-token auth path: look up an `st_` Bearer token against api_tokens
// (SHA-256 hash) joined to LIVE user_roles. Returns { user } on success or
// { status, error } to short-circuit. Enforces read-only tokens centrally:
// a read_only token may only call GET/HEAD/OPTIONS.
async function resolveApiToken(req, rawToken) {
    const db = await getDb();
    const tokenHash = hashToken(rawToken);

    const [rows] = await db.query(
        `SELECT t.id AS token_id, t.user_email, t.read_only, t.last_used_at,
                u.role, u.is_active, u.is_hr, u.is_coordinator
         FROM api_tokens t
         JOIN user_roles u ON u.email = t.user_email
         WHERE t.token_hash = ? AND t.revoked_at IS NULL
           AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
        [tokenHash]
    );
    if (rows.length === 0) {
        await logAuthEvent(db, 'unknown', 'api_token_denied', false, req);
        return { status: 401, error: 'Invalid or expired API token' };
    }

    const row = rows[0];
    if (!row.is_active) {
        await logAuthEvent(db, row.user_email, 'api_token_denied', false, req);
        return { status: 401, error: 'Account is deactivated' };
    }

    const method = (req.method || 'GET').toUpperCase();
    const readOnly = row.read_only === 1 || row.read_only === true;
    if (readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        await logAuthEvent(db, row.user_email, 'api_token_denied', false, req);
        return { status: 403, error: 'Read-only API token cannot perform this request' };
    }

    const user = {
        email: row.user_email,
        role: row.role,
        isAdmin: row.role === 'admin',
        is_hr: row.is_hr,
        is_coordinator: row.is_coordinator,
        tokenId: row.token_id,
        readOnly,
        authMode: 'api',
    };

    // Throttled last_used_at update (at most once per minute per token).
    const isFirstUse = !row.last_used_at;
    const lastUsedMs = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
    if (isFirstUse || Date.now() - lastUsedMs > 60000) {
        await db.query('UPDATE api_tokens SET last_used_at = NOW() WHERE id = ?', [row.token_id]);
    }
    if (isFirstUse) {
        await logAuthEvent(db, row.user_email, 'api_token_first_use', true, req);
    }
    return { user };
}

// Define and export all middleware functions first
// Dual-path bearer auth: `st_` tokens resolve via api_tokens (DB-backed, live
// role re-check, instant revocation); everything else goes through the JWT
// session path unchanged. req.user always carries { email, role, isAdmin,
// is_hr, is_coordinator, authMode } so requireRole works identically for both.
const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (token.startsWith('st_')) {
            const result = await resolveApiToken(req, token);
            if (result.status) {
                return res.status(result.status).json({ error: result.error });
            }
            req.user = result.user;
            return next();
        }

        // Legacy session JWT path
        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (err) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            req.user = { ...user, authMode: 'jwt' };
            next();
        });
    } catch (err) {
        console.error('verifyToken error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Define requireRole middleware factory
const requireRole = (...roles) => {
    return (req, res, next) => {
        console.log('requireRole: Checking roles:', roles, 'for user:', req.user); // Logging added

        if (!req.user) {
            console.log('requireRole: No user found in request'); // Logging added
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Check if user has one of the required roles using the new flag-based system
        const hasRequiredRole = roles.some(role => {
            switch (role) {
                case 'admin':
                    return req.user.isAdmin === true;
                case 'hr':
                    return req.user.is_hr === 1 || req.user.is_hr === true;
                case 'coordinator':
                    return req.user.is_coordinator === 1 || req.user.is_coordinator === true;
                default:
                    return false;
            }
        });

        if (!hasRequiredRole) {
            console.log(`requireRole: User (${req.user.email}) not authorized for required roles:`, roles);
            return res.status(403).json({ error: 'Forbidden' });
        }

        console.log('requireRole: User authorized'); // Logging added
        next();
    };
};

// Define the Express router
const router = express.Router();

// Export the router, logAuthEvent, verifyToken, and requireRole
export { logAuthEvent, router, verifyToken, requireRole };

// Use middleware functions after they are defined
router.get('/me', verifyToken, (req, res) => {
    res.json({ message: 'Access granted' });
});

router.get('/audit', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    res.json({ message: 'Audit access granted' });
});

// Update the login route to forward requests to the external API
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Authenticate user via external API or admin logic
        let user;
        if (email === 'admin') {
            const decodedPassword = Buffer.from(password, 'base64').toString('utf-8');
            if (decodedPassword !== process.env.ADMIN_PASSWORD) {
                return res.status(401).json({ error: 'Invalid password' });
            }
            user = { email: 'admin', role: 'admin' };
        } else {
            const response = await axios.post('https://appcore.beesuite.app/api/auth/login', { email, password });
            user = response.data;
        }

        // Query user_roles table
        const db = await getDb();
        let [roles] = await db.query(
            'SELECT role, is_hr, is_coordinator FROM user_roles WHERE email = ?',
            [email]
        );

        // Debugging user_roles query
        console.log('Roles query result:', roles);

        // If user not in roles table, auto-sync from BeeSuite
        if (roles.length === 0) {
            console.log(`User ${email} not in roles table, attempting auto-sync from BeeSuite...`);
            const beesuiteToken = user.access_token || user.token;
            
            if (!beesuiteToken) {
                return res.status(401).json({ error: 'User not found in roles table' });
            }

            const synced = await syncUserFromBeeSuite(db, email, beesuiteToken);
            if (!synced) {
                return res.status(401).json({ error: 'User not found in roles table' });
            }

            // Re-query roles after sync
            [roles] = await db.query(
                'SELECT role, is_hr, is_coordinator FROM user_roles WHERE email = ?',
                [email]
            );

            if (roles.length === 0) {
                return res.status(401).json({ error: 'User not found in roles table' });
            }
        }

        const { role, is_hr, is_coordinator } = roles[0];
        const isAdmin = role === 'admin';

        // Generate token
        const token = generateAccessToken({ email, isAdmin, is_hr, is_coordinator });

        // Fetch staff name for the response
        let staffName = null;
        try {
            const [staffRows] = await db.query('SELECT name FROM staff WHERE email = ?', [email]);
            if (staffRows.length > 0) staffName = staffRows[0].name;
        } catch (_) { /* ignore */ }

        // Debugging token generation
        console.log('Generated token:', token);
        console.log('User role flags:', { isAdmin, is_hr, is_coordinator });

        return res.status(200).json({
            access_token: token,
            isAdmin,
            is_hr,
            is_coordinator,
            name: staffName
        });
    } catch (err) {
        console.error('Login error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /auth/refresh ─────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token is required' });
        }

        const db = await getDb();
        const refreshTokenHash = hashToken(refreshToken);

        // Find valid refresh token
        const [tokenRecords] = await db.execute(
            `SELECT * FROM auth_tokens WHERE refresh_token_hash = ? AND revoked = 0`,
            [refreshTokenHash]
        );

        if (tokenRecords.length === 0) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        const tokenRecord = tokenRecords[0];

        // Get user role
        const [userRoles] = await db.execute(
            'SELECT * FROM user_roles WHERE email = ?',
            [tokenRecord.user_email]
        );

        if (userRoles.length === 0 || !userRoles[0].is_active) {
            return res.status(401).json({ error: 'User not found or inactive' });
        }

        const userRole = userRoles[0];

        // Generate new access token
        const newAccessToken = generateAccessToken({ 
            email: tokenRecord.user_email, 
            role: userRole.role 
        });
        const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

        // Store new token
        const newTokenId = uuidv4();
        const newTokenHash = hashToken(newAccessToken);
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

        // Revoke old access token but keep refresh token valid
        await db.execute(
            `UPDATE auth_tokens SET revoked = 1 WHERE id = ?`,
            [tokenRecord.id]
        );

        // Insert new access token
        await db.execute(
            `INSERT INTO auth_tokens (id, user_email, token_hash, refresh_token_hash, expires_at, created_at) 
             VALUES (?, ?, ?, ?, ?, ?)`
            , [newTokenId, tokenRecord.user_email, newTokenHash, refreshTokenHash, expiresAt, now]
        );

        logAuthEvent(db, tokenRecord.user_email, 'token_refresh', true, req);

        res.json({ 
            accessToken: newAccessToken,
            user: { email: tokenRecord.user_email, role: userRole.role },
            expiresIn: 8 * 60 * 60
        });
    } catch (err) {
        console.error('POST /auth/refresh error:', err);
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', verifyToken, (req, res) => {
    res.json({ user: req.user });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
    try {
        const db = await getDb();
        const authHeader = req.headers.authorization;
        const token = authHeader.replace('Bearer ', '');
        const tokenHash = hashToken(token);

        // Revoke the token
        await db.execute(
            `UPDATE auth_tokens SET revoked = 1 WHERE token_hash = ?`,
            [tokenHash]
        );

        logAuthEvent(db, req.user.email, 'logout', true, req);
        res.json({ success: true });
    } catch (err) {
        console.error('POST /auth/logout error:', err);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// ── GET /auth/audit ───────────────────────────────────────────────────────────
router.get('/audit', verifyToken, requireRole('admin', 'hr'), async (req, res) => {
    try {
        const db = await getDb();
        const { limit = 50, offset = 0, email } = req.query;
        
        let query = 'SELECT * FROM auth_audit_log';
        const params = [];
        
        if (email) {
            query += ' WHERE email = ?';
            params.push(email.toLowerCase());
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [logs] = await db.execute(query, params);
        res.json(logs);
    } catch (err) {
        console.error('GET /auth/audit error:', err);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

// Debugging JWT_SECRET
console.log('JWT_SECRET used for signing:', process.env.JWT_SECRET);
