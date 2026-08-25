-- Legacy identity constraint. Existing seeded rows are intentionally not
-- validated so a fresh 001-009 chain can run before demo Auth bootstrap.
-- New rows are still checked until migration 009 replaces this link.

ALTER TABLE users
  ADD CONSTRAINT users_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
  NOT VALID;
