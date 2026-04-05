import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

/**
 * Run all pending migrations on MySQL database
 * @param {mysql.Connection} connection - MySQL connection object
 */
async function runMigrations(connection) {
  try {
    // Create migrations tracking table if it doesn't exist
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration_name VARCHAR(255) NOT NULL UNIQUE,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_migration_name (migration_name)
      ) ENGINE=InnoDB
    `);

    // Get list of executed migrations
    const [executed] = await connection.execute('SELECT migration_name FROM _migrations');
    const executedSet = new Set(executed.map(row => row.migration_name));

    // Get list of migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql') && !f.startsWith('_'))
      .sort();

    console.log(`\n📦 Database Migrations`);
    console.log('='.repeat(50));

    let executedCount = 0;
    for (const file of files) {
      const migrationName = path.basename(file, '.sql');

      if (executedSet.has(migrationName)) {
        console.log(`✓ ${migrationName} (already executed)`);
        continue;
      }

      // Read and execute migration file
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Split by semicolons and execute each statement
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      console.log(`⏳ Executing ${migrationName}...`);

      try {
        for (const statement of statements) {
          await connection.execute(statement);
        }

        // Record migration as executed
        await connection.execute(
          'INSERT INTO _migrations (migration_name) VALUES (?)',
          [migrationName]
        );

        console.log(`✅ ${migrationName}`);
        executedCount++;
      } catch (error) {
        console.error(`❌ ${migrationName} failed:`, error.message);
        throw error;
      }
    }

    console.log('='.repeat(50));
    if (executedCount === 0) {
      console.log('✓ All migrations already executed');
    } else {
      console.log(`✓ ${executedCount} migration(s) executed successfully\n`);
    }

    return executedCount;
  } catch (error) {
    console.error('Migration execution failed:', error);
    throw error;
  }
}

export { runMigrations };
