-- Approval routing per the org chart:
--   manager → approves employee leave
--   HR      → approves manager leave
--   admin   → approves anyone
-- Self-approval is blocked in the server action (PRD §9).
--
-- Helper looks up the requester's role on each call.

CREATE OR REPLACE FUNCTION public.requester_role(req_employee_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role
  FROM employees e
  JOIN users u ON u.id = e.user_id
  WHERE e.id = req_employee_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.can_approve_request(req_employee_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN auth.uid() IS NULL THEN false
      WHEN EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid() AND role = 'admin'
      ) THEN true
      WHEN EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid() AND role = 'manager'
      ) AND public.requester_role(req_employee_id) = 'employee' THEN true
      WHEN EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid() AND role = 'hr'
      ) AND public.requester_role(req_employee_id) = 'manager' THEN true
      ELSE false
    END
$$;

-- leave_requests: only the right approver can read
DROP POLICY IF EXISTS "Approvers can read all requests" ON leave_requests;
CREATE POLICY "Approvers can read all requests" ON leave_requests
  FOR SELECT USING (public.can_approve_request(employee_id));

-- leave_requests: same gate for update
DROP POLICY IF EXISTS "Approvers can update all requests" ON leave_requests;
CREATE POLICY "Approvers can update all requests" ON leave_requests
  FOR UPDATE USING (public.can_approve_request(employee_id));
