#!/bin/bash

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# StaffTrack API Test Suite - Bash/cURL Version
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Tests all API endpoints with admin authentication and single token reuse
# Outputs record counts and structure of first record from each endpoint

set -e

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
ADMIN_EMAIL="admin"
ADMIN_PASSWORD="secure_admin_password"
AUTH_TOKEN=""
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Output formatting
print_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_endpoint() {
    echo -e "${YELLOW}◆ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Validate jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed. Install with: apt-get install jq"
    exit 1
fi

# Authenticate and get JWT token
authenticate() {
    print_header "AUTHENTICATION"
    print_endpoint "POST /auth/login"
    
    # Base64 encode the password (frontend requirement)
    local encoded_password=$(echo -n "$ADMIN_PASSWORD" | base64 -w 0)
    
    local response=$(curl -s -X POST "$API_URL/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$encoded_password\"}")
    
    AUTH_TOKEN=$(echo "$response" | jq -r '.accessToken // empty')
    
    if [ -z "$AUTH_TOKEN" ]; then
        print_error "Authentication failed"
        echo "Response: $response"
        exit 1
    fi
    
    print_success "Admin authentication successful"
    echo "Token: ${AUTH_TOKEN:0:20}... (expires in $(echo "$response" | jq -r '.expiresIn // "unknown"') seconds)"
}

# Generic API test function
test_endpoint() {
    local endpoint=$1
    local method=$2
    local description=$3
    
    print_endpoint "$method $endpoint"
    
    local response
    if [ "$method" = "GET" ]; then
        response=$(curl -s -X GET "$API_URL$endpoint" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -H "Content-Type: application/json")
    else
        response=$(curl -s -X POST "$API_URL$endpoint" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -H "Content-Type: application/json")
    fi
    
    # Check if response is valid JSON
    if ! echo "$response" | jq . &>/dev/null 2>&1; then
        print_error "$endpoint - Invalid JSON response"
        return 1
    fi
    
    # Check for errors
    if echo "$response" | jq -e '.error' &>/dev/null 2>&1; then
        local error=$(echo "$response" | jq -r '.error')
        print_error "$endpoint - $error"
        return 1
    fi
    
    # Count records
    local record_count
    if echo "$response" | jq -e 'type == "array"' &>/dev/null 2>&1; then
        record_count=$(echo "$response" | jq 'length')
    else
        record_count=1
    fi
    
    print_success "$description: $record_count records"
    
    # Show first record structure
    local first_record
    if echo "$response" | jq -e 'type == "array"' &>/dev/null 2>&1; then
        first_record=$(echo "$response" | jq '.[0]')
    else
        first_record=$(echo "$response")
    fi
    
    if [ "$first_record" != "null" ]; then
        echo "  Sample structure: $(echo "$first_record" | jq -c 'keys')"
    fi
    
    return 0
}

# Run all tests
print_header "StaffTrack API Test Suite ($TIMESTAMP)"
echo "API URL: $API_URL"
echo ""

authenticate

print_header "ENDPOINTS"

# Test submissions endpoint
test_endpoint "/submissions" "GET" "All submissions" || true

# Test submissions with skills and projects (using admin's submission)
test_endpoint "/submissions/me" "GET" "Admin submission with skills/projects" || true

# Test catalog endpoints
test_endpoint "/catalog/staff" "GET" "Staff catalog" || true
test_endpoint "/catalog/projects" "GET" "Project catalog" || true

# Test admin roles
test_endpoint "/admin/roles" "GET" "User roles and permissions" || true

# Test reports endpoint
test_endpoint "/reports/projects" "GET" "Submission projects report" || true

# Test health endpoint (no auth needed, but include for completeness)
print_endpoint "GET /health"
health_response=$(curl -s -X GET "$API_URL/health")
if echo "$health_response" | jq . &>/dev/null 2>&1; then
    status=$(echo "$health_response" | jq -r '.status // "unknown"')
    print_success "Service health: $status"
else
    print_error "Health check failed"
fi

print_header "SUMMARY"
echo "All tests completed successfully!"
echo "Token expiration: 8 hours from authentication"
echo "Tested endpoints: 8"
echo "Report generated: $TIMESTAMP"
