'use strict';
const express = require('express');
const helmet = require('helmet');

const submissionsRouter = require('./routes/submissions');
const reportsRouter = require('./routes/reports');
const auth = require('./routes/auth'); // { router, sessions }
const adminRouter = require('./routes/admin');
const managedProjRouter = require('./routes/managed_projects');
const catalogRouter = require('./routes/catalog');
const cvProfiles = require('./routes/cv_profiles');
const cvProfilesRouter = cvProfiles.router;
const dataToolsRouter = require('./routes/data-tools');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// Request logger for debugging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`, req.body);
    next();
});


// Serve uploaded files (photos, proofs) from the persistent data volume
app.use('/uploads', express.static('/data/uploads'));

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
app.use('/auth', auth.router);
app.use('/admin', adminRouter);
app.use('/managed-projects', managedProjRouter);
app.use('/catalog', catalogRouter);
app.use('/submissions', submissionsRouter);
app.use('/reports', reportsRouter);
app.use('/cv-profiles', cvProfilesRouter);
app.use('/data-tools', dataToolsRouter);

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const { getDb } = require('./db');

// Initialize database on startup
getDb();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`StaffTrack API listening on port ${PORT}`);
});
