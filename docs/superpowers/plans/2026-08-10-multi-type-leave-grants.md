# Multi-Type Leave Grants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the existing Compassionate Leave grant flow so the same manager-proposes / admin-approves mechanism works for 10 grant-driven leave types. Annual Leave and Medical Leave stay on their fixed-balance model.

**Architecture:** Replace `lib/compassionate.ts` with `lib/grants.ts` (parameterized by `leave_type_id`). Add `GRANT_DRIVEN_LEAVE_TYPES` tuple to `lib/constants.ts`. Add `createLeaveGrant(input)` server action that accepts `leave_type_name` (string) and resolves the id server-side; this keeps the propose dialog a pure client component. Rename `approveCompassionateGrant` → `approveLeaveGrant`. Generalize the compassionate balance check in `createLeaveRequest`. Add Leave Type `<Select>` to the propose dialog. Update lists/cards to render the granted leave type name. No DB migration.

**Tech Stack:** Next.js 16 App Router (server actions, server components), React 19, Supabase (Postgres + RLS), Zod, Tailwind 4, shadcn-style UI components, Playwright for e2e.

## Global Constraints

- TypeScript strict; no `any` unless existing pattern requires it.
- Server actions return `{ ok: boolean; error?: string }` (matches existing `ApprovalResult`).
- Validation: Zod schemas in `lib/validations.ts`; first Zod issue message is the user-facing error.
- All mutations revalidate at least the page(s) whose data they change.
- Do NOT use `runtime = 'edge'` (this is Fluid Compute / Node).
- RLS: keep the dev-mode permissive policy pattern.
- Tests: Playwright e2e only (no unit-test framework in this project). Test file at `tests/<feature>.spec.ts`. Reuse `login`, `navigateTo`, `USERS` from `tests/helpers.ts`. Each test uses `futureDate(n)` for date inputs.
- The grant-driven leave types are: `Childcare Leave`, `Hospitalisation Leave`, `Maternity Leave`, `Paternity Leave`, `Unpaid Leave`, `Off-in-Lieu`, `Training`, `Compassionate Leave`, `Marriage Leave`, `Shared Parental Leave` — exact strings, stored as a `readonly` tuple in `lib/constants.ts`.
- Dashboard renders a card per grant-driven type that has any activity (`granted > 0 OR used > 0 OR pending > 0`).
- `createLeaveGrant` accepts `leave_type_name: string` (the display name) and resolves the UUID inside the action via `leave_types` lookup by name. The dialog never holds a UUID.
- The action layer always validates the resolved type name against `GRANT_DRIVEN_LEAVE_TYPES`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/constants.ts` | Add `GRANT_DRIVEN_LEAVE_TYPES` tuple and `GrantDrivenLeaveTypeName` type. |
| `lib/grants.ts` | New: `getGrantDrivenAvailability(supabase, employeeId, year, leaveTypeId)` and `getGrantDrivenOverview(supabase, employeeId, year)`. |
| `lib/compassionate.ts` | Delete. All callers updated. |
| `lib/validations.ts` | Add `leaveGrantSchema` with `leave_type_name: string`. Remove `compassionateGrantSchema`. |
| `lib/actions.ts` | Add `createLeaveGrant(input)` accepting `leave_type_name`. Rename `approveCompassionateGrant` → `approveLeaveGrant`. Generalize the balance check in `createLeaveRequest` to any grant-driven type. |
| `app/(dashboard)/approvals/page.tsx` | Fetch grants across all grant-driven types; rename section labels; attach leave type name to rows. |
| `app/(dashboard)/page.tsx` | Replace single Compassionate card with N grant-driven cards. |
| `app/(dashboard)/leave/page.tsx` | Mirror dashboard change if a compassionate card exists there. |
| `components/features/grants/grant-propose-dialog.tsx` | Add Leave Type `<Select>` as first field; pass `leave_type_name` to action. |
| `components/features/grants/grant-approval-list.tsx` | Show leave type name. |
| `components/features/grants/my-grants-list.tsx` | Show leave type name. |
| `tests/leave-grants.spec.ts` | Renamed from `compassionate-grants.spec.ts` with updated selectors + new Unpaid Leave test. |

---

### Task 1: Add `GRANT_DRIVEN_LEAVE_TYPES` constant

**Files:**
- Modify: `lib/constants.ts`

**Produces:** Exported tuple + type used everywhere downstream.

- [ ] **Step 1: Add the constant**

In `lib/constants.ts`, after the existing `LEAVE_TYPE_DEFAULTS` block, add:

```ts
export const GRANT_DRIVEN_LEAVE_TYPES = [
  "Childcare Leave",
  "Hospitalisation Leave",
  "Maternity Leave",
  "Paternity Leave",
  "Unpaid Leave",
  "Off-in-Lieu",
  "Training",
  "Compassionate Leave",
  "Marriage Leave",
  "Shared Parental Leave",
] as const;

export type GrantDrivenLeaveTypeName = (typeof GRANT_DRIVEN_LEAVE_TYPES)[number];
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add lib/constants.ts
git commit -m "feat(grants): define grant-driven leave type list"
```

---

### Task 2: Create `lib/grants.ts` with `getGrantDrivenAvailability` and `getGrantDrivenOverview`

**Files:**
- Create: `lib/grants.ts`

**Produces:** Two functions consumed by pages and actions.

- [ ] **Step 1: Write the file**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";

export interface GrantDrivenAvailability {
  granted: number;
  used: number;
  available: number;
  pending: number;
}

export interface GrantDrivenOverviewEntry extends GrantDrivenAvailability {
  leaveTypeId: string;
  leaveTypeName: string;
}

// Pool model for a single grant-driven leave type.
// available = max(approved grants this year - approved requests this year, 0).
export async function getGrantDrivenAvailability(
  supabase: SupabaseClient,
  employeeId: string,
  year: number,
  leaveTypeId: string
): Promise<GrantDrivenAvailability> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31T23:59:59`;

  const [grantedRes, usedRes, pendingRes] = await Promise.all([
    supabase
      .from("leave_grants")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", leaveTypeId)
      .eq("status", "approved")
      .gte("approved_at", yearStart)
      .lte("approved_at", yearEnd),
    supabase
      .from("leave_requests")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", leaveTypeId)
      .eq("status", "approved")
      .gte("start_date", yearStart)
      .lte("start_date", yearEnd),
    supabase
      .from("leave_grants")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", leaveTypeId)
      .eq("status", "pending"),
  ]);

  const sum = (rows: { days: number }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + Number(r.days), 0);

  const granted = sum(grantedRes.data);
  const used = sum(usedRes.data);
  const pending = sum(pendingRes.data);
  return {
    granted,
    used,
    available: Math.max(granted - used, 0),
    pending,
  };
}

// Returns one entry per grant-driven type that has any activity in the year.
// Activity = granted > 0 OR used > 0 OR pending > 0.
export async function getGrantDrivenOverview(
  supabase: SupabaseClient,
  employeeId: string,
  year: number
): Promise<GrantDrivenOverviewEntry[]> {
  const { data: types } = await supabase
    .from("leave_types")
    .select("id, name")
    .in("name", [...GRANT_DRIVEN_LEAVE_TYPES]);

  const matched = (types ?? []).filter((t): t is { id: string; name: string } =>
    (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(t.name)
  );
  if (matched.length === 0) return [];

  const entries = await Promise.all(
    matched.map(async (t) => {
      const a = await getGrantDrivenAvailability(supabase, employeeId, year, t.id);
      return { leaveTypeId: t.id, leaveTypeName: t.name, ...a };
    })
  );

  return entries.filter(
    (e) => e.granted > 0 || e.used > 0 || e.pending > 0
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add lib/grants.ts
git commit -m "feat(grants): add generalized grant-driven availability helpers"
```

---

### Task 3: Add `leaveGrantSchema` and remove `compassionateGrantSchema` in `lib/validations.ts`

**Files:**
- Modify: `lib/validations.ts`

**Produces:** New schema accepting `leave_type_name`. Old `compassionateGrantSchema` removed.

- [ ] **Step 1: Replace the schema**

In `lib/validations.ts`, replace the existing `compassionateGrantSchema` block and its `CompassionateGrantInput` type alias with:

```ts
export const leaveGrantSchema = z.object({
  employee_id: z.string().uuid(),
  leave_type_name: z.string().min(1, "Leave type is required"),
  days: z.number().int().min(1, "Days must be at least 1").max(365, "Days must be at most 365"),
  reason: z.string().min(1, "Reason is required").max(500, "Reason must be at most 500 characters"),
});

export type LeaveGrantInput = z.infer<typeof leaveGrantSchema>;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (the only caller, `lib/actions.ts`, is updated in Task 4)

- [ ] **Step 3: Commit**

```bash
git add lib/validations.ts
git commit -m "feat(grants): add leaveGrantSchema with leave_type_name"
```

---

### Task 4: Update `lib/actions.ts` — generalize `createLeaveRequest` balance check, replace `createCompassionateGrant` with `createLeaveGrant`, rename approve action

**Files:**
- Modify: `lib/actions.ts`

**Produces:** All three changes bundled:
1. `createLeaveRequest` balance check generalized.
2. `createCompassionateGrant` replaced by `createLeaveGrant` (takes `leave_type_name`, resolves id internally).
3. `approveCompassionateGrant` renamed to `approveLeaveGrant`.

- [ ] **Step 1: Update imports**

Replace:
```ts
import { getCompassionateAvailability } from "@/lib/compassionate";
import { compassionateGrantSchema } from "@/lib/validations";
```
With:
```ts
import { getGrantDrivenAvailability } from "@/lib/grants";
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";
import { leaveGrantSchema } from "@/lib/validations";
```

- [ ] **Step 2: Generalize the balance check in `createLeaveRequest`**

Replace:
```ts
if (ltForCheck?.name === "Compassionate Leave") {
  const year = new Date(input.start_date).getFullYear();
  const { available } = await getCompassionateAvailability(
    supabase,
    employee.id,
    year
  );
  if (available < actualDays) {
    return {
      ok: false,
      error:
        "You have no compassionate leave available. Ask your manager to grant it.",
    };
  }
}
```
With:
```ts
if (ltForCheck && (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(ltForCheck.name)) {
  const year = new Date(input.start_date).getFullYear();
  const { available } = await getGrantDrivenAvailability(
    supabase,
    employee.id,
    year,
    ltForCheck.id
  );
  if (available < actualDays) {
    return {
      ok: false,
      error: `You have no ${ltForCheck.name} available. Ask your manager to grant it.`,
    };
  }
}
```

- [ ] **Step 3: Replace `createCompassionateGrant` with `createLeaveGrant`**

Delete the entire `createCompassionateGrant` block (interface + function + closing brace) and replace with:

```ts
// ----- Propose a leave grant (manager or admin) -----

export interface CreateLeaveGrantInput {
  employee_id: string;
  leave_type_name: string;
  days: number;
  reason: string;
}

export async function createLeaveGrant(
  input: CreateLeaveGrantInput
): Promise<ApprovalResult> {
  try {
    const { supabase, user, employee } = await requireSession();
    if (!canProposeGrants(user.role as Role)) {
      return { ok: false, error: "Not authorized" };
    }
    if (!employee) return { ok: false, error: "Proposer record not found" };

    const parsed = leaveGrantSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    // Verify target employee is active. Manager scope: must be a direct
    // report. Admin scope: any active employee.
    const { data: target } = await supabase
      .from("employees")
      .select("id, status, manager_id")
      .eq("id", input.employee_id)
      .single();
    if (!target) return { ok: false, error: "Employee not found" };
    if (target.status !== "active") {
      return { ok: false, error: "Employee is not active" };
    }
    if (user.role === "manager" && target.manager_id !== employee.id) {
      return {
        ok: false,
        error: "Can only grant to your active direct reports",
      };
    }

    // Resolve leave type id from name and confirm it's grant-driven.
    const { data: lt } = await supabase
      .from("leave_types")
      .select("id, name")
      .eq("name", input.leave_type_name)
      .single();
    if (!lt) return { ok: false, error: "Leave type not found" };
    if (!(GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(lt.name)) {
      return { ok: false, error: "This leave type is not grant-driven" };
    }

    const { error: insertError } = await supabase.from("leave_grants").insert({
      employee_id: input.employee_id,
      leave_type_id: lt.id,
      days: input.days,
      reason: input.reason,
      status: "pending",
      created_by: employee.id,
    });
    if (insertError) throw insertError;

    revalidatePath("/approvals");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create grant",
    };
  }
}
```

- [ ] **Step 4: Rename `approveCompassionateGrant` → `approveLeaveGrant`**

Rename the function and its preceding comment `// ----- Approve or reject a pending grant (admin) -----` (keep the comment). Body unchanged.

- [ ] **Step 5: Delete `lib/compassionate.ts`**

```bash
git rm lib/compassionate.ts
```

- [ ] **Step 6: Sweep for stale imports**

```bash
grep -rn "compassionateGrantSchema\|CompassionateGrantInput\|getCompassionateAvailability\|createCompassionateGrant\|approveCompassionateGrant" \
  lib/ components/ app/ tests/ --include='*.ts' --include='*.tsx'
```

For each remaining hit:
- `compassionateGrantSchema` / `CompassionateGrantInput` → removed in Task 3; switch any caller to `leaveGrantSchema` / `LeaveGrantInput`.
- `getCompassionateAvailability` → renamed to `getGrantDrivenAvailability` in Task 4 step 1.
- `createCompassionateGrant` → renamed to `createLeaveGrant` in Task 4 step 3.
- `approveCompassionateGrant` → renamed to `approveLeaveGrant` in Task 4 step 4.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/actions.ts lib/validations.ts
git commit -m "feat(grants): generalize actions and remove compassionate-specific paths"
```

---

### Task 5: Update `grant-propose-dialog.tsx` with Leave Type `<Select>`

**Files:**
- Modify: `components/features/grants/grant-propose-dialog.tsx`

**Produces:** New first field "Leave Type" populated from `GRANT_DRIVEN_LEAVE_TYPES`. Submit calls `createLeaveGrant` with `leave_type_name`. Title becomes "Propose Leave Grant", trigger label "Propose Grant".

- [ ] **Step 1: Update imports**

Replace:
```ts
import { createCompassionateGrant } from "@/lib/actions";
```
With:
```ts
import { createLeaveGrant } from "@/lib/actions";
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";
```

- [ ] **Step 2: Add `leaveTypeName` state**

Replace the state block:
```ts
const [employeeId, setEmployeeId] = useState("");
const [days, setDays] = useState(1);
const [reason, setReason] = useState("");
```
With:
```ts
const [leaveTypeName, setLeaveTypeName] = useState("");
const [employeeId, setEmployeeId] = useState("");
const [days, setDays] = useState(1);
const [reason, setReason] = useState("");
```

Update `reset()` to also `setLeaveTypeName("")`.

- [ ] **Step 3: Update `handleSubmit` to call `createLeaveGrant`**

Replace the call to `createCompassionateGrant` with:
```ts
const result = await createLeaveGrant({
  employee_id: employeeId,
  leave_type_name: leaveTypeName,
  days,
  reason,
});
```

- [ ] **Step 4: Update submit `disabled`**

Change:
```tsx
disabled={pending || !employeeId || !reason}
```
To:
```tsx
disabled={pending || !employeeId || !reason || !leaveTypeName}
```

- [ ] **Step 5: Update trigger label and dialog title**

```tsx
<DialogTrigger render={<Button />}>
  <Plus className="mr-2 h-4 w-4" />
  Propose Grant
</DialogTrigger>
```

```tsx
<DialogTitle>Propose Leave Grant</DialogTitle>
```

- [ ] **Step 6: Insert Leave Type field above Employee**

```tsx
<div>
  <label className="mb-1 block text-sm font-medium">Leave Type</label>
  <Select
    value={leaveTypeName}
    onValueChange={(v) => setLeaveTypeName(v ?? "")}
  >
    <SelectTrigger className="w-full">
      <SelectValue placeholder="Select leave type">
        {leaveTypeName || undefined}
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      {GRANT_DRIVEN_LEAVE_TYPES.map((name) => (
        <SelectItem key={name} value={name}>
          {name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add components/features/grants/grant-propose-dialog.tsx
git commit -m "feat(grants): add Leave Type selector to propose dialog"
```

---

### Task 6: Update `grant-approval-list.tsx` to show leave type name

**Files:**
- Modify: `components/features/grants/grant-approval-list.tsx`

**Produces:** Card subtitle and dialog title show the leave type name.

- [ ] **Step 1: Add `leave_type_name` to `PendingGrant`**

```ts
interface PendingGrant {
  id: string;
  leave_type_name: string;
  days: number;
  reason: string;
  // ...rest
}
```

- [ ] **Step 2: Render the leave type name**

Replace:
```tsx
<p className="mt-1 text-sm text-gray-500">
  Compassionate Leave — {g.days} day(s)
</p>
```
With:
```tsx
<p className="mt-1 text-sm text-gray-500">
  {g.leave_type_name} — {g.days} day(s)
</p>
```

- [ ] **Step 3: Update the dialog title**

```tsx
<DialogTitle>
  {confirming?.action === "approved" ? "Approve" : "Reject"} {confirming?.leaveTypeName}
  for {confirming?.name}?
</DialogTitle>
```

(Add `leaveTypeName: string` to the `confirming` state shape.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/features/grants/grant-approval-list.tsx
git commit -m "feat(grants): render leave type name in approval cards"
```

---

### Task 7: Update `my-grants-list.tsx` to show leave type name

**Files:**
- Modify: `components/features/grants/my-grants-list.tsx`

**Produces:** Same change as Task 6 for the manager's own-grants view.

- [ ] **Step 1: Add `leave_type_name` to the row type and render it**

Add `leave_type_name: string` to the row interface. Replace any "Compassionate Leave" subtitle with `{g.leave_type_name} — {g.days} day(s)`. Update the cancel dialog title similarly if present.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add components/features/grants/my-grants-list.tsx
git commit -m "feat(grants): render leave type name in my-grants list"
```

---

### Task 8: Update `app/(dashboard)/approvals/page.tsx` to fetch grants across all grant-driven types

**Files:**
- Modify: `app/(dashboard)/approvals/page.tsx`

**Produces:** Section labels renamed. Grants fetched for all grant-driven types. Each row carries `leave_type_name`.

- [ ] **Step 1: Replace the import**

If `getCompassionateAvailability` is imported, remove it. Add:
```ts
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";
```

- [ ] **Step 2: Fetch grants for all grant-driven types (admin branch)**

Replace the admin's compassionate-id filter with an `IN` filter keyed on grant-driven type ids. Read existing IDs first:

```ts
const { data: allTypes } = await supabase
  .from("leave_types")
  .select("id, name")
  .in("name", [...GRANT_DRIVEN_LEAVE_TYPES]);
const matchedTypes = (allTypes ?? []).filter((t) =>
  (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(t.name)
);
const typeIds = matchedTypes.map((t) => t.id);
const typeMap = new Map(matchedTypes.map((t) => [t.id, t.name]));

const { data: raw } = await supabase
  .from("leave_grants")
  .select("id, employee_id, leave_type_id, days, reason, created_at, created_by, status")
  .eq("status", "pending")
  .in("leave_type_id", typeIds)
  .order("created_at", { ascending: true });
```

- [ ] **Step 3: Attach `leave_type_name` to each mapped grant**

In the admin `pendingGrants` mapping block, add:
```ts
leave_type_name: typeMap.get(g.leave_type_id) ?? "Unknown",
```

Repeat for the manager branch's `myGrants` (same `typeMap` lookup).

- [ ] **Step 4: Rename section labels**

Replace:
```tsx
<h2 className="text-lg font-semibold">Compassionate Leave Grants</h2>
```
With:
```tsx
<h2 className="text-lg font-semibold">Leave Grants</h2>
```

Replace:
```tsx
<h3 className="mb-2 text-sm font-medium text-gray-500">Pending grants</h3>
<h3 className="mb-2 text-sm font-medium text-gray-500">My grants</h3>
```
With:
```tsx
<h3 className="mb-2 text-sm font-medium text-gray-500">Pending leave grants</h3>
<h3 className="mb-2 text-sm font-medium text-gray-500">My leave grants</h3>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add 'app/(dashboard)/approvals/page.tsx'
git commit -m "feat(approvals): fetch grants across all grant-driven types"
```

---

### Task 9: Update `app/(dashboard)/page.tsx` dashboard to render one card per active grant-driven type

**Files:**
- Modify: `app/(dashboard)/page.tsx`

**Produces:** The single Compassionate card is replaced by a map over `getGrantDrivenOverview`.

- [ ] **Step 1: Replace the import**

Replace:
```ts
import { getCompassionateAvailability } from "@/lib/compassionate";
```
With:
```ts
import { getGrantDrivenOverview } from "@/lib/grants";
```

- [ ] **Step 2: Replace the `compassionate` computation**

Replace:
```ts
const compassionate = employee
  ? await getCompassionateAvailability(supabase, employee.id, year)
  : { granted: 0, used: 0, available: 0, pending: 0 };
```
With:
```ts
const grantDrivenOverview = employee
  ? await getGrantDrivenOverview(supabase, employee.id, year)
  : [];
```

- [ ] **Step 3: Replace the single Compassionate card with a map**

Find the existing `<Card>` with title "Compassionate Leave" referencing `compassionate.available/granted/used/pending`. Replace with:

```tsx
{grantDrivenOverview.map((g) => (
  <Card key={g.leaveTypeId}>
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-medium text-gray-500">
        {g.leaveTypeName}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="text-3xl font-bold">{g.available}</div>
      <p className="text-xs text-gray-500">
        Granted: {g.granted} · Used: {g.used}
      </p>
      {g.pending > 0 && (
        <p className="mt-1 text-xs text-yellow-700">
          {g.pending} day(s) pending admin approval
        </p>
      )}
    </CardContent>
  </Card>
))}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add 'app/(dashboard)/page.tsx'
git commit -m "feat(dashboard): render one card per grant-driven type with activity"
```

---

### Task 10: Mirror dashboard change in `app/(dashboard)/leave/page.tsx`

**Files:**
- Modify: `app/(dashboard)/leave/page.tsx`

**Produces:** Same dashboard pattern applied if a compassionate card exists there.

- [ ] **Step 1: Inspect and apply**

Read `app/(dashboard)/leave/page.tsx`. If it renders a compassionate card derived from `getCompassionateAvailability`, replace with the same `getGrantDrivenOverview` mapping used in Task 9. If it only renders a fixed `leave_balances` grid, ensure no stale import remains.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add 'app/(dashboard)/leave/page.tsx'
git commit -m "feat(leave): render grant-driven balance cards on leave page"
```

---

### Task 11: Rename e2e test and update selectors

**Files:**
- Move: `tests/compassionate-grants.spec.ts` → `tests/leave-grants.spec.ts`
- Modify: `tests/leave-grants.spec.ts`

**Produces:** Existing compassionate-flow test still passes under the new generic selectors.

- [ ] **Step 1: Move the file**

```bash
git mv tests/compassionate-grants.spec.ts tests/leave-grants.spec.ts
```

- [ ] **Step 2: Update selectors**

In `proposeGrant`, replace `await page.click("text=Grant Compassionate Leave");` with:

```ts
await page.click("text=Propose Grant");
```

After opening the dialog, click Leave Type combobox first, pick Compassionate Leave, then the employee combobox:

```ts
await page.locator('[role="combobox"]').nth(0).click();
await page.click('[role="option"]:text("Compassionate Leave")');
await page.locator('[role="combobox"]').nth(1).click();
await page.click(`[role="option"]:text("${opts.employeeName}")`);
```

The assertion `await expect(page.locator(\`text=Compassionate Leave — 1 day(s)\`).first()).toBeVisible();` remains correct because the card now uses `{g.leave_type_name} — {g.days} day(s)`.

- [ ] **Step 3: Run the existing test**

Run: `npm test -- tests/leave-grants.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/leave-grants.spec.ts tests/compassionate-grants.spec.ts
git commit -m "test(grants): rename compassionate-grants spec and update selectors"
```

---

### Task 12: Add Unpaid Leave e2e test

**Files:**
- Modify: `tests/leave-grants.spec.ts`

**Produces:** A second test asserting the same flow works for Unpaid Leave.

- [ ] **Step 1: Add a second test**

Rename `test.describe("Compassionate leave grants")` to `test.describe("Leave grants")` and append a new test:

```ts
test("manager proposes Unpaid Leave grant, admin approves, employee uses", async ({ page }) => {
  await login(page, USERS.manager.email);
  await navigateTo(page, "Approvals");
  await page.click("text=Propose Grant");
  await page.locator('[role="combobox"]').nth(0).click();
  await page.click('[role="option"]:text("Unpaid Leave")');
  await page.locator('[role="combobox"]').nth(1).click();
  await page.click('[role="option"]:text("charlie")');
  await page.locator('input[type="number"]').fill("2");
  await page.fill("textarea", "Extended personal travel");
  await page.click('button:has-text("Submit Grant")');
  await page.waitForLoadState("networkidle");

  await logout(page);
  await login(page, USERS.admin.email);
  await navigateTo(page, "Approvals");
  await expect(page.locator("text=Unpaid Leave").first()).toBeVisible();
  await page.locator("text=Approve").first().click();
  await page.locator('[role="dialog"] >> text=Approve').last().click();
  await page.waitForLoadState("networkidle");

  await logout(page);
  await login(page, USERS.employee.email);
  await expect(page.locator("text=Unpaid Leave").first()).toBeVisible();
  await expect(page.locator("text=Granted: 2 · Used: 0").first()).toBeVisible();

  await navigateTo(page, "My Leave");
  await page.click("text=Request Leave");
  await page.locator('[role="combobox"]').first().click();
  await page.click('[role="option"]:text("Unpaid Leave")');
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill(futureDate(7));
  await dates.nth(1).fill(futureDate(8));
  await page.fill("textarea", "Travel");
  await page.click('button:has-text("Submit Request")');
  await page.waitForLoadState("networkidle");
  await expect(page.locator("text=Pending").first()).toBeVisible();
});
```

- [ ] **Step 2: Run the full spec**

Run: `npm test -- tests/leave-grants.spec.ts`
Expected: both tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/leave-grants.spec.ts
git commit -m "test(grants): add Unpaid Leave end-to-end flow"
```

---

### Task 13: Final typecheck, lint, and smoke check

**Files:** none

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors introduced by this change

- [ ] **Step 3: Smoke check**

```bash
grep -rn "getCompassionateAvailability\|createCompassionateGrant\|approveCompassionateGrant\|compassionateGrantSchema\|CompassionateGrantInput\|lib/compassionate" \
  lib/ components/ app/ tests/ --include='*.ts' --include='*.tsx'
```
Expected: no matches

---

## Self-Review

**Spec coverage:**
- 10 grant-driven types listed in `GRANT_DRIVEN_LEAVE_TYPES` ✓ (Task 1)
- Manager proposes with Leave Type dropdown ✓ (Task 5)
- Admin approves ✓ (Tasks 4, 6)
- Employee sees leave type on dashboard ✓ (Task 9)
- Available days formula matches Compassionate's today ✓ (Task 2)
- Existing compassionate code folded into generic path ✓ (Tasks 3, 4)
- No DB migration ✓
- Annual + Medical stay on fixed balance ✓ (Tasks 4, 9, 10)
- Tests: rename + new Unpaid Leave test ✓ (Tasks 11, 12)

**Placeholder scan:** No "TBD" / "TODO" / "similar to Task N". All code blocks concrete.

**Type consistency:** `CreateLeaveGrantInput` takes `leave_type_name: string` from the start (Task 4). The dialog passes `leaveTypeName` state (Task 5). Schema accepts `leave_type_name` (Task 3). One name = one string = one source of truth.

**Open question for executor:** `app/(dashboard)/leave/page.tsx` was not pre-read. Task 10 step 1 says "inspect and apply" — the implementer should read it first.