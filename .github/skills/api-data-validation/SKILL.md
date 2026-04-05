---
name: api-data-validation
description: "Validate StaffTrack API endpoints and inspect data structures. Use when: testing API endpoints, checking available records, inspecting data schemas, validating endpoints after migrations, or auditing what data exists in the system. Generates and runs automated test scripts with admin JWT token reuse."
---

# API Data Validation for StaffTrack

Systematically validate StaffTrack API endpoints, authenticate with JWT tokens, and inspect data structures. This skill generates fully automated test scripts that authenticate once and reuse tokens across multiple endpoint checks.

## When to Use This Skill

✅ **Use this skill when:**
- Testing API endpoints to see what data is available
- Inspecting first-record structure from each endpoint
- Validating endpoints work after database migrations
- Auditing record counts across the system
- Checking endpoint compliance with expected schema
- Generating record count summaries for reporting
- Testing token reuse and auth lifecycle

❌ **Don't use this skill for:**
- Debugging specific API bugs (use default agent)
- Building new API endpoints (use development workflows)
- Performance load testing (requires different tooling)
- API design decisions (use brainstorming skill)

## Workflow: Test API Endpoints

### Step 1: Define Scope
Specify which endpoints to test:
- **All endpoints** (complete system audit)
- **Specific endpoints** (targeted validation after changes)
- **By category** (submissions, catalogs, admin, reports)

### Step 2: Authentication Setup
- ✅ Automatically authenticate as admin with JWT token
- ✅ Extract 8-hour access token
- ✅ Reuse same token for all subsequent API calls
- ✅ No reauthentication needed

### Step 3: Generate Test Scripts
Create fully functional test scripts in both formats:

**Option A: Bash/cURL** (Fastest, minimal dependencies)
- No Node.js required
- Uses curl for HTTP requests
- Uses jq for JSON parsing
- Output: Formatted console with colors
- Ideal for: Quick validation, CI/CD pipelines

**Option B: Node.js** (Detailed reporting)
- Native JSON handling
- Structured reporting
- Automatic JSON report generation
- Output: Console summary + /tmp/report.json
- Ideal for: Development, detailed analysis

### Step 4: Execute Tests
- Run bash script: `./test-api-*.sh`
- Run Node.js: `node test-api-*.js`
- Results show: record counts + sample structure from first record

### Step 5: Interpret Results
For each endpoint, you see:
- ✅ **Success** - "endpoint: N records" (shows count and structure)
- ❌ **Failure** - Error message and HTTP status
- **Structure** - Field names from first record in [brackets]

### Step 6: Generate Report
- Bash: Console output with summary table
- Node.js: JSON file in /tmp/ with detailed results
- Both: Record counts per endpoint + data validation

## API Endpoints Available

| Endpoint | Purpose | Returns |
|----------|---------|---------|
| `POST /auth/login` | Admin authentication | JWT token, refresh token |
| `GET /submissions` | List all submissions | Submission array |
| `GET /submissions/me` | Get admin's submission | Submission with skills + projects |
| `GET /catalog/staff` | Staff from migration | Staff array with names/titles |
| `GET /catalog/projects` | Projects from migration | Project array with SOCs |
| `GET /admin/roles` | User roles/permissions | User roles array |
| `GET /reports/projects` | Grouped project report | Projects grouped by assignment |
| `GET /health` | Service health | Status + timestamp |

## Customization Options

### Environment Variables

Control test behavior with environment variables:

```bash
# API URL (default: http://localhost:3000)
API_URL=http://staging.example.com:3000 ./test-api-bash.sh

# Database connection (for skills extraction)
MYSQL_HOST=db.example.com
MYSQL_USER=stafftrack
MYSQL_PASSWORD=mypassword
MYSQL_DATABASE=stafftrack
```

### Select Specific Endpoints

Modify the test scripts to include/exclude endpoints:

```bash
# Comment out tests you don't need
# test_endpoint "/submissions" "GET" "All submissions"
# test_endpoint "/catalog/staff" "GET" "Staff catalog"
test_endpoint "/admin/roles" "GET" "User roles"
```

### Custom Report Format

**Bash script:** Clean console output with colored indicators
```
✓ Staff catalog: 142 records
  Sample structure: ["email","name","title","department","manager_name"]
```

**Node.js script:** JSON report for programmatic processing
```json
{
  "timestamp": "2026-04-05T09:22:43Z",
  "endpoints": {
    "/catalog/staff": {
      "status": "success",
      "recordCount": 142,
      "structure": ["email", "name", "title", "department", "manager_name"]
    }
  }
}
```

## Data Structures

### Authentication Response
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "550e8400-e29b-41d4-a716-4466554...",
  "user": { "email": "admin", "role": "admin" },
  "expiresIn": 28800
}
```
**Token reuse:** Use `accessToken` in `Authorization: Bearer {token}` header for all subsequent calls.

### Success Response Structure (Typical)
```json
[
  {
    "field1": "value1",
    "field2": "value2",
    ...
  }
]
```
**Display:** Fields shown as `["field1", "field2", ...]`

### Submission with Skills
```json
{
  "id": "uuid",
  "staffEmail": "user@example.com",
  "staffName": "John Doe",
  "skills": [
    { "skill": "Python", "rating": 5 }
  ],
  "projects": [
    {
      "soc": "SOC-123",
      "projectName": "Project Alpha",
      "role": "Senior Dev",
      "technologies": "Python, Django"
    }
  ]
}
```

## Health Check Baseline

Use this baseline to identify if your system is in a "healthy" state:

### Minimum Healthy System
These endpoints should return data in a production/staging system:

| Endpoint | Production Target | Development Target | Indicates |
|----------|-------------------|--------------------|-----------|
| `/auth/login` | Success with token | Success with token | API responding |
| `/health` | `status: ok` | `status: ok` | Service healthy |
| `/admin/roles` | ≥1 (admin user) | ≥1 (admin user) | Auth system working |
| `/catalog/staff` | ≥50 | 0+ | Staff data imported |
| `/catalog/projects` | ≥20 | 0+ | Project catalog populated |
| `/submissions` | 0+ | 0+ | Submissions table exists |
| `/reports/projects` | Varies | 0 | Project links working |

### Development/Empty System (Normal)
When database is freshly migrated:
- ✅ Auth endpoints working
- ✅ Catalog queries execute (return 0 records)
- ✅ All schema tables exist and are queryable
- ⚠️ No staff/project/submission data until imported

**Next step:** Populate with seed data or CSV imports.

### Problems to Investigate

| Symptom | Likely Cause | Check |
|---------|-------------|-------|
| All endpoints return 0 records | Migrations applied but data not imported | Run `mysql stafftrack < seed.sql` |
| `/submissions` returns HTTP 500 | Backend bug in result handling | Check `docker compose logs backend` |
| `/admin/roles` empty | Admin user not created | Login endpoint should auto-create admin role |
| `/catalog/staff` empty but `/admin/roles` has data | Staff import failed but users exist | Verify CSV import completed |

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `curl: command not found` | curl not installed | `apt-get install curl` |
| `jq: command not found` | jq not installed | `apt-get install jq` |
| `Connection refused` | Backend not running | `docker compose up backend` |
| `Authentication failed` | Wrong password | Verify `ADMIN_PASSWORD` in compose.yaml |
| `HTTP 500` on endpoint | Backend bug | Check docker logs: `docker compose logs backend` |
| `HTTP 404` on /submissions/me | No admin submission | Expected - admin user may not have submitted data |

## Example Usage

### Quick Test All Endpoints (Bash)
```bash
cd /home/steelburn/staff-track
./test-api-bash.sh
```
**Output:** Colored results with record counts in ~1 second

### Generate Detailed JSON Report (Node.js)
```bash
cd /home/steelburn/staff-track
node test-api-node.js
# Saves to: /tmp/api-test-report-{timestamp}.json
```

### Test Custom API Instance
```bash
API_URL=http://prod.example.com:3000 ./test-api-bash.sh
```

### Extract All Skills Data
```bash
node test-skills.js
```
**Provides:**
- Skills catalog statistics
- Submitted skills frequency distribution
- Rating distributions
- Unique skill counts

## Implementation Details

### Authentication Strategy
1. **Authenticate once** - POST /auth/login with admin credentials
2. **Extract token** - Parse `accessToken` from response
3. **Reuse for all calls** - Include token in `Authorization: Bearer {token}` header
4. **8-hour expiration** - Token valid for entire test session
5. **No reauthentication** - Single token handles all endpoint tests

### Test Execution Flow
```
┌─────────────────────────────────────────┐
│ Authenticate (POST /auth/login)         │
│ Extract JWT token                       │
└──────────────┬──────────────────────────┘
               │
        ┌──────▼──────┐
        │ Single Token │
        └──────┬──────┘
               │
   ┌───────────┼───────────┐
   │           │           │
   ▼           ▼           ▼
[Endpoint 1] [Endpoint 2] [Endpoint 3]
   │           │           │
   └───────────┼───────────┘
               │
        ┌──────▼──────────┐
        │ Generate Report │
        │ Record Counts   │
        │ Structures      │
        └─────────────────┘
```

### Token Lifecycle
- **Generated:** When authentication succeeds
- **Duration:** 8 hours (28,800 seconds)
- **Usage:** Included in every API request header
- **Reuse:** Same token for all endpoints in single test run
- **Expiration:** Transparent to test - token valid for entire session

## Files Generated

After running tests, you'll have:

| File | Purpose |
|------|---------|
| `test-api-bash.sh` | Bash/cURL test script (executable) |
| `test-api-node.js` | Node.js test suite (executable) |
| `test-skills.js` | Skills extraction script (executable) |
| `/tmp/api-test-report-*.json` | Detailed JSON report (Node.js output) |

## Sample Output

### Bash Test Output
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENDPOINTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ GET /catalog/staff
✓ Staff catalog: 142 records
  Sample structure: ["email","name","title","department","manager_name"]

◆ GET /admin/roles
✓ User roles and permissions: 1 records
  Sample structure: ["created_at","email","is_active","role","updated_at"]
```

### Node.js Test Output
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEST SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Endpoints Passed: 6
Endpoints Failed: 1
Total Records: 143
Test Endpoints: 7

✓ /catalog/staff                 142 records
✓ /admin/roles                   1 records
✗ /submissions/me                Error: HTTP 404
```

## Next Steps

1. **Validate All Data** - Use this skill to audit current system state
2. **Test After Changes** - Run before/after migrations or schema updates
3. **Generate API Docs** - Use record structures to document API contracts
4. **Monitor Compliance** - Periodically run to ensure data integrity
5. **Automated CI/CD** - Integrate bash script into deployment pipelines

## Related Workflows

- **API Design** - See `brainstorming` skill for designing new endpoints
- **Authentication** - See `API_TESTING_REPORT.md` for JWT token details
- **Data Analysis** - Use `test-skills.js` for deeper skills analytics
- **Performance Testing** - Use this as baseline, then layer in load testing

---

**Version:** 1.0  
**Created:** 2026-04-05  
**Location:** `.github/skills/api-data-validation/`  
**Status:** Production Ready
