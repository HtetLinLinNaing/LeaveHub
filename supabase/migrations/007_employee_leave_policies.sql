-- 007_employee_leave_policies.sql
-- Per-employee opt-in for leave types (notably Compassionate Leave).
-- A row here means "this employee is allowed to use this leave type" and
-- overrides the leave_types defaults. Absence of a row means disabled.
--
-- Approved request path checks this table instead of relying on
-- leave_balances being seeded for every type.

CREATE TABLE employee_leave_policies (
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  allocated_days INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, leave_type_id)
);

CREATE INDEX idx_emp_policy_employee ON employee_leave_policies(employee_id);
CREATE INDEX idx_emp_policy_type ON employee_leave_policies(leave_type_id);

ALTER TABLE employee_leave_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dev_allow_all_emp_policies" ON employee_leave_policies
  FOR ALL USING (auth.uid() IS NULL);

-- Seed Annual + Medical for all existing active employees. HR can opt in
-- Compassionate per employee from the Policies page.
INSERT INTO employee_leave_policies (employee_id, leave_type_id, allocated_days, enabled)
SELECT e.id, lt.id, lt.annual_days, true
FROM employees e
CROSS JOIN leave_types lt
WHERE e.status = 'active' AND lt.name IN ('Annual Leave', 'Medical Leave')
ON CONFLICT DO NOTHING;
