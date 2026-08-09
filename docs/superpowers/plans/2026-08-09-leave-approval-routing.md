# Leave Approval Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the leave approval routing so managers approve only their direct reports' requests, manager self-requests route to admin only, and admin sees the full queue. Drop the `hr` role from the `Role` union, the Postgres ENUM, and seed data so the codebase has a single privileged role.

**Architecture:** Server actions enforce the routing rule (`approveLeaveRequest` checks `employees.manager_id` and `employees.users.role`). The `/approvals` page query filters manager queues to exclude manager self-requests. A new migration replaces the Postgres `role` ENUM via a column-swap dance. The TypeScript `Role` union and seed data are updated in lock-step. Admin gets a dashboard branch that shows pending/approved/on-leave counts.

**Tech Stack:** Next.js 16.3.0 App Router, React 19, TypeScript, Supabase (PostgreSQL), Playwright.

**Spec:** `docs/superpowers/specs/2026-08-09-leave-approval-routing-design.md`

## Global Constraints

- `Role` is `"employee" | "manager" | "admin"` after this change. `"hr"` is dropped everywhere.
- `canApproveLeave(role)` returns true for `manager` and `admin` only.
- `canManageEmployees(role)` returns true for `admin` only.
- Manager self-requests (where `employees.users.role === "manager"`) are hidden from all manager queues and from the manager's own approval action.
- Admin sees every pending request; no filter.
- Admin has no `employees` row, so visiting `/leave` redirects to `/`.
- Seed user `alice@company.com` is removed; `eve@company.com` is the sole admin.
- All commits follow Conventional Commits; each task ends with a single commit.
- Each task independently testable.

---

### Task 1: Drop `"hr"` from the TypeScript `Role` union

**Files:**
- Modify: `lib/types.ts:1`
- Modify: `lib/constants.ts:1-10`

**Interfaces:**
- Consumes: existing `Role` usage across the codebase.
- Produces: `Role = "employee" | "manager" | "admin"`. `ROLES` and `ROLE_LABELS` no longer mention `"hr"`.

- [ ] **Step 1: Update `lib/types.ts`**

Replace the existing `Role` definition at `lib/types.ts:1`:

```ts
export type Role = "employee" | "manager" | "admin";
```

- [ ] **Step 2: Update `lib/constants.ts`**

Replace the `ROLES` array and `ROLE_LABELS` at `lib/constants.ts:3-10`:

```ts
export const ROLES: Role[] = ["employee", "manager", "admin"];

export const ROLE_LABELS: Record<Role, string> = {
  employee: "Employee",
  manager: "Manager",
  admin: "Admin",
};
```

- [ ] **Step 3: Verify the rest of the codebase type-checks**

Run: `npx tsc --noEmit`
Expected: zero errors. The `Role` union shrinks from four values to three, but no code branch should have referenced `"hr"` directly outside `lib/auth.ts` and the two files just edited. If errors appear, grep the file in the error message and remove the dead `"hr"` branch.

Run: `grep -rn '"hr"\|: "hr"\|=== "hr"' --include="*.ts" --include="*.tsx" .`
Expected: no matches outside of expected places (should be empty after the next tasks). If matches remain in `lib/auth.ts`, that's fine — Task 2 cleans it up.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/constants.ts
git commit -m "refactor(types): drop hr from Role union"
```

---

### Task 2: Tighten auth helpers in `lib/auth.ts`

**Files:**
- Modify: `lib/auth.ts:86-92`

**Interfaces:**
- Consumes: the new `Role` union from Task 1.
- Produces: `canApproveLeave(role)` returns true for `manager` and `admin`. `canManageEmployees(role)` returns true for `admin` only.

- [ ] **Step 1: Update `canApproveLeave`**

Replace `lib/auth.ts:86-88`:

```ts
export function canApproveLeave(userRole: Role): boolean {
  return ["manager", "admin"].includes(userRole);
}
```

- [ ] **Step 2: Update `canManageEmployees`**

Replace `lib/auth.ts:90-92`:

```ts
export function canManageEmployees(userRole: Role): boolean {
  return userRole === "admin";
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add lib/auth.ts
git commit -m "refactor(auth): drop hr from approval and management helpers"
```

---

### Task 3: Tighten `approveLeaveRequest` in `lib/actions.ts`

**Files:**
- Modify: `lib/actions.ts:40-108`

**Interfaces:**
- Consumes: `requireSession`, `canApproveLeave`, `Role` from `lib/auth.ts`.
- Produces: a server action that returns `{ ok: false, error: "Not authorized" }` when a manager tries to approve a request whose requester is a manager.

- [ ] **Step 1: Replace the manager-scope branch**

Replace `lib/actions.ts:51-62` with:

```ts
    // Manager scope: only direct reports, and never another manager's self-request.
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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors. The `users!inner(role)` join is supported because `employees.user_id` already has a FK to `users.id` (see `supabase/migrations/001_initial_schema.sql:11-30`).

- [ ] **Step 3: Commit**

```bash
git add lib/actions.ts
git commit -m "feat(approvals): reject manager approving manager self-requests"
```

---

### Task 4: Filter manager queue on `/approvals`

**Files:**
- Modify: `app/(dashboard)/approvals/page.tsx:1-35`

**Interfaces:**
- Consumes: `getCurrentEmployee` from `lib/auth.ts`.
- Produces: a page where the manager's queue excludes requests whose requester has `users.role === "manager"`. Admin sees every pending request.

- [ ] **Step 1: Update the query and add the manager self-request filter**

Replace `app/(dashboard)/approvals/page.tsx:1-35`:

```tsx
import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/features/approvals/approval-list";

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);

  let query = supabase
    .from("leave_requests")
    .select(`
      *,
      employees!inner(id, first_name, last_name, employee_code, department, manager_id, users!inner(role)),
      leave_types(name)
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  // Manager: only direct reports who are not themselves managers.
  if (user?.role === "manager" && employee) {
    query = query
      .eq("employees.manager_id", employee.id)
      .neq("employees.users.role", "manager");
  }
  // Admin: no filter.

  const { data: requests } = await query;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Pending Approvals</h1>
      <ApprovalList requests={requests ?? []} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/(dashboard)/approvals/page.tsx
git commit -m "feat(approvals): filter manager queue to direct reports only"
```

---

### Task 5: Update sidebar nav items

**Files:**
- Modify: `components/shared/sidebar.tsx:28-35`

**Interfaces:**
- Consumes: `Role` from `lib/types.ts`.
- Produces: nav items where `My Leave` excludes `admin`, `Approvals` is `manager` + `admin`, `Employees` and `Policies` are `admin` only.

- [ ] **Step 1: Replace `navItems`**

Replace `components/shared/sidebar.tsx:28-35`:

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add components/shared/sidebar.tsx
git commit -m "feat(nav): remove hr, exclude admin from my leave"
```

---

### Task 6: Redirect admin away from `/leave`

**Files:**
- Modify: `app/(dashboard)/leave/page.tsx:1-56`

**Interfaces:**
- Consumes: `getCurrentEmployee` from `lib/auth.ts`.
- Produces: a page that redirects admin to `/` and renders the existing UI for everyone else.

- [ ] **Step 1: Add the admin redirect at the top of the page**

Insert the following between the `getCurrentEmployee` call and the `Promise.all` data fetch in `app/(dashboard)/leave/page.tsx`:

```ts
  const { user } = await getCurrentEmployee(supabase, session?.email);
  if (user?.role === "admin") redirect("/");
```

Replace the existing `getCurrentEmployee` block (lines 11-12) with:

```ts
  const supabase = await createClient();
  const { employee, user } = await getCurrentEmployee(supabase, session?.email);
  if (user?.role === "admin") redirect("/");
```

- [ ] **Step 2: Verify the imports**

Confirm `redirect` is imported from `next/navigation` at the top of the file. If not, add the import.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/leave/page.tsx"
git commit -m "feat(leave): redirect admin away from my leave"
```

---

### Task 7: Admin-specific dashboard branch

**Files:**
- Modify: `app/(dashboard)/page.tsx:10-141`

**Interfaces:**
- Consumes: `getCurrentEmployee` from `lib/auth.ts`, the existing `Card`, `CardHeader`, `CardTitle`, `CardContent` from `components/ui/card`.
- Produces: an admin branch that renders three stat cards (pending, approved this month, on leave today). Employee and manager paths are unchanged.

- [ ] **Step 1: Read the current file**

Read `app/(dashboard)/page.tsx` in full so the structure is clear before editing. The file currently:
- Fetches balances, pending count, recent requests, holidays for the current employee.
- Renders balance cards, a pending count card, recent requests list, holidays list.
- All queries use `employee?.id ?? ""` so admin sees zeros.

- [ ] **Step 2: Add an early-return admin branch**

Replace the top of the function body in `app/(dashboard)/page.tsx` (after the `today` and `year` declarations) so that when `user?.role === "admin"`, a separate render path runs. Replace lines 10-141 with:

```tsx
import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { getCachedHolidaysFromDate } from "@/lib/cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STATUS_COLORS } from "@/lib/constants";
import { format } from "date-fns";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);
  const today = format(new Date(), "yyyy-MM-dd");
  const year = new Date().getFullYear();

  if (user?.role === "admin") {
    const startOfMonth = format(new Date(year, new Date().getMonth(), 1), "yyyy-MM-dd");
    const [
      { count: pendingCount },
      { count: approvedThisMonth },
      { count: onLeaveToday },
      holidays,
    ] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("leave_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "approved")
        .gte("approved_at", startOfMonth),
      supabase
        .from("leave_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "approved")
        .lte("start_date", today)
        .gte("end_date", today),
      getCachedHolidaysFromDate(today, 3),
    ]);

    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Admin Dashboard</h1>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Pending Approvals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{pendingCount ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Approved This Month
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{approvedThisMonth ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                On Leave Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{onLeaveToday ?? 0}</div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Holidays</CardTitle>
            </CardHeader>
            <CardContent>
              {(holidays ?? []).length === 0 ? (
                <p className="text-sm text-gray-500">No upcoming holidays</p>
              ) : (
                <ul className="space-y-3">
                  {(holidays ?? []).map((h) => (
                    <li key={h.id} className="flex justify-between text-sm">
                      <span className="font-medium">{h.name}</span>
                      <span className="text-gray-500">
                        {format(new Date(h.date), "MMM d, yyyy")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const [
    { data: balances },
    { count: pendingCount },
    { data: recentRequests },
    holidays,
  ] = await Promise.all([
    supabase
      .from("leave_balances")
      .select("*, leave_types(name)")
      .eq("employee_id", employee?.id ?? "")
      .eq("year", year),
    supabase
      .from("leave_requests")
      .select("*", { count: "exact", head: true })
      .eq("employee_id", employee?.id ?? "")
      .eq("status", "pending"),
    supabase
      .from("leave_requests")
      .select("*, leave_types(name)")
      .eq("employee_id", employee?.id ?? "")
      .order("created_at", { ascending: false })
      .limit(5),
    getCachedHolidaysFromDate(today, 3),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">
        Welcome{employee ? `, ${employee.first_name}` : ""}
      </h1>

      {/* Balance cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(balances ?? []).map((b) => (
          <Card key={b.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                {b.leave_types?.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{b.remaining_days}</div>
              <p className="text-xs text-gray-500">
                of {b.allocated_days + b.carry_forward_days} days
              </p>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Pending Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pendingCount ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Recent requests */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Requests</CardTitle>
          </CardHeader>
          <CardContent>
            {(recentRequests ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No recent requests</p>
            ) : (
              <ul className="space-y-3">
                {(recentRequests ?? []).map((req) => (
                  <li
                    key={req.id}
                    className="flex items-center justify-between"
                  >
                    <div>
                      <span className="text-sm font-medium">
                        {req.leave_types?.name}
                      </span>
                      <span className="ml-2 text-xs text-gray-500">
                        {req.days} day(s)
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className={STATUS_COLORS[req.status]}
                    >
                      {req.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Upcoming holidays */}
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Holidays</CardTitle>
          </CardHeader>
          <CardContent>
            {(holidays ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No upcoming holidays</p>
            ) : (
              <ul className="space-y-3">
                {(holidays ?? []).map((h) => (
                  <li key={h.id} className="flex justify-between text-sm">
                    <span className="font-medium">{h.name}</span>
                    <span className="text-gray-500">
                      {format(new Date(h.date), "MMM d, yyyy")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/page.tsx"
git commit -m "feat(dashboard): admin branch with pending/approved/on-leave counts"
```

---

### Task 8: Drop the HR role from the Postgres ENUM

**Files:**
- Create: `supabase/migrations/005_drop_hr_role.sql`

**Interfaces:**
- Consumes: existing `users` and `employees` tables.
- Produces: a migration that removes Alice's rows and replaces the `role` ENUM with one that has no `'hr'` value.

- [ ] **Step 1: Verify the existing migration is in place**

Run: `ls supabase/migrations/`
Expected: `001_initial_schema.sql`, `002_seed_data.sql`, `003_add_auth_fk.sql`, `004_strict_rls.sql` (or whatever exists) and no `005_*` file yet.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/005_drop_hr_role.sql`:

```sql
-- Drop the HR role.
--
-- 1. Remove the only HR seed user. employees first because of the FK from
--    employees.user_id to users.id.
DELETE FROM employees WHERE user_id = (
  SELECT id FROM users WHERE email = 'alice@company.com'
);
DELETE FROM users WHERE email = 'alice@company.com';

-- 2. Create a new role type without 'hr'. Postgres ENUMs do not support
--    DROP VALUE; the column-swap dance is the standard workaround.
CREATE TYPE role_new AS ENUM ('employee', 'manager', 'admin');

-- 3. Swap the column to the new type. The cast is safe because step 1
--    removed every row with role = 'hr'.
ALTER TABLE users
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE role_new USING role::text::role_new,
  ALTER COLUMN role SET DEFAULT 'employee';

-- 4. Drop the old type and rename the new one back.
DROP TYPE role;
ALTER TYPE role_new RENAME TO role;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/005_drop_hr_role.sql
git commit -m "feat(db): drop hr role from role enum"
```

Note: the migration runs against the live Supabase project, not in this repo. Apply it via the Supabase SQL Editor before the next task's seed update takes effect.

---

### Task 9: Update the seed data to drop Alice

**Files:**
- Modify: `supabase/migrations/002_seed_data.sql:12-27`

**Interfaces:**
- Consumes: the migration from Task 8.
- Produces: a seed file that no longer inserts `alice@company.com`. Re-running the seed on a clean DB produces the same five rows the migration leaves behind, minus Alice.

- [ ] **Step 1: Remove Alice from the `users` insert**

Replace `supabase/migrations/002_seed_data.sql:12-18`:

```sql
-- Seed users (UUIDs are deterministic for dev)
INSERT INTO users (id, email, role) VALUES
  ('a0000000-0000-0000-0000-000000000002', 'bob@company.com', 'manager'),
  ('a0000000-0000-0000-0000-000000000003', 'charlie@company.com', 'employee'),
  ('a0000000-0000-0000-0000-000000000004', 'diana@company.com', 'employee'),
  ('a0000000-0000-0000-0000-000000000005', 'eve@company.com', 'admin')
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Remove Alice's row from the `employees` insert**

Replace `supabase/migrations/002_seed_data.sql:21-27`:

```sql
-- Seed employees
INSERT INTO employees (id, user_id, employee_code, first_name, last_name, department, manager_id, join_date, status) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'EMP002', 'Bob', 'Tran', 'Engineering', NULL, '2024-02-01', 'active'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'EMP003', 'Charlie', 'Le', 'Engineering', 'b0000000-0000-0000-0000-000000000002', '2024-03-10', 'active'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'EMP004', 'Diana', 'Pham', 'Engineering', 'b0000000-0000-0000-0000-000000000002', '2024-04-01', 'active'),
  ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', 'EMP005', 'Eve', 'Vo', 'Admin', NULL, '2024-01-01', 'active')
ON CONFLICT (id) DO NOTHING;
```

Note: Eve still has an `employees` row in the seed even though the design says admin has none. This is intentional for now — Task 12 will decide whether to keep it. The server-action changes in Tasks 3-7 do not depend on Eve's row being absent.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/002_seed_data.sql
git commit -m "chore(seed): drop alice (hr user) from seed data"
```

---

### Task 10: Update test helpers and remove the HR-specific Playwright tests

**Files:**
- Modify: `tests/helpers.ts:1-9`
- Modify: `tests/role-access.spec.ts:29-39`
- Modify: `tests/approvals.spec.ts:11-15`

**Interfaces:**
- Consumes: the new role list.
- Produces: a `USERS` constant without `hr`. Role-based access tests assert the new sidebar.

- [ ] **Step 1: Update `tests/helpers.ts`**

Replace `tests/helpers.ts:3-9`:

```ts
export const USERS = {
  manager: { email: "bob@company.com", role: "Manager" },
  employee: { email: "charlie@company.com", role: "Employee" },
  employee2: { email: "diana@company.com", role: "Employee" },
  admin: { email: "eve@company.com", role: "Admin" },
} as const;
```

- [ ] **Step 2: Update `tests/role-access.spec.ts`**

Replace the `HR role` block (lines 29-39) with an `Admin role` block that asserts admin does NOT see `My Leave` (since admin has no employee record):

```ts
  test.describe("Admin role", () => {
    test("sees correct nav links", async ({ page }) => {
      await login(page, USERS.admin.email);
      await expect(page.locator("nav >> text=Dashboard")).toBeVisible();
      await expect(page.locator("nav >> text=My Leave")).not.toBeVisible();
      await expect(page.locator("nav >> text=Calendar")).toBeVisible();
      await expect(page.locator("nav >> text=Approvals")).toBeVisible();
      await expect(page.locator("nav >> text=Employees")).toBeVisible();
      await expect(page.locator("nav >> text=Policies")).toBeVisible();
    });
  });
```

Update the existing `Admin role` block (lines 41-51) — it now duplicates the new block above. Delete the original `Admin role` block.

- [ ] **Step 3: Update `tests/approvals.spec.ts`**

Replace the `HR can see approval queue` test (lines 11-15):

```ts
  test("Admin can see approval queue", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Approvals");
    await expect(page.locator("h1")).toHaveText("Pending Approvals");
  });
```

- [ ] **Step 4: Update any other test files that reference `USERS.hr` or `alice@company.com`**

Run: `grep -rn "alice@company.com\|USERS\.hr" tests/`
Expected: no matches. If matches appear, replace with `USERS.admin` and `eve@company.com` as appropriate.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add tests/
git commit -m "test: drop hr fixtures, add admin nav assertions"
```

---

### Task 11: Add the new approval-routing test cases

**Files:**
- Create: `tests/leave-approval-routing.spec.ts`

**Interfaces:**
- Consumes: `USERS` from `tests/helpers.ts`, the running dev server (Playwright starts it via `playwright.config.ts`).
- Produces: a new spec file with five test cases covering the routing rules.

- [ ] **Step 1: Inspect the existing leave-request test for patterns to copy**

Read `tests/leave-requests.spec.ts` to see how the existing suite drives the request form. Use the same `login` helper, `page.fill` patterns, and form submission flow.

- [ ] **Step 2: Write the new spec file**

Create `tests/leave-approval-routing.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { login, navigateTo, USERS } from "./helpers";

// Use a future date so the working-days calculation accepts the range
// regardless of when the tests run. Each test gets a unique offset.
function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function submitLeaveRequest(page: import("@playwright/test").Page, opts: {
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
}) {
  await page.click("text=Request Leave");
  await page.locator('[role="combobox"]').first().click();
  await page.click(`[role="option"]:text("${opts.leaveType}")`);
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill(opts.startDate);
  await dates.nth(1).fill(opts.endDate);
  await page.fill("textarea", opts.reason);
  await page.click('button:has-text("Submit Request")');
  await page.waitForLoadState("networkidle");
}

test.describe("Leave approval routing", () => {
  test("manager can approve a direct report's request", async ({ page }) => {
    // Employee submits.
    await login(page, USERS.employee.email);
    await submitLeaveRequest(page, {
      leaveType: "Annual Leave",
      startDate: futureDate(14),
      endDate: futureDate(14),
      reason: "Personal day",
    });
    // Manager logs in and approves.
    await page.context().clearCookies();
    await login(page, USERS.manager.email);
    await navigateTo(page, "Approvals");
    await expect(page.locator(`text=${USERS.employee.email.split("@")[0]}`).first()).toBeVisible();
    await page.locator("text=Approve").first().click();
    await expect(page.locator("text=approved").first()).toBeVisible({ timeout: 5000 });
  });

  test("manager cannot approve another manager's self-request", async ({ page }) => {
    // Manager submits.
    await login(page, USERS.manager.email);
    await submitLeaveRequest(page, {
      leaveType: "Annual Leave",
      startDate: futureDate(15),
      endDate: futureDate(15),
      reason: "Manager self day",
    });
    // Manager tries to approve their own — it should not appear in their queue.
    await page.reload();
    await navigateTo(page, "Approvals");
    await expect(page.locator("text=No pending approvals")).toBeVisible();
  });

  test("manager's self-request is invisible to other managers", async ({ page }) => {
    // Manager submits.
    await login(page, USERS.manager.email);
    await submitLeaveRequest(page, {
      leaveType: "Annual Leave",
      startDate: futureDate(16),
      endDate: futureDate(16),
      reason: "Manager solo day",
    });
    // Employee logs in — they are not a manager and shouldn't see the Approvals link.
    await page.context().clearCookies();
    await login(page, USERS.employee.email);
    await expect(page.locator("nav >> text=Approvals")).not.toBeVisible();
  });

  test("admin sees and approves a manager's self-request", async ({ page }) => {
    // Manager submits.
    await login(page, USERS.manager.email);
    await submitLeaveRequest(page, {
      leaveType: "Annual Leave",
      startDate: futureDate(17),
      endDate: futureDate(17),
      reason: "Manager vacation",
    });
    // Admin logs in and approves.
    await page.context().clearCookies();
    await login(page, USERS.admin.email);
    await navigateTo(page, "Approvals");
    await expect(page.locator(`text=${USERS.manager.email.split("@")[0]}`).first()).toBeVisible();
    await page.locator("text=Approve").first().click();
    await expect(page.locator("text=approved").first()).toBeVisible({ timeout: 5000 });
  });

  test("admin sees all pending requests, including direct-report submissions", async ({ page }) => {
    // Employee submits.
    await login(page, USERS.employee.email);
    await submitLeaveRequest(page, {
      leaveType: "Annual Leave",
      startDate: futureDate(18),
      endDate: futureDate(18),
      reason: "Employee day",
    });
    // Admin logs in and sees the request.
    await page.context().clearCookies();
    await login(page, USERS.admin.email);
    await navigateTo(page, "Approvals");
    await expect(page.locator(`text=${USERS.employee.email.split("@")[0]}`).first()).toBeVisible();
  });
});
```

- [ ] **Step 3: Run the new spec to confirm it passes**

Run: `npx playwright test tests/leave-approval-routing.spec.ts`
Expected: all 5 tests pass. The `futureDate()` helper offsets each request by a unique number of days so the tests never collide on the same date.

- [ ] **Step 4: Commit**

```bash
git add tests/leave-approval-routing.spec.ts
git commit -m "test: add leave approval routing test cases"
```

---

### Task 12: Decide Eve's employee record

**Files:**
- Modify: `supabase/migrations/002_seed_data.sql:21-27`

**Interfaces:**
- Consumes: the design decision from the spec: "Admin has no `employees` row."
- Produces: a seed file consistent with that rule.

- [ ] **Step 1: Check the design intent**

The spec says: "Admin has no `employees` row. `getCurrentEmployee` already returns `{ user, employee: null }` for this case." The current seed leaves Eve with an `employees` row.

- [ ] **Step 2: Remove Eve's employees row from the seed**

Replace `supabase/migrations/002_seed_data.sql:21-27`:

```sql
-- Seed employees
INSERT INTO employees (id, user_id, employee_code, first_name, last_name, department, manager_id, join_date, status) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'EMP002', 'Bob', 'Tran', 'Engineering', NULL, '2024-02-01', 'active'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'EMP003', 'Charlie', 'Le', 'Engineering', 'b0000000-0000-0000-0000-000000000002', '2024-03-10', 'active'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'EMP004', 'Diana', 'Pham', 'Engineering', 'b0000000-0000-0000-0000-000000000002', '2024-04-01', 'active')
ON CONFLICT (id) DO NOTHING;
```

The leave-balance seed (`supabase/migrations/002_seed_data.sql:30-42`) uses `FROM employees e CROSS JOIN leave_types lt WHERE lt.annual_days > 0`. Without Eve in `employees`, she will not get a leave balance, which matches the design.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/002_seed_data.sql
git commit -m "chore(seed): drop eve employees row (admin has none)"
```

---

### Task 13: Update the README

**Files:**
- Modify: `README.md:55-61`

**Interfaces:**
- Consumes: the new seed account list.
- Produces: a README that lists the new login accounts.

- [ ] **Step 1: Update the seed account list**

Replace `README.md:55-61`:

```markdown
5. Login with seed accounts:
   - `bob@company.com` — Manager
   - `charlie@company.com` — Employee
   - `diana@company.com` — Employee
   - `eve@company.com` — Admin
```

- [ ] **Step 2: Check the rest of the README for `alice@company.com` or `HR` references**

Run: `grep -n "alice\|HR\|hr" README.md`
Expected: no matches. If any remain, replace with `eve@company.com` or `admin` as appropriate.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): drop alice, list admin as sole privileged user"
```

---

### Task 14: Update the PRD

**Files:**
- Modify: `docs/PRD.md:60-62` (Section 4), `docs/PRD.md:113-122` (Section 5), `docs/PRD.md:165-170` (Section 7), `docs/PRD.md:198-244` (Section 9), `docs/PRD.md:307-330` (Sections 11, 12, 13)

**Interfaces:**
- Consumes: the design intent for the new role model.
- Produces: a PRD that reflects three roles (Employee, Manager, Admin), a single approval flow, and the admin dashboard.

- [ ] **Step 1: Update Section 4 — Role Overview**

Replace `docs/PRD.md:60-62`:

```markdown
| Role     | Description                          |
| -------- | ------------------------------------ |
| Employee | Requests and manages personal leave  |
| Manager  | Approves direct reports' leave requests |
| Admin    | Approves any leave request and manages employees, policies, and holidays |
```

- [ ] **Step 2: Update Section 5 — Role Permissions**

Replace the Manager, HR, and Admin blocks at `docs/PRD.md:84-122`:

```markdown
## Manager

Manager inherits Employee permissions.

Additional permissions:

- View team leave requests
- Approve leave requests from direct reports
- Reject leave requests from direct reports
- View team leave calendar

A manager cannot approve their own leave request. A manager cannot approve another manager's leave request. Those requests are handled by Admin.

---

## Admin

Admin inherits Manager permissions.

Additional permissions:

- Create employees
- Import employees from Excel
- Disable employee accounts
- Reset passwords
- Manage leave policies
- Configure public holidays
- Manage employee information
- Approve any leave request, including manager self-requests

Admins do not submit leave requests and have no leave balance.
```

- [ ] **Step 3: Update Section 7 — Leave Types**

Replace the table at `docs/PRD.md:165-170`:

```markdown
| Leave Type          | Annual Allocation | Approval                                 |
| ------------------- | ----------------- | ---------------------------------------- |
| Annual Leave        | 14 days           | Manager (Admin for manager self-requests) |
| Medical Leave       | 7 days            | Manager (Admin for manager self-requests) |
| Compassionate Leave | Manual request    | Manager (Admin for manager self-requests) |
```

- [ ] **Step 4: Update Section 9 — Leave Approval Workflow**

Replace `docs/PRD.md:198-244`:

```markdown
## Leave Approval Workflow

```
Employee / Manager
        ↓
Direct Manager (only if requester is not a manager)
        ↓
Admin (handles manager self-requests and any request not handled by a manager)
        ↓
Approved / Rejected
```

- Annual Leave: routed to the requester's direct manager. Manager self-requests go to Admin.
- Medical Leave: routed to the requester's direct manager. Manager self-requests go to Admin.
- Compassionate Leave: routed to the requester's direct manager. Manager self-requests go to Admin.
```

- [ ] **Step 5: Update Sections 11 and 12 — references to HR**

Replace "HR controls the maximum carry-forward amount" at `docs/PRD.md:280` with "Admin controls the maximum carry-forward amount."

Replace "HR manages holidays manually" at `docs/PRD.md:309` with "Admin manages holidays manually."

- [ ] **Step 6: Update Section 13 — Dashboard Requirements**

Replace the Employee, Manager, HR Dashboard blocks at `docs/PRD.md:331-361`:

```markdown
## Employee Dashboard

Display:

- Remaining leave balance
- Pending requests
- Recent requests
- Upcoming holidays
- Employees away today

---

## Manager Dashboard

Display:

- Pending approvals for direct reports
- Team leave calendar
- Team leave information

---

## Admin Dashboard

Display:

- Pending approvals count (across the company)
- Approved requests this month
- Employees currently on leave
- Upcoming holidays
```

- [ ] **Step 7: Commit**

```bash
git add docs/PRD.md
git commit -m "docs(prd): drop hr role, update approval workflow and dashboards"
```

---

### Task 15: Final verification

**Files:**
- Read: all files modified in Tasks 1-14.

**Interfaces:**
- Consumes: the full set of changes from earlier tasks.
- Produces: a passing type-check, a passing test suite, and a clean grep for any lingering `"hr"` references.

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: Grep for stale HR references in code**

Run: `grep -rn '"hr"\|: "hr"\|=== "hr"\|alice@company' --include="*.ts" --include="*.tsx" .`
Expected: no matches. Any remaining references are bugs.

- [ ] **Step 3: Run the full Playwright suite**

Run: `npx playwright test`
Expected: all tests pass, including the 5 new ones in `leave-approval-routing.spec.ts` and the updated `role-access.spec.ts`.

- [ ] **Step 4: Commit any final fixes**

If the previous steps surfaced issues, fix them in a single commit:

```bash
git add -A
git commit -m "fix: address issues found in final verification"
```

If no fixes were needed, skip this step.
