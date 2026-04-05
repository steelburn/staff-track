-- Ensure stafftrack user has the correct password set
-- This runs after initial schema creation to properly configure authentication
-- Note: FLUSH PRIVILEGES removed as it requires RELOAD privilege
ALTER USER 'stafftrack'@'%' IDENTIFIED BY 'stafftrack_dev_password';
