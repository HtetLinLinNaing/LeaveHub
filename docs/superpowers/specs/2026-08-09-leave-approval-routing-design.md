# Leave Approval Routing — Design

## Goal

Restructure the leave approval flow so that:

- **Manager** can approve their **direct reports'** leave requests, but cannot approve a request submitted by another **manager** (including themselves). A manager's own leave request never appears on any manager's queue.
- **Admin** can approve **any** leave request — every direct-report request, every manager's self-request, anything else. Admin is the universal approver.
- The **HR role is dropped** from the codebase. HR's responsibilities (employee management, policy management, holiday management) transfer to Admin. HR is no longer a `Role` value, no seed user has it, and the sidebar/UI never mentions it.
- The PRD is updated to match.

## Background

The current PRD (`docs/PRD.md`) describes a four-role system: Employee, Manager, HR, Admin. The current code has a Postgres `role` ENUM containing those four values (`supabase/migrations/001_initial_schema.sql:4`). Manager approval is gated by a `manager_id` scope check (`lib/actions.ts:52-62`). HR has the same scope as admin in the UI today — both can see `/approvals`, `/employees`, and `/policies`. The `canApproveLeave` helper returns true for all three approver roles (`lib/auth.ts:87`), and `canManageEmployees` returns true for `hr` and `admin` (`lib/auth.ts:91`).

The repo's seed data has `alice@company.com` as the HR user (with a full `employees` row) and `eve@company.com` as the admin user (with an `employees` row too). Both roles are functionally identical in the running app today; the only practical difference is the label on their login.

This change makes two things true at once:
1. Approval routing is tightened: managers can't approve manager self-requests.
2. HR is removed entirely. Admin takes over every HR responsibility.

## Decisions Locked

1. **Drop the `hr` role from the `Role` union.** `lib/types.ts` becomes `Role = "employee" | "manager" | "admin"`.
2. **Drop the `hr` value from the Postgres `role` ENUM** via a migration that creates a new type, swaps the column, and drops the old type. (Postgres ENUMs do not support `DROP VALUE`; the column-swap dance is required.)
3. **Migrate the existing HR user.** `alice@company.com` is removed from `users` and `employees`. `eve@company.com` is the sole admin.
4. **Manager self-requests route to admin only.** The `/approvals` page filter excludes manager self-requests from the manager's queue. The `approveLeaveRequest` server action rejects a manager approving a manager's request.
5. **Admin sees the full queue, no filter.**
6. **Admin has no `employees` row** (already true for `eve@company.com` after seed update).
7. **The PRD is updated** to remove HR, tighten the manager rule, and describe the new flow.

## Scope

### In scope

- Postgres migration: drop `'hr'` from the `role` ENUM.
- Migration: remove the HR seed user.
- Seed update: remove `alice@company.com` from `users` and `employees`.
- TypeScript: drop `"hr"` from `Role` in `lib/types.ts`. Update `lib/constants.ts` (`ROLES`, `ROLE_LABELS`).
- `lib/auth.ts`: tighten `canApproveLeave` and `canManageEmployees`.
- `lib/actions.ts`: tighten the manager branch in `approveLeaveRequest`.
- `app/(dashboard)/approvals/page.tsx`: filter manager queue to exclude manager self-requests; admin sees all; add `users!inner(role)` to the select.
- `app/(dashboard)/leave/page.tsx`: redirect admin to `/` (admin has no `employees` record; the page is empty for them).
- `app/(dashboard)/page.tsx`: admin-specific dashboard (pending approvals count, approved this month, employees on leave today).
- `components/shared/sidebar.tsx`: update `navItems` to remove `hr` everywhere and exclude `admin` from `My Leave`.
- `docs/PRD.md`: update sections 4, 5, 7, 9, 13.
- Five Playwright tests covering the new routing rule.

### Out of scope (deferred)

- RLS policy changes. The project still uses mock auth with permissive dev RLS. The new boundaries are enforced in server actions, not the database. Tightening RLS is a separate task.
- A real "system config" page for admin. The PRD previously described admin as managing roles, permissions, and system settings. None of that UI exists in the code today. Building it is a separate feature.
- `approved_by` audit trail for admin approvals. The column is a FK to `employees.id`; admin has no `employees.id`, so the value will be NULL. If a user-id audit is later required, this is a schema change.
- The README's seed account list still references `alice@company.com — HR`. The README will be updated as part of this change.

## Detailed Design

### 1. Migration — `supabase/migrations/005_drop_hr_role.sql`

```sql
-- 1. Remove the HR seed user (alice). Delete from employees first because of FK.
DELETE FROM employees WHERE user_id = (
  SELECT id FROM users WHERE email = 'alice@company.com'
);
DELETE FROM users WHERE email = 'alice@company.com';

-- 2. Create a new role type without 'hr'.
CREATE TYPE role_new AS ENUM ('employee', 'manager', 'admin');

-- 3. Swap the column to the new type.
ALTER TABLE users
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE role_new USING role::text::role_new,
  ALTER COLUMN role SET DEFAULT 'employee';

-- 4. Drop the old type.
DROP TYPE role;

-- 5. Rename the new type to the original name.
ALTER TYPE role_new RENAME TO role;
```

The `USING role::text::role_new` clause handles the cast. Because step 1 deletes the only HR user, no `hr` values remain to be cast.

If a future migration ever needs to remove a value with existing rows, the same dance applies: migrate rows first, then drop the value.

### 2. Seed update — `supabase/migrations/002_seed_data.sql`

Remove Alice's row from the `users` and `employees` INSERT blocks. The migration in section 1 handles the cleanup at runtime; the seed update is needed so that re-running the seed doesn't reinsert her.

### 3. TypeScript types — `lib/types.ts`

```ts
export type Role = "employee" | "manager" | "admin";
```

### 4. Constants — `lib/constants.ts`

```ts
export const ROLES: Role[] = ["employee", "manager", "admin"];

export const ROLE_LABELS: Record<Role, string> = {
  employee: "Employee",
  manager: "Manager",
  admin: "Admin",
};
```

### 5. Auth helpers — `lib/auth.ts`

```ts
export function canApproveLeave(userRole: Role): boolean {
  return ["manager", "admin"].includes(userRole);
}

export function canManageEmployees(userRole: Role): boolean {
  return userRole === "admin";
}
```

`canApproveLeave` keeps `manager` because managers still approve direct reports. `canManageEmployees` becomes admin-only since HR is gone.

### 6. Server action — `lib/actions.ts`

`approveLeaveRequest` (lines 40-108). Tighten the manager branch:

```ts
if (user.role === "manager") {
  const { data: req } = await supabase
    .from("leave_requests")
    .select("employees!inner(manager_id, users!inner(role))")
    .eq("id", requestId)
    .single();
  const r = req as { employees: { manager_id: string | null; users: { role: string } } } | null;
  if (r?.employees.manager_id !== employee.id) {
    return { ok: false, error: "Not authorized for this request" };
  }
  if (r?.employees.users.role === "manager") {
    return { ok: false, error: "Manager self-requests are handled by admin" };
  }
}
```

The HR branch is removed because the type system no longer allows `user.role === "hr"`. Admin and manager share the post-scope path; admin has no scope filter at all.

### 7. Approvals page — `app/(dashboard)/approvals/page.tsx`

```ts
let query = supabase
  .from("leave_requests")
  .select(`
    *,
    employees!inner(id, first_name, last_name, employee_code, department, manager_id, users!inner(role)),
    leave_types(name)
  `)
  .eq("status", "pending")
  .order("created_at", { ascending: true });

if (user?.role === "manager" && employee) {
  query = query
    .eq("employees.manager_id", employee.id)
    .neq("employees.users.role", "manager");
}
// admin: no filter
```

The `users!inner(role)` join is required so the manager self-request filter has the data it needs.

### 8. Leave page — `app/(dashboard)/leave/page.tsx`

```ts
const { user } = await getCurrentEmployee(supabase, session?.email);
if (user?.role === "admin") redirect("/");
```

Admin has no `employees` row, so the page renders empty. Redirecting is cleaner.

### 9. Dashboard — `app/(dashboard)/page.tsx`

For admin, the existing dashboard silently renders zeros everywhere (the `employee?.id ?? ""` queries return empty). Replace this with a small admin-specific view: pending approvals count, approved this month count, employees on leave today. The employee and manager paths are unchanged.

The new cards:

- **Pending approvals** — `count` on `leave_requests` where `status = 'pending'`.
- **Approved this month** — `count` on `leave_requests` where `status = 'approved'` and `approved_at` is in the current month.
- **On leave today** — count of approved requests whose date range covers today. Filter `start_date <= today AND end_date >= today`.

### 10. Sidebar — `components/shared/sidebar.tsx`

```ts
const navItems: NavItem[] = [
  { label: "Dashboard",  href: "/",          icon: LayoutDashboard, roles: ["employee", "manager", "admin"] },
  { label: "My Leave",   href: "/leave",     icon: FileText,        roles: ["employee", "manager"] },
  { label: "Calendar",   href: "/calendar",  icon: CalendarDays,    roles: ["employee", "manager", "admin"] },
  { label: "Approvals",  href: "/approvals", icon: CheckCircle,     roles: ["manager", "admin"] },
  { label: "Employees",  href: "/employees", icon: Users,           roles: ["admin"] },
  { label: "Policies",   href: "/policies",  icon: Settings,        roles: ["admin"] },
];
```

`My Leave` excludes `admin` (admin has no `employees` row). `Approvals` is `manager` + `admin`. `Employees` and `Policies` are `admin` only.

### 11. PRD — `docs/PRD.md`

- **Section 4 (Roles):** three roles: Employee, Manager, Admin. HR is gone.
- **Section 5 (Permissions):**
  - **Employee:** unchanged.
  - **Manager:** inherits Employee only. Can approve direct reports' leave requests. Cannot approve a request submitted by another manager. Cannot approve their own leave request.
  - **Admin:** manages employees, manages leave policies, configures public holidays, manages employee information, approves any leave request (including manager self-requests and any request not handled by a manager).
- **Section 7 (Leave Types):** the table's "Approval" column becomes `Manager (or Admin for manager self-requests)`.
- **Section 9 (Workflow):** the new flow.
  ```
  Employee / Manager
        ↓
  Direct Manager (only if requester is not a manager)
        ↓
  Admin (handles manager self-requests and any unhandled request)
        ↓
  Approved / Rejected
  ```
- **Section 13 (Dashboards):** add an Admin dashboard row: pending approvals count, approved this month, employees on leave today.
- **Section 11 (Carry Forward Policy) and Section 12 (Public Holidays):** change "HR" references to "Admin" in the prose.

### 12. README

Update the seed account list. Remove `alice@company.com — HR`. Keep `eve@company.com — Admin` as the sole privileged user.

### 13. Tests — `tests/leave-approval-routing.spec.ts`

Five cases:

1. **Manager approves a direct report's request.** Bob (manager) approves Charlie (employee) → status `approved`. The leave balance is decremented.
2. **Manager cannot approve another manager's self-request.** Bob (manager) tries to approve Bob's own request → returns `{ ok: false, error: "Manager self-requests are handled by admin" }`.
3. **Manager's self-request is invisible to other managers.** Bob submits a request; another manager logs in and visits `/approvals`; the request does not appear.
4. **Admin sees and approves a manager's self-request.** Eve (admin) visits `/approvals`; Bob's request appears; Eve approves it; status becomes `approved`. (Note: `approved_by` will be NULL because admin has no `employees.id`. Assert that the status changed, not the `approved_by` value.)
5. **Admin sees all pending requests, including direct-report submissions.** Eve (admin) sees both Charlie's and Bob's pending requests in the queue.

For these tests, the project uses mock auth (cookie-based). The test sets the `leavehub_mock_user` cookie for the desired role, then drives the page or calls the server action directly. The action is called via direct import (no form driving needed).

## Files Touched

| File | Change |
| --- | --- |
| `lib/types.ts` | Drop `"hr"` from `Role`. |
| `lib/constants.ts` | Drop `"hr"` from `ROLES` and `ROLE_LABELS`. |
| `lib/auth.ts` | `canApproveLeave` → `["manager", "admin"]`. `canManageEmployees` → admin only. |
| `lib/actions.ts` | Tighten `approveLeaveRequest` manager branch. |
| `app/(dashboard)/approvals/page.tsx` | Filter manager queue; admin sees all. Add `users!inner(role)`. |
| `app/(dashboard)/leave/page.tsx` | Redirect admin. |
| `app/(dashboard)/page.tsx` | Admin-specific dashboard. |
| `components/shared/sidebar.tsx` | Update `navItems`. |
| `docs/PRD.md` | Sections 4, 5, 7, 9, 11, 12, 13. |
| `README.md` | Remove `alice@company.com` from seed account list. |
| `supabase/migrations/002_seed_data.sql` | Remove Alice's seed row. |
| `supabase/migrations/005_drop_hr_role.sql` | New: drop `'hr'` from the role ENUM, remove Alice. |
| `tests/leave-approval-routing.spec.ts` | New: 5 cases. |

## Risks

- **Postgres ENUM migration is irreversible without backup.** The new type-name dance is the standard workaround. If a future migration needs the `hr` value back, it has to add the value to the ENUM (which Postgres does support via `ALTER TYPE ... ADD VALUE`), but the seed user is gone.
- **Existing data:** the only HR user is Alice. The migration deletes her rows. If a real user has been created with `role = 'hr'` since the seed, that data is lost. The migration must run in a maintenance window.
- **TypeScript compile errors at every `role === "hr"` site.** Greppable. A single sweep removes them.
- **`approved_by` is NULL for admin approvals.** Reports that group by approver will show admin as "no approver." Flagged as a follow-up.
- **README drift.** After this change, anyone following the README's seed-account list will see only `eve@company.com` and no `alice@company.com`. If a new HR-equivalent person is needed, the operator creates them via the Employees page as admin.

## Follow-ups (not part of this change)

1. Track `approved_by` as either a polymorphic user reference or a separate `approved_by_user_id` column once a real audit need appears.
2. Tighten RLS so the same boundaries are enforced at the database.
3. Build the real "system config" admin pages (role management, system settings) the PRD envisions.
4. If admin ever needs to file leave on behalf of an employee, add a `createLeaveRequestForEmployee` server action.
