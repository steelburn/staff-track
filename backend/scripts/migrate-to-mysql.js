#!/usr/bin/env node
'use strict';

/**
 * SQLite to MySQL Data Migration Script
 * Preserves all data from SQLite database into MySQL
 * Usage: node scripts/migrate-to-mysql.js [--dry-run]
 */

import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const SQLITE_PATH = '/data/submissions.db';

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'root_password',
  database: process.env.MYSQL_DATABASE || 'stafftrack',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// Table migration mapping with column transformations
const TABLE_MAPPINGS = {
  staff: {
    table: 'staff',
    columns: ['email', 'name', 'title', 'department', 'manager_name'],
  },
  submissions: {
    table: 'submissions',
    columns: ['id', 'staff_email', 'staff_name', 'title', 'department', 'manager_name', 'edited_fields', 'created_at', 'updated_at', 'updated_by_staff'],
    transforms: {
      edited_fields: (v) => v ? JSON.parse(v) : null,
      created_at: handleDatetime,
      updated_at: handleDatetime,
    }
  },
  submission_skills: {
    table: 'submission_skills',
    columns: ['id', 'submission_id', 'skill', 'rating'],
  },
  submission_projects: {
    table: 'submission_projects',
    columns: ['id', 'submission_id', 'soc', 'project_name', 'customer', 'role', 'start_date', 'end_date', 'description', 'key_contributions', 'technologies_used', 'is_active'],
    transforms: {
      start_date: (v) => v && convertSqliteDate(v),
      end_date: (v) => v && convertSqliteDate(v),
    }
  },
  user_roles: {
    table: 'user_roles',
    columns: ['email', 'role', 'is_active', 'created_at', 'updated_at'],
    transforms: {
      role: (v) => v || 'staff',
      is_active: (v) => v !== null ? v : 1,
      created_at: (v) => v && v.trim() && v !== 'null' ? convertSqliteDate(v) : new Date().toISOString().slice(0, 19).replace('T', ' '),
      updated_at: (v) => v && v !== 'null' ? convertSqliteDate(v) : new Date().toISOString().slice(0, 19).replace('T', ' '),
    }
  },
  projects_catalog: {
    table: 'projects_catalog',
    columns: ['id', 'soc', 'project_name', 'customer', 'end_date'],
    transforms: {
      end_date: (v) => v && convertSqliteDate(v),
      customer: (v) => handleUndefined(v, 'Unknown Customer'),
    }
  },
  managed_projects: {
    table: 'managed_projects',
    columns: ['id', 'soc', 'project_name', 'customer', 'type_infra', 'type_software', 'type_infra_support', 'type_software_support', 'start_date', 'end_date', 'technologies', 'description', 'coordinator_email', 'created_at'],
    transforms: {
      start_date: (v) => v && convertSqliteDate(v),
      end_date: (v) => v && convertSqliteDate(v),
      technologies: (v) => v ? JSON.parse(v) : null,
      created_at: (v) => v && convertSqliteDate(v),
    }
  },
  skills_catalog: {
    table: 'skills_catalog',
    columns: ['id', 'name', 'category', 'aliases', 'is_active'],
    transforms: {
      aliases: (v) => v ? JSON.parse(v) : null,
    }
  },
  skill_merge_log: {
    table: 'skill_merge_log',
    columns: ['id', 'from_name', 'to_name', 'affected_count', 'merged_by', 'merged_at'],
    transforms: {
      merged_at: (v) => v && convertSqliteDate(v),
    }
  },
  auth_tokens: {
    table: 'auth_tokens',
    columns: ['id', 'user_email', 'token_hash', 'refresh_token_hash', 'expires_at', 'created_at', 'revoked'],
    transforms: {
      expires_at: (v) => v && convertSqliteDate(v),
      created_at: (v) => v && convertSqliteDate(v),
    }
  },
  auth_audit_log: {
    table: 'auth_audit_log',
    columns: ['id', 'email', 'action', 'ip_address', 'user_agent', 'success', 'created_at'],
    transforms: {
      created_at: (v) => v && convertSqliteDate(v),
    }
  },
  cv_profiles: {
    table: 'cv_profiles',
    columns: ['id', 'staff_email', 'summary', 'phone', 'linkedin', 'location', 'photo_path', 'is_visible', 'created_at', 'updated_at'],
    transforms: {
      is_visible: (v) => v !== null ? v : 1,
      created_at: (v) => v && convertSqliteDate(v),
      updated_at: (v) => v && convertSqliteDate(v),
    }
  },
  education: {
    table: 'education',
    columns: ['id', 'staff_email', 'institution', 'degree', 'field', 'start_year', 'end_year', 'description', 'proof_path', 'is_visible', 'created_at'],
    transforms: {
      is_visible: (v) => v !== null ? v : 1,
      created_at: (v) => v && convertSqliteDate(v),
    }
  },
  certifications: {
    table: 'certifications',
    columns: ['id', 'staff_email', 'name', 'issuer', 'date_obtained', 'expiry_date', 'credential_id', 'description', 'proof_path', 'is_visible', 'created_at'],
    transforms: {
      date_obtained: (v) => v && convertSqliteDate(v),
      expiry_date: (v) => v && convertSqliteDate(v),
      is_visible: (v) => v !== null ? v : 1,
      created_at: (v) => v && convertSqliteDate(v),
    }
  },
  work_history: {
    table: 'work_history',
    columns: ['id', 'staff_email', 'employer', 'job_title', 'start_date', 'end_date', 'description', 'is_current', 'is_visible', 'created_at'],
    transforms: {
      start_date: (v) => v && convertSqliteDate(v),
      end_date: (v) => v && convertSqliteDate(v),
      is_current: (v) => v !== null ? v : 0,
      is_visible: (v) => v !== null ? v : 1,
      created_at: (v) => v && convertSqliteDate(v),
    }
  },
  cv_templates: {
    table: 'cv_templates',
    columns: ['id', 'name', 'markdown_template', 'css_styles', 'company_logo_path', 'is_default'],
  },
  cv_past_projects: {
    table: 'cv_past_projects',
    columns: ['id', 'staff_email', 'work_history_id', 'project_name', 'description', 'role', 'start_date', 'end_date', 'technologies', 'is_visible', 'created_at'],
    transforms: {
      start_date: (v) => v && convertSqliteDate(v),
      end_date: (v) => v && convertSqliteDate(v),
      is_visible: (v) => v !== null ? v : 1,
      created_at: (v) => v && convertSqliteDate(v),
    }
  },
  cv_snapshots: {
    table: 'cv_snapshots',
    columns: ['id', 'staff_email', 'generated_by', 'template_id', 'template_name', 'snapshot_html', 'snapshot_data', 'created_at'],
    transforms: {
      snapshot_data: (v) => v ? JSON.parse(v) : null,
      created_at: (v) => v && convertSqliteDate(v),
    }
  },
};

// Add default handling for created_at and undefined values
const handleUndefined = (value, defaultValue) => (value === undefined ? defaultValue : value);

// Enhanced datetime transformation with fallback for invalid values
function handleDatetime(value) {
  if (!value) return null; // Return null for empty values
  try {
    // Replace 'T' with a space and remove 'Z', then ensure valid MySQL format
    const formatted = value.replace('T', ' ').replace('Z', '').split('.')[0];
    return formatted;
  } catch (error) {
    console.error(`Invalid datetime value encountered: ${value}`);
    return null; // Fallback to null for invalid values
  }
}

/**
 * Convert SQLite ISO text to MySQL DATETIME format
 */
function convertSqliteDate(isoString) {
  if (!isoString) return null;
  return isoString.replace('T', ' ').split('.')[0];
}

// Refine datetime conversion logic to handle 'Z' suffix
const convertToMySQLDatetime = (isoDatetime) => {
  try {
    // Remove 'Z' suffix and convert to MySQL-compatible format
    const date = new Date(isoDatetime.replace('Z', ''));
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid datetime: ${isoDatetime}`);
    }
    return date.toISOString().slice(0, 19).replace('T', ' ');
  } catch (error) {
    console.error(`Error converting datetime: ${isoDatetime}`, error);
    return null; // Fallback to NULL for invalid datetime
  }
};

// Ensure the handleDatetime function is used for datetime fields in TABLE_MAPPINGS
TABLE_MAPPINGS.submissions.transforms.created_at = handleDatetime;
TABLE_MAPPINGS.submissions.transforms.updated_at = handleDatetime;

// Function to generate ON DUPLICATE KEY UPDATE clause for MySQL
function generateOnDuplicateKeyUpdate(columns) {
  return columns.map((col) => `${col} = VALUES(${col})`).join(', ');
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('\n🔄 SQLite to MySQL Data Migration');
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No data will be written\n');
  }

  // Verify SQLite database exists
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`❌ SQLite database not found at: ${SQLITE_PATH}`);
    process.exit(1);
  }

  // Connect to SQLite
  console.log('\n📂 Connecting to SQLite...');
  const sqliteDb = new Database(SQLITE_PATH);
  sqliteDb.pragma('foreign_keys = ON');
  console.log(`✓ SQLite connected: ${SQLITE_PATH}`);

  // Connect to MySQL
  console.log('🗄️  Connecting to MySQL...');
  let mysqlConnection;
  try {
    mysqlConnection = await mysql.createConnection(MYSQL_CONFIG);
    console.log(`✓ MySQL connected: ${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${MYSQL_CONFIG.database}`);
  } catch (error) {
    console.error('❌ MySQL connection failed:', error.message);
    sqliteDb.close();
    process.exit(1);
  }

  // Start migration
  console.log('\n📋 Starting data migration...\n');

  const stats = {
    tablesProcessed: 0,
    rowsMigrated: 0,
    errors: [],
  };

  try {
    for (const [tableName, mapping] of Object.entries(TABLE_MAPPINGS)) {
      try {
        // Check if table exists in SQLite
        const tableExists = sqliteDb.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        ).get(tableName);

        if (!tableExists) {
          console.log(`⊘ ${tableName} - not found in SQLite (skipped)`);
          continue;
        }

        // Get data from SQLite
        const rows = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all();

        if (rows.length === 0) {
          console.log(`○ ${tableName} - no data to migrate`);
          stats.tablesProcessed++;
          continue;
        }

        // Prepare columns and values
        const columns = mapping.columns;
        const placeholders = columns.map(() => '?').join(',');
        const insertSql = mapping.insertQuery
          ? mapping.insertQuery(columns)
          : `INSERT INTO ${mapping.table} (${columns.join(',')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${generateOnDuplicateKeyUpdate(columns)}`;

        if (!DRY_RUN) {
          // Disable foreign key checks temporarily
          await mysqlConnection.execute('SET FOREIGN_KEY_CHECKS=0');

          // Insert data
          for (const row of rows) {
            const values = columns.map(col => {
              let value = row[col];
              if (value === undefined) value = null; // Set undefined values to null
              if (mapping.transforms && mapping.transforms[col]) {
                value = mapping.transforms[col](value);
              }
              return value;
            });

            try {
              await mysqlConnection.execute(insertSql, values);
            } catch (error) {
              // Log error but continue
              stats.errors.push({
                table: tableName,
                row: row.id || row.email,
                error: error.message,
              });
              console.error(`  ⚠️  Error inserting row: ${error.message}`);
            }
          }

          // Re-enable foreign key checks
          await mysqlConnection.execute('SET FOREIGN_KEY_CHECKS=1');
        }

        console.log(`✓ ${tableName} - ${rows.length} row(s) migrated`);
        stats.tablesProcessed++;
        stats.rowsMigrated += rows.length;
      } catch (error) {
        console.error(`❌ ${tableName} - Migration failed: ${error.message}`);
        stats.errors.push({
          table: tableName,
          error: error.message,
        });
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary');
    console.log('='.repeat(60));
    console.log(`Tables processed: ${stats.tablesProcessed}`);
    console.log(`Total rows migrated: ${stats.rowsMigrated}`);

    if (stats.errors.length > 0) {
      console.log(`⚠️  Errors encountered: ${stats.errors.length}`);
      stats.errors.forEach((err, idx) => {
        console.log(`   ${idx + 1}. ${err.table}${err.row ? ` (${err.row})` : ''}: ${err.error}`);
      });
    }

    if (DRY_RUN) {
      console.log('\n✓ Dry run completed successfully - no data written');
    } else {
      console.log('\n✅ Data migration completed successfully!');
    }

    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    stats.errors.push({ error: error.message });
  } finally {
    sqliteDb.close();
    await mysqlConnection.end();
  }

  process.exit(stats.errors.length > 0 ? 1 : 0);
}

// Run migration
migrate().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Adjust user_roles migration logic to ensure default datetime values are always set
TABLE_MAPPINGS.user_roles.transforms = {
  role: (v) => v || 'staff',
  is_active: (v) => v !== null ? v : 1,
  created_at: (v) => v && v.trim() && v !== 'null' ? convertSqliteDate(v) : new Date().toISOString().slice(0, 19).replace('T', ' '),
  updated_at: (v) => v && v !== 'null' ? convertSqliteDate(v) : new Date().toISOString().slice(0, 19).replace('T', ' '),
};

// Ensure all rows are inserted by adding ON DUPLICATE KEY UPDATE logic
async function migrateTableWithUpsert(connection, tableName, rows, columns) {
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns.map((col) => `${col} = VALUES(${col})`).join(', ');
  const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;

  for (const row of rows) {
    const values = columns.map((col) => row[col]);
    await connection.execute(sql, values);
  }
}

// Replace user_roles migration logic
async function migrateUserRoles(connection, sqliteDb) {
  const rows = sqliteDb.prepare('SELECT * FROM user_roles').all();
  const transformedRows = rows.map((row) => {
    const formatDateTime = (value) => {
      if (!value || !value.trim()) {
        return new Date().toISOString().slice(0, 19).replace('T', ' ');
      }
      const date = new Date(value);
      return isNaN(date.getTime()) ? new Date().toISOString().slice(0, 19).replace('T', ' ') : date.toISOString().slice(0, 19).replace('T', ' ');
    };
    row.created_at = formatDateTime(row.created_at);
    row.updated_at = formatDateTime(row.updated_at);
    return row;
  });
  await migrateTableWithUpsert(connection, 'user_roles', transformedRows, TABLE_MAPPINGS.user_roles.columns);
}

// Call migrateUserRoles during migration
(async () => {
  const sqliteDb = new Database(SQLITE_PATH);
  const connection = await mysql.createPool(MYSQL_CONFIG);

  try {
    await migrateUserRoles(connection, sqliteDb);
  } finally {
    sqliteDb.close();
    await connection.end();
  }
})();
