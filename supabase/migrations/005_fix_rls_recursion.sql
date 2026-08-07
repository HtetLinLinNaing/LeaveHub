-- Fix infinite recursion in 004_strict_rls.sql.
--
-- "Admins can read all users" queried the `users` table from within a
-- policy on `users`, triggering the same policy recursively. Same pattern
-- would hit any policy on `users` that does EXISTS(SELECT ... users ...).
--
-- Replace those subqueries with SECURITY DEFINER functions so the inner
-- query runs as the function owner (bypassing RLS), breaking the cycle.

CREATE OR REPLACE FUNCTION public.current_user_role_is(check_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = ANY(check_roles)
  )
$$;

-- Recreate the recursive policy using the helper
DROP POLICY IF EXISTS "Admins can read all users" ON users;
CREATE POLICY "Admins can read all users" ON users
  FOR SELECT USING (public.current_user_role_is(ARRAY['admin']));

-- Rewrite the cross-table policies the same way for consistency and to
-- future-proof against new recursive structures. Behaviour unchanged.
DROP POLICY IF EXISTS "HR can read all employees" ON employees;
CREATE POLICY "HR can read all employees" ON employees
  FOR SELECT USING (public.current_user_role_is(ARRAY['hr', 'admin']));

DROP POLICY IF EXISTS "HR can manage employees" ON employees;
CREATE POLICY "HR can manage employees" ON employees
  FOR ALL USING (public.current_user_role_is(ARRAY['hr', 'admin']));

DROP POLICY IF EXISTS "HR can manage leave types" ON leave_types;
CREATE POLICY "HR can manage leave types" ON leave_types
  FOR ALL USING (public.current_user_role_is(ARRAY['hr', 'admin']));

DROP POLICY IF EXISTS "HR can read all balances" ON leave_balances;
CREATE POLICY "HR can read all balances" ON leave_balances
  FOR SELECT USING (public.current_user_role_is(ARRAY['hr', 'admin']));

DROP POLICY IF EXISTS "HR can manage all requests" ON leave_requests;
CREATE POLICY "HR can manage all requests" ON leave_requests
  FOR ALL USING (public.current_user_role_is(ARRAY['hr', 'admin']));

DROP POLICY IF EXISTS "HR can manage holidays" ON holidays;
CREATE POLICY "HR can manage holidays" ON holidays
  FOR ALL USING (public.current_user_role_is(ARRAY['hr', 'admin']));
