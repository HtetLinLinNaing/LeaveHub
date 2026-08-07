-- ============================================================
-- Strict RLS Policies — run AFTER switching to Google OAuth
-- This replaces the dev-permissive policies from 001_initial_schema.sql
-- ============================================================

-- Drop dev policies
DROP POLICY IF EXISTS "dev_allow_all_users" ON users;
DROP POLICY IF EXISTS "dev_allow_all_employees" ON employees;
DROP POLICY IF EXISTS "dev_allow_all_leave_types" ON leave_types;
DROP POLICY IF EXISTS "dev_allow_all_leave_balances" ON leave_balances;
DROP POLICY IF EXISTS "dev_allow_all_leave_requests" ON leave_requests;
DROP POLICY IF EXISTS "dev_allow_all_holidays" ON holidays;

-- Users: own record + admin
CREATE POLICY "Users can read own record" ON users
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admins can read all users" ON users
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Employees: own + manager team + HR all
CREATE POLICY "Employees can read own record" ON employees
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Managers can read team" ON employees
  FOR SELECT USING (
    manager_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );
CREATE POLICY "HR can read all employees" ON employees
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('hr', 'admin'))
  );
CREATE POLICY "HR can manage employees" ON employees
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('hr', 'admin'))
  );

-- Leave types: read all, HR manage
CREATE POLICY "Anyone can read leave types" ON leave_types
  FOR SELECT USING (true);
CREATE POLICY "HR can manage leave types" ON leave_types
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('hr', 'admin'))
  );

-- Leave balances: own + manager team + HR all
CREATE POLICY "Employees can read own balances" ON leave_balances
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );
CREATE POLICY "Managers can read team balances" ON leave_balances
  FOR SELECT USING (
    employee_id IN (
      SELECT e.id FROM employees e
      JOIN employees m ON e.manager_id = m.id
      WHERE m.user_id = auth.uid()
    )
  );
CREATE POLICY "HR can read all balances" ON leave_balances
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('hr', 'admin'))
  );

-- Leave requests: full workflow
CREATE POLICY "Employees can read own requests" ON leave_requests
  FOR SELECT USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );
CREATE POLICY "Employees can create own requests" ON leave_requests
  FOR INSERT WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
  );
CREATE POLICY "Employees can update own pending requests" ON leave_requests
  FOR UPDATE USING (
    employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())
    AND status = 'pending'
  );
CREATE POLICY "Managers can read team requests" ON leave_requests
  FOR SELECT USING (
    employee_id IN (
      SELECT e.id FROM employees e
      JOIN employees m ON e.manager_id = m.id
      WHERE m.user_id = auth.uid()
    )
  );
CREATE POLICY "Managers can approve team requests" ON leave_requests
  FOR UPDATE USING (
    employee_id IN (
      SELECT e.id FROM employees e
      JOIN employees m ON e.manager_id = m.id
      WHERE m.user_id = auth.uid()
    )
  );
CREATE POLICY "HR can manage all requests" ON leave_requests
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('hr', 'admin'))
  );

-- Holidays: read all, HR manage
CREATE POLICY "Anyone can read holidays" ON holidays
  FOR SELECT USING (true);
CREATE POLICY "HR can manage holidays" ON holidays
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('hr', 'admin'))
  );
