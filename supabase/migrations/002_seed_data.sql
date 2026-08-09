-- Seed data for development
-- Run AFTER 001_initial_schema.sql

-- IMPORTANT: Create these users in Supabase Auth > Users first,
-- then use their auth.uid UUIDs below.
-- OR use Supabase dashboard to create auth users, then update the UUIDs.

-- For mock auth, we insert directly into users table.
-- When switching to real Google OAuth, these UUIDs must match auth.users.

-- Seed users (UUIDs are deterministic for dev)
INSERT INTO users (id, email, role) VALUES
  ('a0000000-0000-0000-0000-000000000002', 'bob@company.com', 'manager'),
  ('a0000000-0000-0000-0000-000000000003', 'charlie@company.com', 'employee'),
  ('a0000000-0000-0000-0000-000000000004', 'diana@company.com', 'employee'),
  ('a0000000-0000-0000-0000-000000000005', 'eve@company.com', 'admin')
ON CONFLICT (id) DO NOTHING;

-- Seed employees
-- Note: Eve (admin) is intentionally not in employees. Admin has no leave
-- balance and cannot request leave.
INSERT INTO employees (id, user_id, employee_code, first_name, last_name, department, manager_id, join_date, status) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'EMP002', 'Bob', 'Tran', 'Engineering', NULL, '2024-02-01', 'active'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'EMP003', 'Charlie', 'Le', 'Engineering', 'b0000000-0000-0000-0000-000000000002', '2024-03-10', 'active'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'EMP004', 'Diana', 'Pham', 'Engineering', 'b0000000-0000-0000-0000-000000000002', '2024-04-01', 'active')
ON CONFLICT (id) DO NOTHING;

-- Seed leave balances for 2026
INSERT INTO leave_balances (employee_id, leave_type_id, year, allocated_days, used_days, remaining_days, carry_forward_days)
SELECT
  e.id,
  lt.id,
  2026,
  lt.annual_days,
  0,
  lt.annual_days,
  0
FROM employees e
CROSS JOIN leave_types lt
WHERE lt.annual_days > 0
ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;

-- Seed holidays for 2026
INSERT INTO holidays (name, date) VALUES
  ('New Year''s Day', '2026-01-01'),
  ('Tet Holiday', '2026-02-17'),
  ('Hung Kings Day', '2026-04-18'),
  ('Reunification Day', '2026-04-30'),
  ('International Workers'' Day', '2026-05-01'),
  ('National Day', '2026-09-02')
ON CONFLICT (date) DO NOTHING;
