#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { restoreDatabase } = require('../src/restore');

const args = process.argv.slice(2);
const dumpFile = args[0];

if (!dumpFile) {
  console.error('❌ Usage: npm run restore <path-to-dump-file.json>');
  console.error('   Example: npm run restore ./submissions-dump-2026-04-04T00-30-00.json');
  process.exit(1);
}

const dumpPath = path.resolve(dumpFile);

if (!fs.existsSync(dumpPath)) {
  console.error(`❌ Dump file not found: ${dumpPath}`);
  process.exit(1);
}

try {
  console.log('🔄 Starting database restore...\n');
  console.log(`📂 Loading dump from: ${dumpPath}\n`);
  
  restoreDatabase(dumpPath);
  
  console.log('\n✅ Restore completed successfully!');
} catch (err) {
  console.error('❌ Restore failed:', err.message);
  process.exit(1);
}
