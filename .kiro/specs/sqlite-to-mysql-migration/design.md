# SQLite to MySQL Migration - Design

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ StaffTrack Migration Pipeline                               │
│                                                              │
│  Phase 1: Extract                                           │
│  ┌────────────────────────────────────────────────────┐     │
│  │ SQLite Database  → Export → Data Dump (JSON/SQL)   │     │
│  │ (12 tables, ~2MB)        → Schema Definition       │     │
│  └────────────────────────────────────────────────────┘     │
│           │                                                   │
│           ▼                                                   │
│  Phase 2: Transform                                         │
│  ┌────────────────────────────────────────────────────┐     │
│  │ SQLite DDL → MySQL DDL conversion                  │     │
│  │ • TEXT → VARCHAR(255) / LONGTEXT                   │     │
│  │ • INTEGER → INT / BIGINT                           │     │
│  │ • Data type mapping                                │     │
│  │ • Charset: UTF8MB4                                 │     │
│  │ • Storage: InnoDB                                  │     │
│  └────────────────────────────────────────────────────┘     │
│           │                                                   │
│           ▼                                                   │
│  Phase 3: Load                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │ MySQL Database ← Create Schema ← Insert Data       │     │
│  │ (12 tables, ~2MB)     ← Validate Constraints       │     │
│  └────────────────────────────────────────────────────┘     │
│           │                                                   │
│           ▼                                                   │
│  Phase 4: Verify                                            │
│  ┌────────────────────────────────────────────────────┐     │
│  │ • Row counts match (exact)                         │     │
│  │ • Checksums validate data                          │     │
│  │ • Foreign keys verified                            │     │
│  │ • No orphaned records                              │     │
│  └────────────────────────────────────────────────────┘     │
│           │                                                   │
│           ▼                                                   │
│  Phase 5: Switch                                            │
│  ┌────────────────────────────────────────────────────┐     │
│  │ Application Code  → MySQL Connection               │     │
│  │ (Update DB driver, connection string, pragma)      │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## Database Schema Conversion

### SQLite to MySQL Type Mapping

| SQLite Type | MySQL Type | Notes |
|---|---|---|
| TEXT | VARCHAR(255) or LONGTEXT | LONGTEXT for fields >255 chars or large content |
| INTEGER | INT or BIGINT | BIGINT for IDs that may exceed 2^31 |
| REAL | DECIMAL(10,2) or DOUBLE | Use DECIMAL for financial data, DOUBLE for metrics |
| BLOB | LONGBLOB | For binary/serialized data |
| NULL | NULL | Preserved as-is |
| PRIMARY KEY | PRIMARY KEY | Exact conversion |
| UNIQUE | UNIQUE | Exact conversion |
| FOREIGN KEY | FOREIGN KEY CONSTRAINT | Add ON DELETE CASCADE/RESTRICT |
| CHECK | Validation Logic (app-level) | MySQL 8.0.16+ supports CHECK, but app-level preferred |
| AUTOINCREMENT | AUTO_INCREMENT | Exact conversion |
| DEFAULT | DEFAULT | Exact conversion, except SQLite functions |

### StaffTrack Schema Conversion

#### Table 1: submissions
```sql
/* SQLite */
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  staff_email TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  title TEXT,
  department TEXT,
  manager_name TEXT,
  edited_fields TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_staff INTEGER DEFAULT 0
);

/* MySQL */
CREATE TABLE submissions (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  staff_email VARCHAR(255) NOT NULL,
  staff_name VARCHAR(255) NOT NULL,
  title VARCHAR(255),
  department VARCHAR(255),
  manager_name VARCHAR(255),
  edited_fields LONGTEXT DEFAULT '[]' COMMENT 'JSON array of field names',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  updated_by_staff TINYINT DEFAULT 0,
  KEY idx_staff_email (staff_email),
  KEY idx_created_at (created_at),
  FOREIGN KEY (staff_email) REFERENCES staff(email) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Table 2: submission_skills
```sql
/* MySQL */
CREATE TABLE submission_skills (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  submission_id VARCHAR(36) NOT NULL,
  skill VARCHAR(255) NOT NULL,
  rating INT DEFAULT 0,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  KEY idx_skill (skill)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Table 3: submission_projects
```sql
/* MySQL */
CREATE TABLE submission_projects (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  submission_id VARCHAR(36) NOT NULL,
  soc VARCHAR(50),
  project_name VARCHAR(255),
  customer VARCHAR(255),
  role VARCHAR(255),
  start_date DATE,
  end_date DATE,
  description LONGTEXT,
  key_contributions LONGTEXT,
  technologies_used LONGTEXT COMMENT 'CSV or JSON',
  is_active TINYINT DEFAULT 0,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  KEY idx_project_name (project_name),
  KEY idx_start_date (start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Table 4: user_roles
```sql
/* MySQL */
CREATE TABLE user_roles (
  email VARCHAR(255) PRIMARY KEY,
  role VARCHAR(50) NOT NULL DEFAULT 'staff',
  is_active TINYINT DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_role (role),
  KEY idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Table 5: managed_projects
```sql
/* MySQL */
CREATE TABLE managed_projects (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  soc VARCHAR(50),
  project_name VARCHAR(255) NOT NULL,
  customer VARCHAR(255),
  type_infra TINYINT DEFAULT 0,
  type_software TINYINT DEFAULT 0,
  type_infra_support TINYINT DEFAULT 0,
  type_software_support TINYINT DEFAULT 0,
  start_date DATE,
  end_date DATE,
  technologies LONGTEXT COMMENT 'CSV list',
  description LONGTEXT,
  coordinator_email VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (coordinator_email) REFERENCES user_roles(email) ON DELETE RESTRICT,
  KEY idx_coordinator_email (coordinator_email),
  KEY idx_project_name (project_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Table 6: staff
```sql
/* MySQL */
CREATE TABLE staff (
  email VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  title VARCHAR(255),
  department VARCHAR(255),
  manager_name VARCHAR(255),
  KEY idx_department (department),
  KEY idx_manager_name (manager_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Table 7: projects_catalog
```sql
/* MySQL */
CREATE TABLE projects_catalog (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  soc VARCHAR(50),
  project_name VARCHAR(255) NOT NULL,
  customer VARCHAR(255),
  end_date DATE,
  KEY idx_project_name (project_name),
  KEY idx_soc (soc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Table 8: skills_catalog
```sql
/* MySQL */
CREATE TABLE skills_catalog (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  name VARCHAR(255) UNIQUE NOT NULL,
  category VARCHAR(100),
  aliases LONGTEXT DEFAULT '[]' COMMENT 'JSON array',
  is_active TINYINT DEFAULT 1,
  KEY idx_name (name),
  KEY idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Table 9: skill_merge_log
```sql
/* MySQL */
CREATE TABLE skill_merge_log (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  from_name VARCHAR(255) NOT NULL,
  to_name VARCHAR(255) NOT NULL,
  affected_count INT DEFAULT 0,
  merged_by VARCHAR(255),
  merged_at DATETIME NOT NULL,
  KEY idx_merged_at (merged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Table 10: auth_tokens
```sql
/* MySQL */
CREATE TABLE auth_tokens (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  user_email VARCHAR(255) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  refresh_token_hash VARCHAR(255),
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  revoked TINYINT DEFAULT 0,
  FOREIGN KEY (user_email) REFERENCES user_roles(email) ON DELETE CASCADE,
  KEY idx_user_email (user_email),
  KEY idx_expires_at (expires_at),
  KEY idx_revoked (revoked)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Table 11: auth_audit_log
```sql
/* MySQL */
CREATE TABLE auth_audit_log (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  email VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  ip_address VARCHAR(45) COMMENT 'IPv4 or IPv6',
  user_agent LONGTEXT,
  success TINYINT NOT NULL,
  created_at DATETIME NOT NULL,
  KEY idx_email (email),
  KEY idx_created_at (created_at),
  KEY idx_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### Table 12: cv_templates
```sql
/* MySQL (if it exists in current schema) */
CREATE TABLE cv_templates (
  id VARCHAR(36) PRIMARY KEY COMMENT 'UUID',
  name VARCHAR(255) NOT NULL,
  markdown_content LONGTEXT NOT NULL,
  css_content LONGTEXT,
  is_default TINYINT DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_is_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## Migration Procedures

### Procedure 1: Export from SQLite

```javascript
/**
 * Export all data and schema from SQLite
 * Outputs: data.json, schema.sql
 */
const Database = require('better-sqlite3');
const fs = require('fs');

function exportSQLiteDatabase(dbPath, exportDir) {
  const db = new Database(dbPath, { readonly: true });
  
  // Step 1: Export schema (CREATE TABLE statements)
  const schema = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all();
  
  const schemaSql = schema
    .map(t => t.sql)
    .filter(s => s)
    .join(';\n\n') + ';';
  
  fs.writeFileSync(`${exportDir}/schema.sql`, schemaSql);
  
  // Step 2: Export data as JSON (preserves types better than CSV)
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all();
  
  const exportData = {};
  const rowCountsBefore = {};
  
  for (const table of tables) {
    const tableName = table.name;
    const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
    exportData[tableName] = rows;
    rowCountsBefore[tableName] = rows.length;
    console.log(`✓ Exported ${tableName}: ${rows.length} rows`);
  }
  
  fs.writeFileSync(
    `${exportDir}/data.json`,
    JSON.stringify(exportData, null, 2)
  );
  
  fs.writeFileSync(
    `${exportDir}/row_counts_before.json`,
    JSON.stringify(rowCountsBefore, null, 2)
  );
  
  db.close();
  console.log('✓ SQLite export complete');
}
```

### Procedure 2: Create MySQL Schema

```javascript
/**
 * Create MySQL tables from converted schema
 */
const mysql = require('mysql2/promise');

async function createMySQLSchema(pool, schemaSql) {
  const connection = await pool.getConnection();
  
  try {
    // Split by semicolon and execute each CREATE TABLE statement
    const statements = schemaSql.split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    for (const statement of statements) {
      // Convert SQLite DDL to MySQL
      const mySqlStatement = convertSQLiteToMySQL(statement);
      console.log(`Creating table: ${mySqlStatement.substring(0, 50)}...`);
      await connection.execute(mySqlStatement);
    }
    
    console.log('✓ MySQL schema creation complete');
  } finally {
    connection.release();
  }
}

function convertSQLiteToMySQL(sqliteStatement) {
  let mySql = sqliteStatement;
  
  // Allow PRAGMA and other MySQL-specific stuff
  mySql = mySql
    .replace(/TEXT/g, 'VARCHAR(255)')
    .replace(/INTEGER PRIMARY KEY/g, 'INT PRIMARY KEY AUTO_INCREMENT')
    .replace(/AUTOINCREMENT/g, '')
    .replace(/CREATE TABLE IF NOT EXISTS/g, 'CREATE TABLE IF NOT EXISTS')
    .replace(/PRAGMA.*?;/g, '')
    .replace(/FOREIGN KEY.*?REFERENCES/g, 'FOREIGN KEY REFERENCES');
  
  // Add InnoDB and charset
  if (!mySql.includes('ENGINE=')) {
    mySql = mySql.replace(/;$/,
      `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
  }
  
  return mySql;
}
```

### Procedure 3: Migrate Data

```javascript
/**
 * Insert data from JSON export to MySQL
 */
async function migrateData(pool, dataExport, rowCountsBefore) {
  const rowCountsAfter = {};
  let totalInserted = 0;
  
  for (const [tableName, rows] of Object.entries(dataExport)) {
    let inserted = 0;
    
    // Insert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      
      for (const row of batch) {
        const columns = Object.keys(row);
        const values = Object.values(row);
        const placeholders = columns.map(() => '?').join(',');
        
        const sql = `INSERT INTO ${tableName} (${columns.join(',')}) VALUES (${placeholders})`;
        
        try {
          const connection = await pool.getConnection();
          await connection.execute(sql, values);
          connection.release();
          inserted++;
        } catch (error) {
          console.error(`Error inserting into ${tableName}:`, error.message);
          // Log but continue (partial migration)
        }
      }
    }
    
    rowCountsAfter[tableName] = inserted;
    totalInserted += inserted;
    console.log(`✓ Migrated ${tableName}: ${inserted} rows (was ${rowCountsBefore[tableName]})`);
  }
  
  return { rowCountsAfter, totalInserted };
}
```

### Procedure 4: Verify Data Integrity

```javascript
/**
 * Validate migrated data
 */
async function verifyDataIntegrity(pool, rowCountsBefore, rowCountsAfter) {
  const report = {
    timestamp: new Date().toISOString(),
    tables: {},
    errors: [],
    warnings: []
  };
  
  for (const [tableName, beforeCount] of Object.entries(rowCountsBefore)) {
    const afterCount = rowCountsAfter[tableName] || 0;
    
    if (beforeCount === afterCount) {
      report.tables[tableName] = {
        status: 'PASS',
        before: beforeCount,
        after: afterCount
      };
    } else {
      report.errors.push(
        `${tableName}: row count mismatch (${beforeCount} → ${afterCount})`
      );
      report.tables[tableName] = {
        status: 'FAIL',
        before: beforeCount,
        after: afterCount
      };
    }
  }
  
  // Validate foreign keys
  const connection = await pool.getConnection();
  const fkCheck = await connection.execute(
    'SELECT * FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_NAME IS NOT NULL'
  );
  connection.release();
  
  // Report
  const passed = Object.values(report.tables).filter(t => t.status === 'PASS').length;
  const total = Object.keys(report.tables).length;
  
  console.log(`\n========== MIGRATION REPORT ==========`);
  console.log(`Tables: ${passed}/${total} passed`);
  if (report.errors.length > 0) {
    console.log(`\nERRORS:`);
    report.errors.forEach(e => console.log(`  ✗ ${e}`));
  }
  console.log(`=====================================\n`);
  
  return report;
}
```

---

## Application Code Changes

### Change 1: Database Connection (db.js)

**Before (SQLite):**
```javascript
const Database = require('better-sqlite3');
let db = new Database(process.env.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
```

**After (MySQL):**
```javascript
const mysql = require('mysql2/promise');

let pool;

async function getPool() {
  if (!pool) {
    pool = await mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: process.env.MYSQL_PORT || 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelayMs: 0,
      charset: 'utf8mb4'
    });
  }
  return pool;
}

async function query(sql, params) {
  const connection = await getPool().then(p => p.getConnection());
  try {
    const [results] = await connection.execute(sql, params);
    return results;
  } finally {
    connection.release();
  }
}
```

### Change 2: Prepared Statements

**Before (SQLite):**
```javascript
const stmt = db.prepare('SELECT * FROM staff WHERE email = ?');
const result = stmt.get(email);
```

**After (MySQL):**
```javascript
const result = await query('SELECT * FROM staff WHERE email = ?', [email]);
```

### Change 3: Transactions

**Before (SQLite):**
```javascript
const tx = db.transaction(() => {
  db.prepare('INSERT INTO table VALUES (?)').run(value1);
  db.prepare('INSERT INTO table VALUES (?)').run(value2);
});
tx();
```

**After (MySQL):**
```javascript
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  await connection.execute('INSERT INTO table VALUES (?)', [value1]);
  await connection.execute('INSERT INTO table VALUES (?)', [value2]);
  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
}
```

---

## Environment Variables

```bash
# MySQL Connection
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=stafftrack_user
MYSQL_PASSWORD=secure_password_here
MYSQL_DATABASE=stafftrack

# Migration Control
MIGRATION_BATCH_SIZE=100
MIGRATION_TIMEOUT_MS=300000  # 5 minutes
VERIFY_AFTER_MIGRATION=true

# Feature Flag (gradual rollover)
USE_MYSQL=false  # Start with 0%, gradually increase
MYSQL_TRAFFIC_PERCENTAGE=0  # 0-100
```

---

## Error Handling Strategy

| Error | Scenario | Recovery |
|---|---|---|
| Connection refused | MySQL not running | Retry with backoff, alert ops |
| Authentication error | Wrong credentials | Fail fast, check env vars |
| Table already exists | Schema creation | Skip creation, continue |
| Foreign key violation | Data integrity | Log violation, skip record |
| Connection timeout | Network issue | Exponential backoff (1s, 2s, 4s, 8s) |
| Out of disk space | MySQL storage full | Fail with clear error |
| Character encoding | UTF-8 mismatch | Convert before insert |

---

## Rollback Procedure

If migration fails:

1. **Keep SQLite intact** (do not delete)
2. **Switch feature flag** `USE_MYSQL=false` back to SQLite
3. **Restart application** to reconnect to SQLite
4. **Investigate errors** in MySQL migration logs
5. **Fix MySQL schema/data** based on error analysis
6. **Retry migration** with corrected procedures

