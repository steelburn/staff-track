-- 0015_create_beesuite_sessions.sql
-- Per-user BeeSuite (AppCore) access tokens, captured at StaffTrack login
-- (see auth.js POST /auth/login). Admin "Sync Staff" / "Sync Projects"
-- actions call BeeSuite under the logged-in operator's OWN identity instead
-- of a shared khairulnizam service account. Re-captured on every login, so a
-- stale/expired BeeSuite session is fixed simply by signing back in.
;

CREATE TABLE IF NOT EXISTS beesuite_sessions (
  email VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  captured_at DATETIME NOT NULL,
  PRIMARY KEY (email),
  FOREIGN KEY(email) REFERENCES user_roles(email) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
