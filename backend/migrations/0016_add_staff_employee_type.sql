-- Add employee_type + employee_status to staff (populated from BeeSuite/ZCS user_info).
-- employee_type   : Permanent | Contract | Temporary | ... (free-form, may be blank)
-- employee_status : Confirmed | Probation | Terminated | ... (free-form, may be blank)
-- Guarded: no-op when the column already exists (MySQL 8.0 lacks ADD COLUMN IF NOT EXISTS).
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff' AND COLUMN_NAME = 'employee_type');
SET @ddl = IF(@col_exists = 0, 'ALTER TABLE staff ADD COLUMN employee_type VARCHAR(100) DEFAULT NULL AFTER department', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff' AND COLUMN_NAME = 'employee_status');
SET @ddl = IF(@col_exists = 0, 'ALTER TABLE staff ADD COLUMN employee_status VARCHAR(50) DEFAULT NULL AFTER employee_type', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff' AND INDEX_NAME = 'idx_employee_type');
SET @ddl = IF(@idx_exists = 0, 'ALTER TABLE staff ADD INDEX idx_employee_type (employee_type)', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
