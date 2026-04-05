ALTER TABLE work_history CHANGE COLUMN company employer VARCHAR(255);
ALTER TABLE work_history CHANGE COLUMN position job_title VARCHAR(255);
ALTER TABLE work_history ADD COLUMN is_current TINYINT DEFAULT 0;
