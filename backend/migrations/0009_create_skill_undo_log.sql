-- 0009_create_skill_undo_log.sql
-- Undo log for skill consolidation ops (merge / rename / split / delete).
-- before_state = full JSON snapshot of the affected submission_skills rows
-- (id, submission_id, skill, rating) captured BEFORE the op, so the most
-- recent op per actor can be rolled back exactly.
;

CREATE TABLE IF NOT EXISTS skill_undo_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_email VARCHAR(255) NOT NULL,
  action VARCHAR(20) NOT NULL,
  summary VARCHAR(500) DEFAULT NULL,
  before_state JSON NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_undo_actor (actor_email, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
