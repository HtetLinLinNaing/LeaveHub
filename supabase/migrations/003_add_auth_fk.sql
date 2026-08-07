-- Run AFTER switching to Google OAuth
-- Links users.id to auth.users.id

ALTER TABLE users
  ADD CONSTRAINT users_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
