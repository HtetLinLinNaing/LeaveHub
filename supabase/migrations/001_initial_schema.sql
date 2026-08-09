-- LeaveHub v2 — Initial Schema

-- Enums
-- Note: 'hr' is intentionally not in the role enum. HR was removed; admin
-- owns employee, policy, and holiday management. The legacy 005_drop_hr_role
-- migration handles live DBs that still have the old enum value.
CREATE TYPE role AS ENUM ('employee', 'manager', 'admin');
CREATE TYPE employee_status AS ENUM ('active', 'inactive');
CREATE TYPE leave_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE duration_type AS ENUM ('full_day', 'half_day');

-- Users (links to Supabase auth.users when using Google OAuth)
-- FK to auth.users added in 003_add_auth_fk.sql after switching from mock auth
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  role role NOT NULL DEFAULT 'employee',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Employees
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_code TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  department TEXT NOT NULL,
  manager_id UUID REFERENCES employees(id),
  join_date DATE NOT NULL,
  status employee_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_employees_user_id ON employees(user_id);
CREATE INDEX idx_employees_manager_id ON employees(manager_id);
CREATE INDEX idx_employees_status ON employees(status);

-- Leave Types
CREATE TABLE leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  annual_days INTEGER NOT NULL DEFAULT 0,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  allow_half_day BOOLEAN NOT NULL DEFAULT true
);

-- Leave Balances
CREATE TABLE leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id),
  year INTEGER NOT NULL,
  allocated_days INTEGER NOT NULL DEFAULT 0,
  used_days INTEGER NOT NULL DEFAULT 0,
  remaining_days INTEGER NOT NULL DEFAULT 0,
  carry_forward_days INTEGER NOT NULL DEFAULT 0,
  UNIQUE(employee_id, leave_type_id, year)
);

CREATE INDEX idx_leave_balances_employee ON leave_balances(employee_id);

-- Leave Requests
CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days NUMERIC(4,1) NOT NULL,
  duration_type duration_type NOT NULL DEFAULT 'full_day',
  reason TEXT NOT NULL,
  status leave_request_status NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (days > 0)
);

CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX idx_leave_requests_status ON leave_requests(status);
CREATE INDEX idx_leave_requests_dates ON leave_requests(start_date, end_date);

-- Holidays
CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  date DATE NOT NULL UNIQUE
);

CREATE INDEX idx_holidays_date ON holidays(date);

-- Working days calculation function (excludes weekends + holidays)
CREATE OR REPLACE FUNCTION calculate_working_days(start_d DATE, end_d DATE)
RETURNS NUMERIC AS $$
DECLARE
  total INTEGER := 0;
  current_d DATE := start_d;
  is_holiday BOOLEAN;
BEGIN
  WHILE current_d <= end_d LOOP
    -- Skip weekends (6=Sat, 7=Sun)
    IF EXTRACT(ISODOW FROM current_d) < 6 THEN
      SELECT EXISTS(SELECT 1 FROM holidays WHERE date = current_d) INTO is_holiday;
      IF NOT is_holiday THEN
        total := total + 1;
      END IF;
    END IF;
    current_d := current_d + 1;
  END LOOP;
  RETURN total;
END;
$$ LANGUAGE plpgsql STABLE;

-- Seed leave types
INSERT INTO leave_types (name, annual_days, requires_approval, allow_half_day) VALUES
  ('Annual Leave', 14, true, true),
  ('Medical Leave', 7, true, true),
  ('Compassionate Leave', 0, true, false);

-- ============================================================
-- RLS Policies
-- DEV MODE: Permissive policies (auth.uid() IS NULL = mock auth)
-- PRODUCTION: Replace with strict policies in 004_strict_rls.sql
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

-- Dev: allow all operations when no auth context (mock auth)
CREATE POLICY "dev_allow_all_users" ON users FOR ALL USING (auth.uid() IS NULL);
CREATE POLICY "dev_allow_all_employees" ON employees FOR ALL USING (auth.uid() IS NULL);
CREATE POLICY "dev_allow_all_leave_types" ON leave_types FOR ALL USING (auth.uid() IS NULL);
CREATE POLICY "dev_allow_all_leave_balances" ON leave_balances FOR ALL USING (auth.uid() IS NULL);
CREATE POLICY "dev_allow_all_leave_requests" ON leave_requests FOR ALL USING (auth.uid() IS NULL);
CREATE POLICY "dev_allow_all_holidays" ON holidays FOR ALL USING (auth.uid() IS NULL);
