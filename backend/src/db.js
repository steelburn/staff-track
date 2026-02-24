'use strict';
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/submissions.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);

    // Run CSV seeders if tables are empty
    const { runSeed } = require('./seed');
    runSeed(db);
  }
  return db;
}

function initSchema(db) {
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
        updated_at TEXT NOT NULL
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
        end_date TEXT,
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
        name TEXT NOT NULL,
        customer TEXT,
        type_infra INTEGER DEFAULT 0,
        type_software INTEGER DEFAULT 0,
        type_infra_support INTEGER DEFAULT 0,
        type_software_support INTEGER DEFAULT 0,
        end_date TEXT,
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
    `);
}

module.exports = { getDb };
