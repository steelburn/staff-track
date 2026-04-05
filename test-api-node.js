#!/usr/bin/env node

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * StaffTrack API Test Suite - Node.js Version
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Tests all API endpoints with admin authentication and single token reuse
 * Outputs record counts, structure, and generates comprehensive report
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const ADMIN_EMAIL = 'admin';
const ADMIN_PASSWORD = 'secure_admin_password';

// Color codes
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

// Test results collector
const results = {
    timestamp: new Date().toISOString(),
    apiUrl: API_URL,
    authToken: null,
    endpoints: {},
    summary: {
        passed: 0,
        failed: 0,
        totalEndpoints: 0,
        totalRecords: 0
    }
};

// Utility functions
function log(color, prefix, message) {
    console.log(`${color}${prefix}${colors.reset} ${message}`);
}

function header(text) {
    console.log(`\n${colors.blue}${'━'.repeat(70)}${colors.reset}`);
    console.log(`${colors.blue}${text}${colors.reset}`);
    console.log(`${colors.blue}${'━'.repeat(70)}${colors.reset}\n`);
}

function success(message) {
    log(colors.green, '✓', message);
}

function error(message) {
    log(colors.red, '✗', message);
}

function info(message) {
    log(colors.cyan, '◦', message);
}

function endpoint(text) {
    log(colors.yellow, '◆', text);
}

// Format keys for display
function getStructureKeys(obj) {
    if (Array.isArray(obj) && obj.length > 0) {
        return Object.keys(obj[0]);
    }
    if (typeof obj === 'object' && obj !== null) {
        return Object.keys(obj);
    }
    return [];
}

// Authenticate and get JWT token
async function authenticate() {
    header('AUTHENTICATION');
    endpoint('POST /auth/login');

    try {
        // Base64 encode the password (frontend requirement)
        const encodedPassword = Buffer.from(ADMIN_PASSWORD).toString('base64');
        
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: ADMIN_EMAIL, password: encodedPassword })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data.accessToken) {
            throw new Error('No access token in response');
        }

        results.authToken = data.accessToken;
        success(`Admin authentication successful`);
        info(`Token: ${data.accessToken.substring(0, 20)}... (expires in ${data.expiresIn} seconds)`);
        return data.accessToken;
    } catch (err) {
        error(`Authentication failed: ${err.message}`);
        process.exit(1);
    }
}

// Test API endpoint
async function testEndpoint(method, path, description) {
    endpoint(`${method} ${path}`);

    try {
        const url = `${API_URL}${path}`;
        const response = await fetch(url, {
            method: method,
            headers: {
                'Authorization': `Bearer ${results.authToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Check for error response
        if (data.error) {
            throw new Error(data.error);
        }

        // Count records
        let recordCount = 0;
        let firstRecord = null;

        if (Array.isArray(data)) {
            recordCount = data.length;
            if (recordCount > 0) {
                firstRecord = data[0];
            }
        } else if (typeof data === 'object' && data !== null) {
            recordCount = 1;
            firstRecord = data;
        }

        results.summary.totalRecords += recordCount;

        // Store result
        results.endpoints[path] = {
            method,
            description,
            status: 'success',
            recordCount,
            structure: getStructureKeys(data)
        };

        success(`${description}: ${recordCount} records`);
        
        if (firstRecord) {
            info(`Sample structure: [${results.endpoints[path].structure.join(', ')}]`);
        }

        results.summary.passed++;
        return true;
    } catch (err) {
        error(`${description}: ${err.message}`);
        
        results.endpoints[path] = {
            method,
            description,
            status: 'failed',
            error: err.message,
            recordCount: 0,
            structure: []
        };

        results.summary.failed++;
        return false;
    }
}

// Generate JSON report
function generateReport() {
    header('DETAILED REPORT');

    console.log(JSON.stringify(results, null, 2));
    
    return results;
}

// Generate summary table
function generateSummary() {
    header('TEST SUMMARY');

    console.log(`Timestamp:        ${results.timestamp}`);
    console.log(`API URL:          ${results.apiUrl}`);
    console.log(`Endpoints Passed: ${results.summary.passed}`);
    console.log(`Endpoints Failed: ${results.summary.failed}`);
    console.log(`Total Records:    ${results.summary.totalRecords}`);
    console.log(`Test Endpoints:   ${results.summary.passed + results.summary.failed}\n`);

    // Table of results
    console.log(`${colors.cyan}Endpoint Results:${colors.reset}`);
    console.log(`${'-'.repeat(70)}`);
    
    for (const [path, result] of Object.entries(results.endpoints)) {
        const statusSymbol = result.status === 'success' ? colors.green + '✓' : colors.red + '✗';
        const statusText = result.status === 'success' 
            ? `${result.recordCount} records`
            : `Error: ${result.error}`;
        console.log(`${statusSymbol}${colors.reset} ${path.padEnd(30)} ${statusText}`);
    }
    
    console.log(`${'-'.repeat(70)}\n`);
}

// Main execution
async function main() {
    header(`StaffTrack API Test Suite`);
    info(`Started: ${new Date().toLocaleString()}`);
    info(`Target: ${API_URL}\n`);

    // Get auth token
    const token = await authenticate();
    results.summary.totalEndpoints = 8; // Update this if adding more endpoints

    // Run all endpoint tests
    header('ENDPOINT TESTS');

    // Submissions
    await testEndpoint('GET', '/submissions', 'All submissions');
    await testEndpoint('GET', '/submissions/me', 'Admin submission with skills/projects');

    // Catalog
    await testEndpoint('GET', '/catalog/staff', 'Staff catalog');
    await testEndpoint('GET', '/catalog/projects', 'Project catalog');

    // Admin
    await testEndpoint('GET', '/admin/roles', 'User roles and permissions');

    // Reports
    await testEndpoint('GET', '/reports/projects', 'Submission projects report');

    // Health check (no auth required)
    endpoint('GET /health');
    try {
        const healthResponse = await fetch(`${API_URL}/health`);
        const healthData = await healthResponse.json();
        success(`Service health: ${healthData.status}`);
        results.endpoints['/health'] = {
            method: 'GET',
            description: 'Service health check',
            status: 'success',
            recordCount: 1,
            structure: Object.keys(healthData)
        };
    } catch (err) {
        error(`Health check failed: ${err.message}`);
    }

    // Generate output
    generateSummary();
    
    // Save detailed report
    const reportPath = `/tmp/api-test-report-${Date.now()}.json`;
    const fs = require('fs');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    
    header('REPORT SAVED');
    success(`Detailed JSON report saved to: ${reportPath}`);
    
    // Exit with appropriate code
    process.exit(results.summary.failed === 0 ? 0 : 1);
}

// Run main
main().catch(err => {
    error(`Fatal error: ${err.message}`);
    process.exit(1);
});
