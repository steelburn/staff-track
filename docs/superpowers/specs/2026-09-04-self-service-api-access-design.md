# Self-Service API Access for Power Users — Design

**Date:** 2026-09-04
**Status:** Approved (brainstorming session, decisions recorded inline)
**Repo:** staff-track (StaffTrack — Express + MySQL backend, vanilla-JS pages served from `public/`, nginx strips `/api` prefix)

## 1. Goal

Give StaffTrack users a self-service, secure way to use the REST API programmatically:

1. **Personal API tokens** — any active user can mint, list, and revoke their own tokens and use them with `Authorization: Bearer st_…` in scripts/tools. Tokens **never exceed the user's own UI permissions** and are checked against the live `user_roles` row on every request.
2. **Data Feeds API** — a purpose-built, read-only surface (`/api/feeds/*`) with filters, sorting, pagination, and JSON/CSV export, designed for external tools/dashboards.
3. **Interactive console + docs** — a single "API Access" page (all logged-in users) with token management, a runnable endpoint explorer, and quick-reference docs.

## 2. Decisions (from brainstorming)

| # | Decision |
|---|----------|
| 1 | Any **active user** can mint tokens; tokens mirror exactly what their role/UI allows. |
| 2 | Token auth works on the **existing `/api/*` CRUD routes** AND a **new read-only Data Feeds API** is added. |
| 3 | Feeds export **JSON (default) and CSV** (`?format=csv` or Accept header). |
| 4 | Tokens are **read-only by default**; per-token opt-in "full" scope enables writes. Feeds endpoints are inherently read-only (GET only). |
| 5 | Token permissions are re-checked against **live `user_roles`** per request (demotion/deactivation kills tokens on the next request). Admin gets an **oversight panel** (list all tokens, force-revoke). |
| 6 | UI: **one page for everyone** — `api-access.html` (nav item visible to all logged-in users), role-aware rendering. Admin panel lives on `admin.html`. |
| 7 | Auth architecture: **opaque DB-backed tokens** (Option 1). Secret `st_` + 43 chars; only SHA-256 hash stored. Dispatch happens inside the existing `verifyToken` middleware — **no per-route edits** are needed for token support. |
| 8 | Rate limiting: light **in-memory** sliding window applied to `/feeds` + token endpoints only. Resets on restart — acceptable for internal tool. |
| 9 | Audit: real DB rows in existing `auth_audit_log` for token lifecycle events (create, revoke, admin-revoke, first use, denied attempts). |

## 3. Data model

Migration `backend/migrations/0014_create_api_tokens.sql`:

```sql
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- Secret never stored — only `SHA-256` hex (consistent with `auth_tokens` hashing in `auth.js`).
- Soft-revoke (`revoked_at`) so history is auditable.
- FK `ON DELETE CASCADE`: deleting a `user_roles` row removes their tokens.

## 4. Backend components

### 4.1 Leaf utilities — `backend/src/utils/tokens.js`, `utils/csv.js`, `utils/ratelimit.js`

- `tokens.js`: `generateApiTokenSecret()` → `st_` + 43 base64url chars (32 random bytes); `hashApiToken(secret)` → sha256 hex; `maskApiToken(secret)` → `st_…last4`.
- `csv.js`: `toCsv(rows, columns)` — flatten objects (nested arrays joined with `|`), RFC-4180-ish escaping.
- `ratelimit.js`: `rateLimit({ windowMs, max })` → Express middleware backed by an in-memory `Map<key, {count, resetAt}>`; prunes on access; returns `429 { error: 'Too many requests' }`.

### 4.2 Auth — `backend/src/routes/auth.js` (single choke point)

- Implement a **real DB-backed** `logAuthEvent(db, email, action, success, req)` (insert into `auth_audit_log` with uuid id, IP, UA) replacing the console-only stub — same signature, used by `/refresh`, `/logout`, and token events.
- Upgrade `verifyToken` to an async dual-path middleware:
  - Bearer token starts with `st_` → **API-token path**:
    1. `sha256(token)` → lookup `api_tokens` where `token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`.
    2. Join live `user_roles` for the token owner; require `is_active = 1`; 401 otherwise.
    3. Method gate: if `read_only = 1` and method not in `GET/HEAD/OPTIONS` → `403 { error: 'Read-only API token' }` + audit `api_token_denied`.
    4. Build `req.user = { email, isAdmin, is_hr, is_coordinator, role, tokenId, readOnly, authMode: 'api' }`.
    5. Throttled `last_used_at` update (≤1/min per token); audit `api_token_first_use` on first use.
  - Otherwise → existing JWT path (unchanged semantics). `req.user.authMode = 'jwt'` for those handlers that care.
- Because every existing route imports `verifyToken` and `requireRole` only reads `req.user` flags, **all existing routes become token-capable with zero route-file edits**. Read-only enforcement is central (method gate), so mutating routes need no `requireWrite` edits either.

### 4.3 Token management API — new `backend/src/routes/api-tokens.js` mounted at `/api-tokens`

Session-JWT only (tokens cannot mint or manage tokens):

| Route | Method | Access | Behavior |
|---|---|---|---|
| `/api-tokens` | POST | any active user (JWT session) | Create `{ name, readOnly=true, expiresInDays? }`. Rules: `name` required ≤100 chars; max **20 active** tokens/user; expiry optional. Returns `{ id, name, readOnly, expiresAt, token }` — secret shown **once**. |
| `/api-tokens` | GET | owner | Own active tokens, masked (`st_…abcd`) — never returns hashes or full secrets. |
| `/api-tokens/:id` | DELETE | owner | Soft-revoke own token. |
| `/api-tokens/admin/all` | GET | admin | All tokens (active + revoked) w/ owner email, scope, created, last used, expiry, revoked. |
| `/api-tokens/admin/:id` | DELETE | admin | Force-revoke any token. |

Audit actions: `api_token_created`, `api_token_revoked`, `api_token_admin_revoked`.

### 4.4 Data Feeds API — new `backend/src/routes/feeds.js` mounted at `/feeds`

Read-only (GET only). Every endpoint requires `verifyToken` (JWT session or any valid API token) and an explicit role gate mirroring the equivalent UI page.

| Endpoint | Scope | Notes |
|---|---|---|
| `GET /feeds/me` | any active user | own `staff` row + latest-submission skill/project counts + certification count (flat row, CSV-safe) |
| `GET /feeds/staff` | Admin/HR/Coordinator = org-wide; manager = direct+indirect subordinates | staff directory rows (flat) |
| `GET /feeds/staff/:email` | self; Admin/HR/Coordinator (anyone); manager (only if target in subordinate set) | single staff row |
| `GET /feeds/projects` | Admin/HR/Coordinator = org; manager = subordinate-scoped (by `coordinator_email`/assignment) | `managed_projects` rows + staff-assignment count |
| `GET /feeds/skills` | Admin/HR/Coordinator = org; manager = subordinates | per-person skill rows (flat: email, skill, rating) |
| `GET /feeds/certifications` | Admin/HR | certification rows + computed `status` (Valid / Expiring ≤90d / Expired) |
| `GET /feeds/summary` | Admin/HR/Coordinator = org; manager = subordinates | curated KPI counts (headcount, active, profile-updated %, skills, projects, certs, expiring) — flat single row |

**Scope resolution:** feeds reuse `getUserSubordinates(db, email)` — exported from `backend/src/routes/reports.js` (recursive CTE over `staff.manager_name`, direct + indirect). A helper `resolveFeedScope(db, user)` mirrors `resolveDashboardScope` in reports.js: full-access roles → `{ scope: 'all', emails: null }`; manager w/ subordinates → `{ scope: 'subordinates', emails }`; otherwise `{ scope: 'none' }` → 403 for org feeds.

**Query convention (shared helper `parseFeedQuery`):**
- `?fields=a,b` — column projection (allowlist per feed)
- `?filter[col]=value` equality, `?filter[col]=~value` substring LIKE — **allowlisted columns only**; unknown filter/sort/field → 400 listing allowed values
- `?sort=col&order=asc|desc` — allowlisted sort columns
- `?page=1&limit=50` — default 50, max 500
- `?format=csv` or `Accept: text/csv` — CSV response

**JSON envelope:** `{ data: [...], meta: { page, limit, total, returned } }`.
**CSV:** flat row-per-record (nested arrays joined `|`), `Content-Disposition: attachment; filename="<feed>-p<page>.csv"`.

### 4.5 Wiring — `backend/src/index.js`

Mount `apiTokensRouter` at `/api-tokens` and `feedsRouter` at `/feeds`. `verifyToken` upgrade needs no other changes.

## 5. Frontend

### 5.1 `public/api-access.html` + `public/api-access.js` — nav item 🔌 "API Access" (all logged-in users)

Page shell mirrors `admin.html` (sidebar layout, theme toggle, page header). Three sections:

1. **My Tokens** — create form: token name (input), scope radio (Read-only default / Full access), expiry select (30 / 90 / 365 days / No expiry; default 90). Active-token table: name, scope badge, created, expires, last used, masked key. Actions per row: copy cURL, revoke (confirm). One-time reveal modal on create showing the full secret + Copy button + "store it now" warning.
2. **API Console** — grouped endpoint catalog built from a client-side `ENDPOINTS` array (method, path, access tag, params). Cards filtered by the user's role + token scope (read-only hides write methods). Selecting an endpoint shows a param builder (query params for GET; body editor hidden for read-only) → **Run** → response viewer (status, pretty JSON or CSV preview, download button, copy cURL).
3. **Quick reference** — auth header snippet, cURL/PowerShell examples, feed query grammar table, error code table, rate-limit note.

### 5.2 Admin oversight — `public/admin.html` + `public/admin.js`

New section below "User Permissions": **"API Tokens (org-wide)"** table — owner email, name, scope, created, last used, expires, status + Force-revoke button (confirm). Loads via `GET /api/api-tokens/admin/all`.

### 5.3 Navigation

- `public/sidebar.js` `render()`: add `renderNavItem('🔌', 'API Access', '/api-access.html', activeTab === 'api-access')` in the Main section (visible to everyone).
- `public/menu.js` legacy `renderNav()`: add the matching link in the common area (pages that still use `#main-nav`).

## 6. Error codes (documented in quick reference)

| Status | Meaning |
|---|---|
| 401 | Missing/invalid token; revoked/expired token; owner deactivated |
| 403 | Read-only token on a write method; role gate denied |
| 404 | Unknown endpoint / record |
| 400 | Bad query (unknown filter/field, invalid limit) |
| 429 | Rate limited |

## 7. Security posture

- Secret shown once at creation; only SHA-256 hash stored; never logged.
- Read-only by default; write requires explicit opt-in at creation.
- Live role + `is_active` re-check per request → demote/deactivate = instant kill.
- FK cascade removes tokens when a `user_roles` row is deleted.
- Soft-revoke retained for audit; admin force-revoke; full audit trail (`auth_audit_log`).
- In-memory rate limiting on `/feeds` and `/api-tokens` (300 req/min/token, 60 req/min/IP on failures; resets on restart — documented limitation).
- Max 20 active tokens per user.

## 8. Out of scope (explicit)

- Long-lived JWT PATs / denylists (Option 2 rejected).
- CSV export beyond the feeds (existing report exports unchanged).
- Per-endpoint fine-grained scopes (only the single read-only/full axis).
- Token rotation/refresh of API tokens (revoke + re-mint is the flow).
- HTTPS — already handled by nginx/proxy layer outside this feature.

## 9. Verification plan (repo conventions — script-based, no unit framework)

- `review-api-tokens.cjs` — API flow tests against a running stack: mint → masked list → use on GET → read-only write → 403 → write-enabled token write on a permitted route → revoke → dead → deactivate owner → dead → feeds filters/pagination/CSV → admin panel list + force-revoke → rate limit 429.
- `review-api-access-ui.cjs` — puppeteer screenshots of `api-access.html` (token list, console run, create-token reveal) light + dark.
- Backend restarts via `docker compose restart backend` (backend source is volume-mounted).

## 10. Files touched

- Create: `backend/migrations/0014_create_api_tokens.sql`, `backend/src/utils/tokens.js`, `backend/src/utils/csv.js`, `backend/src/utils/ratelimit.js`, `backend/src/routes/api-tokens.js`, `backend/src/routes/feeds.js`, `public/api-access.html`, `public/api-access.js`, `review-api-tokens.cjs`, `review-api-access-ui.cjs`
- Modify: `backend/src/routes/auth.js`, `backend/src/routes/reports.js` (export `getUserSubordinates` only), `backend/src/index.js`, `public/sidebar.js`, `public/menu.js`, `public/admin.html`, `public/admin.js`, `docs/ROADMAP.md`, `README.md` (brief)
