import mysql from 'mysql2/promise';
import { runMigrations } from './migrations.js';
import { v4 as uuidv4 } from 'uuid';

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'stafftrack',
  // CRITICAL: explicit utf8mb4 connection charset. mysql2 3.x defaults to
  // utf8mb4, but relying on the default is fragile — a latin1 client charset
  // mangles every non-ASCII value from utf8mb4 tables (★ → "â˜…", – → "â€“").
  // Also: NEVER pipe SQL through the `mysql` CLI without
  // `--default-character-set=utf8mb4` — it connects latin1 by default and the
  // server reinterprets UTF-8 bytes as cp1252 on write (2026-08-26 incident).
  charset: 'utf8mb4',
};

let pool;
let migrationsRun = false;

// Seed default CV templates
async function seedTemplates(connection) {
  try {
    const [existing] = await connection.execute('SELECT COUNT(*) as count FROM cv_templates');
    if (existing[0].count > 0) {
      console.log('Templates already seeded');
      return;
    }

    const templates = [
      {
        id: 'classic',
        name: 'Classic',
        is_default: 1,
        markdown: '# {{name}}\n\n{{#photo}}<div class="cv-photo"><img src="{{photo_path}}" alt="Profile Photo" /></div>{{/photo}}\n\n**{{title}}** | {{department}}\n\n---\n\n{{phone}} | {{email}}{{#linkedin}} | {{linkedin}}{{/linkedin}} | {{location}}\n\n---\n\n{{section:summary}}## Professional Summary\n\n{{summary}}\n\n---\n\n{{/section:summary}}{{section:education}}## Education\n\n{{#education}}\n- **{{institution}}**{{#degree}} — {{degree}}{{/degree}}{{#field}}, {{field}}{{/field}}{{#start_year}} ({{start_year}}{{#end_year}} – {{end_year}}{{/end_year}}){{/start_year}}{{#description}}\n  {{description}}{{/description}}{{#proof_path}}\n  📎 [View Proof]({{proof_path}}){{/proof_path}}\n{{/education}}\n\n---\n\n{{/section:education}}{{section:skills}}## Skills\n\n{{#skills}}\n- {{skill}} (★{{rating}})\n{{/skills}}\n\n---\n\n{{/section:skills}}{{section:certifications}}## Certifications\n\n{{#certifications}}\n- **{{name}}** · {{issuer}}\n  Obtained: {{date_obtained}}{{#expiry_date}} · Expires: {{expiry_date}}{{/expiry_date}}{{#credential_id}} · ID: {{credential_id}}{{/credential_id}}{{#proof_path}}\n  📎 [View Certificate]({{proof_path}}){{/proof_path}}\n{{/certifications}}\n\n---\n\n{{/section:certifications}}{{section:awards}}## Awards & Accomplishments\n\n{{#awards}}\n- **{{title}}**{{#issuer}} — {{issuer}}{{/issuer}}{{#date_received}} ({{date_received}}){{/date_received}}{{#description}}\n  {{description}}{{/description}}{{#proof_path}}\n  📎 [View Proof]({{proof_path}}){{/proof_path}}\n{{/awards}}\n\n---\n\n{{/section:awards}}{{section:workHistory}}## Work History\n\n{{#workHistory}}\n**{{employer}}** — {{job_title}} ({{start_date}} – {{end_date}})\n\n{{description}}\n\n{{/workHistory}}\n\n---\n\n{{/section:workHistory}}{{section:projects}}## Projects\n\n{{#projects}}\n**{{project_name}}** ({{customer}}) • {{role}} • {{end_date}}\n\n{{/projects}}\n\n{{/section:projects}}*Generated {{generatedAt}}*',
        css: 'body { font-family: "Segoe UI", Arial, sans-serif; font-size: 14px; color: #111; } .cv-body { position: relative; max-width: 860px; margin: 0 auto; padding: 32px; } h1 { font-size: 2rem; margin: 0 0 4px; } h2 { color: #1d4ed8; border-bottom: 2px solid #1d4ed8; padding-bottom: 4px; margin-top: 1.5rem; } hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.25rem 0; } ul { padding-left: 1.2rem; } table { border-collapse: collapse; width: 100%; } th { background: #f3f4f6; text-align: left; } th, td { padding: 6px 10px; border: 1px solid #e5e7eb; } .cv-photo { position: absolute; top: 32px; right: 32px; } .cv-photo img { width: 120px; height: 120px; border-radius: 50%; border: 2px solid #1d4ed8; box-shadow: 0 2px 8px rgba(0,0,0,0.1); object-fit: cover; } a { color: #1d4ed8; text-decoration: none; } a:hover { text-decoration: underline; }'
      },
      {
        id: 'modern',
        name: 'Modern',
        is_default: 0,
        markdown: '# {{name}}\n\n{{#photo}}<div class="cv-photo"><img src="{{photo_path}}" alt="Profile Photo" /></div>{{/photo}}\n\n**{{title}}** | {{department}}\n\n---\n\n{{phone}} | {{email}}{{#linkedin}} | {{linkedin}}{{/linkedin}} | {{location}}\n\n---\n\n{{section:summary}}## Professional Summary\n\n{{summary}}\n\n---\n\n{{/section:summary}}{{section:education}}## Education\n\n{{#education}}\n- **{{institution}}**{{#degree}} — {{degree}}{{/degree}}{{#field}}, {{field}}{{/field}}{{#start_year}} ({{start_year}}{{#end_year}} – {{end_year}}{{/end_year}}){{/start_year}}{{#description}}\n  {{description}}{{/description}}{{#proof_path}}\n  📎 [View Proof]({{proof_path}}){{/proof_path}}\n{{/education}}\n\n---\n\n{{/section:education}}{{section:skills}}## Skills\n\n{{#skills}}\n- {{skill}} (★{{rating}})\n{{/skills}}\n\n---\n\n{{/section:skills}}{{section:certifications}}## Certifications\n\n{{#certifications}}\n- **{{name}}** · {{issuer}}\n  Obtained: {{date_obtained}}{{#expiry_date}} · Expires: {{expiry_date}}{{/expiry_date}}{{#credential_id}} · ID: {{credential_id}}{{/credential_id}}{{#proof_path}}\n  📎 [View Certificate]({{proof_path}}){{/proof_path}}\n{{/certifications}}\n\n---\n\n{{/section:certifications}}{{section:awards}}## Awards & Accomplishments\n\n{{#awards}}\n- **{{title}}**{{#issuer}} — {{issuer}}{{/issuer}}{{#date_received}} ({{date_received}}){{/date_received}}{{#description}}\n  {{description}}{{/description}}{{#proof_path}}\n  📎 [View Proof]({{proof_path}}){{/proof_path}}\n{{/awards}}\n\n---\n\n{{/section:awards}}{{section:workHistory}}## Work History\n\n{{#workHistory}}\n**{{employer}}** — {{job_title}} ({{start_date}} – {{end_date}})\n\n{{description}}\n\n{{/workHistory}}\n\n---\n\n{{/section:workHistory}}{{section:projects}}## Projects\n\n{{#projects}}\n**{{project_name}}** ({{customer}}) • {{role}} • {{end_date}}\n\n{{/projects}}\n\n{{/section:projects}}*Generated {{generatedAt}}*',
        css: 'body { font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px; color: #1a202c; background: #f7fafc; } .cv-body { position: relative; max-width: 900px; margin: 0 auto; padding: 40px; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); } h1 { font-size: 2.25rem; margin: 0 0 8px; font-weight: 700; color: #0f766e; } h2 { color: #0f766e; border-left: 4px solid #0f766e; padding-left: 12px; margin-top: 2rem; font-size: 1.2rem; } hr { border: none; border-top: 2px solid #e2e8f0; margin: 1.5rem 0; } ul { padding-left: 1.5rem; } table { border-collapse: collapse; width: 100%; } th { background: #f0fdfa; text-align: left; font-weight: 600; } th, td { padding: 8px 12px; border: 1px solid #d1fae5; } .cv-photo { position: absolute; top: 40px; right: 40px; } .cv-photo img { width: 100px; height: 100px; border-radius: 8px; border: 1px solid #d1fae5; box-shadow: 0 4px 12px rgba(0,0,0,0.08); object-fit: cover; } a { color: #0f766e; text-decoration: none; } a:hover { text-decoration: underline; }'
      },
      {
        id: 'minimal',
        name: 'Minimal',
        is_default: 0,
        markdown: '# {{name}}\n\n{{#photo}}<div class="cv-photo"><img src="{{photo_path}}" alt="Profile Photo" /></div>{{/photo}}\n{{title}} — {{department}}\n\n{{phone}} | {{email}}{{#linkedin}} | {{linkedin}}{{/linkedin}} | {{location}}\n\n{{section:summary}}## Summary\n{{summary}}\n{{/section:summary}}{{section:education}}## Education\n{{#education}}\n{{institution}}{{#degree}} · {{degree}}{{/degree}}{{#field}}, {{field}}{{/field}}{{#start_year}} ({{start_year}}{{#end_year}} – {{end_year}}{{/end_year}}){{/start_year}}{{#description}} — {{description}}{{/description}}{{#proof_path}} 📎 [Proof]({{proof_path}}){{/proof_path}}\n{{/education}}\n{{/section:education}}{{section:skills}}## Skills\n{{#skills}}\n{{skill}} (★{{rating}}) {{/skills}}\n{{/section:skills}}{{section:certifications}}## Certifications\n{{#certifications}}\n{{name}} · {{issuer}} | {{date_obtained}}{{#expiry_date}} – {{expiry_date}}{{/expiry_date}}{{#proof_path}} | 📎 [Proof]({{proof_path}}){{/proof_path}}\n{{/certifications}}\n{{/section:certifications}}{{section:awards}}## Awards\n{{#awards}}\n{{title}}{{#issuer}} · {{issuer}}{{/issuer}}{{#date_received}} | {{date_received}}{{/date_received}}{{#description}} — {{description}}{{/description}}{{#proof_path}} 📎 [Proof]({{proof_path}}){{/proof_path}}\n{{/awards}}\n{{/section:awards}}{{section:workHistory}}## Experience\n{{#workHistory}}\n{{employer}} — {{job_title}} | {{start_date}} – {{end_date}}\n{{description}}\n{{/workHistory}}\n{{/section:workHistory}}{{section:projects}}## Projects\n{{#projects}}\n{{project_name}} ({{customer}}) • {{role}} • {{end_date}}\n{{/projects}}\n{{/section:projects}}Generated {{generatedAt}}',
        css: 'body { font-family: Courier, monospace; font-size: 12px; color: #000; line-height: 1.6; } .cv-body { position: relative; max-width: 800px; margin: 0 auto; padding: 24px; } h1 { font-size: 1.5rem; margin: 16px 0 4px; font-weight: bold; } h2 { font-size: 1rem; margin: 12px 0 4px; font-weight: bold; text-decoration: underline; } hr { border: none; border-top: 1px dashed #000; margin: 12px 0; } ul { margin: 0; padding-left: 20px; } table { border-collapse: collapse; } th, td { padding: 4px 8px; border: 1px solid #000; } .cv-photo { position: absolute; top: 24px; right: 24px; } .cv-photo img { width: 80px; height: 120px; border: 1px solid #000; object-fit: cover; } a { color: #000; text-decoration: underline; }'
      }
    ];

    for (const tmpl of templates) {
      await connection.execute(
        'INSERT INTO cv_templates (id, name, markdown_template, css_styles, is_default) VALUES (?, ?, ?, ?, ?)',
        [tmpl.id, tmpl.name, tmpl.markdown, tmpl.css, tmpl.is_default]
      );
    }
    console.log('✓ Seeded 3 default CV templates');
  } catch (err) {
    console.error('Error seeding templates:', err.message);
  }
}

export async function getDb() {
  if (!pool) {
    console.log('Initializing MySQL connection pool...');
    pool = mysql.createPool({
      ...MYSQL_CONFIG,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelayMs: 30000,
    });

    // Get a test connection to verify connectivity
    let connection;
    try {
      connection = await pool.getConnection();
      console.log('Connected to MySQL database.');
      
      // Run migrations only once
      if (!migrationsRun) {
        await runMigrations(connection);
        await seedTemplates(connection);
        migrationsRun = true;
      }
      
      connection.release();
    } catch (err) {
      console.error('Failed to initialize database:', err.message);
      throw err;
    }
  }
  
  return {
    async query(sql, params = []) {
      const connection = await pool.getConnection();
      try {
        return await connection.execute(sql, params);
      } finally {
        connection.release();
      }
    },
    async queryOne(sql, params = []) {
      const [rows] = await this.query(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },
  };
}
