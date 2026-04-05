import express from 'express';
import { getDb } from '../db.js';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import axios from 'axios';

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

// Define a placeholder for logAuthEvent
function logAuthEvent(db, email, event, success, req) {
    console.log(`Auth event: ${event} for ${email} - Success: ${success}`);
}

// Define and export all middleware functions first
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        console.log('verifyToken: No token provided');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.log('verifyToken: Token verification failed', err.message);
            return res.status(403).json({ error: 'Forbidden' });
        }

        console.log('verifyToken: Token verified successfully', user);
        req.user = user;
        next();
    });
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
        const [roles] = await db.query(
            'SELECT role, is_hr, is_coordinator FROM user_roles WHERE email = ?',
            [email]
        );

        // Debugging user_roles query
        console.log('Roles query result:', roles);

        if (roles.length === 0) {
            return res.status(401).json({ error: 'User not found in roles table' });
        }

        const { role, is_hr, is_coordinator } = roles[0];
        const isAdmin = role === 'admin';

        // Generate token
        const token = generateAccessToken({ email, isAdmin, is_hr, is_coordinator });

        // Debugging token generation
        console.log('Generated token:', token);
        console.log('User role flags:', { isAdmin, is_hr, is_coordinator });

        return res.status(200).json({
            access_token: token,
            isAdmin,
            is_hr,
            is_coordinator
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
