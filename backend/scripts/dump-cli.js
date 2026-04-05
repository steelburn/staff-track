#!/usr/bin/env node
'use strict';
import path from 'path';
import { dumpDatabase } from '../src/dump.js';

const args = process.argv.slice(2);
const saveToFile = args.includes('--file');

try {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `submissions-dump-${timestamp}.json`;
  const outputPath = path.join(process.cwd(), filename);

  console.log('🔄 Starting database dump...\n');
  dumpDatabase(outputPath);
  console.log('\n✅ Dump completed successfully!');
} catch (err) {
  console.error('❌ Dump failed:', err.message);
  process.exit(1);
}
