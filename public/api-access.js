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

// ── Help & Guide (single source — injected into the inline section AND the
//    ❓ Help overlay modal, so both stay identical) ─────────────────────────────
const HELP_GUIDE_HTML = `
<div class="help-guide">
    <div class="help-quickstart">
        <p><b>Quick start</b></p>
        <ul>
            <li><b>1 · Create</b> a token below — name it after the job (e.g. “Nightly BI sync”). Read-only is the safe default; pick an expiry (90&nbsp;days recommended).</li>
            <li><b>2 · Copy the secret immediately</b> — it is shown <b>once</b> and never stored. Anyone holding it can act as you.</li>
            <li><b>3 · Call the API</b> with the token in the <code>Authorization</code> header:</li>
        </ul>
        <pre>curl -H "Authorization: Bearer st_…" "https://your-host/api/feeds/me"</pre>
        <p style="margin-bottom:0;">Full reference below, organised by topic. The same guide opens as an overlay any time via the <b>❓ Help</b> button (top-right).</p>
    </div>
    <div class="api-docs-banner">
        <span style="font-size:18px; line-height:1;">🤖</span>
        <span><b>Building a client?</b> Machine-readable reference — <code>https://your-host/api-docs.json</code> is an <b>OpenAPI 3.0</b> document describing every endpoint, parameter, schema and example on this page (same catalog the console lists). Tools, scripts and AI agents can fetch it directly to generate interfaces — see also the <b>📖 API Docs</b> button at the top of this page.</span>
    </div>

    <details>
        <summary>1 · How tokens work</summary>
        <div class="help-body">
            <p>An <b>API token</b> is a personal, user-owned credential tied to <b>your</b> account. It acts as you on the API — never wider than what your live UI role can do.</p>
            <ul>
                <li><b>Secret format:</b> <code>st_</code> followed by 43 random characters (46 total). Only a <b>SHA-256 hash</b> is stored server-side, so even a database leak cannot recover usable tokens.</li>
                <li><b>Shown once:</b> the plaintext secret is returned only at creation (and shown in the reveal dialog). It can never be viewed again — rotate (revoke + create) if you lose it.</li>
                <li><b>List display:</b> your token list shows a masked key (e.g. <code>st_…9f3a</code>) plus name, scope, created/expiry/last-used dates.</li>
                <li><b>Limit:</b> up to <b>20 active tokens</b> per user. Revoke one to free a slot.</li>
                <li><b>Expiry:</b> you choose 30 / 90 / 180 / 365 days or “Never”. Expired tokens are rejected with <code>401</code>. Shorter is safer — pick the shortest lifetime that fits the job.</li>
                <li><b>Live role re-check:</b> every request resolves your token against <code>user_roles</code> <i>at that moment</i>. If your account is deactivated or demoted, existing tokens stop working on the next request (401). If you're promoted, tokens widen automatically.</li>
                <li><b>Tokens cannot manage tokens:</b> creating, listing or revoking tokens requires an interactive browser session. A stolen token therefore can't mint more tokens.</li>
                <li><b>Audit:</b> creation, revocation, admin force-revokes, first use, and denied attempts are recorded in the platform audit trail.</li>
            </ul>
        </div>
    </details>

    <details>
        <summary>2 · Read-only vs Full access</summary>
        <div class="help-body">
            <table>
                <tr><th></th><th>Read-only <span class="badge badge-info">default</span></th><th>Full access</th></tr>
                <tr><td><b>Allowed</b></td><td><code>GET</code> / <code>HEAD</code> / <code>OPTIONS</code> on every endpoint your role can reach</td><td>Everything read-only allows, <b>plus</b> the write operations (<code>POST</code> / <code>PUT</code> / <code>DELETE</code> / <code>PATCH</code>) your role permits on those endpoints</td></tr>
                <tr><td><b>Write attempt</b></td><td>Rejected centrally with <code>403 “Read-only API token cannot perform this request”</code></td><td>Passes the auth gate; the route still applies its own role checks</td></tr>
                <tr><td><b>Data feeds</b></td><td colspan="2">Always read-only, for every token</td></tr>
                <tr><td><b>Token management</b></td><td colspan="2">Never allowed for API tokens (403) — browser session only</td></tr>
            </table>
            <p>Choose <b>Read-only</b> unless an automation genuinely needs to write. A full-access token should be guarded like a password — anyone holding it can create data as you.</p>
        </div>
    </details>

    <details>
        <summary>3 · What can your tokens access?</summary>
        <div class="help-body">
            <p>Feed scope is decided by your <b>live</b> role — the console on this page only lists endpoints your role can actually use:</p>
            <table>
                <tr><th>Your role</th><th>Data Feed scope</th><th>Extra endpoints</th></tr>
                <tr><td>Admin</td><td>Org-wide — all feeds (<code>/feeds/me</code>, <code>staff</code>, <code>projects</code>, <code>skills</code>, <code>summary</code>)</td><td><code>/feeds/certifications</code>, staff catalog, CV endpoints for any staff (§6), and every write your UI role allows</td></tr>
                <tr><td>HR</td><td>Org-wide — all feeds</td><td><code>/feeds/certifications</code>, staff catalog, CV endpoints for any staff (§6), role writes</td></tr>
                <tr><td>Coordinator</td><td>Org-wide — staff / projects / skills / summary feeds</td><td>Dashboard-style reports for managed staff, read-only CV endpoints (§6)</td></tr>
                <tr><td>Manager (has reports, no full access)</td><td>The same feeds, but <b>scoped to your direct + indirect reports only</b></td><td>Read-only CV endpoints (§6) — view access like the CV page</td></tr>
                <tr><td>Staff (no reports)</td><td><code>/feeds/me</code> — your own directory record only</td><td>Read-only CV endpoints for your own record (§6)</td></tr>
            </table>
            <p>Notes:</p>
            <ul>
                <li>Requesting a record outside your scope returns <code>403</code>.</li>
                <li>If your account has <b>no staff-directory record</b> (some admin/HR logins), <code>/feeds/me</code> returns <code>404 “No staff record for this account”</code> — that's expected; use the org-wide feeds instead.</li>
                <li>Admins see org-wide token metadata (never secrets) and can force-revoke any token on <b>Admin → API Tokens Oversight</b>.</li>
            </ul>
        </div>
    </details>

    <details>
        <summary>4 · Authenticating & making requests</summary>
        <div class="help-body">
            <p>Send the token in the <code>Authorization</code> header on every request. Host: <code>https://your-host</code> (the same origin you use in the browser).</p>
            <p><b>cURL — JSON list:</b></p>
            <pre>curl -H "Authorization: Bearer st_…" "https://your-host/api/feeds/staff?limit=10"</pre>
            <p><b>cURL — CSV download</b> (the API sends it as an attachment, so <code>-OJ</code> saves it using the server's filename):</p>
            <pre>curl -OJ -H "Authorization: Bearer st_…" "https://your-host/api/feeds/staff?limit=10&amp;format=csv"</pre>
            <p><b>Python (requests):</b></p>
            <pre>import requests

TOKEN = "st_…"  # keep out of source control — use an env var / secret store
r = requests.get(
    "https://your-host/api/feeds/staff",
    params={"limit": 100, "filter[department]": "Engineering"},
    headers={"Authorization": f"Bearer {TOKEN}"},
)
r.raise_for_status()
print(r.json()["data"])</pre>
            <p><b>Node.js (global fetch):</b></p>
            <pre>const TOKEN = process.env.STAFFTRACK_TOKEN; // never hard-code
const res = await fetch("https://your-host/api/feeds/staff?limit=100", {
    headers: { Authorization: "Bearer " + TOKEN },
});
if (!res.ok) throw new Error("HTTP " + res.status + ": " + (await res.text()));
const { data, meta } = await res.json();</pre>
            <p><b>Power BI / Power Query (M):</b></p>
            <pre>let
    Source = Json.Document(Web.Contents(
        "https://your-host/api/feeds/staff?limit=100",
        [Headers = [Authorization = "Bearer st_…"]]
    )),
    Rows = Table.FromRecords(Source[data])
in
    Rows</pre>
            <p><b>Machine-readable reference:</b> <code>https://your-host/api-docs.json</code> (OpenAPI 3.0 — see the 🤖 banner at the top of this guide).</p>
            <p>Tips:</p>
            <ul>
                <li>Want CSV? Ask with <code>?format=csv</code> or the <code>Accept: text/csv</code> header.</li>
                <li>Test a token first in the <b>🧪 API Console</b> (set “Authenticate as → API token” and paste it), then hit <b>Copy cURL</b> to get a ready-made command.</li>
                <li>Anything outside your role — or a revoked/expired/deactivated token — fails with <code>401</code> / <code>403</code>, never with fake data.</li>
            </ul>
        </div>
    </details>

    <details>
        <summary>5 · Data Feeds API reference</summary>
        <div class="help-body">
            <p>Feeds are <b>read-only</b>, <code>GET</code>-only endpoints returning either a JSON envelope or a CSV attachment:</p>
            <pre>{
  "data": [ { "email": "jane@example.com", "name": "Jane …", "department": "…" } ],
  "meta": { "page": 1, "limit": 50, "total": 128, "returned": 50 }
}</pre>
            <table>
                <tr><th>Param</th><th>Meaning</th><th>Example</th></tr>
                <tr><td><code>fields</code></td><td>Comma list of columns to return (whitelisted per feed). Empty = defaults.</td><td><code>fields=email,name,department</code></td></tr>
                <tr><td><code>filter[col]</code></td><td>Exact match on an allowed column</td><td><code>filter[department]=Engineering</code></td></tr>
                <tr><td><code>filter[col]=~text</code></td><td>Case-insensitive “contains” search</td><td><code>filter[name]=~john</code></td></tr>
                <tr><td><code>sort</code> + <code>order</code></td><td>Sort by an allowed column, <code>asc</code> or <code>desc</code></td><td><code>sort=name&amp;order=desc</code></td></tr>
                <tr><td><code>page</code> + <code>limit</code></td><td>Pagination: page ≥ 1, limit 1–500 (default 50)</td><td><code>page=2&amp;limit=100</code></td></tr>
                <tr><td><code>format</code></td><td><code>csv</code> returns an attachment — or send <code>Accept: text/csv</code></td><td><code>format=csv</code></td></tr>
            </table>
            <p>Allowed columns per feed (an unsupported one → <code>400</code>, with the allowed list in the message):</p>
            <table>
                <tr><th>Feed</th><th>Filterable</th><th>Sortable</th></tr>
                <tbody data-guide="feed-cols"></tbody>
            </table>
            <p>CSV responses respect <code>fields</code> and the same filters; quoted per RFC-4180, with a <code>Content-Disposition</code> attachment filename (e.g. <code>staff.csv</code>).</p>
        </div>
    </details>

    <details>
        <summary>6 · Staff data & CV endpoints (profile bundle)</summary>
        <div class="help-body">
            <p>Feeds return directory-style rows. When you need <b>one person's full record</b> — the data behind a CV — use the CV-profile endpoints. They serve the same comprehensive bundle the CV generator reads, so Admin/HR can pull everything needed to produce a CV for a staff member in a <b>single call</b>:</p>
            <pre>curl -H "Authorization: Bearer st_…" "https://your-host/api/cv-profiles/jane@example.com"</pre>
            <p>Response — the complete profile bundle (date fields are <code>YYYY-MM-DD</code>; sections are <code>[]</code> until the person records them):</p>
            <pre>{
  "profile":        { "summary": "…", "phone": "…", "linkedin": "…", "location": "…", "photo_path": "…" },
  "education":      [ { "institution": "…", "degree": "…", "field": "…", "start_year": 2018, "end_year": 2022, "description": "…" } ],
  "certifications": [ { "name": "…", "issuer": "…", "date_obtained": "2024-03-01", "expiry_date": "2027-03-01", "credential_id": "…" } ],
  "awards":         [ { "title": "…", "issuer": "…", "date_received": "2023-11-01", "description": "…" } ],
  "workHistory":    [ { "employer": "…", "job_title": "…", "start_date": "2021-06-01", "end_date": "2023-05-31", "is_current": 1 } ],
  "pastProjects":   [ { "project_name": "…", "role": "…", "technologies": "…", "start_date": "2022-01-01", "end_date": "2022-12-31" } ]
}</pre>
            <table>
                <tr><th>Endpoint</th><th>Returns</th></tr>
                <tbody data-guide="cv-endpoints"></tbody>
            </table>
            <p><b>Access notes</b> (same access as the CV page):</p>
            <ul>
                <li>You can always read <b>your own</b> record; signed-in users get the read-only “view” of other staff profiles, which is what lets Admin/HR prepare and generate CVs for any staff member.</li>
                <li>The <code>GET</code> endpoints work with <b>read-only</b> tokens: three return JSON (profile bundle, snapshots list, audit trail) and the certifications bundle returns a <b>ZIP download</b> of proof documents (<code>Content-Type: application/zip</code>).</li>
                <li><code>generate</code> is a <b>write</b> — read-only tokens are rejected with <code>403</code>; full-access tokens can call it. In the UI, generating CVs for other staff is exposed to Admin/HR.</li>
                <li><code>audit</code> is extra-restricted: the profile owner, Admin, HR, and Coordinators only — anyone else gets <code>403</code>.</li>
            </ul>
        </div>
    </details>

    <details>
        <summary>7 · Status codes & errors</summary>
        <div class="help-body">
            <table>
                <tr><th>Code</th><th>Meaning</th><th>What to do</th></tr>
                <tr><td><code>200</code></td><td>OK (feeds also use 200 for empty results)</td><td>—</td></tr>
                <tr><td><code>201</code></td><td>Created (e.g. token created — the one-time secret is in the body)</td><td>Copy and store it now</td></tr>
                <tr><td><code>400</code></td><td>Bad request — an unsupported filter/sort column, invalid <code>limit</code>, bad JSON body…</td><td>The error message names the offending parameter (e.g. “Unsupported filter 'x'. Allowed: …”)</td></tr>
                <tr><td><code>401</code></td><td>Missing, invalid, expired, revoked token — or a deactivated account</td><td>Check the header; create a fresh token</td></tr>
                <tr><td><code>403</code></td><td>Read-only token on a write, token-management via an API token, or a record outside your role's scope</td><td>Use a full-access token (writes) / browser session (token mgmt) / an in-scope record</td></tr>
                <tr><td><code>404</code></td><td>Unknown route, or <code>/feeds/me</code> when your account has no staff-directory record</td><td>Expected in the no-record case — use org feeds</td></tr>
                <tr><td><code>429</code></td><td>Too many requests from your client in a short window</td><td>Back off and retry; the API sets a <code>Retry-After</code> header</td></tr>
                <tr><td><code>500</code></td><td>Server-side failure</td><td>Wait, retry; contact support if it persists</td></tr>
            </table>
        </div>
    </details>

    <details>
        <summary>8 · Security best practices</summary>
        <div class="help-body">
            <ul>
                <li><b>Treat tokens like passwords.</b> Anyone with the secret can act as you up to your role's power.</li>
                <li><b>Least privilege:</b> keep read-only unless a job genuinely writes. You can always create a second, full-access token later.</li>
                <li><b>Short lifetimes:</b> pick the shortest expiry that fits. Rotate quarterly for long-running integrations.</li>
                <li><b>Store safely:</b> use an environment variable or a secret manager — never commit tokens to source control, dashboards, chat or tickets.</li>
                <li><b>Name tokens by purpose</b> (e.g. “Power BI refresh”) so the audit trail and the token list are easy to read.</li>
                <li><b>Suspect a leak?</b> Revoke immediately from this page. Admins can force-revoke org-wide from Admin → API Tokens Oversight, and deactivating the owning account kills its tokens on the next request.</li>
                <li><b>Remember:</b> a token is only as safe as your account — enable every protection your account offers.</li>
            </ul>
        </div>
    </details>

    <details>
        <summary>9 · Troubleshooting & FAQ</summary>
        <div class="help-body">
            <ul>
                <li><b>I get 401 immediately.</b> The token is wrong, expired, revoked, or the account was deactivated. Create a new one and update your script.</li>
                <li><b>I lost the secret.</b> Irrecoverable by design (only a hash is stored). Revoke and create a replacement; update the consumer.</li>
                <li><b>My revoked token still appears somewhere.</b> Your own list only shows active tokens (revoked ones disappear). Admins see history, with a “Revoked” status, on the Admin oversight panel.</li>
                <li><b>403 on a feed.</b> Either a read-only token tried a write, or the requested record is outside your scope (managers see only their team).</li>
                <li><b>404 on “My record”.</b> Your account has no staff-directory row — normal for some admin/HR logins. Use the org-wide feeds.</li>
                <li><b>How do I read one person's full data (e.g. to prepare or generate a CV)?</b> <code>GET /api/cv-profiles/{email}</code> returns the complete profile bundle — see section 6 for the endpoints, a sample response, and who may read each.</li>
                <li><b>Can a token create other tokens?</b> No — token management is browser-session only (403). This contains blast radius.</li>
                <li><b>“Unsupported filter” / “Unknown sort” (400).</b> The column isn't whitelisted for that feed — see the reference table in section 5.</li>
                <li><b>CSV output looks odd?</b> It's standard RFC-4180 (commas, quotes, newlines escaped). Open it in a spreadsheet or a CSV parser.</li>
                <li><b>What happens to my tokens if I leave the company?</b> The account deactivation check runs on every request — tokens stop returning 401 right away.</li>
                <li><b>Can an admin see my secret?</b> No. Only the SHA-256 hash exists server-side; oversight shows metadata (name, user, scope, dates, status).</li>
            </ul>
        </div>
    </details>
</div>
`;

// ── Endpoint catalog ───────────────────────────────────────────────────────────
// Single source of truth: the console dropdown, the guide's feed-column table
// (§5) and the guide's CV-endpoint table (§6) are ALL generated from ENDPOINTS,
// so docs and console can never drift. Add an endpoint here and it appears
// everywhere (console + both guide tables) automatically.
// roles: all | full | admin | hr | manager (manager = has subordinates or full)
// kind: feed (filterable/sortable paginated) | cv (path param + optional POST body) | simple
// doc: one-line “Returns” used by the guide §6 table.
const ENDPOINTS = [
    { id: 'feeds-me', label: 'My record — /api/feeds/me', method: 'GET', path: '/api/feeds/me', roles: 'all', kind: 'feed', filterable: [], sortable: [], feedDefaultSort: '', feedNote: 'Your own record — single object, not paginated/filterable' },
    { id: 'feeds-staff', label: 'Staff directory — /api/feeds/staff', method: 'GET', path: '/api/feeds/staff', roles: 'full,manager', kind: 'feed', filterable: ['department', 'manager_name', 'active'], filterCols: ['department', 'manager_name', 'active (1/0)'], sortable: ['name', 'email', 'department'], feedDefaultSort: 'name' },
    { id: 'feeds-projects', label: 'Projects — /api/feeds/projects', method: 'GET', path: '/api/feeds/projects', roles: 'full,manager', kind: 'feed', filterable: ['customer', 'soc', 'project_name'], sortable: ['project_name', 'customer', 'soc', 'end_date'], feedDefaultSort: 'project_name' },
    { id: 'feeds-skills', label: 'Skills (latest per person) — /api/feeds/skills', method: 'GET', path: '/api/feeds/skills', roles: 'full,manager', kind: 'feed', filterable: ['skill'], sortable: ['skill', 'email', 'rating'], feedDefaultSort: 'skill' },
    { id: 'feeds-certs', label: 'Certifications — /api/feeds/certifications', method: 'GET', path: '/api/feeds/certifications', roles: 'admin,hr', kind: 'feed', filterable: ['email', 'name', 'issuer', 'status'], sortable: ['email', 'name', 'issuer', 'expiry_date'], feedDefaultSort: 'email' },
    { id: 'feeds-summary', label: 'Org summary KPIs — /api/feeds/summary', method: 'GET', path: '/api/feeds/summary', roles: 'full,manager', kind: 'feed', filterable: [], sortable: [], feedDefaultSort: '', feedNote: 'Org summary KPIs — single aggregate object' },
    { id: 'reports-mine', label: 'My subordinates — /api/reports/my-subordinates', method: 'GET', path: '/api/reports/my-subordinates', roles: 'manager', kind: 'simple' },
    { id: 'catalog-staff', label: 'Staff catalog — /api/catalog/staff', method: 'GET', path: '/api/catalog/staff', roles: 'admin,hr', kind: 'simple' },
    // ── CV-profile endpoints (guide §6) — {email} is filled in by the console ──
    { id: 'cv-profile', label: 'Staff CV profile bundle — /api/cv-profiles/{email}', method: 'GET', path: '/api/cv-profiles/{email}', roles: 'all', kind: 'cv', doc: 'The comprehensive profile bundle — profile, education, certifications, awards, work history, past projects (see guide §6 for the response shape).' },
    { id: 'cv-snapshots', label: 'CV snapshots — /api/cv-profiles/{email}/snapshots', method: 'GET', path: '/api/cv-profiles/{email}/snapshots', roles: 'all', kind: 'cv', doc: 'Previously generated CVs — template data + HTML, who generated it, created date; newest first.' },
    { id: 'cv-certs-bundle', label: 'Certifications bundle — /api/cv-profiles/{email}/certifications/bundle', method: 'GET', path: '/api/cv-profiles/{email}/certifications/bundle', roles: 'all', kind: 'cv', doc: 'Downloads the person\'s certification proof documents as a ZIP attachment (certificates_<staff>.zip) — binary, not JSON. 404 when there are no proofs.' },
    { id: 'cv-audit', label: 'Profile audit trail — /api/cv-profiles/{email}/audit', method: 'GET', path: '/api/cv-profiles/{email}/audit', roles: 'all', kind: 'cv', doc: 'Profile change history — section, action, actor, timestamp (newest first). Your own is always readable; someone else’s needs Admin/HR/Coordinator (403 otherwise).' },
    { id: 'cv-generate', label: 'Generate CV — POST /api/cv-profiles/{email}/generate', method: 'POST', path: '/api/cv-profiles/{email}/generate', roles: 'admin,hr', kind: 'cv', bodyExample: '{ "template_id": "classic" }', doc: 'Generate (or regenerate) a CV from a template — returns the rendered HTML + template name. Persisting is a separate step: POST {email}/snapshots with the HTML (or the Save action on the CV page). A write: read-only tokens get 403.' },
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

// ── Guide tables — generated from ENDPOINTS so the docs can never drift from
//    the console catalog (both guide copies — inline + ❓ modal — get filled) ──
function buildGuideTables() {
    const col = arr => (arr && arr.length) ? arr.map(c => '<code>' + esc(c) + '</code>').join(', ') : '';
    const feedRows = ENDPOINTS.filter(e => e.kind === 'feed').map(ep => {
        const pathCell = '<code>' + ep.path.replace(/^\/api/, '') + '</code>';
        if (ep.feedNote) return '<tr><td>' + pathCell + '</td><td colspan="2">' + ep.feedNote + '</td></tr>';
        const filterCols = ep.filterCols || ep.filterable || [];
        return '<tr><td>' + pathCell + '</td><td>' + col(filterCols) + '</td><td>' + col(ep.sortable || []) + '</td></tr>';
    }).join('');
    const cvRows = ENDPOINTS.filter(e => e.kind === 'cv').map(ep =>
        '<tr><td><code>' + esc(ep.method + ' ' + ep.path) + '</code></td><td>' + esc(ep.doc || '') + '</td></tr>'
    ).join('');
    document.querySelectorAll('[data-guide="feed-cols"]').forEach(tb => { tb.innerHTML = feedRows; });
    document.querySelectorAll('[data-guide="cv-endpoints"]').forEach(tb => { tb.innerHTML = cvRows; });
}

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

// Resolve {param} placeholders (e.g. {email}) from the console's path-param
// input. Blank = the signed-in user's own record (matches guide §6 access notes).
function effectivePath(ep, forPreview) {
    if (!ep.path.includes('{')) return ep.path;
    const raw = (document.getElementById('con-param-val')?.value || '').trim()
        || ((authUser && authUser.email) || '');
    return ep.path.replace(/\{(\w+)\}/g, () => forPreview ? raw : encodeURIComponent(raw));
}

function onEndpointChange(ep) {
    activeEndpoint = ep;
    const feedBox = document.getElementById('con-feed-controls');
    feedBox.style.display = ep.kind === 'feed' ? '' : 'none';
    const cvBox = document.getElementById('con-cv-controls');
    if (cvBox) {
        cvBox.style.display = ep.kind === 'cv' ? '' : 'none';
        if (ep.kind === 'cv') {
            const pv = document.getElementById('con-param-val');
            if (pv) { pv.value = ''; pv.placeholder = 'jane@example.com'; }
            const pl = document.getElementById('con-param-label');
            if (pl) pl.textContent = 'Staff email';
            const ph = document.getElementById('con-param-hint');
            if (ph) ph.title = {
                'cv-audit': 'Who to audit — your own is always readable; someone else’s requires Admin/HR/Coordinator.',
                'cv-generate': 'Who the CV is for — blank = yourself. Generating for other staff is an Admin/HR action.',
            }[ep.id] || 'The staff member — leave blank for your own record.';
            const bodyBox = document.getElementById('con-body-controls');
            if (bodyBox) bodyBox.style.display = ep.method === 'POST' ? '' : 'none';
            const bv = document.getElementById('con-body-val');
            if (bv) bv.value = ep.bodyExample || '';
        }
    }
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
    const qs = activeEndpoint.kind === 'feed' ? currentQuery() : '';
    urlEl.textContent = activeEndpoint.method + ' ' + effectivePath(activeEndpoint, true) + (qs ? '?' + qs : '');
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

    const qs = ep.kind === 'feed' ? currentQuery() : '';
    const url = effectivePath(ep, false) + (qs ? '?' + qs : '');
    const headers = {};
    if (authMode === 'token') {
        if (!pasted) { toast('Paste an API token first', true); return; }
        headers['Authorization'] = 'Bearer ' + pasted;
    }
    const wantsCsv = ep.kind === 'feed' && format === 'csv'; // CSV is feeds-only (guide §5)
    headers['Accept'] = wantsCsv ? 'text/csv' : 'application/json';
    const opts = { method: ep.method || 'GET', headers };
    let bodyRaw = '';
    if (ep.method === 'POST') {
        bodyRaw = (document.getElementById('con-body-val')?.value || '').trim();
        try { JSON.parse(bodyRaw); } catch { toast('JSON body is not valid', true); return; }
        headers['Content-Type'] = 'application/json';
        opts.body = bodyRaw;
    }

    status.textContent = 'Sending ' + opts.method + ' ' + url + ' …';
    output.style.display = 'none';
    download.style.display = 'none';
    copyCurl.disabled = true;
    const btn = document.getElementById('con-run');
    btn.disabled = true;
    try {
        const res = authMode === 'session'
            ? await window.StaffTrackAuth.apiFetch(url, opts)
            : await fetch(url, opts);
        const ctype = res.headers.get('content-type') || '';
        status.textContent = opts.method + ' ' + url + ' → ' + res.status + ' ' + res.statusText;
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
        } else if (ctype.includes('application/zip') || ctype.includes('application/octet-stream')) {
            // Binary download (e.g. the CV certifications bundle) — offer a save.
            const blob = await res.blob();
            const name = (res.headers.get('content-disposition') || '').match(/filename="?([^";]+)"?/i);
            output.textContent = 'Binary response (' + (ctype || 'unknown') + ', ' + blob.size.toLocaleString() + ' bytes) — saved as ' + (name ? name[1] : ep.id + '.zip') + '. Open it to inspect.';
            download.textContent = '💾 Download ' + (name ? name[1] : 'bundle.zip');
            download.style.display = '';
            download.onclick = () => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = name ? name[1] : ep.id + '.zip';
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
            let cmd = 'curl -X ' + opts.method + ' -H "Authorization: Bearer ' + token + '"';
            if (wantsCsv) cmd += ' -H "Accept: text/csv"';
            if (opts.method === 'POST') cmd += ' -H "Content-Type: application/json" -d ' + "'" + bodyRaw.replace(/'/g, "'\\''") + "'";
            copyText(cmd + ' ' + location.origin + url);
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

    // help & guide — inject the single source into the inline section + overlay modal.
    // https://your-host placeholders become the caller's actual origin (https FQDN in
    // production, localhost:port in dev) so samples are always runnable as-is.
    const isHttp = typeof location !== 'undefined' && location.protocol && /^https?:$/.test(location.protocol);
    const guideHost = isHttp ? location.origin : 'https://your-host';
    const guideHtml = HELP_GUIDE_HTML.split('https://your-host').join(guideHost);
    const inlineGuide = document.getElementById('help-guide-inline');
    if (inlineGuide) inlineGuide.innerHTML = guideHtml;
    const modalGuide = document.getElementById('help-modal-body');
    if (modalGuide) modalGuide.innerHTML = guideHtml;
    buildGuideTables(); // fills the generated endpoint tables in every guide copy
    const btnHelp = document.getElementById('btn-help');
    if (btnHelp) btnHelp.addEventListener('click', () => openModal('help-modal'));

    // console wiring
    renderEndpointSelect();
    if (activeEndpoint) onEndpointChange(activeEndpoint);
    document.getElementById('con-add-filter').addEventListener('click', addFilterRow);
    ['con-fields', 'con-sort', 'con-order', 'con-limit'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateUrlPreview);
    });
    document.getElementById('con-fields').addEventListener('input', updateUrlPreview);
    const conParam = document.getElementById('con-param-val');
    if (conParam) conParam.addEventListener('input', updateUrlPreview);
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