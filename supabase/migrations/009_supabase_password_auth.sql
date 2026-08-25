BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID;

UPDATE public.users AS app_user
SET auth_user_id = app_user.id
FROM auth.users AS auth_user
WHERE app_user.auth_user_id IS NULL
  AND auth_user.id = app_user.id;

ALTER TABLE public.users
  ADD CONSTRAINT users_auth_user_id_key UNIQUE (auth_user_id);

ALTER TABLE public.users
  ADD CONSTRAINT users_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;

CREATE OR REPLACE FUNCTION public.current_user_role_is(check_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE auth_user_id = auth.uid() AND role::text = ANY(check_roles)
  )
$$;

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
  FROM employees e
  JOIN users u ON u.id = e.user_id
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1
$$;

DROP POLICY IF EXISTS "Users can read own record" ON users;
CREATE POLICY "Users can read own record" ON users
  FOR SELECT USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "Employees can read own record" ON employees;
CREATE POLICY "Employees can read own record" ON employees
  FOR SELECT USING (id = public.current_employee_id());

DROP POLICY IF EXISTS "Employees can read own balances" ON leave_balances;
CREATE POLICY "Employees can read own balances" ON leave_balances
  FOR SELECT USING (employee_id = public.current_employee_id());

DROP POLICY IF EXISTS "dev_allow_all_leave_grants" ON leave_grants;
DROP POLICY IF EXISTS "dev_allow_all_leave_request_days" ON leave_request_days;

COMMIT;
