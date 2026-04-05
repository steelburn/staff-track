-- StaffTrack MySQL Migration
-- Version: 0001
-- Description: Initial schema migration from SQLite to MySQL
-- Date: 2026-04-04

-- Base record for each staff submission
CREATE TABLE IF NOT EXISTS submissions (
  id VARCHAR(36) PRIMARY KEY,
  staff_email VARCHAR(255) NOT NULL,
  staff_name VARCHAR(255) NOT NULL,
  title VARCHAR(255),
  department VARCHAR(255),
  manager_name VARCHAR(255),
  edited_fields JSON DEFAULT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  updated_by_staff TINYINT DEFAULT 0,
  INDEX idx_staff_email (staff_email),
  INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Individual skills submitted by the user
CREATE TABLE IF NOT EXISTS submission_skills (
  id VARCHAR(36) PRIMARY KEY,
  submission_id VARCHAR(36) NOT NULL,
  skill VARCHAR(255) NOT NULL,
  rating INT DEFAULT 0,
  FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  INDEX idx_submission_id (submission_id),
  INDEX idx_skill (skill)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Individual project assignments submitted by the user
CREATE TABLE IF NOT EXISTS submission_projects (
  id VARCHAR(36) PRIMARY KEY,
  submission_id VARCHAR(36) NOT NULL,
  soc VARCHAR(100),
  project_name VARCHAR(255),
  customer VARCHAR(255),
  role VARCHAR(255),
  start_date DATE,
  end_date DATE,
  description LONGTEXT,
  key_contributions LONGTEXT,
  technologies_used TEXT,
  is_active TINYINT DEFAULT 0,
  FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  INDEX idx_submission_id (submission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Administrative Roles (user permissions and access control)
CREATE TABLE IF NOT EXISTS user_roles (
  email VARCHAR(255) PRIMARY KEY,
  role ENUM('admin', 'hr', 'coordinator', 'sa', 'sales', 'staff') NOT NULL DEFAULT 'staff',
  is_active TINYINT DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_role (role),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Projects explicitly created by coordinators
CREATE TABLE IF NOT EXISTS managed_projects (
  id VARCHAR(36) PRIMARY KEY,
  soc VARCHAR(100),
  project_name VARCHAR(255) NOT NULL,
  customer VARCHAR(255),
  type_infra TINYINT DEFAULT 0,
  type_software TINYINT DEFAULT 0,
  type_infra_support TINYINT DEFAULT 0,
  type_software_support TINYINT DEFAULT 0,
  start_date DATE,
  end_date DATE,
  technologies JSON,
  description LONGTEXT,
  coordinator_email VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_coordinator_email (coordinator_email),
  INDEX idx_soc (soc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Globally referenced staff identity records (Migrated from CSV)
CREATE TABLE IF NOT EXISTS staff (
  email VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  title VARCHAR(255),
  department VARCHAR(255),
  manager_name VARCHAR(255),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Globally referenced project catalog (Migrated from CSV)
CREATE TABLE IF NOT EXISTS projects_catalog (
  id VARCHAR(36) PRIMARY KEY,
  soc VARCHAR(100),
  project_name VARCHAR(255) NOT NULL,
  customer VARCHAR(255),
  end_date DATE,
  INDEX idx_soc (soc),
  INDEX idx_project_name (project_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Canonical list of skills (Data Governance)
CREATE TABLE IF NOT EXISTS skills_catalog (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  category VARCHAR(100),
  aliases JSON DEFAULT NULL,
  is_active TINYINT DEFAULT 1,
  INDEX idx_name (name),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit log for skill merge operations
CREATE TABLE IF NOT EXISTS skill_merge_log (
  id VARCHAR(36) PRIMARY KEY,
  from_name VARCHAR(255) NOT NULL,
  to_name VARCHAR(255) NOT NULL,
  affected_count INT DEFAULT 0,
  merged_by VARCHAR(255),
  merged_at DATETIME NOT NULL,
  INDEX idx_merged_at (merged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- JWT tokens for session management
CREATE TABLE IF NOT EXISTS auth_tokens (
  id VARCHAR(36) PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  token_hash TEXT NOT NULL,
  refresh_token_hash TEXT,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  revoked TINYINT DEFAULT 0,
  FOREIGN KEY(user_email) REFERENCES user_roles(email) ON DELETE CASCADE,
  INDEX idx_user_email (user_email),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit log for authentication events
CREATE TABLE IF NOT EXISTS auth_audit_log (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  success TINYINT NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_email (email),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CV Profiles (white-label CV management)
CREATE TABLE IF NOT EXISTS cv_profiles (
  id VARCHAR(36) PRIMARY KEY,
  staff_email VARCHAR(255) NOT NULL,
  summary LONGTEXT,
  phone VARCHAR(20),
  linkedin VARCHAR(500),
  location VARCHAR(255),
  photo_path VARCHAR(500),
  is_visible TINYINT DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_staff_email (staff_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Education records for CV
CREATE TABLE IF NOT EXISTS education (
  id VARCHAR(36) PRIMARY KEY,
  staff_email VARCHAR(255) NOT NULL,
  institution VARCHAR(255),
  degree VARCHAR(100),
  field VARCHAR(255),
  start_year INT,
  end_year INT,
  description LONGTEXT,
  proof_path VARCHAR(500),
  is_visible TINYINT DEFAULT 1,
  created_at DATETIME NOT NULL,
  INDEX idx_staff_email (staff_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Certifications for CV
CREATE TABLE IF NOT EXISTS certifications (
  id VARCHAR(36) PRIMARY KEY,
  staff_email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  issuer VARCHAR(255),
  date_obtained DATE,
  expiry_date DATE,
  credential_id VARCHAR(255),
  description LONGTEXT,
  proof_path VARCHAR(500),
  is_visible TINYINT DEFAULT 1,
  created_at DATETIME NOT NULL,
  INDEX idx_staff_email (staff_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Work history for CV
CREATE TABLE IF NOT EXISTS work_history (
  id VARCHAR(36) PRIMARY KEY,
  staff_email VARCHAR(255) NOT NULL,
  employer VARCHAR(255),
  job_title VARCHAR(255),
  start_date DATE,
  end_date DATE,
  description LONGTEXT,
  is_current TINYINT DEFAULT 0,
  is_visible TINYINT DEFAULT 1,
  created_at DATETIME NOT NULL,
  INDEX idx_staff_email (staff_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CV Templates (white-label templates for generating CVs)
CREATE TABLE IF NOT EXISTS cv_templates (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  markdown_template LONGTEXT,
  css_styles LONGTEXT,
  company_logo_path VARCHAR(500),
  is_default TINYINT DEFAULT 0,
  INDEX idx_is_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Past projects for CV (manually added projects)
CREATE TABLE IF NOT EXISTS cv_past_projects (
  id VARCHAR(36) PRIMARY KEY,
  staff_email VARCHAR(255) NOT NULL,
  work_history_id VARCHAR(36),
  project_name VARCHAR(255) NOT NULL,
  description LONGTEXT,
  role VARCHAR(255),
  start_date DATE,
  end_date DATE,
  technologies TEXT,
  is_visible TINYINT DEFAULT 1,
  created_at DATETIME NOT NULL,
  FOREIGN KEY(work_history_id) REFERENCES work_history(id) ON DELETE SET NULL,
  INDEX idx_staff_email (staff_email),
  INDEX idx_work_history_id (work_history_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CV Snapshots (generated CV snapshots for versioning)
CREATE TABLE IF NOT EXISTS cv_snapshots (
  id VARCHAR(36) PRIMARY KEY,
  staff_email VARCHAR(255) NOT NULL,
  generated_by VARCHAR(255) NOT NULL,
  template_id VARCHAR(36),
  template_name VARCHAR(255),
  snapshot_html LONGTEXT NOT NULL,
  snapshot_data JSON,
  created_at DATETIME NOT NULL,
  FOREIGN KEY(template_id) REFERENCES cv_templates(id) ON DELETE SET NULL,
  INDEX idx_staff_email (staff_email),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration tracking table (for framework)
CREATE TABLE IF NOT EXISTS _migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  migration_name VARCHAR(255) NOT NULL UNIQUE,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_migration_name (migration_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
