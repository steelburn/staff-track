import mysql from 'mysql2/promise';
import { runMigrations } from './migrations.js';

let pool = null;

/**
 * Create MySQL connection pool
 */
async function initializePool() {
  if (pool) {
    return pool;
  }

  const config = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'root_password',
    database: process.env.MYSQL_DATABASE || 'stafftrack',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT || '10'),
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelayMs: 30000,
    timezone: 'Z', // Use UTC
  };

  console.log(`🗄️  Connecting to MySQL at ${config.host}:${config.port}/${config.database}`);

  try {
    pool = await mysql.createPool(config);

    // Test connection
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();

    console.log('✓ MySQL connection pool established');

    // Run migrations
    const migConnection = await pool.getConnection();
    try {
      await runMigrations(migConnection);
    } finally {
      migConnection.release();
    }

    return pool;
  } catch (error) {
    console.error('❌ MySQL connection failed:', error.message);
    throw error;
  }
}

/**
 * Get database connection from pool
 * @returns {mysql.Connection} MySQL connection
 */
async function getConnection() {
  if (!pool) {
    await initializePool();
  }
  return await pool.getConnection();
}

/**
 * Execute query with automatic connection management
 * @param {string} sql - SQL query
 * @param {array} params - Query parameters
 * @returns {array} [rows, fields]
 */
async function query(sql, params = []) {
  const connection = await getConnection();
  try {
    return await connection.execute(sql, params);
  } finally {
    connection.release();
  }
}

/**
 * Execute a single row query
 * @param {string} sql - SQL query
 * @param {array} params - Query parameters
 * @returns {object} Single row or null
 */
async function queryOne(sql, params = []) {
  const [rows] = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Insert operation
 * @param {string} table - Table name
 * @param {object} data - Data to insert
 * @returns {object} Insert result with insertId
 */
async function insert(table, data) {
  const columns = Object.keys(data);
  const values = Object.values(data);
  const placeholders = columns.map(() => '?').join(',');

  const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`;
  const [result] = await query(sql, values);
  return result;
}

/**
 * Update operation
 * @param {string} table - Table name
 * @param {object} data - Data to update
 * @param {string} where - WHERE clause (without WHERE keyword)
 * @param {array} whereParams - WHERE clause parameters
 * @returns {object} Update result with affectedRows
 */
async function update(table, data, where, whereParams = []) {
  const sets = Object.keys(data).map(k => `${k} = ?`).join(',');
  const values = [...Object.values(data), ...whereParams];

  const sql = `UPDATE ${table} SET ${sets} WHERE ${where}`;
  const [result] = await query(sql, values);
  return result;
}

/**
 * Delete operation
 * @param {string} table - Table name
 * @param {string} where - WHERE clause
 * @param {array} params - WHERE parameters
 * @returns {object} Delete result with affectedRows
 */
async function deleteRecord(table, where, params = []) {
  const sql = `DELETE FROM ${table} WHERE ${where}`;
  const [result] = await query(sql, params);
  return result;
}

/**
 * Transaction helper
 * @param {function} callback - Function to execute in transaction
 * @returns {any} Result from callback
 */
async function transaction(callback) {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Close the connection pool
 */
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('✓ MySQL connection pool closed');
  }
}

export {
  initializePool,
  getConnection,
  query,
  queryOne,
  insert,
  update,
  deleteRecord,
  transaction,
  close,
};
