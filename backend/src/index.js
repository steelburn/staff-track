import express from 'express';
import helmet from 'helmet';

import { router as submissionsRouter } from './routes/submissions.js';
import { router as reportsRouter } from './routes/reports.js';
import { router as authRouter } from './routes/auth.js';
import { router as adminRouter } from './routes/admin.js';
import { router as managedProjRouter } from './routes/managed_projects.js';
import { router as catalogRouter } from './routes/catalog.js';
import { router as cvProfilesRouter } from './routes/cv_profiles.js';
import { router as dataToolsRouter } from './routes/data-tools.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", "data:"],
            styleSrc: ["'self'", "'unsafe-inline'", "https:"],
            scriptSrc: ["'self'"],
            fontSrc: ["'self'", "https:", "data:"],
            formAction: ["'self'"],
            baseUri: ["'self'"],
            objectSrc: ["'none'"],
        },
    },
    crossOriginResourcePolicy: false,
}));
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
app.use('/auth', authRouter);
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
import { getDb } from './db.js';

// Initialize database on startup
getDb();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`StaffTrack API listening on port ${PORT}`);
});
