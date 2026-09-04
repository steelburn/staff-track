# Self-Service API Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Give any active StaffTrack user self-service personal API tokens (read-only by default, optional write), unlock all existing `/api` routes + a new read-only Data Feeds API (`/api/feeds/*`, JSON + CSV, filter/sort/paginate) for those tokens, plus an in-app token manager + runnable API console page and an admin oversight panel.

**Architecture:** Opaque tokens (`st_` prefix, SHA-256 hashes stored in a new `api_tokens` table) resolved inside the existing `verifyToken` middleware — no per-route edits needed; read-only enforcement is a central method gate. Feeds are a new `feeds.js` route module reusing `getUserSubordinates` (exported from `reports.js`) for role/managers scoping. Frontend adds `api-access.html` (token manager + console, role-aware) and an admin tokens section on `admin.html`.

**Tech Stack:** Node 20+ ESM (Express, mysql2, jsonwebtoken, uuid), MySQL 8 (migrations auto-run on backend start), vanilla JS frontend in `public/`, docker compose stack (backend on `:3000` via nginx `:6082`, `/api` prefix stripped), verification via repo-convention `review-*.cjs` scripts + puppeteer/playwright screenshots.

**Spec:** `docs/superpowers/specs/2026-09-04-self-service-api-access-design.md` (approved 2026-09-04).

**Repo conventions every task must follow:**
- Backend is ESM (`"type": "module"`). Frontend is plain browser JS (`'use strict'`, no modules).
- Backend source is volume-mounted into the container: **after editing backend files, run `docker compose restart backend`** before testing. Frontend `public/` is served directly by nginx — no restart needed.
- Live stack URLs: API via nginx `http://localhost:6082/api/...` (strips `/api`), DB via `docker compose exec db mysql ...`.
- Admin login for tests: `POST /api/auth/login` with `{ email: 'admin', password: base64('secure_admin_password') }` → `base64 = c2VjdXJlX2FkbWluX3Bhc3N3b3Jk`. Response has `access_token`.
- DB creds inside container: user `stafftrack`, password `stafftrack_dev_password`, database `stafftrack`.
- Do not log or print full token secrets beyond the creation response.

---

### Task 0: Feature branch

**Files:** none

- [x] **Step 1: Create a feature branch**

Run: `cd /home/steelburn/staff-track && git checkout -b feat/api-access`
Expected: `Switched to a new branch 'feat/api-access'`

- [x] **Step 2: Verify the stack is running**

Run: `docker compose ps --format '{{.Name}} {{.Status}}'`
Expected: `staff-track-backend-1 Up ...`, `staff-track-db-1 Up (healthy)`, `staff-track-nginx-1 Up ...`

If the stack is down, start it with `docker compose up -d` and wait for `db` to be healthy (`docker compose ps`).

---

### Task 1: Migration — `api_tokens` table

**Files:**
- Create: `backend/migrations/0014_create_api_tokens.sql`

- [x] **Step 1: Write the migration file**

Create `backend/migrations/0014_create_api_tokens.sql`:

```sql
-- 0014_create_api_tokens.sql
-- Self-service personal API tokens. Only SHA-256 hashes of secrets are stored;
-- the plaintext `st_…` secret is shown once at creation and never persisted.
;

CREATE TABLE IF NOT EXISTS api_tokens (
  id VARCHAR(36) PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  read_only TINYINT(1) NOT NULL DEFAULT 1,
  expires_at DATETIME NULL,
  last_used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY(user_email) REFERENCES user_roles(email) ON DELETE CASCADE,
  UNIQUE INDEX idx_token_hash (token_hash),
  INDEX idx_user_email (user_email),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- NOTE: 0900_ai_ci (not unicode_ci) — FK to user_roles.email requires identical collation (live table is 0900_ai_ci).
```

- [x] **Step 2: Apply the migration**

Run: `cd /home/steelburn/staff-track && docker compose restart backend`
Expected: backend logs (from `docker compose logs backend --tail 20`) show `✅ 0014_create_api_tokens` after `📦 Database Migrations`.

- [x] **Step 3: Verify table + migration row**

Run:
```bash
docker compose exec -T db mysql -ustafftrack -pstafftrack_dev_password stafftrack -e "SHOW COLUMNS FROM api_tokens; SELECT migration_name FROM _migrations WHERE migration_name='0014_create_api_tokens';"
```
Expected: 10 columns (`id, user_email, name, token_hash, read_only, expires_at, last_used_at, revoked_at, created_at`) and exactly one row `0014_create_api_tokens`.

- [x] **Step 4: Commit**

```bash
git add backend/migrations/0014_create_api_tokens.sql
git commit -m "feat: api_tokens table migration (self-service API access)"
```

---

### Task 2: Leaf utilities — tokens, CSV, rate limit

**Files:**
- Create: `backend/src/utils/tokens.js`
- Create: `backend/src/utils/csv.js`
- Create: `backend/src/utils/ratelimit.js`

- [x] **Step 1: Write `backend/src/utils/tokens.js`**

```js
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
```

- [x] **Step 2: Write `backend/src/utils/csv.js`**

```js
// Minimal RFC-4180-style CSV writer for flat row objects.
// Nested arrays are joined with '|' (feeds return flat rows only).

export function escapeCsvValue(v) {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join('|') : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

export function toCsv(rows, columns) {
    const header = columns.join(',');
    const body = rows
        .map(row => columns.map(col => escapeCsvValue(row[col])).join(','))
        .join('\n');
    return header + '\n' + body;
}
```

- [x] **Step 3: Write `backend/src/utils/ratelimit.js`**

```js
// Lightweight in-memory sliding-window rate limiter. Per-process only —
// resets on restart. Fine for an internal tool; documented as a limitation.

export function rateLimit({ windowMs = 60000, max = 300, keyFn = null, message = 'Too many requests' }) {
    const hits = new Map(); // key -> { count, resetAt }

    return function rateLimitMiddleware(req, res, next) {
        const key = keyFn ? keyFn(req) : req.ip;
        const now = Date.now();

        if (hits.size > 10000) {
            for (const [k, rec] of hits) {
                if (rec.resetAt <= now) hits.delete(k);
            }
        }

        const rec = hits.get(key);
        if (!rec || rec.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        rec.count += 1;
        if (rec.count > max) {
            res.set('Retry-After', String(Math.ceil((rec.resetAt - now) / 1000)));
            return res.status(429).json({ error: message });
        }
        next();
    };
}
```

- [x] **Step 4: Verify the utilities**

Run:
```bash
cd /home/steelburn/staff-track && node -e "
import('/home/steelburn/staff-track/backend/src/utils/tokens.js').then(async (t) => {
  const a = t.generateApiTokenSecret();
  const b = t.generateApiTokenSecret();
  console.log('secret prefix:', a.slice(0, 3), 'len:', a.length);
  console.log('unique:', a !== b);
  console.log('hash len:', t.hashApiToken(a).length);
  console.log('mask:', t.maskTokenHash(t.hashApiToken(a)));
});
import('/home/steelburn/staff-track/backend/src/utils/csv.js').then((c) => {
  console.log('csv:', JSON.stringify(c.toCsv([{ x: 'a', y: 'b\"c' }, { x: 'd', y: null }], ['x', 'y'])));
});
import('/home/steelburn/staff-track/backend/src/utils/ratelimit.js').then((r) => {
  console.log('ratelimit exported:', typeof r.rateLimit === 'function');
});
"
```
Expected output (values differ):
```
secret prefix: st_ len: 46
unique: true
hash len: 64
mask: st_…<4 hex chars>
csv: "x,y
a,\"b\"\"c\"
d,"
ratelimit exported: true
```
(`len: 46` = `st_` + 43; `b\"c` line shows RFC escaping.)

- [x] **Step 5: Commit**

```bash
git add backend/src/utils/tokens.js backend/src/utils/csv.js backend/src/utils/ratelimit.js
git commit -m "feat: token/csv/ratelimit utilities for self-service API access"
```

---

### Task 3: Auth — real `logAuthEvent` + dual-path `verifyToken`

**Files:**
- Modify: `backend/src/routes/auth.js`

Context: `verifyToken` is currently synchronous JWT-only middleware; `logAuthEvent` is a console-only stub. Both live in `backend/src/routes/auth.js` between `hashToken` and `requireRole`. Every other route imports `verifyToken`/`requireRole` from this file, so upgrading it here is the single choke point — **no other route files change in this task.**

- [x] **Step 1: Replace the `logAuthEvent` stub with a DB-backed implementation + `resolveApiToken` helper**

In `backend/src/routes/auth.js`, replace this exact block:

```js
// Define a placeholder for logAuthEvent
function logAuthEvent(db, email, event, success, req) {
    console.log(`Auth event: ${event} for ${email} - Success: ${success}`);
}
```

with:

```js
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
```

- [x] **Step 2: Replace `verifyToken` with the dual-path version**

Replace this exact block:

```js
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
```

with:

```js
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
```

Note: `requireRole`, the `export { logAuthEvent, router, verifyToken, requireRole }` line, and every route handler are unchanged.

- [x] **Step 3: Restart backend + verify JWT login still works**

Run: `cd /home/steelburn/staff-track && docker compose restart backend`

Then:
```bash
TOKEN=$(curl -s -X POST http://localhost:6082/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin","password":"c2VjdXJlX2FkbWluX3Bhc3N3b3Jk"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).access_token")
curl -s -o /dev/null -w 'JWT /me -> %{http_code}\n' http://localhost:6082/api/auth/me -H "Authorization: Bearer $TOKEN"
```
Expected: `JWT /me -> 200`

- [x] **Step 4: Verify the API-token path with a SQL-seeded token**

Generate a token secret + hash locally, seed one row for the `admin` user (admin exists in `user_roles`), then exercise the middleware:

```bash
cd /home/steelburn/staff-track && SECRET=$(node -e "import('/home/steelburn/staff-track/backend/src/utils/tokens.js').then(t=>console.log(t.generateApiTokenSecret()))")
HASH=$(node -e "import('/home/steelburn/staff-track/backend/src/utils/tokens.js').then(t=>console.log(t.hashApiToken(process.argv[1])))" "$SECRET")
echo "SECRET=$SECRET"; echo "HASH=$HASH"
docker compose exec -T db mysql -ustafftrack -pstafftrack_dev_password stafftrack -e "INSERT INTO api_tokens (id, user_email, name, token_hash, read_only, created_at) VALUES (UUID(), 'admin', 'seeded-test', '$HASH', 1, NOW());"
```
Then (repeat the login from Step 3 to get a fresh `$TOKEN` if the shell reset):
```bash
# read-only token: GET works
curl -s -o /dev/null -w 'GET with read-only token -> %{http_code}\n' http://localhost:6082/api/catalog/staff -H "Authorization: Bearer $SECRET"
# read-only token: write blocked
curl -s -X POST http://localhost:6082/api/submissions -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' -d '{}' -o /dev/null -w 'POST with read-only token -> %{http_code}\n'
# garbage token rejected
curl -s -o /dev/null -w 'GET with garbage token -> %{http_code}\n' http://localhost:6082/api/catalog/staff -H "Authorization: Bearer st_NotARealToken000"
```
Expected: `GET with read-only token -> 200`, `POST with read-only token -> 403`, `GET with garbage token -> 401`.

Clean up the seeded row:
```bash
docker compose exec -T db mysql -ustafftrack -pstafftrack_dev_password stafftrack -e "DELETE FROM api_tokens WHERE name='seeded-test';"
```

- [x] **Step 5: Verify audit rows landed**

Run:
```bash
docker compose exec -T db mysql -ustafftrack -pstafftrack_dev_password stafftrack -e "SELECT action, email, success, ip_address FROM auth_audit_log WHERE action LIKE 'api_token%' ORDER BY created_at DESC LIMIT 5;"
```
Expected: rows for `api_token_first_use` (success=1) and `api_token_denied` (success=0), both with `admin`/`unknown` email.

- [x] **Step 6: Commit**

```bash
git add backend/src/routes/auth.js
git commit -m "feat: dual-path verifyToken + DB-backed auth audit for API tokens"
```

---

### Task 4: Token management API — `/api-tokens` routes

**Files:**
- Create: `backend/src/routes/api-tokens.js`
- Modify: `backend/src/index.js` (import + mount)

- [x] **Step 1: Write `backend/src/routes/api-tokens.js`**

```js
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
```

- [x] **Step 2: Mount the router in `backend/src/index.js`**

Add after the existing data-tools import:

```js
import { router as apiTokensRouter } from './routes/api-tokens.js';
```

And after the existing data-tools mount line `app.use('/data-tools', dataToolsRouter);`:

```js
app.use('/api-tokens', apiTokensRouter);
```

- [x] **Step 3: Restart backend + run the full lifecycle**

Run: `cd /home/steelburn/staff-track && docker compose restart backend`

Then run this scripted lifecycle (fresh login, create 2 tokens, list, use, revoke, admin list, admin revoke):

```bash
BASE=http://localhost:6082/api
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"admin","password":"c2VjdXJlX2FkbWluX3Bhc3N3b3Jk"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).access_token")
AUTH="Authorization: Bearer $TOKEN"

# clean ci-test tokens left by previous runs of this task (env passthrough for node)
TB="$BASE" TK="$TOKEN" AUTH="$AUTH" node -e "
const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
(async () => {
  for (const t of d.tokens) {
    if ((t.name || '').startsWith('ci-test-')) {
      await fetch(process.env.TB + '/api-tokens/' + t.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + process.env.TK } });
    }
  }
})().catch(() => {});
" < <(curl -s $BASE/api-tokens -H "$AUTH") 2>/dev/null || true

# create (read-only default)
RESP=$(curl -s -X POST $BASE/api-tokens -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"ci-test-ro","expiresInDays":30}')
echo "CREATE1: $RESP" | head -c 300; echo
SECRET=$(echo "$RESP" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")
ID1=$(echo "$RESP" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).id")

# create (full access)
RESP2=$(curl -s -X POST $BASE/api-tokens -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"ci-test-rw","readOnly":false}')
SECRET2=$(echo "$RESP2" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")
ID2=$(echo "$RESP2" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).id")

# list (masked)
curl -s $BASE/api-tokens -H "$AUTH" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); d.tokens.map(t=>t.name+':'+t.readOnly+':'+t.mask).join('\n')"

# read-only token: GET ok / POST 403
curl -s -o /dev/null -w 'RO GET  -> %{http_code}\n' $BASE/catalog/staff -H "Authorization: Bearer $SECRET"
curl -s -o /dev/null -w 'RO POST -> %{http_code}\n' -X POST $BASE/admin/roles -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' -d '{}'
# full token: GET ok, and the write path reaches the route (400 = route-level validation, not auth)
curl -s -o /dev/null -w 'RW GET  -> %{http_code}\n' $BASE/catalog/staff -H "Authorization: Bearer $SECRET2"
curl -s -o /dev/null -w 'RW POST -> %{http_code}\n' -X POST $BASE/admin/roles -H "Authorization: Bearer $SECRET2" -H 'Content-Type: application/json' -d '{}'

# own revoke
curl -s -o /dev/null -w 'DELETE own -> %{http_code}\n' -X DELETE $BASE/api-tokens/$ID1 -H "$AUTH"
curl -s -o /dev/null -w 'revoked GET -> %{http_code}\n' $BASE/catalog/staff -H "Authorization: Bearer $SECRET"

# admin oversight
curl -s $BASE/api-tokens/admin/all -H "$AUTH" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); 'admin sees ' + d.tokens.length + ' token(s)'"
curl -s -o /dev/null -w 'admin revoke -> %{http_code}\n' -X DELETE $BASE/api-tokens/admin/$ID2 -H "$AUTH"

# token cannot manage tokens
curl -s -o /dev/null -w 'token list-as-token -> %{http_code}\n' $BASE/api-tokens -H "Authorization: Bearer $SECRET2"
```

Expected sequence:
```
CREATE1: {"id":"...","name":"ci-test-ro","readOnly":true,"expiresAt":"...","mask":"st_…...","token":"st_..."}
ci-test-ro:true:st_…....
ci-test-rw:false:st_…....
RO GET  -> 200
RO POST -> 403
RW GET  -> 200
RW POST -> 400
DELETE own -> 200
revoked GET -> 401
admin sees 0 token(s)   (clean run; count includes any ci-test leftovers from reruns)
admin revoke -> 404       (already revoked — run order makes this 404; if 200, also fine)
token list-as-token -> 403
```

- [x] **Step 4: Verify audit rows**

Run:
```bash
docker compose exec -T db mysql -ustafftrack -pstafftrack_dev_password stafftrack -e "SELECT action, COUNT(*) AS n FROM auth_audit_log WHERE email='admin' AND action LIKE 'api_token%' GROUP BY action ORDER BY action;"
```
Expected: rows incl. `api_token_created` (≥2), `api_token_revoked` (≥1), `api_token_admin_revoked` (≥1).

- [x] **Step 5: Commit**

```bash
git add backend/src/routes/api-tokens.js backend/src/index.js
git commit -m "feat: self-service API token management endpoints + admin oversight"
```

---

### Task 5: Export `getUserSubordinates` from reports.js

**Files:**
- Modify: `backend/src/routes/reports.js` (last line only)

- [x] **Step 1: Export the helper**

Replace the last line of `backend/src/routes/reports.js`:

```js
export { router };
```

with:

```js
export { router, getUserSubordinates };
```

- [x] **Step 2: Smoke-check reports still work**

Run: `cd /home/steelburn/staff-track && docker compose restart backend`

```bash
TOKEN=$(curl -s -X POST http://localhost:6082/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin","password":"c2VjdXJlX2FkbWluX3Bhc3N3b3Jk"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).access_token")
curl -s -o /dev/null -w 'reports/my-subordinates -> %{http_code}\n' http://localhost:6082/api/reports/my-subordinates -H "Authorization: Bearer $TOKEN"
```
Expected: `reports/my-subordinates -> 200`

- [x] **Step 3: Commit**

```bash
git add backend/src/routes/reports.js
 git commit -m "chore: export getUserSubordinates for feeds reuse"
```

---

### Task 6: Data Feeds API — `/feeds` routes

**Files:**
- Create: `backend/src/routes/feeds.js`
- Modify: `backend/src/index.js` (import + mount)

Design: uniform GET-only surface. Query grammar: `?fields=a,b` (projection, validated), `?filter[col]=v` (equality) / `?filter[col]=~v` (substring), `?sort=col&order=asc|desc`, `?page=1&limit=50` (max 500), `?format=csv` or `Accept: text/csv`. JSON envelope `{ data, meta: { page, limit, total, returned } }`. Totals come from `COUNT(*) OVER()` in the same round-trip.

- [x] **Step 1: Write `backend/src/routes/feeds.js`**

```js
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
```

- [x] **Step 2: Mount `/feeds` in `backend/src/index.js`**

Add import after the api-tokens import:

```js
import { router as feedsRouter } from './routes/feeds.js';
```

Add mount after the api-tokens mount:

```js
app.use('/feeds', feedsRouter);
```

- [x] **Step 3: Restart + verify all feeds as admin**

Run: `cd /home/steelburn/staff-track && docker compose restart backend`

```bash
BASE=http://localhost:6082/api
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"email":"admin","password":"c2VjdXJlX2FkbWluX3Bhc3N3b3Jk"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).access_token")
AUTH="Authorization: Bearer $TOKEN"
for EP in me staff projects skills certifications summary; do
  printf '%-16s -> %s\n' "/feeds/$EP" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/feeds/$EP -H "$AUTH")"
done
# NOTE: encode [ ] as %5B %5D (or pass -g) — curl treats raw brackets as URL globs
curl -s "$BASE/feeds/staff?limit=3&filter%5Bactive%5D=1&format=csv" -H "$AUTH" | head -3
echo "---"; curl -s "$BASE/feeds/staff?limit=2&sort=name&order=desc" -H "$AUTH" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); 'total='+d.meta.total+' returned='+d.meta.returned+' first='+d.data[0].name"
echo "---"; curl -s "$BASE/feeds/staff?filter%5Bbogus%5D=x" -H "$AUTH" | head -c 200; echo
```
Expected: `/feeds/staff|projects|skills|certifications|summary` return `200`; `/feeds/me` returns `200` only if the account has a staff row (`admin` has none → `404 {"error":"No staff record for this account"}` — by design). The CSV block prints a header row (`email,name,title,department,manager_name,active`); the JSON block prints `total=… returned=2 first=…`; the bogus filter prints `{"error":"Unsupported filter 'bogus'. Allowed: department, manager_name, active"}`.

- [x] **Step 4: Verify role scoping with a plain-staff account**

Insert a plain staff user (use an email that exists in `staff` if possible; otherwise the scope resolution returns `none` which is what we want to test):

```bash
docker compose exec -T db mysql -ustafftrack -pstafftrack_dev_password stafftrack -e "INSERT IGNORE INTO user_roles (email, role, is_active, created_at, updated_at) VALUES ('scope-test@zen.com.my', 'staff', 1, NOW(), NOW()); INSERT IGNORE INTO staff (email, name, title, department, manager_name) VALUES ('scope-test@zen.com.my', 'Scope Test', 'Engineer', 'IT', NULL);"
STAFF_TOKEN=$(curl -s -X POST http://localhost:6082/api/auth/login -H 'Content-Type: application/json' -d '{"email":"scope-test@zen.com.my","password":"dummy"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).access_token" 2>/dev/null)
```

Note: if BeeSuite rejects the dummy-password login (external auth), simulate the staff JWT instead — mint a session JWT directly with the same secret used by the container (`JWT_SECRET` = `dev_secret_change_me_in_prod`):

```bash
STAFF_TOKEN=$(node -e "const jwt=require('/home/steelburn/staff-track/node_modules/jsonwebtoken'); console.log(jwt.sign({email:'scope-test@zen.com.my',isAdmin:false,is_hr:0,is_coordinator:0}, 'dev_secret_change_me_in_prod', {expiresIn:'1h'}))")
```

Then:
```bash
curl -s -o /dev/null -w 'staff /feeds/me       -> %{http_code}\n' http://localhost:6082/api/feeds/me -H "Authorization: Bearer $STAFF_TOKEN"
curl -s -o /dev/null -w 'staff /feeds/staff    -> %{http_code}\n' http://localhost:6082/api/feeds/staff -H "Authorization: Bearer $STAFF_TOKEN"
curl -s -o /dev/null -w 'staff /feeds/skills   -> %{http_code}\n' http://localhost:6082/api/feeds/skills -H "Authorization: Bearer $STAFF_TOKEN"
curl -s -o /dev/null -w 'staff /feeds/staff/:self -> %{http_code}\n' http://localhost:6082/api/feeds/staff/scope-test@zen.com.my -H "Authorization: Bearer $STAFF_TOKEN"
```
Expected: `staff /feeds/me -> 200`, all others `403`.

Clean up:
```bash
docker compose exec -T db mysql -ustafftrack -pstafftrack_dev_password stafftrack -e "DELETE FROM user_roles WHERE email='scope-test@zen.com.my'; DELETE FROM staff WHERE email='scope-test@zen.com.my';"
```

- [x] **Step 5: Commit**

```bash
git add backend/src/routes/feeds.js backend/src/index.js
 git commit -m "feat: read-only Data Feeds API (staff/projects/skills/certs/summary) with JSON+CSV"
```

---

### Task 7: API Access page — token manager + console + quick reference

**Files:**
- Create: `public/api-access.html`
- Create: `public/api-access.js`
- Modify: `public/sidebar.js` (nav item, Main section)
- Modify: `public/menu.js` (legacy nav item)

All logged-in users get the page; content is role-aware. `api-access.js` mirrors the bootstrap pattern of `public/admin.js` (requireAuth, `renderSidebarNav('api-access')` fallback `renderNav`, ThemeManager, Toast).

- [x] **Step 1: Add the nav item (new sidebar)**

In `public/sidebar.js`, inside the Main section of `render(user, activeTab)` (right after the My CV item), replace:

```js
                ${this.renderNavItem('📄', 'My CV', '/cv-profile.html', activeTab === 'cv-profile')}
```

with:

```js
                ${this.renderNavItem('📄', 'My CV', '/cv-profile.html', activeTab === 'cv-profile')}
                ${this.renderNavItem('🔌', 'API Access', '/api-access.html', activeTab === 'api-access')}
```

- [x] **Step 2: Add the nav item (legacy menu)**

In `public/menu.js`, inside `renderNav(activeTab)`, right after the My CV line, replace:

```js
    html += `<a href="/cv-profile.html" class="nav-link ${activeTab === 'cv-profile' ? 'active' : ''}">📄 My CV</a>`;
```

with:

```js
    html += `<a href="/cv-profile.html" class="nav-link ${activeTab === 'cv-profile' ? 'active' : ''}">📄 My CV</a>`;
    html += `<a href="/api-access.html" class="nav-link ${activeTab === 'api-access' ? 'active' : ''}">🔌 API Access</a>`;
```

- [x] **Step 3: Write `public/api-access.html`**

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>StaffTrack — API Access</title>
    <link rel="stylesheet" href="/css/main.css?v=20260904a">
    <script src="/theme.js?v=20260904a"></script>
</head>

<body>
    <div class="app-layout">
        <!-- ═══ Sidebar ═══════════════════════════════════════════════════════ -->
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-header">
                <div class="sidebar-logo">📋</div>
                <span class="sidebar-title">StaffTrack</span>
            </div>
            <nav class="sidebar-nav" id="sidebar-nav"></nav>
            <div class="sidebar-footer">
                <div class="user-card" id="sidebar-user-card"></div>
            </div>
            <button class="sidebar-toggle" id="sidebarToggle">◀</button>
        </aside>
        <div class="sidebar-overlay" id="sidebarOverlay"></div>

        <!-- ═══ Main Content ═════════════════════════════════════════════════ -->
        <div class="main-content">
            <header class="page-header">
                <div class="page-header-top">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <button class="mobile-menu-btn" id="mobileMenuBtn">☰</button>
                        <div>
                            <h1 class="page-title">API Access</h1>
                            <p class="page-subtitle">Personal API tokens, data feeds, and a live console</p>
                        </div>
                    </div>
                    <div class="page-actions">
                        <button class="btn btn-secondary" id="theme-toggle" data-theme-toggle>
                            <span class="theme-icon">🌙</span>
                            <span class="theme-label">Dark</span>
                        </button>
                    </div>
                </div>
            </header>

            <main class="content-area">
                <!-- ═══ My Tokens ═════════════════════════════════════════════ -->
                <div class="section-header" style="margin-top:0;">
                    <h2 class="section-title">🔑 My API Tokens</h2>
                    <span class="section-count" id="token-count-hint"></span>
                </div>

                <div class="card" style="margin-bottom: var(--space-5);">
                    <div class="card-header">
                        <div class="card-title">Create a token</div>
                        <div class="card-subtitle">Tokens act as <b>you</b> — never wider than your UI role. The secret is shown once.</div>
                    </div>
                    <div class="card-body">
                        <div style="display:grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
                            <div>
                                <label class="form-label" for="tok-name">Token name</label>
                                <input type="text" id="tok-name" class="input" maxlength="100" placeholder="e.g. Nightly backup sync">
                            </div>
                            <div>
                                <label class="form-label">Scope</label>
                                <div style="display:flex; gap: var(--space-4); padding-top: 6px;">
                                    <label style="display:flex; align-items:center; gap:6px;">
                                        <input type="radio" name="tok-scope" value="read" checked> Read-only <span style="font-size:11px; color: var(--color-text-muted);">(safe default)</span>
                                    </label>
                                    <label style="display:flex; align-items:center; gap:6px;">
                                        <input type="radio" name="tok-scope" value="full"> Full access
                                    </label>
                                </div>
                            </div>
                            <div>
                                <label class="form-label" for="tok-expiry">Expires in</label>
                                <select id="tok-expiry" class="select" style="width:100%;">
                                    <option value="30">30 days</option>
                                    <option value="90" selected>90 days</option>
                                    <option value="180">180 days</option>
                                    <option value="365">365 days</option>
                                    <option value="never">Never (not recommended)</option>
                                </select>
                            </div>
                        </div>
                        <p id="tok-scope-warning" style="display:none; font-size:12px; color: var(--color-warning); margin: var(--space-3) 0 0;">
                            ⚠️ A full-access token can <b>write</b> to every endpoint your role allows. Anyone holding it can act as you.
                        </p>
                        <p id="tok-expiry-warning" style="display:none; font-size:12px; color: var(--color-warning); margin: var(--space-3) 0 0;">
                            ⚠️ Tokens that never expire stay valid until manually revoked.
                        </p>
                        <div style="margin-top: var(--space-4);">
                            <button class="btn btn-primary" id="tok-create">+ Create token</button>
                        </div>
                    </div>
                </div>

                <div class="table-container">
                    <div class="table-scroll">
                        <table class="table" id="api-token-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Key</th>
                                    <th>Scope</th>
                                    <th>Created</th>
                                    <th>Expires</th>
                                    <th>Last used</th>
                                    <th style="text-align:right;">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="api-token-tbody">
                                <tr><td colspan="7"><div class="loading-state"><div class="spinner"></div><p>Loading tokens...</p></div></td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- ═══ API Console ═══════════════════════════════════════════ -->
                <div class="section-header" style="margin-top: var(--space-6);">
                    <h2 class="section-title">🧪 API Console</h2>
                    <span class="section-count">Try endpoints live — responses come straight from the API</span>
                </div>

                <div class="card" style="margin-bottom: var(--space-5);">
                    <div class="card-body">
                        <div style="display:grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); align-items:end;">
                            <div>
                                <label class="form-label" for="con-endpoint">Endpoint</label>
                                <select id="con-endpoint" class="select" style="width:100%;"></select>
                            </div>
                            <div>
                                <label class="form-label" for="con-auth">Authenticate as</label>
                                <select id="con-auth" class="select" style="width:100%;">
                                    <option value="session">My session (default)</option>
                                    <option value="token">API token (paste below)</option>
                                </select>
                            </div>
                            <div style="grid-column: span 2;">
                                <label class="form-label" for="con-token-paste">Pasted API token</label>
                                <input type="password" id="con-token-paste" class="input" style="width:100%;" placeholder="st_… — only needed when using 'API token' auth">
                            </div>
                        </div>

                        <div id="con-feed-controls" style="margin-top: var(--space-4);">
                            <div style="display:grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));">
                                <div>
                                    <label class="form-label" for="con-fields">fields <span style="font-size:11px; color:var(--color-text-muted);">(comma list)</span></label>
                                    <input type="text" id="con-fields" class="input" placeholder="email,name,department">
                                </div>
                                <div>
                                    <label class="form-label" for="con-sort">sort</label>
                                    <select id="con-sort" class="select" style="width:100%;"></select>
                                </div>
                                <div>
                                    <label class="form-label" for="con-order">order</label>
                                    <select id="con-order" class="select" style="width:100%;">
                                        <option value="asc">asc</option>
                                        <option value="desc">desc</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="form-label" for="con-limit">limit <span style="font-size:11px; color:var(--color-text-muted);">(≤500)</span></label>
                                    <input type="number" id="con-limit" class="input" value="25" min="1" max="500">
                                </div>
                                <div>
                                    <label class="form-label" for="con-format">format</label>
                                    <select id="con-format" class="select" style="width:100%;">
                                        <option value="json">JSON</option>
                                        <option value="csv">CSV (download)</option>
                                    </select>
                                </div>
                            </div>
                            <div style="margin-top: var(--space-3);">
                                <label class="form-label">Filters <button type="button" class="btn btn-ghost btn-sm" id="con-add-filter">+ add</button></label>
                                <div id="con-filter-rows" style="display:grid; gap: var(--space-2); margin-top: var(--space-2);"></div>
                            </div>
                        </div>

                        <div style="display:flex; gap: var(--space-3); align-items:center; margin-top: var(--space-4); flex-wrap:wrap;">
                            <code id="con-url" style="font-family:monospace; font-size:12px;"></code>
                            <button class="btn btn-primary" id="con-run">▶ Run</button>
                            <button class="btn btn-secondary" id="con-copy-curl" disabled>Copy cURL</button>
                            <button class="btn btn-secondary" id="con-download" style="display:none;">⬇ Download CSV</button>
                        </div>

                        <div id="con-status" style="margin-top: var(--space-3); font-size:12px; color: var(--color-text-muted);"></div>
                        <pre id="con-output" style="display:none; margin-top: var(--space-3); background:var(--color-bg-muted); border:1px solid var(--color-border); border-radius:8px; padding:var(--space-4); overflow:auto; max-height:480px; font-size:12px; white-space:pre-wrap; word-break:break-word;"></pre>
                    </div>
                </div>

                <!-- ═══ Quick Reference ═══════════════════════════════════════ -->
                <div class="section-header" style="margin-top: var(--space-6);">
                    <h2 class="section-title">📖 Quick Reference</h2>
                </div>
                <div class="card">
                    <div class="card-body" style="font-size: 13px; line-height: 1.7;">
                        <p><b>Authenticate</b> — send the token in the <code>Authorization</code> header:</p>
                        <pre style="background:var(--color-bg-muted); border:1px solid var(--color-border); border-radius:8px; padding:var(--space-4); overflow:auto; max-height:480px; font-size:12px; white-space:pre-wrap; word-break:break-word;">curl -H "Authorization: Bearer st_…" \
  https://your-host/api/feeds/staff?limit=10&amp;format=csv</pre>
                        <p><b>Write access</b> — tokens are read-only unless you chose full access at creation. Read-only tokens are rejected with <code>403</code> on any non-GET request. API tokens can never manage other tokens.</p>
                        <p><b>Data Feed query grammar</b> (all feeds are GET):</p>
                        <ul style="margin-left: var(--space-5);">
                            <li><code>?fields=email,name,department</code> — limit columns (whitelisted per feed)</li>
                            <li><code>?filter[department]=IT</code> — exact match; <code>?filter[name]=~john</code> — substring</li>
                            <li><code>?sort=name&amp;order=asc</code> — sort by an allowed column</li>
                            <li><code>?page=2&amp;limit=50</code> — pagination (limit ≤ 500, default 50)</li>
                            <li><code>?format=csv</code> or <code>Accept: text/csv</code> — CSV export</li>
                        </ul>
                        <p><b>Errors</b> — <code>401</code> invalid/expired/revoked token · <code>403</code> read-only token or out-of-scope record · <code>400</code> bad query param (name says which) · <code>429</code> rate limited.</p>
                        <p><b>Scope</b> — tokens resolve against your live role on every request. If your account is deactivated or demoted, existing tokens stop working immediately. Revoke a token any time from this page; admins can force-revoke any token from the Admin page.</p>
                    </div>
                </div>
            </main>
        </div>
    </div>

    <!-- ═══ Reveal-secret modal ═════════════════════════════════════════════ -->
    <div class="modal-backdrop" id="reveal-modal">
        <div class="modal" role="dialog" aria-modal="true">
            <div class="modal-header">
                <div class="modal-title">🔑 Token created — copy it now</div>
                <button class="modal-close" data-close-modal>✕</button>
            </div>
            <div class="modal-body">
                <p style="font-size:13px; color: var(--color-text-muted);">This secret is shown <b>once</b> and never stored. Keep it safe — anyone with it can act as you.</p>
                <input type="text" id="reveal-secret" class="input" readonly style="width:100%; font-family: monospace; margin-top: var(--space-3);">
                <div style="display:flex; gap: var(--space-3); margin-top: var(--space-4); flex-wrap:wrap;">
                    <button class="btn btn-primary" id="reveal-copy">📋 Copy token</button>
                    <button class="btn btn-secondary" id="reveal-copy-curl">Copy cURL sample</button>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" data-close-modal>I've saved it</button>
            </div>
        </div>
    </div>

    <!-- Toast Container -->
    <div id="toast-container" class="toast-container"></div>

    <script src="/auth.js?v=20260904a"></script>
    <script src="/menu.js?v=20260904a"></script>
    <script src="/sidebar.js?v=20260904a"></script>
    <script src="/toast.js?v=20260904a"></script>
    <script src="/api-access.js?v=20260904a"></script>
</body>

</html>
```

- [x] **Step 4: Write `public/api-access.js`**

```js
'use strict';

const authUser = requireAuth();

// ── Role model ─────────────────────────────────────────────────────────────────
const isAdmin = authUser.isAdmin === true;
const isHR = authUser.is_hr === true || authUser.is_hr === 1;
const isCoord = authUser.is_coordinator === true || authUser.is_coordinator === 1;
const hasFullAccess = isAdmin || isHR || isCoord;
const subordinateCount = parseInt(sessionStorage.getItem('st_subordinate_count') || '0', 10);
const isManager = hasFullAccess || subordinateCount > 0;

// ── Toast / modal helpers ──────────────────────────────────────────────────────
function toast(title, isErr) {
    if (typeof Toast !== 'undefined') {
        Toast.show({ type: isErr ? 'error' : 'success', title, closable: true });
    } else {
        alert(title);
    }
}
function openModal(id) { closeModal(); const el = document.getElementById(id); if (el) el.classList.add('active'); }
function closeModal() { document.querySelectorAll('.modal-backdrop.active').forEach(el => el.classList.remove('active')); }
function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(String(v).replace(' ', 'T'));
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Endpoint catalog ───────────────────────────────────────────────────────────
// roles: all | full | admin | hr | manager (manager = has subordinates or full)
const ENDPOINTS = [
    { id: 'feeds-me', label: 'My record — /api/feeds/me', method: 'GET', path: '/api/feeds/me', roles: 'all', kind: 'feed', filterable: [], sortable: [], feedDefaultSort: '' },
    { id: 'feeds-staff', label: 'Staff directory — /api/feeds/staff', method: 'GET', path: '/api/feeds/staff', roles: 'full,manager', kind: 'feed', filterable: ['department', 'manager_name', 'active'], sortable: ['name', 'email', 'department'], feedDefaultSort: 'name' },
    { id: 'feeds-projects', label: 'Projects — /api/feeds/projects', method: 'GET', path: '/api/feeds/projects', roles: 'full,manager', kind: 'feed', filterable: ['customer', 'soc', 'project_name'], sortable: ['project_name', 'customer', 'soc', 'end_date'], feedDefaultSort: 'project_name' },
    { id: 'feeds-skills', label: 'Skills (latest per person) — /api/feeds/skills', method: 'GET', path: '/api/feeds/skills', roles: 'full,manager', kind: 'feed', filterable: ['skill'], sortable: ['skill', 'email', 'rating'], feedDefaultSort: 'skill' },
    { id: 'feeds-certs', label: 'Certifications — /api/feeds/certifications', method: 'GET', path: '/api/feeds/certifications', roles: 'admin,hr', kind: 'feed', filterable: ['email', 'name', 'issuer', 'status'], sortable: ['email', 'name', 'issuer', 'expiry_date'], feedDefaultSort: 'email' },
    { id: 'feeds-summary', label: 'Org summary KPIs — /api/feeds/summary', method: 'GET', path: '/api/feeds/summary', roles: 'full,manager', kind: 'feed', filterable: [], sortable: [], feedDefaultSort: '' },
    { id: 'reports-mine', label: 'My subordinates — /api/reports/my-subordinates', method: 'GET', path: '/api/reports/my-subordinates', roles: 'manager', kind: 'simple' },
    { id: 'catalog-staff', label: 'Staff catalog — /api/catalog/staff', method: 'GET', path: '/api/catalog/staff', roles: 'admin,hr', kind: 'simple' },
];
const visibleEndpoints = ENDPOINTS.filter(ep => {
    const need = ep.roles.split(',');
    const have = [];
    if (isAdmin) have.push('admin');
    if (isHR) have.push('hr');
    if (hasFullAccess) have.push('full');
    if (isManager) have.push('manager');
    return need.some(r => r === 'all' || have.includes(r));
});

// ── My Tokens ──────────────────────────────────────────────────────────────────
let lastSecret = null;   // only lives in memory right after creation

async function loadTokens() {
    const tbody = document.getElementById('api-token-tbody');
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/api-tokens');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const { tokens } = await res.json();
        const hint = document.getElementById('token-count-hint');
        if (hint) hint.textContent = tokens.length + ' / 20 active token' + (tokens.length === 1 ? '' : 's');
        renderTokens(tokens);
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--color-danger);">Failed to load tokens: ' + esc(err.message) + '</td></tr>';
    }
}

function renderTokens(tokens) {
    const tbody = document.getElementById('api-token-tbody');
    if (tokens.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--color-text-muted); text-align:center; padding: var(--space-5);">No active tokens. Create one above to call the API from scripts, cron jobs, or Power BI.</td></tr>';
        return;
    }
    tbody.innerHTML = tokens.map(t => {
        const scopeBadge = t.readOnly
            ? '<span class="badge badge-info">Read-only</span>'
            : '<span class="badge badge-success">Full access</span>';
        const expiring = t.expiresAt && new Date(String(t.expiresAt).replace(' ', 'T')).getTime() - Date.now() < 30 * 86400e3;
        const expiry = t.expiresAt
            ? (expiring ? '<span class="badge badge-warning">' + esc(fmtDate(t.expiresAt)) + '</span>' : esc(fmtDate(t.expiresAt)))
            : '<span class="badge badge-neutral">Never</span>';
        const fresh = lastSecret && t.id === lastSecret.id ? '<span class="badge badge-success">New</span> ' : '';
        return `<tr data-id="${esc(t.id)}">
            <td>${fresh}${esc(t.name)}</td>
            <td><span style="font-family:monospace;">${esc(t.mask)}</span></td>
            <td>${scopeBadge}</td>
            <td>${esc(fmtDate(t.createdAt))}</td>
            <td>${expiry}</td>
            <td>${esc(fmtDate(t.lastUsedAt))}</td>
            <td style="text-align:right; white-space:nowrap;">
                <button class="btn btn-ghost btn-sm tok-copy-curl" ${lastSecret && t.id === lastSecret.id ? '' : 'disabled'}>Copy cURL</button>
                <button class="btn btn-danger btn-sm tok-revoke">Revoke</button>
            </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.tok-revoke').forEach(btn => {
        btn.addEventListener('click', async () => {
            const tr = btn.closest('tr');
            const id = tr.dataset.id;
            const name = tr.querySelector('td').textContent.trim();
            if (!confirm('Revoke token "' + name + '"? Any script using it will stop working immediately.')) return;
            const res = await window.StaffTrackAuth.apiFetch('/api/api-tokens/' + id, { method: 'DELETE' });
            if (res.ok) {
                toast('Token revoked');
                if (lastSecret && lastSecret.id === id) lastSecret = null;
                loadTokens();
            } else {
                const data = await res.json().catch(() => ({}));
                toast('Revoke failed: ' + (data.error || res.status), true);
            }
        });
    });
    tbody.querySelectorAll('.tok-copy-curl').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!lastSecret) return;
            copyText('curl -H "Authorization: Bearer ' + lastSecret.token + '" ' + location.origin + '/api/feeds/me');
        });
    });
}

function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard')).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}
function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Copied to clipboard');
}

async function createToken() {
    const name = document.getElementById('tok-name').value.trim();
    const scope = document.querySelector('input[name="tok-scope"]:checked').value;
    const expirySel = document.getElementById('tok-expiry').value;
    if (!name) { toast('Please name your token', true); return; }
    const body = {
        name,
        readOnly: scope === 'read',
        expiresInDays: expirySel === 'never' ? null : parseInt(expirySel, 10),
    };
    const btn = document.getElementById('tok-create');
    btn.disabled = true;
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/api-tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        lastSecret = { id: data.id, token: data.token };
        document.getElementById('reveal-secret').value = data.token;
        openModal('reveal-modal');
        document.getElementById('tok-name').value = '';
        toast('Token created');
        loadTokens();
    } catch (err) {
        toast('Create failed: ' + err.message, true);
    } finally {
        btn.disabled = false;
    }
}

// ── Console ────────────────────────────────────────────────────────────────────
let activeEndpoint = visibleEndpoints[0] || null;
let filterRowCounter = 0;

function renderEndpointSelect() {
    const sel = document.getElementById('con-endpoint');
    sel.innerHTML = visibleEndpoints.map(ep => `<option value="${ep.id}">${esc(ep.label)}</option>`).join('');
    sel.addEventListener('change', () => onEndpointChange(visibleEndpoints.find(e => e.id === sel.value)));
}

function onEndpointChange(ep) {
    activeEndpoint = ep;
    const feedBox = document.getElementById('con-feed-controls');
    feedBox.style.display = ep.kind === 'feed' ? '' : 'none';
    document.getElementById('con-filter-rows').innerHTML = '';
    const sortSel = document.getElementById('con-sort');
    sortSel.innerHTML = (ep.sortable || []).map(c => `<option value="${c}">${c}</option>`).join('') || '<option value="">—</option>';
    if (ep.feedDefaultSort) sortSel.value = ep.feedDefaultSort;
    document.getElementById('con-fields').value = '';
    updateUrlPreview();
}

function addFilterRow() {
    const ep = activeEndpoint;
    if (!ep || ep.kind !== 'feed') return;
    filterRowCounter += 1;
    const id = 'flt-' + filterRowCounter;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap: var(--space-2); align-items:center;';
    row.innerHTML = `
        <select class="select flt-col" style="flex:1; min-width:120px;">${(ep.filterable || []).map(c => `<option value="${c}">${c}</option>`).join('')}</select>
        <select class="select flt-op" style="width:90px;"><option value="eq">= equals</option><option value="like">~ contains</option></select>
        <input type="text" class="input flt-val" style="flex:2;" placeholder="value">
        <button type="button" class="btn btn-ghost btn-sm flt-del" title="Remove">✕</button>
    `;
    row.querySelector('.flt-del').addEventListener('click', () => { row.remove(); updateUrlPreview(); });
    ['change', 'input'].forEach(ev => row.querySelectorAll('select, input').forEach(el => el.addEventListener(ev, updateUrlPreview)));
    document.getElementById('con-filter-rows').appendChild(row);
    updateUrlPreview();
}

function currentQuery() {
    const ep = activeEndpoint;
    const parts = [];
    if (ep.kind === 'feed') {
        const fields = document.getElementById('con-fields').value.trim();
        if (fields) parts.push('fields=' + encodeURIComponent(fields));
        document.querySelectorAll('#con-filter-rows .flt-col').forEach((sel, i) => {
            const col = sel.value, op = document.querySelectorAll('#con-filter-rows .flt-op')[i].value, val = document.querySelectorAll('#con-filter-rows .flt-val')[i].value.trim();
            if (!col || !val) return;
            const key = 'filter[' + col + ']';
            parts.push(key + '=' + encodeURIComponent((op === 'like' ? '~' : '') + val));
        });
        const sort = document.getElementById('con-sort').value;
        if (sort) parts.push('sort=' + encodeURIComponent(sort));
        const order = document.getElementById('con-order').value;
        if (order) parts.push('order=' + encodeURIComponent(order));
        const limit = document.getElementById('con-limit').value;
        if (limit) parts.push('limit=' + encodeURIComponent(limit));
    }
    return parts.join('&');
}

function updateUrlPreview() {
    const urlEl = document.getElementById('con-url');
    if (!activeEndpoint) { urlEl.textContent = ''; return; }
    urlEl.textContent = activeEndpoint.method + ' ' + activeEndpoint.path + (currentQuery() ? '?' + currentQuery() : '');
}

async function runConsole() {
    const output = document.getElementById('con-output');
    const status = document.getElementById('con-status');
    const download = document.getElementById('con-download');
    const copyCurl = document.getElementById('con-copy-curl');
    const format = document.getElementById('con-format').value;
    const authMode = document.getElementById('con-auth').value;
    const pasted = document.getElementById('con-token-paste').value.trim();
    const ep = activeEndpoint;
    if (!ep) return;

    const url = ep.path + (currentQuery() ? '?' + currentQuery() : '');
    const headers = {};
    if (authMode === 'token') {
        if (!pasted) { toast('Paste an API token first', true); return; }
        headers['Authorization'] = 'Bearer ' + pasted;
    }
    if (format === 'csv') headers['Accept'] = 'text/csv';
    else headers['Accept'] = 'application/json';

    status.textContent = 'Sending ' + ep.method + ' ' + url + ' …';
    output.style.display = 'none';
    download.style.display = 'none';
    copyCurl.disabled = true;
    const btn = document.getElementById('con-run');
    btn.disabled = true;
    try {
        const res = authMode === 'session'
            ? await window.StaffTrackAuth.apiFetch(url, { headers })
            : await fetch(url, { headers });
        const ctype = res.headers.get('content-type') || '';
        status.textContent = ep.method + ' ' + url + ' → ' + res.status + ' ' + res.statusText;
        output.style.display = '';
        if (ctype.includes('text/csv')) {
            const text = await res.text();
            output.textContent = text;
            download.style.display = '';
            download.onclick = () => {
                const blob = new Blob([text], { type: 'text/csv' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = ep.id + '.csv';
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            };
        } else {
            const data = await res.json().catch(() => null);
            output.textContent = data == null ? '(non-JSON response)' : JSON.stringify(data, null, 2);
        }
        copyCurl.disabled = false;
        copyCurl.onclick = () => {
            const token = authMode === 'token' ? pasted : (window.StaffTrackAuth.getToken ? window.StaffTrackAuth.getToken() : '');
            copyText('curl -X ' + ep.method + ' -H "Authorization: Bearer ' + token + '"' + (format === 'csv' ? ' -H "Accept: text/csv"' : '') + ' ' + location.origin + url);
        };
    } catch (err) {
        status.textContent = 'Request failed: ' + err.message;
    } finally {
        btn.disabled = false;
    }
}

// ── Warnings / wiring ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (typeof renderSidebarNav === 'function') {
        renderSidebarNav('api-access');
    } else if (typeof renderNav === 'function') {
        renderNav('api-access');
    }
    if (typeof ThemeManager !== 'undefined') ThemeManager.updateToggleButtons();
    if (typeof Toast !== 'undefined') Toast.init();

    // scope radio warning
    document.querySelectorAll('input[name="tok-scope"]').forEach(r => r.addEventListener('change', () => {
        const full = document.querySelector('input[name="tok-scope"]:checked').value === 'full';
        document.getElementById('tok-scope-warning').style.display = full ? '' : 'none';
    }));
    document.getElementById('tok-expiry').addEventListener('change', () => {
        const never = document.getElementById('tok-expiry').value === 'never';
        document.getElementById('tok-expiry-warning').style.display = never ? '' : 'none';
    });
    document.getElementById('tok-create').addEventListener('click', createToken);

    // console wiring
    renderEndpointSelect();
    if (activeEndpoint) onEndpointChange(activeEndpoint);
    document.getElementById('con-add-filter').addEventListener('click', addFilterRow);
    ['con-fields', 'con-sort', 'con-order', 'con-limit'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateUrlPreview);
    });
    document.getElementById('con-fields').addEventListener('input', updateUrlPreview);
    document.getElementById('con-run').addEventListener('click', runConsole);

    // modal helpers
    document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeModal));
    document.getElementById('reveal-copy').addEventListener('click', () => {
        const secret = document.getElementById('reveal-secret').value;
        if (secret) copyText(secret);
    });
    document.getElementById('reveal-copy-curl').addEventListener('click', () => {
        const secret = document.getElementById('reveal-secret').value;
        if (secret) copyText('curl -H "Authorization: Bearer ' + secret + '" ' + location.origin + '/api/feeds/me');
    });

    loadTokens();
});
```

- [x] **Step 5: Smoke-test the page loads for a logged-in session**

Frontend files are served by nginx directly — no restart needed. Fetch the page and confirm the JS parses by loading it through chromium in Task 9; for now just confirm both files are served:

```bash
curl -s -o /dev/null -w 'api-access.html -> %{http_code}\n' http://localhost:6082/api-access.html
curl -s -o /dev/null -w 'api-access.js -> %{http_code}\n' http://localhost:6082/api-access.js
```
Expected: both `200`.

- [x] **Step 6: Commit**

```bash
git add public/api-access.html public/api-access.js public/sidebar.js public/menu.js
git commit -m "feat: API Access page (token manager + console + quick reference) with nav entry"
```

---

### Task 8: Admin oversight — org-wide API token panel

**Files:**
- Modify: `public/admin.html` (second section)
- Modify: `public/admin.js` (load/render/revoke + wiring)

- [x] **Step 1: Add the section to `public/admin.html`**

In `public/admin.html`, replace:

```html
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>
```

with:

```html
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- ═══ API Tokens Oversight ═══════════════════════════════ -->
                <div class="section-header" style="margin-top: var(--space-6);">
                    <h2 class="section-title">🔑 API Tokens Oversight</h2>
                    <span class="section-count" id="api-admin-count">Org-wide personal API tokens</span>
                </div>

                <div class="toolbar" style="margin-bottom: var(--space-4);">
                    <div class="search-box">
                        <span class="search-icon">🔍</span>
                        <input type="text" id="api-admin-search" class="input" placeholder="Search by user or token name...">
                    </div>
                    <button class="btn btn-secondary" id="api-admin-refresh">↻ Refresh</button>
                </div>

                <div class="table-container">
                    <div class="table-scroll">
                        <table class="table" id="api-admin-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>User</th>
                                    <th>Scope</th>
                                    <th>Created</th>
                                    <th>Expires</th>
                                    <th>Last used</th>
                                    <th>Status</th>
                                    <th style="text-align:right;">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="api-admin-tbody">
                                <tr>
                                    <td colspan="8">
                                        <div class="loading-state">
                                            <div class="spinner"></div>
                                            <p>Loading tokens...</p>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <p style="font-size:12px; color: var(--color-text-muted); margin-top: var(--space-3);">
                    Tokens are user-owned and revoked by their owners on the API Access page. Force-revoke here for security incidents — deactivating the user's account also kills their tokens on the next request.
                </p>
            </main>
```

- [x] **Step 2: Extend `public/admin.js`**

Replace:

```js
// ── Initialization ────────────────────────────────────────────────────────────
```

with the API-token helpers plus the same comment:

```js
// ── API Tokens Oversight ──────────────────────────────────────────────────────
let adminTokens = [];
let adminTokenSearchQ = '';

function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(String(v).replace(' ', 'T'));
    return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadAdminTokens() {
    const tbody = document.getElementById('api-admin-tbody');
    const countEl = document.getElementById('api-admin-count');
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/api-tokens/admin/all');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const { tokens } = await res.json();
        adminTokens = tokens;
        const active = tokens.filter(t => !t.revokedAt).length;
        if (countEl) countEl.textContent = active + ' active / ' + tokens.length + ' total (last 500)';
        renderAdminTokens();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="8" style="color:var(--color-danger);">Failed to load tokens: ' + esc(err.message) + '</td></tr>';
        if (countEl) countEl.textContent = 'Failed to load';
    }
}

function renderAdminTokens() {
    const tbody = document.getElementById('api-admin-tbody');
    const q = adminTokenSearchQ.toLowerCase();
    const rows = adminTokens.filter(t =>
        !q || t.user_email.toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q)
    );
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="color:var(--color-text-muted); text-align:center; padding: var(--space-5);">No tokens match.</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(t => {
        const scopeBadge = t.readOnly ? '<span class="badge badge-info">Read-only</span>' : '<span class="badge badge-success">Full</span>';
        const status = t.revokedAt
            ? '<span class="badge badge-neutral">Revoked ' + esc(fmtDate(t.revokedAt)) + '</span>'
            : (t.expiresAt && new Date(String(t.expiresAt).replace(' ', 'T')).getTime() < Date.now()
                ? '<span class="badge badge-danger">Expired</span>'
                : '<span class="badge badge-success">Active</span>');
        const canRevoke = !t.revokedAt && (!t.expiresAt || new Date(String(t.expiresAt).replace(' ', 'T')).getTime() >= Date.now());
        return `<tr data-id="${esc(t.id)}" data-email="${esc(t.user_email)}">
            <td>${esc(t.name)}</td>
            <td>${esc(t.user_email)}</td>
            <td>${scopeBadge}</td>
            <td>${esc(fmtDate(t.createdAt))}</td>
            <td>${t.expiresAt ? esc(fmtDate(t.expiresAt)) : '<span class="badge badge-neutral">Never</span>'}</td>
            <td>${esc(fmtDate(t.lastUsedAt))}</td>
            <td>${status}</td>
            <td style="text-align:right;">
                <button class="btn btn-danger btn-sm api-admin-revoke" ${canRevoke ? '' : 'disabled'}>Force revoke</button>
            </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.api-admin-revoke').forEach(btn => {
        btn.addEventListener('click', async () => {
            const tr = btn.closest('tr');
            const id = tr.dataset.id;
            const email = tr.dataset.email;
            const name = tr.querySelector('td').textContent.trim();
            if (!confirm('Force-revoke token "' + name + '" owned by ' + email + '?')) return;
            const res = await window.StaffTrackAuth.apiFetch('/api/api-tokens/admin/' + id, { method: 'DELETE' });
            if (res.ok) {
                showToast('Token force-revoked');
                loadAdminTokens();
            } else {
                const data = await res.json().catch(() => ({}));
                showToast('Revoke failed: ' + (data.error || res.status), true);
            }
        });
    });
}

// ── Initialization ────────────────────────────────────────────────────────────
```

Then inside the existing `DOMContentLoaded` handler, after the `loadData();` line, insert:

```js
    loadAdminTokens();

    // API token search + refresh
    const apiAdminSearch = document.getElementById('api-admin-search');
    if (apiAdminSearch) {
        apiAdminSearch.addEventListener('input', e => {
            adminTokenSearchQ = e.target.value.trim();
            renderAdminTokens();
        });
    }
    const apiAdminRefresh = document.getElementById('api-admin-refresh');
    if (apiAdminRefresh) {
        apiAdminRefresh.addEventListener('click', loadAdminTokens);
    }
```

Anchor for that insertion: the block

```js
    loadData();

    // Roles Search
```

becomes

```js
    loadData();
    loadAdminTokens();

    // API token search + refresh
    const apiAdminSearch = document.getElementById('api-admin-search');
    if (apiAdminSearch) {
        apiAdminSearch.addEventListener('input', e => {
            adminTokenSearchQ = e.target.value.trim();
            renderAdminTokens();
        });
    }
    const apiAdminRefresh = document.getElementById('api-admin-refresh');
    if (apiAdminRefresh) {
        apiAdminRefresh.addEventListener('click', loadAdminTokens);
    }

    // Roles Search
```

- [x] **Step 3: Verify the page serves and the admin API responds**

Frontend-only change (no backend restart needed):

```bash
curl -s -o /dev/null -w 'admin.html -> %{http_code}\n' http://localhost:6082/admin.html
curl -s -o /dev/null -w 'admin.js -> %{http_code}\n' http://localhost:6082/admin.js
```
Expected: both `200`.

- [x] **Step 4: Commit**

```bash
git add public/admin.html public/admin.js
git commit -m "feat: admin API token oversight panel (org-wide list + force-revoke)"
```

---

### Task 9: Verification — review scripts (repo convention)

**Files:**
- Create: `review-api-tokens.cjs` (backend API lifecycle assertions)
- Create: `review-api-access-ui.cjs` (puppeteer/playwright UI + screenshots)

- [x] **Step 1: Write `review-api-tokens.cjs`**

```js
'use strict';
// review-api-tokens.cjs — live verification of the self-service API access backend:
// token lifecycle, read-only enforcement, live role/deactivation re-check, feeds
// (JSON+CSV+grammar), and admin oversight. Requires the local stack (localhost:6082).
// Usage: node review-api-tokens.cjs
const { execSync } = require('node:child_process');

const BASE = process.env.BASE || 'http://localhost:6082/api';
const ADMIN_PW = 'secure_admin_password';
const DB = 'docker compose exec -T db mysql -ustafftrack -pstafftrack_dev_password stafftrack -e';
const NAME = 'review-' + Date.now();

let failures = 0;
const assert = (cond, msg) => {
    if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('PASS:', msg);
};
const sql = (q) => execSync(`${DB} "${q.replace(/"/g, '\\"')}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

(async () => {
    // 0. Login
    const login = await fetch(BASE + '/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin', password: Buffer.from(ADMIN_PW).toString('base64') }),
    });
    assert(login.ok, 'admin login ' + login.status);
    const { access_token: token } = await login.json();
    const auth = { Authorization: 'Bearer ' + token };

    // 1. Create read-only token (lifecycle)
    const created = await fetch(BASE + '/api-tokens', {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: NAME + '-ro', expiresInDays: 30 }),
    });
    assert(created.status === 201, 'create token 201 (got ' + created.status + ')');
    const createdJson = await created.json();
    const secret = createdJson.token;
    assert(secret && secret.startsWith('st_') && secret.length === 46, 'secret has st_ prefix + 43 chars');
    assert(createdJson.readOnly === true, 'readOnly defaults to true');
    assert(!createdJson.token_hash && typeof createdJson.mask === 'string', 'no hash in response, mask present');
    const tokenAuth = { Authorization: 'Bearer ' + secret };

    // 2. List is masked
    const list = await (await fetch(BASE + '/api-tokens', { headers: auth })).json();
    const mine = list.tokens.find(t => t.id === createdJson.id);
    assert(mine && /^st_…[0-9a-f]{4}$/.test(mine.mask), 'list returns masked key only');
    assert(mine && !mine.token_hash, 'list never returns hashes');

    // 3. Read-only enforcement + feed grammar
    assert((await fetch(BASE + '/catalog/staff', { headers: tokenAuth })).status === 200, 'read-only token GET catalog 200');
    const roWrite = await fetch(BASE + '/admin/roles', { method: 'POST', headers: { ...tokenAuth, 'Content-Type': 'application/json' }, body: '{}' });
    assert(roWrite.status === 403, 'read-only token POST blocked 403 (got ' + roWrite.status + ')');
    const staffFeed = await fetch(BASE + '/feeds/staff?limit=3&filter[active]=1&sort=name&order=asc', { headers: tokenAuth });
    assert(staffFeed.status === 200, 'feeds/staff JSON 200');
    const feedJson = await staffFeed.json();
    assert(Array.isArray(feedJson.data) && feedJson.data.length <= 3 && feedJson.meta && typeof feedJson.meta.total === 'number', 'feed envelope { data, meta }');
    const csvRes = await fetch(BASE + '/feeds/staff?limit=3&format=csv', { headers: tokenAuth });
    const csvText = await csvRes.text();
    assert(csvRes.headers.get('content-type').includes('text/csv') && csvText.split('\n')[0].includes('email'), 'CSV export with header row');
    const badFilter = await fetch(BASE + '/feeds/staff?filter[bogus]=x', { headers: tokenAuth });
    const badBody = await badFilter.json();
    assert(badFilter.status === 400 && /Unsupported filter 'bogus'/.test(badBody.error), 'unknown filter rejected 400');
    const certDeny = await fetch(BASE + '/feeds/certifications', { headers: tokenAuth });
    assert(certDeny.status === 200, 'admin token: feeds/certifications 200');
    const summary = await fetch(BASE + '/feeds/summary', { headers: tokenAuth });
    assert(summary.status === 200, 'feeds/summary 200');

    // 4. Revoke own + dead token
    assert((await fetch(BASE + '/api-tokens/' + createdJson.id, { method: 'DELETE', headers: auth })).status === 200, 'revoke own token 200');
    assert((await fetch(BASE + '/catalog/staff', { headers: tokenAuth })).status === 401, 'revoked token rejected 401');

    // 5. Live deactivation check (token hash seeded via SQL for a dummy staff user)
    const DUMMY = NAME + '@example.test';
    sql(`INSERT INTO user_roles (email, role, is_active, created_at, updated_at) VALUES ('${DUMMY}', 'staff', 1, NOW(), NOW())`);
    const dSecret = execSync('node -e "import(\'/home/steelburn/staff-track/backend/src/utils/tokens.js\').then(t=>console.log(t.generateApiTokenSecret()))"').toString().trim();
    const dHash = execSync('node -e "import(\'/home/steelburn/staff-track/backend/src/utils/tokens.js\').then(t=>console.log(t.hashApiToken(process.argv[1])))" "' + dSecret + '"').toString().trim();
    sql(`INSERT INTO api_tokens (id, user_email, name, token_hash, read_only, created_at) VALUES (UUID(), '${DUMMY}', '${NAME}-deact', '${dHash}', 1, NOW())`);
    // active staff w/o staff row: /feeds/me -> 404 (auth PASSED, no record)
    assert((await fetch(BASE + '/feeds/me', { headers: { Authorization: 'Bearer ' + dSecret } })).status === 404,
        'active staff token passes auth (feeds/me -> 404 no staff row)');
    sql(`UPDATE user_roles SET is_active = 0 WHERE email = '${DUMMY}'`);
    assert((await fetch(BASE + '/feeds/me', { headers: { Authorization: 'Bearer ' + dSecret } })).status === 401,
        'deactivated user token dies on next request (401)');
    sql(`DELETE FROM api_tokens WHERE user_email = '${DUMMY}'; DELETE FROM user_roles WHERE email = '${DUMMY}';`);

    // 6. Admin oversight: full-access token + force revoke
    const createdFull = await fetch(BASE + '/api-tokens', {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: NAME + '-rw', readOnly: false }),
    });
    const fullJson = await createdFull.json();
    const fullAuth = { Authorization: 'Bearer ' + fullJson.token };
    assert((await fetch(BASE + '/catalog/staff', { headers: fullAuth })).status === 200, 'full token GET 200');
    const rwWrite = await fetch(BASE + '/admin/roles', { method: 'POST', headers: { ...fullAuth, 'Content-Type': 'application/json' }, body: '{}' });
    assert(rwWrite.status === 400, 'full token write passes auth gate (route-level 400 expected)');
    assert((await fetch(BASE + '/api-tokens', { headers: fullAuth })).status === 403, 'API token cannot manage tokens (403)');
    const adminAll = await (await fetch(BASE + '/api-tokens/admin/all', { headers: auth })).json();
    const foundFull = adminAll.tokens.find(t => t.id === fullJson.id);
    assert(foundFull && foundFull.readOnly === false, 'admin sees full token with scope flag');
    assert((await fetch(BASE + '/api-tokens/admin/' + fullJson.id, { method: 'DELETE', headers: auth })).status === 200, 'admin force-revoke 200');
    assert((await fetch(BASE + '/catalog/staff', { headers: fullAuth })).status === 401, 'force-revoked token rejected 401');

    // 7. Cleanup: no leftover review tokens
    // Soft revokes keep rows — count only ACTIVE leftovers.
    const leftover = sql(`SELECT COUNT(*) AS n FROM api_tokens WHERE revoked_at IS NULL AND (name LIKE '${NAME}%' OR user_email LIKE '${NAME}%')`).trim();
    assert(/n\s+0/.test(leftover), 'no leftover review tokens in api_tokens');

    console.log('\n' + (failures === 0 ? '✅ ALL PASS' : '❌ ' + failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
})().catch(err => { console.error('SCRIPT ERROR:', err); process.exit(1); });
```

- [x] **Step 2: Write `review-api-access-ui.cjs`**

```js
'use strict';
// review-api-access-ui.cjs — UI verification + screenshots for API Access feature.
// Targets the LOCAL stack (override with BASE=https://host).
// Usage: node review-api-access-ui.cjs
const { createRequire } = require('node:module');
const require2 = createRequire('/home/steelburn/development/teliti-team/teliti/package.json');
const { chromium } = require2('playwright-core');
const fs = require('node:fs');

const BASE = process.env.BASE || 'http://localhost:6082';
const ADMIN_PW = 'secure_admin_password';
const SHOTS = __dirname + '/review-shots';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const assert = (cond, msg) => {
    if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('PASS:', msg);
};

(async () => {
    const loginRes = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin', password: Buffer.from(ADMIN_PW).toString('base64') }),
    });
    if (!loginRes.ok) throw new Error('login failed: ' + loginRes.status);
    const { access_token: token } = await loginRes.json();
    const authHdr = { Authorization: 'Bearer ' + token };

    // Clean review-ui tokens left by previous runs (max 20 active per user)
    const mine = await (await fetch(BASE + '/api/api-tokens', { headers: authHdr })).json();
    for (const t of (mine.tokens || [])) {
        if ((t.name || '').startsWith('review-ui-')) {
            await fetch(BASE + '/api/api-tokens/' + t.id, { method: 'DELETE', headers: authHdr });
        }
    }

    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e).slice(0, 200)));
    page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url().replace(BASE, '')); });

    const injectUser = (tok, user) => page.addInitScript(({ tok, user }) => {
        sessionStorage.setItem('st_token', tok);
        sessionStorage.setItem('st_user', JSON.stringify(user));
        sessionStorage.setItem('st_token_expires_at', (Date.now() + 7 * 3600e3).toString());
    }, { tok, user });

    // ── 1. Admin: API Access page renders token list ─────────────────────
    await injectUser(token, { email: 'admin', name: 'Admin', isAdmin: true, is_hr: 1, is_coordinator: 1 });
    await page.goto(BASE + '/api-access.html', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => !document.querySelector('#api-token-tbody .spinner'), { timeout: 15000 });
    const hasTokensTable = await page.evaluate(() => !!document.querySelector('#api-token-tbody'));
    assert(hasTokensTable, 'admin API Access page loads tokens table');
    const navHasApi = await page.evaluate(() => [...document.querySelectorAll('#sidebar-nav .nav-item')].some(a => (a.textContent || '').includes('API Access')));
    assert(navHasApi, 'sidebar shows API Access nav item');
    const endpointOptions = await page.evaluate(() => [...document.querySelectorAll('#con-endpoint option')].map(o => o.textContent));
    assert(endpointOptions.length >= 6, 'console lists role-appropriate endpoints (' + endpointOptions.length + ')');
    await page.screenshot({ path: SHOTS + '/api-access-admin.png', fullPage: true });

    // ── 2. Create a token through the UI ──────────────────────────────────
    await page.fill('#tok-name', 'review-ui-' + Date.now());
    await page.click('#tok-create');
    await page.waitForSelector('#reveal-modal.active', { timeout: 10000 });
    const revealed = await page.inputValue('#reveal-secret');
    assert(revealed.startsWith('st_') && revealed.length === 46, 'reveal modal shows one-time secret');
    await page.screenshot({ path: SHOTS + '/api-access-reveal.png' });
    await page.click('#reveal-modal [data-close-modal]');
    await page.waitForTimeout(500);
    const rowCount = await page.evaluate(() => document.querySelectorAll('#api-token-tbody tr[data-id]').length);
    assert(rowCount >= 1, 'new token row appears in table');

    // ── 3. Console: run staff feed (JSON) ─────────────────────────────────
    await page.selectOption('#con-endpoint', 'feeds-staff');
    await page.fill('#con-fields', 'email,name,department');
    await page.selectOption('#con-sort', 'name');
    await page.fill('#con-limit', '5');
    await page.click('#con-add-filter');
    await page.selectOption('#con-filter-rows .flt-col', 'active');
    await page.fill('#con-filter-rows .flt-val', '1');
    await page.click('#con-run');
    await page.waitForFunction(() => {
        const el = document.getElementById('con-output');
        return el && el.style.display !== 'none' && el.textContent.includes('"data"');
    }, { timeout: 15000 });
    assert(true, 'console runs feeds/staff and shows JSON envelope');
    await page.screenshot({ path: SHOTS + '/api-access-console-json.png' });

    // ── 4. Console: CSV format ────────────────────────────────────────────
    await page.selectOption('#con-format', 'csv');
    await page.click('#con-run');
    await page.waitForFunction(() => {
        const el = document.getElementById('con-output');
        return el && el.style.display !== 'none' && /^email,/.test(el.textContent.trim());
    }, { timeout: 15000 });
    const dlVisible = await page.evaluate(() => getComputedStyle(document.getElementById('con-download')).display !== 'none');
    assert(dlVisible, 'CSV download button shown after CSV run');
    await page.screenshot({ path: SHOTS + '/api-access-console-csv.png' });

    // ── 5. Admin oversight panel ──────────────────────────────────────────
    await page.goto(BASE + '/admin.html', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForSelector('#api-admin-tbody tr[data-id]', { timeout: 15000 });
    assert(true, 'admin oversight lists tokens (org-wide)');
    await page.screenshot({ path: SHOTS + '/api-access-admin-oversight.png', fullPage: true });

    // ── 6. Plain-staff view (no subordinates) ─────────────────────────────
    await injectUser(token, { email: 'staff@example.test', name: 'Staff', isAdmin: false, is_hr: 0, is_coordinator: 0 });
    await page.goto(BASE + '/api-access.html', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1000);
    const staffEndpointOptions = await page.evaluate(() => [...document.querySelectorAll('#con-endpoint option')].map(o => o.textContent));
    assert(staffEndpointOptions.length === 1 && /feeds\/me/.test(staffEndpointOptions[0]), 'staff console shows only My record feed (' + staffEndpointOptions.join(' | ') + ')');
    await page.screenshot({ path: SHOTS + '/api-access-staff-view.png' });

    const hardErrors = errors.filter(e => !/401|403|404/.test(e));
    assert(hardErrors.length === 0, 'no console/page errors (got ' + hardErrors.length + ': ' + hardErrors.slice(0, 3).join(' | ') + ')');

    await browser.close();
    console.log('\nScreenshots in ' + SHOTS);
    console.log(failures === 0 ? '✅ ALL PASS' : '❌ ' + failures + ' FAILURE(S)');
    process.exit(failures === 0 ? 0 : 1);
})().catch(err => { console.error('SCRIPT ERROR:', err); process.exit(1); });
```

- [x] **Step 3: Run both review scripts**

```bash
cd /home/steelburn/staff-track && node review-api-tokens.cjs
node review-api-access-ui.cjs
```

Expected: every line starts with `PASS:` and both end with `✅ ALL PASS`. Inspect the screenshots in `review-shots/` (open `review-shots/api-access-admin.png` and `review-shots/api-access-admin-oversight.png`) to confirm the page matches the design (token table, console, badges).

If any assertion fails, fix the underlying code in the relevant earlier task file, restart the backend if backend code changed (`docker compose restart backend`), re-run the failing script, and commit the fix with a `fix:` message (e.g. `git commit -m "fix: feeds/staff scope clause when manager has no subordinates"`).

- [x] **Step 4: Commit the review scripts**

```bash
git add review-api-tokens.cjs review-api-access-ui.cjs
git commit -m "test: review scripts for API access (backend lifecycle + UI screenshots)"
```

---

### Task 10: Docs + final pass

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `README.md`

- [x] **Step 1: ROADMAP — mark the feature completed**

In `docs/ROADMAP.md`, immediately before the line `## Confirmed Prioritization`, insert:

```markdown
### 🔌 Self-Service API Access — ✅ COMPLETED (2026-09-04)

Personal, user-owned API tokens (`st_` secrets; SHA-256 hashes stored) unlock the
entire `/api` surface for any active user, scoped to their live UI role:

- **Personal tokens**: read-only by default, optional full-access at creation;
masked list, one-time secret reveal, self-revoke, optional expiry (default 90d).
- **Data Feeds API** (`/api/feeds/*`): read-only staff / projects / skills /
certifications / summary feeds with `fields`, `filter[col]`, `sort/order`,
`page/limit`, and JSON or CSV output. Admin/HR/coordinator = org-wide;
managers = subordinates (reuses `getUserSubordinates`); staff = self only.
- **Live re-check per request**: tokens resolve against `user_roles` on every
call, so deactivated/demoted users' tokens die on the next request.
- **UI**: `api-access.html` (token manager + runnable console + quick reference,
all roles) and an API Tokens oversight panel in `admin.html` (org-wide list,
last-used, force-revoke).
```

- [x] **Step 2: README — page list + features**

In `README.md`, after the line:

```
  - `certifications.html`: Organization-wide certification catalog (Admin/HR).
```

insert:

```
  - `api-access.html`: Personal API tokens, Data Feeds, and an API console (all roles).
```

- [x] **Step 3: Final regression pass**

Run:

```bash
cd /home/steelburn/staff-track
# 1. All migrations applied + backend healthy
docker compose ps --format '{{.Name}} {{.Status}}'
docker compose logs backend --tail 10 | grep -i 'error' || echo 'no backend errors'
# 2. Both review scripts green
node review-api-tokens.cjs && node review-api-access-ui.cjs
# 3. Session login + one pre-existing route untouched (JWT path)
TOKEN=$(curl -s -X POST http://localhost:6082/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin","password":"c2VjdXJlX2FkbWluX3Bhc3N3b3Jk"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).access_token")
curl -s -o /dev/null -w 'cv/session route (reports/my-subordinates) -> %{http_code}\n' http://localhost:6082/api/reports/my-subordinates -H "Authorization: Bearer $TOKEN"
# 4. Tree tidy: no temp files left
ls review-shots/ | head -5
```

Expected: stack healthy, no backend errors, both review scripts `ALL PASS`, `reports/my-subordinates -> 200`, screenshots present.

- [x] **Step 4: Commit docs**

```bash
git add docs/ROADMAP.md README.md
git commit -m "docs: roadmap + README for self-service API access"
```

- [x] **Step 5: Final commit + branch summary**

```bash
git status --short
git log --oneline -1
git push -u origin feat/api-access 2>/dev/null || echo 'no remote configured — branch is local'
```

Expected: clean `git status`, latest commit is the docs commit. (If no remote exists, the branch stays local — fine.)

---

## Definition of Done (whole feature)

- [x] `api_tokens` table migrated and indexed; no plaintext secrets anywhere in DB or logs.
- [x] Existing `/api/*` routes work with `st_` tokens — verified 200/403/401 matrix in `review-api-tokens.cjs`.
- [x] Read-only tokens blocked from writes; full-access tokens pass route-level role checks; tokens cannot mint tokens.
- [x] All 7 feeds endpoints return correct JSON envelope; CSV export works via `?format=csv` and `Accept: text/csv`.
- [x] Role scoping verified: admin org-wide, plain staff self-only (403 on org feeds), live deactivation kills tokens.
- [x] Audit rows written for create/revoke/admin-revoke/first-use/denied.
- [x] UI: nav entry for all roles, token manager, console, quick reference, admin oversight panel; screenshots reviewed.
- [x] Docs updated (ROADMAP + README).

