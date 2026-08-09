-- Compassionate leave grants
--
-- A grant is the manager's promise that an employee has N days of
-- compassionate leave available. The grant is filed by a manager,
-- approved by admin, and lives in its own table (not leave_requests).
-- Once approved, the employee can file a normal leave_request with
-- leave_type = Compassionate; that request draws from the grant pool.

CREATE TYPE compassionate_grant_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE compassionate_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id),
  days NUMERIC(4,1) NOT NULL CHECK (days > 0),
  reason TEXT NOT NULL,
  status compassionate_grant_status NOT NULL DEFAULT 'pending',
  created_by UUID NOT NULL REFERENCES employees(id),
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_grants_employee ON compassionate_grants(employee_id);
CREATE INDEX idx_grants_status ON compassionate_grants(status);

ALTER TABLE compassionate_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dev_allow_all_compassionate_grants" ON compassionate_grants
  FOR ALL USING (auth.uid() IS NULL);
