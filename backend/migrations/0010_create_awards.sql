-- Awards and Accomplishments for CV
;

CREATE TABLE IF NOT EXISTS awards (
  id VARCHAR(36) PRIMARY KEY,
  staff_email VARCHAR(255) NOT NULL,
  title VARCHAR(255),
  issuer VARCHAR(255),
  date_received DATE,
  description LONGTEXT,
  is_visible TINYINT DEFAULT 1,
  created_at DATETIME NOT NULL,
  INDEX idx_staff_email (staff_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
