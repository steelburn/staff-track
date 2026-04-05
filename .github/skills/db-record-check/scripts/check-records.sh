#!/bin/bash

# Database Record Count Checker
# Checks record counts for tables related to api-data-validation skill
# Usage: bash check-records.sh [table1 table2 ...]

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MYSQL_HOST="${MYSQL_HOST:-db}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-root_password}"
MYSQL_DATABASE="${MYSQL_DATABASE:-stafftrack}"

# Default tables related to api-data-validation skill
DEFAULT_TABLES=(
  "submissions"
  "submission_skills"
  "submission_projects"
  "user_roles"
  "managed_projects"
  "staff"
  "projects_catalog"
  "skills_catalog"
  "auth_tokens"
  "auth_audit_log"
)

# Use provided tables or fall back to defaults
if [ $# -gt 0 ]; then
  TABLES=("$@")
else
  TABLES=("${DEFAULT_TABLES[@]}")
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Database Record Count Check${NC}"
echo -e "${BLUE}Database: ${MYSQL_DATABASE}${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

TOTAL=0
CHECKED=0
FAILED=0

# Function to execute MySQL query
mysql_query() {
  local query="$1"
  docker compose exec -T db mysql \
    -h "$MYSQL_HOST" \
    -u "$MYSQL_USER" \
    -p"$MYSQL_PASSWORD" \
    "$MYSQL_DATABASE" \
    -sNe "$query"
}

# Check each table
for table in "${TABLES[@]}"; do
  # Check if table exists
  table_exists=$(mysql_query "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${MYSQL_DATABASE}' AND TABLE_NAME='${table}';" 2>/dev/null || echo "0")
  
  if [ "$table_exists" -eq 0 ]; then
    echo -e "${BLUE}⚠ ${table}: table not found${NC}"
    ((FAILED++))
    continue
  fi
  
  # Get record count
  count=$(mysql_query "SELECT COUNT(*) FROM \`${table}\`;" 2>/dev/null || echo "error")
  
  if [ "$count" = "error" ]; then
    echo -e "${BLUE}✗ ${table}: error reading count${NC}"
    ((FAILED++))
    continue
  fi
  
  # Format count with thousands separator
  formatted_count=$(printf "%'d" "$count" 2>/dev/null || echo "$count")
  
  echo -e "${GREEN}✓ ${table}: ${formatted_count}${NC}"
  ((TOTAL+=count))
  ((CHECKED++))
done

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ $CHECKED -gt 0 ]; then
  formatted_total=$(printf "%'d" "$TOTAL" 2>/dev/null || echo "$TOTAL")
  echo -e "${GREEN}✓ Checked ${CHECKED} tables${NC}"
  echo -e "${GREEN}Total records: ${formatted_total}${NC}"
fi

if [ $FAILED -gt 0 ]; then
  echo -e "${BLUE}⚠ ${FAILED} table(s) not found or error${NC}"
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
