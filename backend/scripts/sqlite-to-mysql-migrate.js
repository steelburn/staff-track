#!/usr/bin/env node
'use strict';

/**
 * SQLite to MySQL Data Migration Script
 * Migrates complete SQLite database to MySQL, preserving table structures
 * SQLite structure takes priority - creates MySQL tables from SQLite schema
 * 
 * Usage:
 *   node scripts/sqlite-to-mysql-migrate.js [--dry-run] [--sqlite-path PATH] [--drop-tables]
 * 
 * Options:
 *   --dry-run          Display migration plan without executing
 *   --sqlite-path      Path to SQLite database (default: /var/lib/mysql/_data)
 *   --drop-tables      Drop existing MySQL tables before migration
 */

import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const DROP_TABLES = argv.includes('--drop-tables');
const SQLITE_PATH_ARG = argv.find(arg => arg.startsWith('--sqlite-path='))?.split('=')[1];

const SQLITE_PATH = SQLITE_PATH_ARG || '/var/lib/mysql/_data';
const SQLITE_DB_FILE = path.join(SQLITE_PATH, 'submissions.db');

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER || 'stafftrack',
  password: process.env.MYSQL_PASSWORD || 'stafftrack_dev_password',
  database: process.env.MYSQL_DATABASE || 'stafftrack',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// ════════════════════════════════════════════════════════════════════════════
// MIGRATION LOGIC
// ════════════════════════════════════════════════════════════════════════════

class SQLiteToMySQLMigrator {
  constructor(sqlitePath, mysqlConfig, dryRun = false) {
    this.sqlitePath = sqlitePath;
    this.mysqlConfig = mysqlConfig;
    this.dryRun = dryRun;
    this.stats = {
      tablesCreated: 0,
      recordsMigrated: 0,
      errors: [],
    };
  }

  /**
   * Convert SQLite data type to MySQL equivalent
   */
  convertDataType(sqliteType) {
    if (!sqliteType) return 'TEXT';
    
    const type = sqliteType.toUpperCase();
    
    if (type.includes('INT')) return 'INT';
    if (type.includes('REAL') || type.includes('FLOAT')) return 'FLOAT';
    if (type.includes('BLOB')) return 'LONGBLOB';
    if (type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT')) {
      return type.includes('TEXT') ? 'LONGTEXT' : 'VARCHAR(255)';
    }
    if (type.includes('DATE') || type.includes('TIME')) return 'DATETIME';
    if (type.includes('BOOL')) return 'TINYINT(1)';
    
    return 'TEXT';
  }

  /**
   * Convert SQLite column definition to MySQL
   */
  convertColumnDef(colName, colType, notNull, defaultValue, isPrimaryKey) {
    let def = `\`${colName}\` ${this.convertDataType(colType)}`;
    
    if (isPrimaryKey) {
      def += ' PRIMARY KEY';
    } else {
      if (notNull) def += ' NOT NULL';
      if (defaultValue !== undefined && defaultValue !== null && defaultValue !== '') {
        const val = defaultValue.toString();
        if (val === 'CURRENT_TIMESTAMP' || val === 'CURRENT_DATE' || val === 'CURRENT_TIME') {
          def += ` DEFAULT ${val}`;
        } else if (!isNaN(val)) {
          def += ` DEFAULT ${val}`;
        } else if (val.toLowerCase() === 'true' || val === '1') {
          def += ' DEFAULT 1';
        } else if (val.toLowerCase() === 'false' || val === '0') {
          def += ' DEFAULT 0';
        } else {
          def += ` DEFAULT '${val.replace(/'/g, "''")}'`;
        }
      }
    }
    
    return def;
  }

  /**
   * Extract SQLite schema and generate MySQL CREATE TABLE statements
   */
  extractAndConvertSchema(sqliteDb) {
    const tables = {};
    
    // Get all tables from SQLite
    const tableList = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();

    console.log(`\n📊 Found ${tableList.length} tables in SQLite`);

    for (const tableRow of tableList) {
      const tableName = tableRow.name;
      
      // Get table info
      const tableInfo = sqliteDb.prepare(`PRAGMA table_info(${tableName})`).all();
      
      if (tableInfo.length === 0) {
        console.warn(`  ⚠️  Skipping empty table: ${tableName}`);
        continue;
      }

      // Get foreign keys
      const foreignKeys = sqliteDb.prepare(`PRAGMA foreign_key_list(${tableName})`).all();

      // Build CREATE TABLE statement
      let createStatement = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (\n`;
      
      const columnDefs = tableInfo.map(col => 
        this.convertColumnDef(
          col.name,
          col.type,
          col.notnull === 1,
          col.dflt_value,
          col.pk === 1
        )
      );

      createStatement += columnDefs.map(def => `  ${def}`).join(',\n');

      // Add foreign key constraints
      if (foreignKeys.length > 0) {
        createStatement += ',\n';
        const fkDefs = foreignKeys.map(fk =>
          `  FOREIGN KEY (\`${fk.from}\`) REFERENCES \`${fk.table}\`(\`${fk.to}\`) ON DELETE ${fk.on_delete}`
        );
        createStatement += fkDefs.join(',\n');
      }

      createStatement += '\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';

      tables[tableName] = {
        createStatement,
        columns: tableInfo.map(col => col.name),
        count: sqliteDb.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get().cnt,
      };

      console.log(`  ✓ ${tableName} (${tables[tableName].count} records)`);
    }

    return tables;
  }

  /**
   * Migrate data from SQLite to MySQL
   */
  async migrateData(sqliteDb, mysqlConnection, tables) {
    console.log('\n📦 Migrating data...');

    for (const [tableName, tableInfo] of Object.entries(tables)) {
      try {
        // Get all rows from SQLite
        const rows = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all();
        
        if (rows.length === 0) {
          console.log(`  ✓ ${tableName} (0 records - skipped)`);
          continue;
        }

        // Insert in batches
        const batchSize = 1000;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          
          for (const row of batch) {
            const columns = Object.keys(row);
            const values = Object.values(row).map(v => {
              // Convert SQLite values to MySQL-compatible format
              if (v === null || v === undefined) return null;
              if (typeof v === 'object') return JSON.stringify(v);
              return v;
            });

            const placeholders = columns.map(() => '?').join(', ');
            const sql = `INSERT INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES (${placeholders})`;
            
            if (!this.dryRun) {
              try {
                await mysqlConnection.execute(sql, values);
              } catch (err) {
                console.error(`  ❌ Error inserting into ${tableName}:`, err.message);
                this.stats.errors.push({
                  table: tableName,
                  row: row,
                  error: err.message,
                });
              }
            }
          }
        }

        this.stats.recordsMigrated += rows.length;
        console.log(`  ✓ ${tableName} (${rows.length} records migrated)`);

      } catch (err) {
        console.error(`  ❌ Failed to migrate ${tableName}:`, err.message);
        this.stats.errors.push({
          table: tableName,
          error: err.message,
        });
      }
    }
  }

  /**
   * Run the complete migration
   */
  async run() {
    console.log('\n' + '═'.repeat(70));
    console.log('🚀 SQLite to MySQL Migration');
    console.log('═'.repeat(70));
    console.log(`Source SQLite:  ${SQLITE_DB_FILE}`);
    console.log(`Target MySQL:   ${this.mysqlConfig.host}:${this.mysqlConfig.port}/${this.mysqlConfig.database}`);
    console.log(`Mode:           ${this.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log('═'.repeat(70));

    // Check SQLite file exists
    if (!fs.existsSync(SQLITE_DB_FILE)) {
      console.error(`\n❌ SQLite database not found: ${SQLITE_DB_FILE}`);
      process.exit(1);
    }

    // Open SQLite connection
    console.log('\n🔗 Connecting to SQLite...');
    let sqliteDb;
    try {
      sqliteDb = new Database(SQLITE_DB_FILE, { readonly: true });
      sqliteDb.pragma('journal_mode = WAL');
      console.log('✓ Connected to SQLite');
    } catch (err) {
      console.error(`❌ Failed to connect to SQLite: ${err.message}`);
      process.exit(1);
    }

    // Connect to MySQL
    console.log('🔗 Connecting to MySQL...');
    let mysqlPool;
    let mysqlConnection;
    try {
      mysqlPool = await mysql.createPool(this.mysqlConfig);
      mysqlConnection = await mysqlPool.getConnection();
      await mysqlConnection.ping();
      console.log('✓ Connected to MySQL');
    } catch (err) {
      console.error(`❌ Failed to connect to MySQL: ${err.message}`);
      process.exit(1);
    }

    try {
      // Extract schema
      const tables = this.extractAndConvertSchema(sqliteDb);
      console.log(`\n✓ Schema extracted from ${Object.keys(tables).length} tables\n`);

      // Drop existing tables if requested
      if (DROP_TABLES && !this.dryRun) {
        console.log('🗑️  Dropping existing tables...');
        for (const tableName of Object.keys(tables)) {
          try {
            await mysqlConnection.execute(`DROP TABLE IF EXISTS \`${tableName}\``);
            console.log(`  ✓ Dropped ${tableName}`);
          } catch (err) {
            console.warn(`  ⚠️  Could not drop ${tableName}: ${err.message}`);
          }
        }
      }

      // Create tables in MySQL
      console.log('\n📋 Creating MySQL tables...');
      for (const [tableName, tableInfo] of Object.entries(tables)) {
        try {
          if (!this.dryRun) {
            await mysqlConnection.execute(tableInfo.createStatement);
          }
          console.log(`  ✓ ${tableName}`);
          this.stats.tablesCreated++;
        } catch (err) {
          console.error(`  ❌ Failed to create ${tableName}: ${err.message}`);
          this.stats.errors.push({
            step: 'CREATE TABLE',
            table: tableName,
            error: err.message,
          });
        }
      }

      // Migrate data
      if (!this.dryRun) {
        await this.migrateData(sqliteDb, mysqlConnection, tables);
      }

      // Print summary
      console.log('\n' + '═'.repeat(70));
      console.log('📊 Migration Summary');
      console.log('═'.repeat(70));
      console.log(`Tables Created:  ${this.stats.tablesCreated}`);
      console.log(`Records Migrated: ${this.stats.recordsMigrated}`);
      console.log(`Errors:          ${this.stats.errors.length}`);
      
      if (this.stats.errors.length > 0) {
        console.log('\n⚠️  Errors encountered:');
        this.stats.errors.forEach(err => {
          console.log(`  - ${err.table || err.step}: ${err.error}`);
        });
      }

      if (this.dryRun) {
        console.log('\n✓ Dry run completed. No data was modified.');
      } else {
        console.log('\n✅ Migration completed successfully!');
      }

    } finally {
      sqliteDb.close();
      await mysqlConnection.release();
      await mysqlPool.end();
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

const migrator = new SQLiteToMySQLMigrator(SQLITE_PATH, MYSQL_CONFIG, DRY_RUN);
migrator.run().catch(err => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
