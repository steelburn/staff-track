import crypto from 'crypto';

// API token secret: `st_` + 43 base64url chars (32 random bytes). 43 chars
// because base64url(32 bytes) = ceil(32/3)*4 = 44 with padding stripped → 43.
export function generateApiTokenSecret() {
    return 'st_' + crypto.randomBytes(32).toString('base64url');
}

export function hashApiToken(secret) {
    return crypto.createHash('sha256').update(secret).digest('hex');
}

// Stable display label derived from the stored hash (never needs the secret).
// e.g. 'st_…ab12' — matches the last 4 hex chars of the sha256 hash.
export function maskTokenHash(hash) {
    if (!hash || typeof hash !== 'string') return 'st_…????';
    return 'st_…' + String(hash).slice(-4);
}
