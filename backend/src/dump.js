'use strict';
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

/**
 * Get all table names from the database
 */
function getTableNames(db) {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  return tables.map(t => t.name);
}

/**
 * Dump all database data to a JSON file
 */
function dumpDatabase(outputPath) {
  try {
    const db = getDb();
    const dump = {
      exported_at: new Date().toISOString(),
      tables: {}
    };

    const tables = getTableNames(db);

    for (const tableName of tables) {
      try {
        const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
        dump.tables[tableName] = rows;
        console.log(`✓ Dumped ${tableName}: ${rows.length} rows`);
      } catch (err) {
        console.error(`✗ Failed to dump ${tableName}:`, err.message);
      }
    }

    fs.writeFileSync(outputPath, JSON.stringify(dump, null, 2), 'utf-8');
    console.log(`\n✓ Database dump saved to: ${outputPath}`);
    console.log(`  File size: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);
    
    return dump;
  } catch (err) {
    console.error('✗ Database dump failed:', err.message);
    throw err;
  }
}

/**
 * Dump database and return as JSON
 */
function dumpDatabaseAsJson() {
  try {
    const db = getDb();
    const dump = {
      exported_at: new Date().toISOString(),
      tables: {}
    };

    const tables = getTableNames(db);

    for (const tableName of tables) {
      try {
        const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
        dump.tables[tableName] = rows;
      } catch (err) {
        console.error(`Failed to dump ${tableName}:`, err.message);
      }
    }

    return dump;
  } catch (err) {
    console.error('Database dump failed:', err.message);
    throw err;
  }
}

module.exports = {
  dumpDatabase,
  dumpDatabaseAsJson,
  getTableNames
};
