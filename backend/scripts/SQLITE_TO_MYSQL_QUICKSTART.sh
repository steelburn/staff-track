#!/bin/bash
# SQLite to MySQL Migration Quick Reference
# Location: backend/scripts/SQLITE_TO_MYSQL_QUICKSTART.sh
# Description: Quick commands for running the migration scripts

set -e

echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║         SQLite to MySQL Migration - Quick Start Guide                  ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}📋 Available Commands:${NC}\n"

echo -e "${YELLOW}1. DRY-RUN MIGRATION (Preview only - RECOMMENDED FIRST STEP)${NC}"
echo "   docker compose exec backend node scripts/sqlite-to-mysql-migrate.js --dry-run"
echo "   OR (local):"
echo "   node backend/scripts/sqlite-to-mysql-migrate.js --dry-run"
echo ""

echo -e "${YELLOW}2. EXECUTE MIGRATION${NC}"
echo "   docker compose exec backend node scripts/sqlite-to-mysql-migrate.js"
echo "   OR (local):"
echo "   node backend/scripts/sqlite-to-mysql-migrate.js"
echo ""

echo -e "${YELLOW}3. MIGRATE WITH TABLE DROP (Use with caution!)${NC}"
echo "   docker compose exec backend node scripts/sqlite-to-mysql-migrate.js --drop-tables"
echo "   OR (local):"
echo "   node backend/scripts/sqlite-to-mysql-migrate.js --drop-tables"
echo ""

echo -e "${YELLOW}4. SCAN CODEBASE FOR SQLITE PATTERNS${NC}"
echo "   docker compose exec backend node scripts/sqlite-to-mysql-patterns.js"
echo "   OR (local):"
echo "   node backend/scripts/sqlite-to-mysql-patterns.js"
echo ""

echo -e "${YELLOW}5. GENERATE DETAILED PATTERN REPORT${NC}"
echo "   docker compose exec backend node scripts/sqlite-to-mysql-patterns.js --report"
echo "   OR (local):"
echo "   node backend/scripts/sqlite-to-mysql-patterns.js --report"
echo ""

echo -e "${YELLOW}6. AUTO-FIX SQLITE PATTERNS IN CODE${NC}"
echo "   docker compose exec backend node scripts/sqlite-to-mysql-patterns.js --fix"
echo "   OR (local):"
echo "   node backend/scripts/sqlite-to-mysql-patterns.js --fix"
echo ""

echo -e "${GREEN}📚 Full Documentation:${NC}"
echo "   .github/skills/sqlite-to-mysql/SKILL.md"
echo ""

echo -e "${BLUE}⚡ Recommended Migration Workflow:${NC}"
echo ""
echo "   1. Start Docker containers (if not running):"
echo "      docker compose up -d"
echo ""
echo "   2. Preview migration (DRY-RUN) - ALWAYS DO THIS FIRST"
echo "      node backend/scripts/sqlite-to-mysql-migrate.js --dry-run"
echo ""
echo "   3. Execute migration"
echo "      node backend/scripts/sqlite-to-mysql-migrate.js"
echo ""
echo "   4. Scan codebase for patterns"
echo "      node backend/scripts/sqlite-to-mysql-patterns.js --report"
echo ""
echo "   5. Auto-fix patterns (only if needed)"
echo "      node backend/scripts/sqlite-to-mysql-patterns.js --fix"
echo ""
echo "   6. Verify migration"
echo "      docker compose exec db mysql -u stafftrack -p stafftrack_dev_password stafftrack -e 'SHOW TABLES;'"
echo ""
echo "   7. Test application"
echo "      curl http://localhost:3000/health"
echo ""

echo -e "${BLUE}🔧 Environment Variables:${NC}"
echo "   MYSQL_HOST (default: db)"
echo "   MYSQL_PORT (default: 3306)"
echo "   MYSQL_USER (default: stafftrack)"
echo "   MYSQL_PASSWORD (default: stafftrack_dev_password)"
echo "   MYSQL_DATABASE (default: stafftrack)"
echo ""

echo -e "${BLUE}📂 SQLite Database Location:${NC}"
echo "   Default:  /var/lib/mysql/_data/submissions.db"
echo "   Specify:  --sqlite-path /path/to/database"
echo ""

echo -e "${BLUE}✅ After Migration Checklist:${NC}"
echo "   □ Dry-run completed successfully"
echo "   □ Migration executed"
echo "   □ Record counts verified"
echo "   □ Code patterns scanned"
echo "   □ Auto-fixes applied (if needed)"
echo "   □ Application tests passed"
echo "   □ API endpoints working"
echo ""

echo -e "${GREEN}✨ For detailed help, read the SKILL.md file in .github/skills/sqlite-to-mysql/${NC}"
echo ""
