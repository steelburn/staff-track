ALTER TABLE profile_audit_log
    MODIFY staff_email varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
    MODIFY actor_email varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL;
