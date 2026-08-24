import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { dumpDatabaseAsJson } from '../dump.js';
import { restoreDatabaseFromJson } from '../restore.js';
import { getDb } from '../db.js';

const router = express.Router();

// Multer for JSON file restore (memory storage, parse JSON)
const jsonUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/json' || path.extname(file.originalname) === '.json')
            cb(null, true);
        else cb(new Error('Only JSON files are allowed'));
    }
});

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
router.post('/restore-file', jsonUpload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const jsonStr = req.file.buffer.toString('utf8');
    const data = JSON.parse(jsonStr);

    if (!data || typeof data !== 'object')
      return res.status(400).json({ error: 'File must contain a valid JSON dump object' });

    const results = restoreDatabaseFromJson(data);

    res.json({
      success: true,
      message: `Database restored from ${req.file.originalname}`,
      results
    });
  } catch (err) {
    console.error('Restore from file failed:', err);
    res.status(500).json({ error: 'Failed to restore from file: ' + err.message });
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
