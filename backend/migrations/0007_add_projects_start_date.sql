-- Add start_date column to projects_catalog for BeeSuite sync
ALTER TABLE projects_catalog 
ADD COLUMN start_date DATE DEFAULT NULL AFTER customer,
ADD INDEX idx_start_date (start_date);
