# Admin Handles All Leave Requests — Design

## Goal

Restructure the leave approval flow so that the **admin** role is the sole approver for every leave request in the system. The admin has no `employees` row, holds no leave balance, and cannot submit leave for themselves. Manager and HR approval paths are removed. The PRD is updated to match.

## Background

The current PRD (`docs/PRD.md`) describes a multi-tier flow:

- Manager approves Annual and Medical leave for their direct reports.
- HR approves Compassionate leave (after a Manager Review).
- Admin has no leave-related permissions defined.

In the codebase, `admin` is already wired into `canApproveLeave` (`lib/auth.ts:87`) and the sidebar (`components/shared/sidebar.tsx:32`), but the `/approvals` page filters to "manager direct reports" only (`app/(dashboard)/approvals/page.tsx:22-25`), so admin's queue is empty. Admin also gets a "My Leave" page (`/leave`) and can submit requests, but balances and the seed `employees` row for `eve@company.com` were never treated as a first-class case.

This change collapses the approval flow to a single approver (admin) and removes admin from the leave-submitter side of the system.

## Decisions Locked

1. **Admin user has no `employees` row.** Admin exists only in the `users` table. The `getCurrentEmployee` helper already returns `{ user, employee: null }` for this case, and pages already use `employee?.id` safely.
2. **All leave requests go to admin.** Manager approval is removed. HR approval is removed.
3. **HR keeps employee, holiday, and policy management.** Their approval permissions are dropped from the UI and from the PRD.
4. **Admin cannot submit leave.** Visiting `/leave` redirects to `/`. The `createLeaveRequest` server action rejects admin with an error.
5. **`approved_by` will be NULL for admin approvals** (admin has no employee id). Acceptable for now; flagged as a follow-up if a user-id audit trail becomes important.

## Scope

### In scope

- Server action guards in `lib/actions.ts` for `createLeaveRequest` and `cancelLeaveRequest`.
- Drop the manager-scope branch in `app/(dashboard)/approvals/page.tsx` and gate the page to admin.
- Redirect admin away from `app/(dashboard)/leave/page.tsx`.
- Update sidebar nav items to reflect the new role model.
- Replace admin's empty dashboard with an admin-specific overview (pending approvals + team activity).
- Update `docs/PRD.md` sections 5, 7, 9, and 13 to match the new flow.
- Three Playwright tests covering the new boundaries.

### Out of scope (deferred)

- **RLS policy changes.** The project still uses mock auth with permissive dev RLS. The new boundaries are enforced in server actions, not the database. Tightening RLS is a separate task.
- **Removing `manager` and `hr` from the `Role` union.** Both roles still exist for login. They're just stripped of approval UI and permissions.
- **`approved_by` audit trail for admin approvals.** The current column is a FK to `employees.id`. Admin has no employee id, so the field stays NULL. If a user-id audit is later required, this is a schema change.
- **Admin submitting leave on behalf of an employee.** Not requested. Easy to add later if HR needs to backfill.

## Detailed Design

### 1. Server Action Changes — `lib/actions.ts`

**`createLeaveRequest` (lines 218-261).** Reject admin at the top of the handler, before the schema parse.

```ts
const { supabase, user, employee } = await requireSession();
if (user.role === "admin") {
  return { ok: false, error: "Admins cannot request leave" };
}
if (!employee) return { ok: false, error: "Employee record not found" };
```

**`cancelLeaveRequest` (lines 265-285).** Same admin guard for symmetry. The existing `eq("employee_id", employee.id)` clause already prevents admin from cancelling anyone else's request, but the explicit guard gives a clearer error.

```ts
const { supabase, user, employee } = await requireSession();
if (user.role === "admin") {
  return { ok: false, error: "Admins cannot have leave requests" };
}
if (!employee) return { ok: false, error: "Employee record not found" };
```

**`approveLeaveRequest` (lines 40-108).** Drop the manager-scope branch (lines 52-62). The function still relies on `canApproveLeave(user.role)`, which already returns true for admin. The function itself does not need a role change — only the caller (the `/approvals` page) restricts access to admin. HR and manager keep the technical ability to approve but have no UI to invoke it. (This is acceptable for the mock-auth era; in production RLS would be the real guard.)

**`createEmployee` (lines 122-206).** No change. The Zod schema in `lib/validations.ts:11-19` already restricts `role` to `"employee"`.

### 2. Approvals Page — `app/(dashboard)/approvals/page.tsx`

Drop the manager-scope branch. Gate the page to admin.

```ts
export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user } = await getCurrentEmployee(supabase, session?.email);

  if (user?.role !== "admin") redirect("/");

  const { data: requests } = await supabase
    .from("leave_requests")
    .select(`
      *,
      employees!inner(id, first_name, last_name, employee_code, department, manager_id),
      leave_types(name)
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Pending Approvals</h1>
      <ApprovalList requests={requests ?? []} />
    </div>
  );
}
```

### 3. Leave Page — `app/(dashboard)/leave/page.tsx`

Redirect admin to `/`. The page otherwise does nothing useful for them.

```ts
const { user } = await getCurrentEmployee(supabase, session?.email);
if (user?.role === "admin") redirect("/");
```

### 4. Sidebar — `components/shared/sidebar.tsx`

Update `navItems` (lines 28-35):

```ts
const navItems: NavItem[] = [
  { label: "Dashboard",   href: "/",           icon: LayoutDashboard, roles: ["employee", "manager", "hr", "admin"] },
  { label: "My Leave",    href: "/leave",      icon: FileText,        roles: ["employee", "manager", "hr"] },
  { label: "Calendar",    href: "/calendar",   icon: CalendarDays,    roles: ["employee", "manager", "hr", "admin"] },
  { label: "Approvals",   href: "/approvals",  icon: CheckCircle,     roles: ["admin"] },
  { label: "Employees",   href: "/employees",  icon: Users,           roles: ["hr", "admin"] },
  { label: "Policies",    href: "/policies",   icon: Settings,        roles: ["hr", "admin"] },
];
```

`My Leave` drops `admin`. `Approvals` becomes admin-only. Manager and HR no longer see an Approvals link, so the actions in `lib/actions.ts` become unreachable for them via the UI.

### 5. Dashboard — `app/(dashboard)/page.tsx`

The current dashboard reads `employee?.id` for balances, pending count, and recent requests. For admin this resolves to `undefined` and the queries return empty — so the dashboard silently renders "0" everywhere.

Replace this for admin with a small admin-specific overview:

- Pending approvals count (server-side `count` on `leave_requests` where `status = pending`).
- Approved this month count.
- Employees on leave today (count of approved requests whose date range covers today).

Layout: same grid, but admin sees three cards (Pending, Approved this month, On leave today) instead of the per-employee balance cards. Reuse `Card` and `CardContent` from `components/ui/card`.

The other roles (employee, manager, hr) keep the current dashboard unchanged.

### 6. PRD Update — `docs/PRD.md`

- **Section 5 (Role Permissions):**
  - **Employee:** unchanged.
  - **Manager:** drop "Approve leave requests" and "Reject leave requests." Manager inherits Employee permissions only.
  - **HR:** drop any approval-related lines. Keep: create employees, import employees, disable accounts, reset passwords, manage leave policies, configure public holidays, manage employee info.
  - **Admin:** replace "Manage system configuration" with the new scope: "Approve all leave requests (employee, manager, HR)." Add the line "Admins do not submit leave requests."
- **Section 7 (Leave Types):** the table's "Approval" column becomes `Admin` for all three rows.
- **Section 9 (Leave Approval Workflow):** collapse the two diagrams into one:
  ```
  Employee / Manager / HR
        ↓
      Admin
        ↓
  Approved / Rejected
  ```
- **Section 13 (Dashboard Requirements):** add an Admin dashboard row: "Pending approvals count, approved this month, employees on leave today."

### 7. Tests — `tests/`

Three new Playwright cases. They run against the mock-auth login (cookie-based) so the test just sets the `leavehub_mock_user` cookie for the desired role and visits the page.

1. **Admin sees pending approvals from all employees and managers.** Log in as `eve@company.com`, visit `/approvals`, expect to see at least one pending request rendered.
2. **Admin is redirected from `/leave` to `/`.** Log in as `eve@company.com`, visit `/leave`, expect the URL to be `/`.
3. **Admin cannot submit a leave request via the action.** Log in as `eve@company.com`, invoke `createLeaveRequest` via the in-process test harness, expect `{ ok: false, error: "Admins cannot request leave" }`.

(For the third case, the test imports `createLeaveRequest` from `@/lib/actions` and calls it directly — no need to drive the form.)

## Files Touched

| File | Change |
| --- | --- |
| `lib/actions.ts` | Add admin guards in `createLeaveRequest` and `cancelLeaveRequest`. |
| `app/(dashboard)/approvals/page.tsx` | Drop manager-scope branch; redirect non-admin. |
| `app/(dashboard)/leave/page.tsx` | Redirect admin. |
| `app/(dashboard)/page.tsx` | Admin-specific dashboard. |
| `components/shared/sidebar.tsx` | Update `navItems` roles. |
| `docs/PRD.md` | Update sections 5, 7, 9, 13. |
| `tests/admin-flow.spec.ts` | New file. Three cases. |

## Risks

- **Hidden assumption that `employee` is always non-null.** The codebase uses `employee?.id` defensively in pages but `requireSession` in `actions.ts` only checks `user`. The new admin guards make this explicit, but if any other action assumes `employee`, admin could break it. Mitigation: rely on the existing `if (!employee) return { ok: false, error: "..." }` pattern that is already in `createLeaveRequest` and `cancelLeaveRequest`.
- **Mock auth hides the real RLS state.** None of this change is enforced at the database level. When the project migrates to Google OAuth + `004_strict_rls.sql`, the RLS policies will need to be reviewed. Flagged as out of scope.
- **`approved_by` is null for admin approvals.** Reports that group by approver will show admin as "no approver." Acceptable for now; flagged as a follow-up.

## Follow-ups (not part of this change)

1. Track `approved_by` as either a polymorphic user reference or a separate `approved_by_user_id` column once a real audit need appears.
2. Tighten RLS so the same boundaries are enforced at the database.
3. Decide whether the `manager` and `hr` approval entries in `canApproveLeave` should be deleted (the function returns true for them today but they have no UI to invoke it).
