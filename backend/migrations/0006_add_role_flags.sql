-- Migration: Add is_hr and is_coordinator boolean flags to user_roles
-- These columns are used by the auth system to control access

ALTER TABLE user_roles 
  ADD COLUMN is_hr TINYINT DEFAULT 0 AFTER role,
  ADD COLUMN is_coordinator TINYINT DEFAULT 0 AFTER is_hr;

-- Populate the flags based on existing role values
UPDATE user_roles SET is_hr = 1 WHERE role = 'hr';
UPDATE user_roles SET is_coordinator = 1 WHERE role = 'coordinator';

-- Admin users get both flags set to 1
UPDATE user_roles SET is_hr = 1, is_coordinator = 1 WHERE role = 'admin';
