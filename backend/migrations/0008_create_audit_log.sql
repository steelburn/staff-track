-- 0008_create_audit_log.sql
-- Audit trail for staff profile updates (any personal entry: staff details,
-- skills, active/past projects, education, certifications, work history, photo).
;

CREATE TABLE IF NOT EXISTS profile_audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  staff_email VARCHAR(255) NOT NULL,
  actor_email VARCHAR(255) NOT NULL,
  section VARCHAR(50) NOT NULL,
  action VARCHAR(20) NOT NULL,
  summary VARCHAR(500) DEFAULT NULL,
  details JSON DEFAULT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_audit_staff (staff_email, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
