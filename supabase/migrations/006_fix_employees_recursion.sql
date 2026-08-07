-- Fix infinite recursion in 004_strict_rls.sql: employees self-references.
--
-- 004's "Managers can read team" and similar policies on employees, leave
-- balances, and leave requests all do `FROM employees WHERE user_id = auth.uid()`
-- inside a policy that already runs against employees/leave_*/holidays. With
-- RLS enabled on employees, the inner SELECT re-triggers the same policy
-- and recurses.
--
-- Add a SECURITY DEFINER helper that returns the caller's employee.id,
-- bypassing RLS. Rewrite the 4 self-referencing policies to use it.

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM employees WHERE user_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_manager_of(target_employee_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE id = target_employee_id
      AND manager_id = public.current_employee_id()
  )
$$;

-- employees: Managers can read team
DROP POLICY IF EXISTS "Managers can read team" ON employees;
CREATE POLICY "Managers can read team" ON employees
  FOR SELECT USING (manager_id = public.current_employee_id());

-- leave_balances: Managers can read team balances
DROP POLICY IF EXISTS "Managers can read team balances" ON leave_balances;
CREATE POLICY "Managers can read team balances" ON leave_balances
  FOR SELECT USING (public.is_manager_of(employee_id));

-- leave_requests: Employees can read own requests
DROP POLICY IF EXISTS "Employees can read own requests" ON leave_requests;
CREATE POLICY "Employees can read own requests" ON leave_requests
  FOR SELECT USING (employee_id = public.current_employee_id());

-- leave_requests: Employees can create own requests
DROP POLICY IF EXISTS "Employees can create own requests" ON leave_requests;
CREATE POLICY "Employees can create own requests" ON leave_requests
  FOR INSERT WITH CHECK (employee_id = public.current_employee_id());

-- leave_requests: Employees can update own pending requests
DROP POLICY IF EXISTS "Employees can update own pending requests" ON leave_requests;
CREATE POLICY "Employees can update own pending requests" ON leave_requests
  FOR UPDATE USING (
    employee_id = public.current_employee_id() AND status = 'pending'
  );

-- leave_requests: Managers can read team requests
DROP POLICY IF EXISTS "Managers can read team requests" ON leave_requests;
CREATE POLICY "Managers can read team requests" ON leave_requests
  FOR SELECT USING (public.is_manager_of(employee_id));

-- leave_requests: Managers can approve team requests
DROP POLICY IF EXISTS "Managers can approve team requests" ON leave_requests;
CREATE POLICY "Managers can approve team requests" ON leave_requests
  FOR UPDATE USING (public.is_manager_of(employee_id));
