# API Data Validation Skill - Complete 🎉

## What Was Created

### 📋 Skill File Structure
```
.github/skills/
├── api-data-validation/
│   └── SKILL.md              (11 KB - fully documented)
├── README.md                 (Discovery & conventions guide)
```

### 📚 Skill Contents

**SKILL.md includes:**
- ✅ Full workflow documentation (8 steps)
- ✅ When/when-not-to-use guidelines
- ✅ API endpoint reference table
- ✅ Authentication strategy explanation
- ✅ Data structure examples (JSON samples)
- ✅ Customization options (env vars, selective testing)
- ✅ Health check baseline (production targets)
- ✅ Troubleshooting guide with solutions
- ✅ Example usage with expected output
- ✅ Token lifecycle documentation
- ✅ Files generated summary

## How to Use This Skill

### In VS Code Copilot Chat
Type `/` and search for "api-data-validation":

```
# Example prompts that will trigger the skill:

/api-data-validation check what data is in the API right now
/api-data-validation test endpoints after database migration
/api-data-validation validate catalog endpoints return correct structures
/api-data-validation generate record count report for all endpoints
/api-data-validation audit data integrity in submissions endpoint
```

### From Command Line (Without Copilot)
```bash
cd /home/steelburn/staff-track
./test-api-bash.sh              # Quick validation
node test-api-node.js           # Detailed JSON report
node test-skills.js             # Skills analysis
```

## Key Features

### ✅ Automatic Features
- **Single Auth:** Authenticate once, reuse token for all endpoints
- **Batch Testing:** Test multiple endpoints in one script run
- **Dual Format:** Generates both bash/cURL and Node.js scripts
- **Record Counts:** Shows number of records per endpoint
- **Structure Display:** Shows field names from first record
- **Health Baseline:** Compares results to healthy system targets
- **JSON Reporting:** Generates machine-readable reports in /tmp/

### 📊 What You Get
For each test run:
```
Endpoint Results:
├─ /submissions: 142 records [id, staffEmail, staffName, createdAt, updatedAt]
├─ /catalog/staff: 500 records [email, name, title, department, manager_name]
├─ /catalog/projects: 230 records [id, soc, project_name, customer, end_date]
├─ /admin/roles: 1 record [email, role, is_active, created_at, updated_at]
└─ /health: ok [status, ts]
```

## Related Skills to Create Next

Based on this workflow, these skills would be complementary:

### 1. **Data Import & Seeding** (Suggested)
```
Workflow: Load CSV/JSON data into database

When to use: Populating staff catalog, projects, skills
Would handle: CSV import, data validation, seed operations
Pairs with: api-data-validation (test after import)
```

### 2. **API Schema Validation** (Suggested)
```
Workflow: Verify response structures match expected schemas

When to use: Validating endpoints conform to contracts
Would handle: JSON schema validation, field type checking
Pairs with: api-data-validation (use output to define schemas)
```

### 3. **Performance Baseline Testing** (Advanced)
```
Workflow: Measure endpoint response times

When to use: Establishing performance benchmarks
Would handle: Load testing, latency measurement
Pairs with: api-data-validation (baseline health checks)
```

### 4. **Database Health Monitoring** (Suggested)
```
Workflow: Check table sizes, indexes, performance

When to use: Database audit, optimization planning
Would handle: Table stats, index analysis, query performance
Pairs with: api-data-validation (database perspective)
```

## File Locations

All files created during skill usage are stored in workspace:

```
/home/steelburn/staff-track/
├── .github/skills/
│   ├── api-data-validation/SKILL.md       ← Skill definition
│   └── README.md                          ← Skills directory guide
├── test-api-bash.sh                       ← Generated bash test
├── test-api-node.js                       ← Generated Node.js test
├── test-skills.js                         ← Skills analyzer
├── API_TESTING_REPORT.md                  ← Full documentation
└── TEST_QUICK_REFERENCE.sh                ← Quick reference
```

JSON reports generated at:
```
/tmp/api-test-report-{timestamp}.json
```

## Skill Metadata

| Aspect | Value |
|--------|-------|
| **Location** | `.github/skills/api-data-validation/SKILL.md` |
| **Scope** | Workspace-scoped (shared with team) |
| **Use Case** | Validate API endpoints + inspect data during development |
| **Automation** | Fully automated (generates and runs tests) |
| **Coverage** | StaffTrack API (8 endpoints) |
| **Status** | ✅ Production Ready |
| **Version** | 1.0 |
| **Created** | 2026-04-05 |

## Triggering the Skill

The skill will be discovered when you type prompts mentioning:
- "test API endpoints"
- "check available records"
- "inspect data structures"
- "validate endpoints"
- "audit what data exists"
- "data schemas"
- "validate after migrations"

The skill's "Use when:" description makes it discoverable to Copilot Chat.

## Next Steps

1. **Try the Skill:**
   ```bash
   # Using the test scripts directly
   ./test-api-bash.sh
   node test-api-node.js
   
   # Or via Copilot Chat (coming soon)
   /api-data-validation test all endpoints after migration
   ```

2. **Refine the Baseline:**
   - Run the skill with your production data
   - Update health check baseline in SKILL.md with actual expected values
   - Share baseline expectations with team

3. **Create Related Skills:**
   - Consider creating Data Import skill (populate catalog data)
   - Consider Schema Validation skill (validate response structures)

4. **Integrate into Workflows:**
   - Add to CI/CD pipeline pre/post migration tests
   - Use in development PR checks
   - Include in deployment validation steps

## Validation Checklist

✅ Skill created in `.github/skills/api-data-validation/SKILL.md`
✅ YAML frontmatter is valid (`name`, `description`)
✅ Description includes "Use when:" trigger phrases
✅ Workflow is documented with 6+ steps
✅ Data structures with sample JSON provided
✅ Authentication strategy explained
✅ Health check baseline included
✅ Troubleshooting section with solutions
✅ Test scripts referenced and verified
✅ Example usage provided
✅ Skills directory README added

**Status: ✅ Ready for Use**

---

**Created by:** GitHub Copilot  
**Date:** 2026-04-05  
**Framework:** VS Code Copilot Skills  
**Scope:** Workspace-scoped (`.github/skills/`)
