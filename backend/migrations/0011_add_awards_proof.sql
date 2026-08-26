-- Add proof_path to awards
;

ALTER TABLE awards
  ADD COLUMN proof_path VARCHAR(500) NULL AFTER description;
