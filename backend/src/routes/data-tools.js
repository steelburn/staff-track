import express from 'express';
import fs from 'fs';
import path from 'path';
import { dumpDatabaseAsJson } from '../dump.js';
import { restoreDatabaseFromJson } from '../restore.js';
import { getDb } from '../db.js';

const router = express.Router();

/**
 * GET /data-tools/dump
 * Dump all database data as JSON
 * Returns the dump as JSON response
 */
router.get('/dump', (_req, res) => {
  try {
    const dump = dumpDatabaseAsJson();
    
    // Set headers to download as file
    res.setHeader('Content-Disposition', `attachment; filename="submissions-dump-${Date.now()}.json"`);
    res.setHeader('Content-Type', 'application/json');
    
    res.json(dump);
  } catch (err) {
    console.error('Dump failed:', err);
    res.status(500).json({ error: 'Failed to dump database', message: err.message });
  }
});

/**
 * POST /data-tools/restore
 * Restore database from a JSON dump
 * Expects JSON body with dump data
 */
router.post('/restore', (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a valid JSON dump object' });
    }

    const results = restoreDatabaseFromJson(req.body);
    
    res.json({
      success: true,
      message: `Database restored successfully`,
      results
    });
  } catch (err) {
    console.error('Restore failed:', err);
    res.status(500).json({ error: 'Failed to restore database', message: err.message });
  }
});

/**
 * POST /data-tools/restore-file
 * Restore database from uploaded JSON file
 * Expects multipart/form-data with 'file' field
 */
router.post('/restore-file', (req, res) => {
  try {
    // This endpoint would require multer middleware
    // For now, just return an informational message
    res.json({
      message: 'File upload restore endpoint - requires multer middleware configuration',
      alternative: 'Use POST /data-tools/restore with JSON body'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restore from file', message: err.message });
  }
});

/**
 * GET /data-tools/status
 * Get database status and statistics
 */
router.get('/status', async (_req, res) => {
  try {
    const db = await getDb();

    const stats = {};
    const [tables] = await db.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `);

    for (const { TABLE_NAME } of tables) {
      const [countResult] = await db.query(`SELECT COUNT(*) as count FROM ${TABLE_NAME}`);
      stats[TABLE_NAME] = countResult[0].count;
    }

    res.json({
      status: 'ok',
      database: process.env.MYSQL_DATABASE || 'stafftrack',
      host: process.env.MYSQL_HOST || 'localhost',
      tables: Object.keys(stats).length,
      statistics: stats
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get database status', message: err.message });
  }
});

export { router };
