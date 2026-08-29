-- Add name column to managed_projects (live schema drift: name NOT NULL, project_name nullable).
-- Guarded: no-op when the column already exists (MySQL 8.0 lacks ADD COLUMN IF NOT EXISTS).
;
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'managed_projects' AND COLUMN_NAME = 'name');
SET @ddl = IF(@col_exists = 0, 'ALTER TABLE managed_projects ADD COLUMN name VARCHAR(255) NOT NULL AFTER project_name', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
