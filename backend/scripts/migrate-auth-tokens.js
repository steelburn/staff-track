import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function migrateAuthTokens() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'stafftrack',
    });

    try {
        console.log('Adding `refresh_token_hash` column to `auth_tokens` table...');
        await connection.execute(
            'ALTER TABLE auth_tokens ADD COLUMN refresh_token_hash VARCHAR(255);'
        );
        console.log('Migration completed successfully.');
    } catch (error) {
        console.error('Migration failed:', error.message);
    } finally {
        await connection.end();
    }
}

migrateAuthTokens();