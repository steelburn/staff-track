'use strict';
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/submissions.db');

let db;
let schemaInitialized = false;

function getDb() {
  if (!db) {
    console.log("Initializing database at path:", DB_PATH); // Log the database path
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    if (!schemaInitialized) {
      initSchema(db);
      schemaInitialized = true;
    }

    runMigrations(db);

    // Run CSV seeders if tables are empty
    const { runSeed } = require('./seed');
    runSeed(db);
  }
  return db;
}

function initSchema(db) {
  if (schemaInitialized) return; // Prevent redundant execution

  db.exec(`
      PRAGMA journal_mode = WAL;

      -- Base record for each staff submission
      CREATE TABLE IF NOT EXISTS submissions (
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

      -- Individual skills submitted by the user
      CREATE TABLE IF NOT EXISTS submission_skills (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        skill TEXT NOT NULL,
        rating INTEGER DEFAULT 0,
        FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
      );

      -- Individual project assignments submitted by the user
      CREATE TABLE IF NOT EXISTS submission_projects (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        soc TEXT,
        project_name TEXT,
        customer TEXT,
        role TEXT,
        start_date TEXT,
        end_date TEXT,
        description TEXT,
        key_contributions TEXT,
        technologies_used TEXT,
        is_active INTEGER DEFAULT 0,
        FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
      );

      -- Administrative Roles
      CREATE TABLE IF NOT EXISTS user_roles (
        email TEXT PRIMARY KEY,
        is_hr INTEGER DEFAULT 0,
        is_coordinator INTEGER DEFAULT 0
      );

      -- Projects explicitly created by coordinators
      CREATE TABLE IF NOT EXISTS managed_projects (
        id TEXT PRIMARY KEY,
        soc TEXT,
        project_name TEXT NOT NULL,
        customer TEXT,
        type_infra INTEGER DEFAULT 0,
        type_software INTEGER DEFAULT 0,
        type_infra_support INTEGER DEFAULT 0,
        type_software_support INTEGER DEFAULT 0,
        start_date TEXT,
        end_date TEXT,
        technologies TEXT,
        description TEXT,
        coordinator_email TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Globally referenced staff identity records (Migrated from CSV)
      CREATE TABLE IF NOT EXISTS staff (
        email TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT,
        department TEXT,
        manager_name TEXT
      );

      -- Globally referenced project catalog (Migrated from CSV)
      CREATE TABLE IF NOT EXISTS projects_catalog (
        id TEXT PRIMARY KEY,
        soc TEXT,
        project_name TEXT NOT NULL,
        customer TEXT,
        end_date TEXT
      );

      -- Canonical list of skills (Data Governance)
      CREATE TABLE IF NOT EXISTS skills_catalog (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        category TEXT,
        aliases TEXT DEFAULT '[]',
        is_active INTEGER DEFAULT 1
      );

      -- Audit log for skill merge operations
      CREATE TABLE IF NOT EXISTS skill_merge_log (
        id TEXT PRIMARY KEY,
        from_name TEXT NOT NULL,
        to_name TEXT NOT NULL,
        affected_count INTEGER DEFAULT 0,
        merged_by TEXT,
        merged_at TEXT NOT NULL
      );

      -- User roles with granular permissions (6 roles)
      CREATE TABLE IF NOT EXISTS user_roles (
        email TEXT PRIMARY KEY,
        role TEXT NOT NULL DEFAULT 'staff',
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- JWT tokens for session management
      CREATE TABLE IF NOT EXISTS auth_tokens (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        refresh_token_hash TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked INTEGER DEFAULT 0,
        FOREIGN KEY(user_email) REFERENCES user_roles(email)
      );

      -- Audit log for authentication events
      CREATE TABLE IF NOT EXISTS auth_audit_log (
        id TEXT PRIMARY KEY,
        email TEXT,
        action TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        success INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

  schemaInitialized = true;
}

function seedDefaultTemplates(db) {
  const now = new Date().toISOString();

  const classicMarkdown = `# {{name}}

**{{title}}** | {{department}}

---

{{phone}} | {{email}} | {{location}}{{#linkedin}} | [LinkedIn]({{linkedin}}){{/linkedin}}

---

## Professional Summary

{{summary}}

---

## Technical Skills

{{#skills}}
- **{{skill}}** {{#rating}}({{rating}}/5){{/rating}}
{{/skills}}

---

## Current Projects

{{#projects}}
### {{project_name}}
*{{start_date}}{{#end_date}} – {{end_date}}{{/end_date}}*
- **Customer:** {{customer}} | **SOC:** {{soc}} | **Role:** {{role}}
{{#technologies}}
- **Technologies:** {{technologies}}
{{/technologies}}

{{description}}
{{/projects}}

---

## Work History

{{#workHistory}}
### {{employer}} — {{job_title}}
*{{start_date}} – {{end_date}}*

{{description}}

{{/workHistory}}

---

## Past Projects

{{#pastProjects}}
### {{project_name}}
*{{role}} | {{start_date}} – {{end_date}}*

{{description}}

**Technologies:** {{technologies}}

{{/pastProjects}}

---

## Education

{{#education}}
### {{institution}}
**{{degree}}** in {{field}} ({{start_year}} – {{end_year}})

{{description}}

{{/education}}

---

## Certifications

{{#certifications}}
### {{name}}
*Issued by {{issuer}} on {{date_obtained}}*{{#expiry_date}} | *Expires: {{expiry_date}}*{{/expiry_date}}

{{description}}

{{/certifications}}

---

*Generated by StaffTrack on {{generatedAt}}*`;

  const classicCss = `
@import url('https://fonts.googleapis.com/css2?family=Georgia:ital,wght@0,400;1,400&family=Inter:wght@300;400;600;700&display=swap');
body { margin: 0; padding: 32px; font-family: 'Inter', sans-serif; font-size: 14px; color: #1a1a2e; background: #fff; }
.cv-body { max-width: 800px; margin: 0 auto; }
h1 { font-size: 2rem; font-weight: 700; margin: 0 0 4px; color: #1a1a2e; }
h2 { font-size: 1.1rem; font-weight: 600; color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 4px; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.05em; }
h3 { font-size: 1rem; font-weight: 600; margin: 12px 0 4px; color: #1a1a2e; }
p { margin: 4px 0 8px; line-height: 1.6; }
ul { margin: 4px 0; padding-left: 20px; }
li { margin: 3px 0; line-height: 1.5; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
em { color: #6b7280; font-style: normal; font-size: 0.875rem; }
strong { color: #374151; }
a { color: #2563eb; text-decoration: none; }
@media print { body { padding: 16px; } }`;

  const modernMarkdown = `# {{name}}

> {{title}} — {{department}}

---

📞 {{phone}} &nbsp;|&nbsp; ✉️ {{email}} &nbsp;|&nbsp; 📍 {{location}}{{#linkedin}} &nbsp;|&nbsp; 🔗 [LinkedIn]({{linkedin}}){{/linkedin}}

---

## About Me

{{summary}}

---

## Skills

{{#skills}}
- {{skill}} {{#rating}}★{{rating}}{{/rating}}
{{/skills}}

---

## Active Projects

{{#projects}}
**{{project_name}}** · {{customer}} · {{role}}
*{{start_date}}{{#end_date}} → {{end_date}}{{/end_date}}*
{{#technologies}}
Stack: {{technologies}}
{{/technologies}}
{{#description}}
{{description}}
{{/description}}

{{/projects}}

---

## Career History

{{#workHistory}}
### {{employer}}
**{{job_title}}** · *{{start_date}} → {{end_date}}*

{{description}}

{{/workHistory}}

---

## Notable Projects

{{#pastProjects}}
**{{project_name}}** · {{role}} · *{{start_date}} – {{end_date}}*
{{description}}
*Stack: {{technologies}}*

{{/pastProjects}}

---

## Education

{{#education}}
**{{institution}}** · {{degree}} in {{field}} · {{start_year}}–{{end_year}}
{{description}}

{{/education}}

---

## Certifications

{{#certifications}}
🏆 **{{name}}** · {{issuer}} · {{date_obtained}}
{{description}}

{{/certifications}}

---

*Generated {{generatedAt}} via StaffTrack*`;

  const modernCss = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&display=swap');
body { margin: 0; padding: 0; font-family: 'Outfit', sans-serif; font-size: 14px; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
.cv-body { max-width: 820px; margin: 0 auto; padding: 40px 40px; }
h1 { font-size: 2.4rem; font-weight: 800; margin: 0 0 6px; background: linear-gradient(135deg, #60a5fa, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
h2 { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #60a5fa; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #1e3a5f; }
h3 { font-size: 1rem; font-weight: 600; margin: 14px 0 4px; color: #f1f5f9; }
blockquote { border-left: 3px solid #60a5fa; margin: 8px 0 16px; padding: 4px 0 4px 16px; color: #94a3b8; font-size: 1rem; }
p { margin: 4px 0 8px; line-height: 1.65; color: #cbd5e1; }
ul { margin: 4px 0; padding-left: 20px; }
li { margin: 3px 0; line-height: 1.55; color: #cbd5e1; }
hr { border: none; border-top: 1px solid #1e293b; margin: 24px 0; }
em { color: #64748b; font-style: normal; font-size: 0.85rem; }
strong { color: #f1f5f9; }
a { color: #60a5fa; text-decoration: none; }
@media print { body { background: #fff !important; color: #1a1a2e !important; } .cv-body { padding: 16px; } h1 { -webkit-text-fill-color: #1a1a2e; } h2 { color: #2563eb; } }`;

  const minimalMarkdown = `{{name}}
{{title}}

{{email}}{{#phone}} · {{phone}}{{/phone}}{{#location}} · {{location}}{{/location}}{{#linkedin}} · {{linkedin}}{{/linkedin}}

---

SUMMARY

{{summary}}

---

SKILLS

{{#skills}}{{skill}}{{#rating}} ({{rating}}){{/rating}} · {{/skills}}

---

EXPERIENCE

{{#workHistory}}
{{employer}} | {{job_title}}
{{start_date}} – {{end_date}}
{{description}}

{{/workHistory}}

---

PROJECTS

{{#projects}}
{{project_name}} | {{customer}} | {{role}}
{{start_date}}–{{end_date}}
{{technologies}}
{{description}}

{{/projects}}

---

EDUCATION

{{#education}}
{{institution}} | {{degree}}{{#field}}, {{field}}{{/field}} | {{start_year}}–{{end_year}}
{{/education}}

---

CERTIFICATIONS

{{#certifications}}
{{name}} | {{issuer}} | {{date_obtained}}
{{/certifications}}

---

Generated {{generatedAt}}`;

  const minimalCss = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&display=swap');
body { margin: 0; padding: 40px 48px; font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: #111; background: #fafaf8; line-height: 1.7; }
.cv-body { max-width: 720px; margin: 0 auto; }
h1 { font-size: 1.5rem; font-weight: 500; margin: 0 0 2px; letter-spacing: -0.02em; }
h2 { display: none; }
h3 { font-size: 0.85rem; font-weight: 500; margin: 16px 0 4px; text-transform: uppercase; letter-spacing: 0.1em; color: #555; }
p { margin: 2px 0 6px; }
ul { margin: 4px 0; padding-left: 0; list-style: none; }
li::before { content: "— "; color: #999; }
li { margin: 2px 0; }
hr { border: none; border-top: 1px solid #ddd; margin: 18px 0; }
em { color: #888; font-style: normal; }
strong { font-weight: 500; }
a { color: #111; }
blockquote { display: none; }
@media print { body { padding: 20px 24px; } }`;

  const templates = [
    { id: 'classic', name: 'Classic Professional', markdown_template: classicMarkdown, css_styles: classicCss, is_default: 1 },
    { id: 'modern', name: 'Modern Dark', markdown_template: modernMarkdown, css_styles: modernCss, is_default: 0 },
    { id: 'minimal', name: 'Minimal Clean', markdown_template: minimalMarkdown, css_styles: minimalCss, is_default: 0 },
  ];

  const stmt = db.prepare(`INSERT OR IGNORE INTO cv_templates (id, name, markdown_template, css_styles, company_logo_path, is_default) VALUES (?, ?, ?, ?, NULL, ?)`);
  for (const t of templates) {
    stmt.run(t.id, t.name, t.markdown_template, t.css_styles, t.is_default);
  }
  console.log('Seeded 3 default CV templates (classic, modern, minimal)');
}

function runMigrations(db) {
  // Debugging: Log the schema of 'auth_tokens'
  const authTokensInfo = db.pragma("table_info('auth_tokens')");
  console.log("auth_tokens schema:", authTokensInfo);

  // Ensure 'token_hash' column exists in 'auth_tokens'
  const hasTokenHash = authTokensInfo.some(c => c.name === 'token_hash');
  if (!hasTokenHash) {
    db.exec('ALTER TABLE auth_tokens ADD COLUMN token_hash TEXT');
    console.log("Added 'token_hash' column to 'auth_tokens'");
  } else {
    console.log("'token_hash' column already exists in 'auth_tokens'");
  }

  // Ensure 'refresh_token_hash' column exists in 'auth_tokens'
  const hasRefreshTokenHash = authTokensInfo.some(c => c.name === 'refresh_token_hash');
  if (!hasRefreshTokenHash) {
    db.exec('ALTER TABLE auth_tokens ADD COLUMN refresh_token_hash TEXT');
    console.log("Added 'refresh_token_hash' column to 'auth_tokens'");
  } else {
    console.log("'refresh_token_hash' column already exists in 'auth_tokens'");
  }

  // Add updated_by_staff if missing
  const info = db.pragma("table_info('submissions')");
  const hasCol = info.some(c => c.name === 'updated_by_staff');
  if (!hasCol) {
    db.exec('ALTER TABLE submissions ADD COLUMN updated_by_staff INTEGER DEFAULT 0');
  }

  // Extend submission_projects with historical fields (CV Gen Phase 1a)
  const projInfo = db.pragma("table_info('submission_projects')");
  const hasStartDate = projInfo.some(c => c.name === 'start_date');
  if (!hasStartDate) {
    db.exec(`ALTER TABLE submission_projects ADD COLUMN start_date TEXT`);
    db.exec(`ALTER TABLE submission_projects ADD COLUMN description TEXT`);
    db.exec(`ALTER TABLE submission_projects ADD COLUMN key_contributions TEXT`);
    db.exec(`ALTER TABLE submission_projects ADD COLUMN technologies_used TEXT`);
    db.exec(`ALTER TABLE submission_projects ADD COLUMN is_active INTEGER DEFAULT 0`);
    console.log('Extended submission_projects table with historical fields');
  }

  // Migrate user_roles from old format to new format with role column
  const oldRoleInfo = db.pragma("table_info('user_roles')");
  const hasRoleCol = oldRoleInfo.some(c => c.name === 'role');
  if (!hasRoleCol) {
    db.exec('ALTER TABLE user_roles ADD COLUMN role TEXT DEFAULT "staff"');
    console.log("Added 'role' column to 'user_roles'");
  }

  // Add is_active column to user_roles if missing
  const roleInfo = db.pragma("table_info('user_roles')");
  const hasIsActive = roleInfo.some(c => c.name === 'is_active');
  if (!hasIsActive) {
    db.exec('ALTER TABLE user_roles ADD COLUMN is_active INTEGER DEFAULT 1');
    db.exec('ALTER TABLE user_roles ADD COLUMN created_at TEXT');
    db.exec('ALTER TABLE user_roles ADD COLUMN updated_at TEXT');
    console.log('Added is_active, created_at, updated_at columns to user_roles');
  }

  // Create auth_tokens table if not exists
  const hasAuthTokens = db.pragma("table_info('auth_tokens')");
  if (hasAuthTokens.length === 0) {
    db.exec(`CREATE TABLE IF NOT EXISTS auth_tokens (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      refresh_token_hash TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked INTEGER DEFAULT 0,
      FOREIGN KEY(user_email) REFERENCES user_roles(email)
    )`);
    console.log('Created auth_tokens table');
  }

  // Create auth_audit_log table if not exists
  const hasAuthAudit = db.pragma("table_info('auth_audit_log')");
  if (hasAuthAudit.length === 0) {
    db.exec(`CREATE TABLE IF NOT EXISTS auth_audit_log (
      id TEXT PRIMARY KEY,
      email TEXT,
      action TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      success INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`);
    console.log('Created auth_audit_log table');
  }

  // Create cv_profiles table for staff CV profile data
  const hasCvProfiles = db.pragma("table_info('cv_profiles')");
  if (hasCvProfiles.length === 0) {
    db.exec(`CREATE TABLE IF NOT EXISTS cv_profiles (
      id TEXT PRIMARY KEY,
      staff_email TEXT NOT NULL,
      summary TEXT,
      phone TEXT,
      linkedin TEXT,
      location TEXT,
      photo_path TEXT,
      is_visible INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    console.log('Created cv_profiles table');
  }

  // Create education table for CV
  const hasEducation = db.pragma("table_info('education')");
  if (hasEducation.length === 0) {
    db.exec(`CREATE TABLE IF NOT EXISTS education (
      id TEXT PRIMARY KEY,
      staff_email TEXT NOT NULL,
      institution TEXT,
      degree TEXT,
      field TEXT,
      start_year INTEGER,
      end_year INTEGER,
      description TEXT,
      is_visible INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    )`);
    console.log('Created education table');
  }

  // Create certifications table for CV
  const hasCertifications = db.pragma("table_info('certifications')");
  if (hasCertifications.length === 0) {
    db.exec(`CREATE TABLE IF NOT EXISTS certifications (
      id TEXT PRIMARY KEY,
      staff_email TEXT NOT NULL,
      name TEXT,
      issuer TEXT,
      date_obtained TEXT,
      expiry_date TEXT,
      credential_id TEXT,
      description TEXT,
      is_visible INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    )`);
    console.log('Created certifications table');
  }

  // Create work_history table for CV
  const hasWorkHistory = db.pragma("table_info('work_history')");
  if (hasWorkHistory.length === 0) {
    db.exec(`CREATE TABLE IF NOT EXISTS work_history (
      id TEXT PRIMARY KEY,
      staff_email TEXT NOT NULL,
      employer TEXT,
      job_title TEXT,
      start_date TEXT,
      end_date TEXT,
      description TEXT,
      is_current INTEGER DEFAULT 0,
      is_visible INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    )`);
    console.log('Created work_history table');
  }

  // Create cv_templates table for white-label templates
  const hasCvTemplates = db.pragma("table_info('cv_templates')");
  if (hasCvTemplates.length === 0) {
    db.exec(`CREATE TABLE IF NOT EXISTS cv_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      markdown_template TEXT,
      css_styles TEXT,
      company_logo_path TEXT,
      is_default INTEGER DEFAULT 0
    )`);
    seedDefaultTemplates(db);
  }

  // Create cv_past_projects table for manually added past projects
  const hasCvPastProjects = db.pragma("table_info('cv_past_projects')");
  if (hasCvPastProjects.length === 0) {
    db.exec(`CREATE TABLE IF NOT EXISTS cv_past_projects (
      id TEXT PRIMARY KEY,
      staff_email TEXT NOT NULL,
      work_history_id TEXT,
      project_name TEXT NOT NULL,
      description TEXT,
      role TEXT,
      start_date TEXT,
      end_date TEXT,
      technologies TEXT,
      is_visible INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY(work_history_id) REFERENCES work_history(id) ON DELETE SET NULL
    )`);
    console.log('Created cv_past_projects table');
  }

  // Create cv_snapshots table
  const hasCvSnapshots = db.pragma("table_info('cv_snapshots')");
  if (hasCvSnapshots.length === 0) {
    db.exec(`CREATE TABLE IF NOT EXISTS cv_snapshots (
      id TEXT PRIMARY KEY,
      staff_email TEXT NOT NULL,
      generated_by TEXT NOT NULL,
      template_id TEXT,
      template_name TEXT,
      snapshot_html TEXT NOT NULL,
      snapshot_data TEXT,
      created_at TEXT NOT NULL
    )`);
    console.log('Created cv_snapshots table');
  }

  // Migrate cv_templates to add markdown_template and css_styles if missing
  const tmplInfo = db.pragma("table_info('cv_templates')");
  if (tmplInfo.length > 0) {
    if (!tmplInfo.some(c => c.name === 'markdown_template')) {
      db.exec('ALTER TABLE cv_templates ADD COLUMN markdown_template TEXT');
      console.log('Added markdown_template column to cv_templates');
    }
    if (!tmplInfo.some(c => c.name === 'css_styles')) {
      db.exec('ALTER TABLE cv_templates ADD COLUMN css_styles TEXT');
      console.log('Added css_styles column to cv_templates');
    }
    // Seed default templates if none exist
    const countRow = db.prepare('SELECT COUNT(*) as c FROM cv_templates').get();
    if (countRow.c === 0) {
      seedDefaultTemplates(db);
    }
  }

  // Migrations for new columns
  const whInfo = db.pragma("table_info('work_history')");
  if (!whInfo.some(c => c.name === 'is_current')) {
    db.exec('ALTER TABLE work_history ADD COLUMN is_current INTEGER DEFAULT 0');
    console.log('Added is_current column to work_history');
  }

  const ppInfo = db.pragma("table_info('cv_past_projects')");
  if (!ppInfo.some(c => c.name === 'work_history_id')) {
    db.exec('ALTER TABLE cv_past_projects ADD COLUMN work_history_id TEXT');
    console.log('Added work_history_id column to cv_past_projects');
  }

  // Add proof_path column to education table
  const eduInfo = db.pragma("table_info('education')");
  if (!eduInfo.some(c => c.name === 'proof_path')) {
    db.exec('ALTER TABLE education ADD COLUMN proof_path TEXT');
    console.log('Added proof_path column to education');
  }

  // Add proof_path column to certifications table
  const certInfo = db.pragma("table_info('certifications')");
  if (!certInfo.some(c => c.name === 'proof_path')) {
    db.exec('ALTER TABLE certifications ADD COLUMN proof_path TEXT');
    console.log('Added proof_path column to certifications');
  }

  // Migration for managed_projects
  const mpInfo = db.pragma("table_info('managed_projects')");
  if (mpInfo.length > 0) {
    // Rename 'name' to 'project_name' if it exists
    if (mpInfo.some(c => c.name === 'name') && !mpInfo.some(c => c.name === 'project_name')) {
      db.exec('ALTER TABLE managed_projects RENAME COLUMN name TO project_name');
      console.log('Renamed name to project_name in managed_projects');
    }
    // Rename 'project_brief' to 'description' if it exists
    if (mpInfo.some(c => c.name === 'project_brief') && !mpInfo.some(c => c.name === 'description')) {
      db.exec('ALTER TABLE managed_projects RENAME COLUMN project_brief TO description');
      console.log('Renamed project_brief to description in managed_projects');
    }
  }

  // Migration for submission_projects
  const spInfo = db.pragma("table_info('submission_projects')");
  if (!spInfo.some(c => c.name === 'start_date')) {
    db.exec('ALTER TABLE submission_projects ADD COLUMN start_date TEXT');
    console.log('Added start_date column to submission_projects');
  }
  if (!spInfo.some(c => c.name === 'description')) {
    db.exec('ALTER TABLE submission_projects ADD COLUMN description TEXT');
    console.log('Added description column to submission_projects');
  }
  if (!spInfo.some(c => c.name === 'key_contributions')) {
    db.exec('ALTER TABLE submission_projects ADD COLUMN key_contributions TEXT');
    console.log('Added key_contributions column to submission_projects');
  }
  if (!spInfo.some(c => c.name === 'technologies_used')) {
    db.exec('ALTER TABLE submission_projects ADD COLUMN technologies_used TEXT');
    console.log('Added technologies_used column to submission_projects');
  }
  if (!spInfo.some(c => c.name === 'is_active')) {
    db.exec('ALTER TABLE submission_projects ADD COLUMN is_active INTEGER DEFAULT 0');
    console.log('Added is_active column to submission_projects');
  }

  // Ensure 'role' column exists in 'user_roles'
  const userRolesInfo = db.pragma("table_info('user_roles')");
  const hasRoleColumn = userRolesInfo.some(c => c.name === 'role');
  if (!hasRoleColumn) {
    db.exec('ALTER TABLE user_roles ADD COLUMN role TEXT DEFAULT "staff"');
    console.log("Added 'role' column to 'user_roles'");
  }
}

module.exports = { getDb };
