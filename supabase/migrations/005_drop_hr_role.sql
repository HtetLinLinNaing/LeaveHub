-- Drop the HR role.
--
-- 1. Remove the only HR seed user. employees first because of the FK from
--    employees.user_id to users.id.
DELETE FROM employees WHERE user_id = (
  SELECT id FROM users WHERE email = 'alice@company.com'
);
DELETE FROM users WHERE email = 'alice@company.com';

-- 2. Create a new role type without 'hr'. Postgres ENUMs do not support
--    DROP VALUE; the column-swap dance is the standard workaround.
CREATE TYPE role_new AS ENUM ('employee', 'manager', 'admin');

-- 3. Swap the column to the new type. The cast is safe because step 1
--    removed every row with role = 'hr'.
ALTER TABLE users
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE role_new USING role::text::role_new,
  ALTER COLUMN role SET DEFAULT 'employee';

-- 4. Drop the old type and rename the new one back.
DROP TYPE role;
ALTER TYPE role_new RENAME TO role;
