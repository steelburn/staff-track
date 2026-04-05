#!/usr/bin/env node
'use strict';

/**
 * SQLite to MySQL Codebase Converter
 * Scans codebase for SQLite-specific patterns and converts them to MySQL-compatible
 * 
 * SQLite-specific patterns detected:
 * - SQLITE_SEQUENCE table references
 * - AUTO_INCREMENT (SQLite uses AUTOINCREMENT)
 * - sqlite3 library imports
 * - db.run(), db.get(), db.all() callbacks
 * - PRAGMA statements
 * - SQLite date/time functions
 * - JSON function differences
 * - CAST operators
 * 
 * Usage:
 *   node scripts/sqlite-to-mysql-patterns.js [--dry-run] [--fix] [--report]
 * 
 * Options:
 *   --dry-run   Show what would be changed without modifying files
 *   --fix       Apply all conversions (requires explicit flag for safety)
 *   --report    Generate detailed report of all found patterns
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const BACKEND_SRC = path.join(WORKSPACE_ROOT, 'src');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const FIX = argv.includes('--fix');
const REPORT = argv.includes('--report');

// ════════════════════════════════════════════════════════════════════════════
// PATTERN DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════

const PATTERNS = [
  {
    name: 'sqlite3 imports',
    pattern: /import\s+.*from\s+['"]sqlite3['"]/g,
    replacement: null, // Remove
    description: 'Remove sqlite3 imports - use mysql2 instead',
    example: "import Database from 'sqlite3';",
  },
  {
    name: 'better-sqlite3 imports',
    pattern: /import\s+.*from\s+['"]better-sqlite3['"]/g,
    replacement: null,
    description: 'Remove better-sqlite3 imports - use mysql2 instead',
    example: "import Database from 'better-sqlite3';",
  },
  {
    name: 'db.run() callback pattern',
    pattern: /db\.run\s*\(\s*['"`]([^'"`]*)['"` ]*,\s*\[\s*([^\]]*)\s*\]\s*,?\s*\(err[,\)]/g,
    replacement: 'await db.execute("$1", [$2]);',
    description: 'Convert SQLite db.run() callbacks to MySQL execute()',
    example: "db.run('INSERT INTO table VALUES (?)', [value], (err) => {",
  },
  {
    name: 'db.get() callback pattern',
    pattern: /db\.get\s*\(\s*['"`]([^'"`]*)['"` ]*,\s*\(err,\s*row\)/g,
    replacement: 'const row = await db.queryOne("$1");',
    description: 'Convert SQLite db.get() to MySQL queryOne()',
    example: "db.get('SELECT * FROM table WHERE id = ?', (err, row) => {",
  },
  {
    name: 'db.all() callback pattern',
    pattern: /db\.all\s*\(\s*['"`]([^'"`]*)['"` ]*,\s*\(err,\s*rows\)/g,
    replacement: 'const rows = await db.query("$1");',
    description: 'Convert SQLite db.all() to MySQL query()',
    example: "db.all('SELECT * FROM table', (err, rows) => {",
  },
  {
    name: 'PRAGMA statements',
    pattern: /PRAGMA\s+\w+\s*[=;]/gi,
    replacement: null,
    description: 'Remove PRAGMA statements - not supported in MySQL',
    example: 'PRAGMA foreign_keys = ON;',
  },
  {
    name: 'SQLite datetime functions',
    pattern: /datetime\s*\(\s*'now'\s*\)/gi,
    replacement: 'NOW()',
    description: 'Replace SQLite datetime() with MySQL NOW()',
    example: "datetime('now')",
  },
  {
    name: 'SQLite date functions',
    pattern: /date\s*\(\s*'(\+[^']*)?now'\s*\)/gi,
    replacement: 'DATE_ADD(NOW(), INTERVAL $1)',
    description: 'Replace SQLite date() with MySQL DATE_ADD()',
    example: "date('+1 day', 'now')",
  },
  {
    name: 'SQLite typeof() function',
    pattern: /typeof\s*\(\s*(\w+)\s*\)/gi,
    replacement: "CASE WHEN $1 IS NULL THEN 'null' WHEN $1 REGEXP '^[0-9]+$' THEN 'integer' ELSE 'text' END",
    description: 'Replace SQLite typeof() with MySQL CASE expression',
    example: "typeof(column)",
  },
  {
    name: 'SQLite json_extract()',
    pattern: /json_extract\s*\(\s*([^,]+)\s*,\s*['"]([^'"]+)['"]\s*\)/gi,
    replacement: 'JSON_EXTRACT($1, "$2")',
    description: 'SQLite json_extract to MySQL JSON_EXTRACT',
    example: "json_extract(data, '$.key')",
  },
  {
    name: 'SQLite group_concat()',
    pattern: /group_concat\s*\(\s*([^,]+)\s*,\s*['"]([^'"]+)['"]\s*\)/gi,
    replacement: 'GROUP_CONCAT($1 SEPARATOR "$2")',
    description: 'SQLite group_concat to MySQL GROUP_CONCAT',
    example: "group_concat(name, ', ')",
  },
  {
    name: 'SQLite AUTOINCREMENT',
    pattern: /AUTOINCREMENT/gi,
    replacement: 'AUTO_INCREMENT',
    description: 'Replace SQLite AUTOINCREMENT with MySQL AUTO_INCREMENT',
    example: 'AUTOINCREMENT',
  },
  {
    name: 'SQLite strftime()',
    pattern: /strftime\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\s*\)/gi,
    replacement: "DATE_FORMAT($2, '%Y-%m-%d')",
    description: 'Replace SQLite strftime() with MySQL DATE_FORMAT()',
    example: "strftime('%Y-%m-%d', created_at)",
  },
  {
    name: 'SQLite CAST operator',
    pattern: /CAST\s*\(\s*([^\s]+)\s+AS\s+TEXT\s*\)/gi,
    replacement: 'CAST($1 AS CHAR)',
    description: 'Replace SQLite TEXT cast with MySQL CHAR',
    example: 'CAST(id AS TEXT)',
  },
  {
    name: 'SQLite CAST to INTEGER',
    pattern: /CAST\s*\(\s*([^\s]+)\s+AS\s+INTEGER\s*\)/gi,
    replacement: 'CAST($1 AS SIGNED)',
    description: 'Replace SQLite INTEGER cast with MySQL SIGNED',
    example: 'CAST(count AS INTEGER)',
  },
  {
    name: 'SQLite RETURNING clause',
    pattern: /RETURNING\s+(\w+)/gi,
    replacement: null,
    description: 'Remove RETURNING clause - not in MySQL, use LAST_INSERT_ID()',
    example: 'INSERT ... RETURNING id',
  },
];

// ════════════════════════════════════════════════════════════════════════════
// SCANNER CLASS
// ════════════════════════════════════════════════════════════════════════════

class SQLitePatternScanner {
  constructor(rootDir, patterns, dryRun = false) {
    this.rootDir = rootDir;
    this.patterns = patterns;
    this.dryRun = dryRun;
    this.findings = {};
    this.filesProcessed = 0;
  }

  /**
   * Get all JavaScript files in directory
   */
  getJSFiles(dir) {
    const files = [];
    
    const traverse = (currentDir) => {
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            // Skip node_modules, .git, etc
            if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
              traverse(path.join(currentDir, entry.name));
            }
          } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(path.join(currentDir, entry.name));
          }
        }
      } catch (err) {
        console.error(`Error reading directory ${currentDir}:`, err.message);
      }
    };
    
    traverse(dir);
    return files;
  }

  /**
   * Scan a single file for patterns
   */
  scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const relPath = path.relative(this.rootDir, filePath);
      const isMatch = false;

      for (const pattern of this.patterns) {
        const matches = content.matchAll(pattern.pattern);
        const matchArray = Array.from(matches);

        if (matchArray.length > 0) {
          if (!this.findings[relPath]) {
            this.findings[relPath] = [];
          }

          for (const match of matchArray) {
            this.findings[relPath].push({
              patternName: pattern.name,
              description: pattern.description,
              match: match[0],
              line: content.substring(0, match.index).split('\n').length,
              column: match.index - content.lastIndexOf('\n', match.index - 1),
              replacement: pattern.replacement,
              example: pattern.example,
            });
          }

          if (!isMatch) console.log(`  ✓ ${relPath}`);
        }
      }
    } catch (err) {
      console.error(`Error scanning ${filePath}:`, err.message);
    }
  }

  /**
   * Generate report
   */
  generateReport() {
    const fileCount = Object.keys(this.findings).length;
    const totalMatches = Object.values(this.findings).reduce((sum, arr) => sum + arr.length, 0);

    console.log('\n' + '═'.repeat(70));
    console.log('📋 SQLite Pattern Detection Report');
    console.log('═'.repeat(70));
    console.log(`Files Scanned:   ${this.filesProcessed}`);
    console.log(`Files with Issues: ${fileCount}`);
    console.log(`Total Patterns Found: ${totalMatches}`);
    console.log('═'.repeat(70));

    if (fileCount === 0) {
      console.log('\n✅ No SQLite-specific patterns found!');
      return;
    }

    // Group by pattern name
    const patternStats = {};
    for (const findings of Object.values(this.findings)) {
      for (const finding of findings) {
        if (!patternStats[finding.patternName]) {
          patternStats[finding.patternName] = 0;
        }
        patternStats[finding.patternName]++;
      }
    }

    console.log('\n📊 Patterns by Type:');
    const sorted = Object.entries(patternStats).sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted) {
      console.log(`  • ${name}: ${count} occurrence(s)`);
    }

    console.log('\n📄 Detailed Findings:');
    for (const [file, findings] of Object.entries(this.findings)) {
      console.log(`\n  ${file}`);
      for (const finding of findings) {
        console.log(`    Line ${finding.line}, Col ${finding.column}: ${finding.patternName}`);
        console.log(`      Match: ${finding.match.substring(0, 60)}${finding.match.length > 60 ? '...' : ''}`);
        if (finding.replacement) {
          console.log(`      Suggestion: ${finding.replacement}`);
        } else {
          console.log(`      Action: ${finding.description}`);
        }
      }
    }
  }

  /**
   * Apply fixes to files
   */
  applyFixes() {
    if (!FIX) {
      console.log('\n📝 Use --fix flag to apply conversions\n');
      return;
    }

    console.log('\n🔧 Applying conversions...');
    let filesFixed = 0;
    let changesApplied = 0;

    for (const [filePath, findings] of Object.entries(this.findings)) {
      const fullPath = path.join(this.rootDir, filePath);
      let content = fs.readFileSync(fullPath, 'utf8');
      let fileChanged = false;

      // Group findings by pattern and apply in reverse line order to maintain positions
      const sortedFindings = findings.sort((a, b) => b.line - a.line);

      for (const finding of sortedFindings) {
        if (finding.replacement === null) {
          // Remove pattern
          const regex = new RegExp(finding.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          if (regex.test(content)) {
            content = content.replace(regex, '');
            fileChanged = true;
            changesApplied++;
          }
        } else if (finding.replacement) {
          // Replace pattern
          const regex = new RegExp(finding.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          if (regex.test(content)) {
            content = content.replace(regex, finding.replacement);
            fileChanged = true;
            changesApplied++;
          }
        }
      }

      if (fileChanged && !this.dryRun) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`  ✓ ${filePath}`);
        filesFixed++;
      }
    }

    console.log(`\n✅ Fixed ${filesFixed} file(s) with ${changesApplied} conversion(s)`);
  }

  /**
   * Run the scanner
   */
  run() {
    console.log('\n' + '═'.repeat(70));
    console.log('🔍 SQLite Pattern Scanner');
    console.log('═'.repeat(70));
    console.log(`Workspace Root: ${this.rootDir}`);
    console.log('═'.repeat(70));

    console.log('\n📁 Scanning JavaScript files...');
    const jsFiles = this.getJSFiles(this.rootDir);
    this.filesProcessed = jsFiles.length;

    console.log(`Found ${jsFiles.length} JavaScript file(s)\n`);

    for (const file of jsFiles) {
      this.scanFile(file);
    }

    // Generate report
    this.generateReport();

    // Apply fixes if requested
    if (FIX || REPORT) {
      this.applyFixes();
    }

    if (this.dryRun && !FIX) {
      console.log('\n💡 Add --fix to apply these conversions\n');
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

const scanner = new SQLitePatternScanner(BACKEND_SRC, PATTERNS, DRY_RUN);
scanner.run();
