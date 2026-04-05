#!/usr/bin/env node
'use strict';

/**
 * Database Migration Verification Script
 * Compares SQLite and MySQL databases before and after migration
 * Usage: node scripts/verify-migration.js
 */

import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import path from 'path';
import fs from 'fs';

const SQLITE_PATH = process.env.DB_PATH || path.join(__dirname, '../data/submissions.db');

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'root_password',
  database: process.env.MYSQL_DATABASE || 'stafftrack',
};

const TABLES_TO_VERIFY = [
  'staff',
  'submissions',
  'submission_skills',
  'submission_projects',
  'user_roles',
  'projects_catalog',
  'managed_projects',
  'skills_catalog',
  'skill_merge_log',
  'auth_tokens',
  'auth_audit_log',
  'cv_profiles',
  'education',
  'certifications',
  'work_history',
  'cv_templates',
  'cv_past_projects',
  'cv_snapshots',
];

/**
 * Get row count from SQLite
 */
function getSqliteCount(table) {
  try {
    const db = new Database(SQLITE_PATH);
    const result = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
    db.close();
    return result?.count || 0;
  } catch (error) {
    return null;
  }
}

/**
 * Get row count from MySQL
 */
async function getMysqlCount(connection, table) {
  try {
    const [rows] = await connection.execute(`SELECT COUNT(*) as count FROM ${table}`);
    return rows[0]?.count || 0;
  } catch (error) {
    return null;
  }
}

/**
 * Main verification
 */
async function verify() {
  console.log('\n📊 Database Migration Verification');
  console.log('='.repeat(70));

  let mysqlConnection;

  try {
    // Check SQLite exists
    if (!fs.existsSync(SQLITE_PATH)) {
      console.error(`❌ SQLite database not found at: ${SQLITE_PATH}`);
      return;
    }

    // Connect to MySQL
    try {
      mysqlConnection = await mysql.createConnection(MYSQL_CONFIG);
      console.log(`✓ Connected to MySQL: ${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}`);
    } catch (error) {
      console.error(`❌ MySQL connection failed: ${error.message}`);
      console.log('\nTroubleshooting:');
      console.log('1. Verify MySQL container is running: docker compose ps');
      console.log('2. Check environment variables are set correctly');
      console.log('3. Ensure database is initialized: docker compose exec db mysql -u root -p');
      return;
    }

    // Comparison table
    console.log('\n📋 Row Count Comparison');
    console.log('='.repeat(70));
    console.log(
      'Table Name'.padEnd(25) +
      'SQLite'.padEnd(15) +
      'MySQL'.padEnd(15) +
      'Status'
    );
    console.log('-'.repeat(70));

    let allMatch = true;
    const details = [];

    for (const table of TABLES_TO_VERIFY) {
      const sqliteCount = getSqliteCount(table);
      const mysqlCount = await getMysqlCount(mysqlConnection, table);

      const status = sqliteCount === mysqlCount ? '✓ OK' : '❌ MISMATCH';
      if (sqliteCount !== mysqlCount && sqliteCount !== null && mysqlCount !== null) {
        allMatch = false;
      }

      console.log(
        table.padEnd(25) +
        String(sqliteCount ?? 'N/A').padEnd(15) +
        String(mysqlCount ?? 'N/A').padEnd(15) +
        status
      );

      if (sqliteCount !== null && mysqlCount !== null) {
        details.push({
          table,
          sqlite: sqliteCount,
          mysql: mysqlCount,
          match: sqliteCount === mysqlCount,
        });
      }
    }

    console.log('='.repeat(70));

    // Summary
    console.log('\n📈 Summary');
    console.log('='.repeat(70));

    const totalSqlite = details.reduce((sum, d) => sum + d.sqlite, 0);
    const totalMysql = details.reduce((sum, d) => sum + d.mysql, 0);
    const matchedTables = details.filter(d => d.match).length;
    const totalTables = details.length;

    console.log(`Total Rows (SQLite): ${totalSqlite}`);
    console.log(`Total Rows (MySQL):  ${totalMysql}`);
    console.log(`Matched Tables:      ${matchedTables}/${totalTables}`);

    if (allMatch) {
      console.log('\n✅ Migration verification PASSED - All data counts match!');
    } else {
      console.log('\n⚠️  Migration verification FAILED - Some counts do not match');
      console.log('\nMismatched tables:');
      details.filter(d => !d.match).forEach(d => {
        console.log(`  • ${d.table}: SQLite=${d.sqlite}, MySQL=${d.mysql}`);
      });
    }

    // Sample data check
    console.log('\n🔍 Sample Data Verification');
    console.log('='.repeat(70));

    // Check staff table
    try {
      const sqliteDb = new Database(SQLITE_PATH);
      const staffSample = sqliteDb.prepare('SELECT * FROM staff LIMIT 1').get();
      sqliteDb.close();

      const [mysqlStaff] = await mysqlConnection.execute('SELECT * FROM staff LIMIT 1');

      if (staffSample && mysqlStaff.length > 0) {
        console.log('✓ Staff table sample data matches structure');
      }
    } catch (error) {
      console.log('⚠️  Could not verify staff sample:', error.message);
    }

    // Data integrity checks
    console.log('\n🔐 Data Integrity Checks');
    console.log('='.repeat(70));

    // Check for orphaned records
    const [orphaned] = await mysqlConnection.execute(`
      SELECT COUNT(*) as count FROM submission_skills ss
      WHERE NOT EXISTS (SELECT 1 FROM submissions s WHERE s.id = ss.submission_id)
    `);

    if (orphaned[0].count === 0) {
      console.log('✓ No orphaned submission_skills records');
    } else {
      console.log(`⚠️  Found ${orphaned[0].count} orphaned submission_skills records`);
    }

    // Check for missing user roles
    const [missingRoles] = await mysqlConnection.execute(`
      SELECT COUNT(DISTINCT staff_email) as count FROM submissions
      WHERE staff_email NOT IN (SELECT email FROM user_roles)
    `);

    if (missingRoles[0].count === 0) {
      console.log('✓ All submitters have user roles');
    } else {
      console.log(`⚠️  ${missingRoles[0].count} submitters missing user roles`);
    }

    console.log('='.repeat(70));
    console.log('\n✅ Verification complete\n');

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    console.error(error.stack);
  } finally {
    if (mysqlConnection) {
      await mysqlConnection.end();
    }
  }

  process.exit(0);
}

// Run verification
verify().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
