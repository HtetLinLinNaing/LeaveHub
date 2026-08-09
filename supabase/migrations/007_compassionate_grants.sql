-- LeaveHub — Compassionate Leave grants
-- Manager-proposed, admin-approved grants of compassionate leave days
-- for a specific employee. Distinct from leave_requests (which deduct
-- from an existing balance); here, the grant is the source of the
-- balance.

CREATE TYPE leave_grant_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE leave_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id),
  days NUMERIC(4,1) NOT NULL CHECK (days > 0),
  reason TEXT NOT NULL,
  status leave_grant_status NOT NULL DEFAULT 'pending',
  created_by UUID NOT NULL REFERENCES employees(id),
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES employees(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_leave_grants_employee ON leave_grants(employee_id);
CREATE INDEX idx_leave_grants_status ON leave_grants(status);

ALTER TABLE leave_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dev_allow_all_leave_grants" ON leave_grants FOR ALL USING (auth.uid() IS NULL);
