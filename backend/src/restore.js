'use strict';
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

/**
 * Restore database from a JSON dump file
 */
function restoreDatabase(dumpPath, options = {}) {
  try {
    if (!fs.existsSync(dumpPath)) {
      throw new Error(`Dump file not found: ${dumpPath}`);
    }

    const dumpData = JSON.parse(fs.readFileSync(dumpPath, 'utf-8'));
    const db = getDb();

    let totalRows = 0;
    const results = {
      tables_processed: 0,
      total_rows_imported: 0,
      errors: []
    };

    // Process each table in the dump
    for (const [tableName, rows] of Object.entries(dumpData.tables || {})) {
      if (!Array.isArray(rows) || rows.length === 0) {
        console.log(`⊘ Skipped ${tableName}: no data`);
        continue;
      }

      try {
        // Get column names from the first row
        const columns = Object.keys(rows[0]);
        const placeholders = columns.map(() => '?').join(', ');
        const columnList = columns.join(', ');

        const insertStmt = db.prepare(
          `INSERT OR REPLACE INTO ${tableName} (${columnList}) VALUES (${placeholders})`
        );

        const transaction = db.transaction((dataRows) => {
          for (const row of dataRows) {
            const values = columns.map(col => row[col]);
            insertStmt.run(...values);
          }
        });

        transaction(rows);
        
        results.tables_processed++;
        results.total_rows_imported += rows.length;
        console.log(`✓ Restored ${tableName}: ${rows.length} rows`);
      } catch (err) {
        const errorMsg = `Failed to restore ${tableName}: ${err.message}`;
        console.error(`✗ ${errorMsg}`);
        results.errors.push(errorMsg);
      }
    }

    console.log(`\n✓ Database restoration complete:`);
    console.log(`  Tables processed: ${results.tables_processed}`);
    console.log(`  Rows imported: ${results.total_rows_imported}`);
    
    if (results.errors.length > 0) {
      console.log(`  Errors: ${results.errors.length}`);
    }

    return results;
  } catch (err) {
    console.error('✗ Database restoration failed:', err.message);
    throw err;
  }
}

/**
 * Restore database from a JSON object (in memory)
 */
function restoreDatabaseFromJson(dumpData, options = {}) {
  try {
    const db = getDb();

    let totalRows = 0;
    const results = {
      tables_processed: 0,
      total_rows_imported: 0,
      errors: []
    };

    // Process each table in the dump
    for (const [tableName, rows] of Object.entries(dumpData.tables || {})) {
      if (!Array.isArray(rows) || rows.length === 0) {
        continue;
      }

      try {
        // Get column names from the first row
        const columns = Object.keys(rows[0]);
        const placeholders = columns.map(() => '?').join(', ');
        const columnList = columns.join(', ');

        const insertStmt = db.prepare(
          `INSERT OR REPLACE INTO ${tableName} (${columnList}) VALUES (${placeholders})`
        );

        const transaction = db.transaction((dataRows) => {
          for (const row of dataRows) {
            const values = columns.map(col => row[col]);
            insertStmt.run(...values);
          }
        });

        transaction(rows);
        
        results.tables_processed++;
        results.total_rows_imported += rows.length;
      } catch (err) {
        const errorMsg = `Failed to restore ${tableName}: ${err.message}`;
        results.errors.push(errorMsg);
      }
    }

    return results;
  } catch (err) {
    console.error('Database restoration failed:', err.message);
    throw err;
  }
}

module.exports = {
  restoreDatabase,
  restoreDatabaseFromJson
};
