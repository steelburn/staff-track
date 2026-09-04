-- 0014_create_api_tokens.sql
-- Self-service personal API tokens. Only SHA-256 hashes of secrets are stored;
-- the plaintext `st_…` secret is shown once at creation and never persisted.
;

CREATE TABLE IF NOT EXISTS api_tokens (
  id VARCHAR(36) PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  read_only TINYINT(1) NOT NULL DEFAULT 1,
  expires_at DATETIME NULL,
  last_used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY(user_email) REFERENCES user_roles(email) ON DELETE CASCADE,
  UNIQUE INDEX idx_token_hash (token_hash),
  INDEX idx_user_email (user_email),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
