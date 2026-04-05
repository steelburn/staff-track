#!/bin/bash

# Visual guide to the API Data Validation Skill

cat << 'EOF'

╔════════════════════════════════════════════════════════════════════════════╗
║                    API Data Validation Skill - Ready to Use                ║
╚════════════════════════════════════════════════════════════════════════════╝

📍 SKILL LOCATION

  Workspace:     /home/steelburn/staff-track/
  Skill file:    .github/skills/api-data-validation/SKILL.md
  Directory:     .github/skills/README.md (discovery guide)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 WHAT THE SKILL DOES

  ✅ Generates test scripts automatically
  ✅ Authenticates once with JWT token
  ✅ Reuses token across all API endpoint calls
  ✅ Tests 8 API endpoints in parallel
  ✅ Counts records per endpoint
  ✅ Extracts field structure from first record
  ✅ Generates JSON reports for analysis
  ✅ Validates against health check baseline

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 HOW TO USE IT

  Option 1: Via VS Code Copilot Chat (Coming Soon)
  ────────────────────────────────────────────────

    Type "/" in VS Code Copilot Chat and select:
    
    /api-data-validation check what data is available
    /api-data-validation test endpoints after migration
    /api-data-validation validate catalog structures

  Option 2: Command Line (Direct Usage)
  ─────────────────────────────────────

    cd /home/steelburn/staff-track
    
    # Quick test (bash/cURL - fastest)
    ./test-api-bash.sh
    
    # Detailed report (Node.js - JSON output)
    node test-api-node.js
    
    # Skills analysis (database extraction)
    node test-skills.js

  Option 3: With Custom Settings
  ──────────────────────────────

    # Test different API endpoint
    API_URL=http://staging.example.com:3000 ./test-api-bash.sh
    
    # Query different database
    MYSQL_HOST=prod-db node test-skills.js

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 WHAT YOU GET BACK

  Console Output:
  ───────────────
    ✓ All submissions: 142 records
    ✓ Staff catalog: 500 records  
      Sample structure: ["email","name","title","department","manager_name"]
    ✓ Project catalog: 230 records
    ✓ User roles: 1 records
    ✓ Service health: ok

  JSON Report: (In /tmp/api-test-report-*.json)
  ──────────────────────────────────────────────
    {
      "timestamp": "2026-04-05T17:45:00Z",
      "endpoints": {
        "/submissions": {
          "status": "success",
          "recordCount": 142,
          "structure": ["id","staffEmail","staffName","createdAt","updatedAt"]
        }
      }
    }

  Automatic Analysis:
  ──────────────────
    ★ Compares results to health check baseline
    ★ Highlights unexpected values
    ★ Identifies missing data
    ★ Validates schema compliance

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔐 HOW AUTH TOKEN REUSE WORKS

  Step 1: Authenticate Once
  ──────────────────────────
    POST /auth/login
    └─> Get: accessToken (valid 8 hours)
  
  Step 2: Reuse Token
  ──────────────────
    Authorization: Bearer {accessToken}
    
    GET /submissions         (uses same token)
    GET /catalog/staff       (uses same token)
    GET /admin/roles         (uses same token)
    ... (all subsequent calls use same token)
  
  Step 3: No Reauthentication Needed
  ──────────────────────────────────
    Token valid for entire test session
    Single 8-hour JWT covers all 8 endpoints

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 ENDPOINTS TESTED

  Authentication:
    ✓ POST /auth/login           → JWT token generation

  Submissions:
    ✓ GET /submissions           → All submissions
    ✓ GET /submissions/me        → Admin's submission

  Catalogs:
    ✓ GET /catalog/staff         → Staff directory
    ✓ GET /catalog/projects      → Project list

  Admin:
    ✓ GET /admin/roles           → User roles & permissions

  Reports:
    ✓ GET /reports/projects      → Project assignments

  Health:
    ✓ GET /health                → Service status

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🩺 HEALTH CHECK BASELINE

  Production System Expected Minimums:

    Endpoint                  | Target    | Green  | Yellow | Red
    ──────────────────────────┼───────────┼────────┼────────┼──────
    /auth/login               | Success   | ✓      | -      | ✗
    /health                   | ok        | ✓      | -      | ✗
    /admin/roles              | ≥1        | 5+     | 1      | 0
    /catalog/staff            | ≥50       | 500+   | 50-499 | 0
    /catalog/projects         | ≥20       | 200+   | 20-199 | 0
    /submissions              | Any       | 100+   | 1-99   | 0
    /reports/projects         | Varies    | 50+    | 1-49   | 0

  Development System Expected:

    All endpoints responding ✓
    All tables queryable ✓
    Record counts: 0+ (data may not be imported yet)
    Auth working ✓

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 CUSTOMIZATION OPTIONS

  Test Specific Endpoints Only:
    Edit test-api-bash.sh and comment out endpoints you don't need

  Use Custom API URL:
    API_URL=http://api.example.com:3000 ./test-api-bash.sh

  Use Custom Database:
    MYSQL_HOST=db.example.com MYSQL_PASSWORD=pwd node test-skills.js

  Generate Reports Only (No Console Output):
    node test-api-node.js > /dev/null
    # Check /tmp/api-test-report-*.json

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 COMMON USE CASES

  1. After Database Migration:
     → Run skill to verify all endpoints responsive
     → Check table structures queryable
     → Baseline shows 0 records (expected)

  2. After Data Import:
     → Run skill to count imported records
     → Verify field structures match schema
     → Compare against health check baseline

  3. During Development:
     → Quick endpoint health check
     → See what data currently exists
     → Validate new endpoints working

  4. Before Deployment:
     → Final endpoint validation
     → Record counts for release notes
     → Health check pre-production review

  5. Performance Testing:
     → Use as baseline query load
     → Then add load testing on top
     → Compare token reuse behavior

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 DOCUMENTATION

  Skill Definition:
    .github/skills/api-data-validation/SKILL.md  (12 KB, comprehensive)

  Skills Directory Guide:
    .github/skills/README.md  (discovery & conventions)

  Full Technical Report:
    API_TESTING_REPORT.md  (implementation details)

  Quick Reference:
    TEST_QUICK_REFERENCE.sh  (copy-paste ready)

  Completion Summary:
    SKILL_CREATION_COMPLETE.md  (this overview + next steps)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎓 SUGGESTED NEXT SKILLS

  Based on this workflow, these would be valuable:

  1. Data Import & Seeding
     ├─ Purpose: Load staff, projects, skills into database
     ├─ Pairs with: api-data-validation (validate after import)
     └─ Benefit: Fully automate test data setup

  2. API Schema Validation
     ├─ Purpose: Verify response structures match OpenAPI spec
     ├─ Pairs with: api-data-validation (use output for validation)
     └─ Benefit: Enforce contractual API compliance

  3. Performance Baseline Testing
     ├─ Purpose: Measure endpoint latency and throughput
     ├─ Pairs with: api-data-validation (health check foundation)
     └─ Benefit: Establish performance regression detection

  4. Database Health Monitoring
     ├─ Purpose: Check indexes, table sizes, slow queries
     ├─ Pairs with: api-data-validation (database perspective)
     └─ Benefit: Identify database optimization opportunities

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ VERIFICATION CHECKLIST

  ✓ Skill created in .github/skills/api-data-validation/SKILL.md
  ✓ YAML frontmatter valid and complete
  ✓ "Use when:" trigger phrases included in description
  ✓ 12+ documentation sections with examples
  ✓ Data structures with JSON samples
  ✓ Health check baseline documented
  ✓ Troubleshooting guide included
  ✓ Test scripts working and verified
  ✓ Token reuse strategy documented
  ✓ Example usage with expected output
  ✓ Skills directory README created
  ✓ Ready for team use

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📞 GETTING HELP

  1. Read the skill: .github/skills/api-data-validation/SKILL.md
  2. Check the baseline: Health Check Baseline section
  3. Troubleshooting: See SKILL.md Troubleshooting section
  4. Examples: See SKILL.md Example Usage section
  5. Related docs: API_TESTING_REPORT.md (full technical details)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 YOU'RE ALL SET!

  The skill is ready to use. You can:

  1. Use it immediately from the command line:
     cd /home/steelburn/staff-track && ./test-api-bash.sh

  2. Reference it in VS Code Copilot Chat:
     /api-data-validation test endpoints

  3. Share with team via git:
     .github/skills/api-data-validation/SKILL.md

  4. Build other skills on top of this foundation:
     See "Suggested Next Skills" above

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skill Version: 1.0
Status: ✅ Production Ready
Created: 2026-04-05
Framework: VS Code Copilot Skills

EOF
