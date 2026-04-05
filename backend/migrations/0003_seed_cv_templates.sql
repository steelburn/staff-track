CREATE TABLE IF NOT EXISTS cv_templates (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  markdown_template LONGTEXT,
  css_styles LONGTEXT,
  company_logo_path VARCHAR(500),
  is_default TINYINT DEFAULT 0,
  INDEX idx_is_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
