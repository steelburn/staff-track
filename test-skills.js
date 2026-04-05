#!/usr/bin/env node

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Skills Data Extractor - Node.js
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Extracts all skills from skills_catalog and submission_skills tables
 * Provides statistics and structure analysis
 */

import mysql from 'mysql2/promise';

// Configuration
const DB_CONFIG = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER || 'stafftrack',
    password: process.env.MYSQL_PASSWORD || 'stafftrack_dev_password',
    database: process.env.MYSQL_DATABASE || 'stafftrack'
};

// Color codes
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

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

async function getSkillsData() {
    let connection;
    
    try {
        header('Connecting to Database');
        info(`Host: ${DB_CONFIG.host}:${DB_CONFIG.port}`);
        info(`Database: ${DB_CONFIG.database}\n`);

        connection = await mysql.createConnection(DB_CONFIG);
        success('Database connection established');

        header('Skills Catalog');

        // Get all skills from skills_catalog
        const [skillsCatalog] = await connection.query(
            'SELECT id, name, category, is_active FROM skills_catalog ORDER BY name ASC'
        );

        success(`Skills catalog: ${skillsCatalog.length} total skills`);
        
        if (skillsCatalog.length > 0) {
            info(`Sample structure: ${JSON.stringify(skillsCatalog[0])}`);
            
            // Group by category
            const byCategory = {};
            skillsCatalog.forEach(skill => {
                const cat = skill.category || 'Uncategorized';
                byCategory[cat] = (byCategory[cat] || 0) + 1;
            });
            
            console.log(`\n  Skills by category:`);
            Object.entries(byCategory).forEach(([cat, count]) => {
                console.log(`    • ${cat}: ${count} skills`);
            });
        }

        header('Submission Skills');

        // Get all unique skills submitted
        const [submissionSkills] = await connection.query(`
            SELECT DISTINCT skill, COUNT(*) as occurrences, AVG(rating) as avg_rating
            FROM submission_skills
            GROUP BY skill
            ORDER BY occurrences DESC
        `);

        success(`Submitted skills: ${submissionSkills.length} unique skills`);
        
        if (submissionSkills.length > 0) {
            info(`Sample structure: ${JSON.stringify(submissionSkills[0])}`);
            
            console.log(`\n  Top 10 most submitted skills:`);
            submissionSkills.slice(0, 10).forEach((skill, idx) => {
                console.log(`    ${idx + 1}. ${skill.skill} (${skill.occurrences}x, avg rating: ${skill.avg_rating.toFixed(1)})`);
            });
        }

        // Get total skill submissions
        const [skillStats] = await connection.query(`
            SELECT 
                COUNT(*) as total_skill_records,
                COUNT(DISTINCT submission_id) as submissions_with_skills,
                AVG(rating) as avg_skill_rating
            FROM submission_skills
        `);

        header('Skills Statistics');
        
        if (skillStats.length > 0 && skillStats[0]) {
            success(`Total skill records: ${skillStats[0].total_skill_records}`);
            success(`Submissions with skills: ${skillStats[0].submissions_with_skills}`);
            success(`Average skill rating: ${Number(skillStats[0].avg_skill_rating).toFixed(2)}`);
        }

        // Show rating distribution
        const [ratingDist] = await connection.query(`
            SELECT rating, COUNT(*) as count
            FROM submission_skills
            WHERE rating > 0
            GROUP BY rating
            ORDER BY rating DESC
        `);

        if (ratingDist.length > 0) {
            console.log(`\n  Skill rating distribution:`);
            ratingDist.forEach(row => {
                const bar = '█'.repeat(Math.round(row.count / 5));
                console.log(`    Rating ${row.rating}: ${bar} (${row.count} skills)`);
            });
        }

        header('Summary');
        console.log(`
  Total unique skills in catalog:     ${skillsCatalog.length}
  Total unique skills submitted:      ${submissionSkills.length}
  Total skill records:                ${skillStats[0]?.total_skill_records || 0}
  Submissions with skills:            ${skillStats[0]?.submissions_with_skills || 0}
  
  Report generated: ${new Date().toLocaleString()}
        `);

        await connection.end();
        success('Database connection closed');

    } catch (err) {
        error(`Error: ${err.message}`);
        process.exit(1);
    }
}

// Run
getSkillsData().catch(err => {
    error(`Fatal error: ${err.message}`);
    process.exit(1);
});
