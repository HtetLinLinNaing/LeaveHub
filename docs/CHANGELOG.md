# LeaveHub v1.0 — Changelog

## Release: Phase 1-5 Complete
**Date:** 2026-08-07
**Branch:** `feat/initial-setup`

---

## Phase 1: Foundation

### Project Setup
- Next.js 16 with App Router
- TypeScript (strict mode)
- Tailwind CSS v4
- shadcn/ui (base-ui components)
- Supabase PostgreSQL client (`@supabase/ssr` + `@supabase/supabase-js`)

### Authentication
- Mock auth system (cookie-based session)
- Login page — enter employee email to sign in
- Middleware route protection — unauthenticated users redirected to `/login`
- Session persists across page refreshes

### Database Design
**Tables:**
| Table | Purpose |
|-------|---------|
| `users` | Auth + role (employee/manager/hr/admin) |
| `employees` | Employee profile + manager relationship |
| `leave_types` | Annual (14d), Medical (7d), Compassionate (manual) |
| `leave_balances` | Per-employee, per-type, per-year tracking |
| `leave_requests` | Leave submissions with status workflow |
| `holidays` | Public holidays managed by HR |

**SQL Functions:**
- `calculate_working_days(start, end)` — excludes weekends + holidays

**RLS Policies:**
- Dev-permissive policies active (all operations allowed when `auth.uid()` is null)
- Strict production policies prepared in `004_strict_rls.sql`

---

## Phase 2: Employee Management

### Employee CRUD
- HR can create employees (generates `EMP###` code automatically)
- Assign role (employee/manager/hr/admin) and manager
- Auto-allocates leave balances for current year on creation
- Employee list with code, name, email, department, role, status

### Role Management
- 4 roles: Employee, Manager, HR, Admin
- Role-based sidebar navigation
- Role-aware data access via Supabase RLS

---

## Phase 3: Leave System

### Leave Types
- Annual Leave: 14 days, manager approval
- Medical Leave: 7 days, manager approval
- Compassionate Leave: manual allocation, HR approval
- HR can edit annual day allocations

### Leave Balance
- Auto-calculated: `remaining = allocated + carry_forward - used`
- Displayed on dashboard and leave page
- Deducted when leave is approved

### Leave Requests
- Required fields: leave type, start/end date, duration (full/half day), reason
- Working days auto-calculated (excludes weekends + holidays)
- Status: pending → approved/rejected/cancelled
- Employees can cancel pending or approved requests
- Edit pending requests (cancel and resubmit pattern)

---

## Phase 4: Approval Workflow

### Manager Approval
- Approval queue shows pending requests from direct reports
- Single-click approve/reject
- Updates leave balance on approval
- Manager cannot approve own leave (enforced at UI level)

### HR Approval
- HR sees all pending requests (not filtered by team)
- Compassionate leave routes through HR
- Same approve/reject flow

---

## Phase 5: Dashboard

### Employee Dashboard
- Leave balance cards (by type)
- Pending requests count
- Recent requests list (last 5) with status badges
- Upcoming holidays (next 3)
- Employees away today count

### Manager Dashboard
- Same as employee dashboard
- Approval queue accessible via sidebar

### HR Dashboard
- Same as employee dashboard
- Employee management accessible via sidebar
- Policy management accessible via sidebar

---

## Additional Features Built

### Team Calendar
- Monthly grid view
- Public holidays highlighted (red)
- Approved leave shown per day with employee name
- Color-coded by employee
- Navigate between months

### Policies Page
- Leave type management (edit annual days)
- Holiday CRUD (add/delete public holidays)

---

## Tech Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Auth | Mock (cookie) | Google OAuth credentials not ready; swap planned for Step 10 |
| RLS | Dev-permissive | Mock auth has no `auth.uid()`; strict policies pre-written |
| State | Server Components + TanStack Query | No state management library needed |
| Validation | Zod | Schema-first, TypeScript inference |
| Dates | date-fns | Tree-shakeable, no moment.js bloat |
| UI | shadcn/ui (base-ui) | Latest version, uses base-ui instead of Radix |

---

## Migration Path to v2

### To enable Google OAuth:
1. Configure Google provider in Supabase Dashboard
2. Run `003_add_auth_fk.sql`
3. Run `004_strict_rls.sql`
4. Replace mock auth in `lib/auth.ts` with Supabase Auth

### To add Excel import:
- HR employee page → add file upload + parse logic
- Use `xlsx` library for parsing
- Validate rows against `employeeSchema`

### To add email notifications:
- Supabase Edge Functions or Next.js API routes
- Trigger on status change (pending → approved/rejected)

---

## Files Reference

```
supabase/migrations/
├── 001_initial_schema.sql    # Tables, indexes, functions, dev RLS
├── 002_seed_data.sql         # Sample users, employees, balances, holidays
├── 003_add_auth_fk.sql       # FK to auth.users (for Google OAuth)
└── 004_strict_rls.sql        # Production RLS policies
```

## Seed Accounts

| Email | Role | Password |
|-------|------|----------|
| alice@company.com | HR | N/A (mock auth) |
| bob@company.com | Manager | N/A (mock auth) |
| charlie@company.com | Employee | N/A (mock auth) |
| diana@company.com | Employee | N/A (mock auth) |
| eve@company.com | Admin | N/A (mock auth) |
