#!/bin/bash
# Quick Reference Guide for StaffTrack API Testing

cat << 'EOF'

╔════════════════════════════════════════════════════════════════════════════╗
║                    StaffTrack API Testing - Quick Reference                ║
╚════════════════════════════════════════════════════════════════════════════╝

📋 Three Test Scripts Available:

1. Bash/cURL Test (Recommended for quick testing)
   └─ File: test-api-bash.sh
   └─ Usage: ./test-api-bash.sh
   └─ Requires: curl, jq
   └─ Output: Formatted console output with pass/fail indicators
   └─ Speed: Fastest - no Node.js overhead
   └─ Tests: 8 endpoints including health check

2. Node.js Test (Recommended for detailed reporting)
   └─ File: test-api-node.js  
   └─ Usage: node test-api-node.js
   └─ Requires: Node.js v18+
   └─ Output: Console summary + JSON report in /tmp/
   └─ Speed: 2-3 seconds total
   └─ Tests: 9 endpoints with detailed structure analysis

3. Skills Data Extraction (Database analysis)
   └─ File: test-skills.js
   └─ Usage: node test-skills.js
   └─ Requires: Node.js v18+, mysql2 package
   └─ Output: Skills catalog and submission statistics
   └─ Speed: 1-2 seconds
   └─ Analysis: Categories, ratings, frequency distributions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 QUICK START

# Run all tests
cd /home/steelburn/staff-track
./test-api-bash.sh
node test-api-node.js
node test-skills.js

# Or run individual tests
./test-api-bash.sh       # Fast validation
node test-api-node.js    # Full report with JSON

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚙️  CONFIGURATION

Environment Variables (Optional):

  API_URL              Override API endpoint
  MYSQL_HOST           Database hostname (default: localhost)
  MYSQL_PORT           Database port (default: 3306)
  MYSQL_USER           Database user (default: stafftrack)
  MYSQL_PASSWORD       Database password
  MYSQL_DATABASE       Database name (default: stafftrack)

Examples:

  # Use staging environment
  API_URL=http://staging.example.com:3000 ./test-api-bash.sh

  # Use custom database
  MYSQL_HOST=prod-db.example.com node test-skills.js

  # All options
  API_URL=http://api.example.com:3000 MYSQL_HOST=db.example.com \
    node test-api-node.js

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 EXPECTED OUTPUT

✅ Successful Test (Bash):
  ◆ GET /catalog/staff
  ✓ Staff catalog: 142 records
    Sample structure: ["email","name","title","department","manager_name"]

✅ Successful Test (Node.js):
  ◆ GET /catalog/staff
  ✓ Staff catalog: 142 records
  ◦ Sample structure: [email, name, title, department, manager_name]

❌ Failed Test:
  ✗ Admin submission with skills/projects: HTTP 404
  (This is expected - admin user has no submission)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 WHAT GETS TESTED

Authentication:
  ✓ POST /auth/login - Admin authentication with JWT token generation

Submissions:
  ✓ GET /submissions - List all staff submissions
  ✓ GET /submissions/me - Retrieve admin's submission with skills/projects

Catalogs:
  ✓ GET /catalog/staff - Baseline staff information
  ✓ GET /catalog/projects - Baseline project list

Admin:
  ✓ GET /admin/roles - User roles and permissions

Reports:
  ✓ GET /reports/projects - Submission projects grouped by assignment

Health:
  ✓ GET /health - API service status

Skills:
  ✓ Query skills_catalog table for all available skills
  ✓ Analyze submission_skills for user-submitted data
  ✓ Generate rating distribution statistics

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔑 AUTHENTICATION DETAILS

Admin Credentials:
  Email:    admin (or admin@stafftrack.local)
  Password: secure_admin_password (from ADMIN_PASSWORD env in compose.yaml)

Token Details:
  Type:        JWT (HS256)
  Expiration:  8 hours
  Secret:      dev_secret_change_me_in_prod
  Encoding:    Password must be base64-encoded before sending
  Reuse:       Same token used for all subsequent requests

Request Format:
  POST /auth/login
  {
    "email": "admin",
    "password": "BASE64_ENCODED_PASSWORD"
  }

Response:
  {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "550e8400-e29b-41d4...",
    "user": { "email": "admin", "role": "admin" },
    "expiresIn": 28800
  }

Using Token:
  Header: Authorization: Bearer {accessToken}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 RECORD COUNTS SUMMARY

When database is populated, each test provides:

Endpoint              | Records | Sample Fields
─────────────────────────────────────────────────────────────────────────
Submissions           | N       | id, staffEmail, staffName, createdAt
Submission Details    | 1       | id, skills[], projects[]
Staff Catalog         | N       | email, name, title, department, manager
Project Catalog       | M       | id, soc, project_name, customer, end_date
User Roles            | K       | email, role, is_active, created_at
Project Report        | L       | assignment_id, soc, staff_name, submissions[]
Health                | 1       | status, ts

Skills Analysis:
──────────────────────────────────────────────────────────────────────────
Skills Catalog        | N       | id, name, category, is_active
Submission Skills     | M       | skill, occurrences, avg_rating
Rating Distribution   | 5       | rating, count

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 TROUBLESHOOTING

Issue: "curl: command not found"
Solution: apt-get install curl

Issue: "jq: command not found"
Solution: apt-get install jq

Issue: "Connection refused"
Solution: Check if backend is running: docker compose logs backend

Issue: "Authentication failed"
Solution: Verify ADMIN_PASSWORD in compose.yaml matches the script

Issue: "Cannot connect to database"
Solution: Ensure MySQL is running: docker compose ps db

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 DOCUMENTATION

Detailed Report: ./API_TESTING_REPORT.md
This File:       ./TEST_QUICK_REFERENCE.sh (read as text, don't execute)

Location:        /home/steelburn/staff-track/

Files:
  - test-api-bash.sh    (5.1 KB, 170 lines, 8 endpoints)
  - test-api-node.js    (8.1 KB, 230 lines, 9 endpoints)  
  - test-skills.js      (5.7 KB, 182 lines, database analysis)
  - API_TESTING_REPORT.md (comprehensive documentation)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ Created: 2026-04-05 17:22:43 UTC
Version: 1.0
Status: Production Ready

EOF
