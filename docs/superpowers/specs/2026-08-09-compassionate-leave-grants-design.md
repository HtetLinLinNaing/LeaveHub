# Compassionate Leave Grants — Design

## Goal

Compassionate Leave is **not** a standard leave balance. Every employee has zero auto-allocated days for it today (and must keep having zero). Instead, Compassionate Leave is granted per-employee by a Manager, then approved by an Admin, before the employee can use it.

This change introduces:

1. A new `leave_grants` table that records the proposed, approved, and rejected grants — the audit trail.
2. A Manager flow to propose a grant for a direct report.
3. An Admin flow to approve or reject pending grants.
4. A derived "available days" computation for the Compassionate Leave card on the employee dashboard and `/leave` page, replacing the meaningless `0` that the card shows today.
5. A balance check on compassionate leave requests, so an employee cannot submit a request they have no days for.

## Background

- `leave_types` has a `Compassionate Leave` row with `annual_days=0` and `allow_half_day=false` (`supabase/migrations/001_initial_schema.sql:79`). This row stays as-is.
- `leave_balances` is per `(employee_id, leave_type_id, year)`. New employees get balance rows only for `annual_days > 0` leave types (`lib/actions.ts:175-189`), so no employee has a balance row for compassionate. Even if one exists, `annual_days=0` makes it contribute 0.
- The existing leave-request flow deducts from `leave_balances` on approval (`lib/actions.ts:84-99`). We do not change this.
- The Manager/Admin approval routing was tightened in the previous spec (`docs/superpowers/specs/2026-08-09-leave-approval-routing-design.md`): managers approve direct reports, admin approves everything. The grant flow reuses the same logic.
- The destructive-action confirmation pattern lives in `components/features/approvals/approval-list.tsx` (confirm dialog before approve/reject). The new grant UI reuses the same pattern.

## Decisions Locked

1. **New `leave_grants` table.** Separate from `leave_requests`. Status: `pending | approved | rejected`. Columns for `created_by` (manager), `approved_by`/`approved_at`, `rejected_by`/`rejected_at`, optional `rejection_reason`.
2. **Manager proposes, Admin approves.** Matches the example in the request brief. Manager scope: only their direct reports. Admin approves or rejects any pending grant.
3. **No expiry on the grant itself.** Grants are valid for the calendar year they were approved in. A grant approved on Dec 15, 2026 must be used by Dec 31, 2026. The "year" of a grant is `EXTRACT(YEAR FROM approved_at)`.
4. **Available-days formula is computed at read time.** No cached column. `available = max(approved_grants_this_year − used_compassionate_requests_this_year, 0)`.
5. **Pool model, not FIFO.** A request doesn't reference a specific grant. Audit is via the grant rows themselves.
6. **Compassionate leave requests are blocked when available < requested days.** Error returned at submission time, not at approval time.
7. **The existing Compassionate Leave card is updated, not replaced.** Same `<Card>` component, same grid slot. The internal content switches to the derived value (granted · used).
8. **No half-day grants.** `leave_types.allow_half_day = false` for compassionate. The grant form requires `days >= 1`, integer.
9. **No change to the existing leave-request approval flow.** A compassionate request goes through the same `approveLeaveRequest` path as any other. The deduction happens against `leave_balances` as today, but since `leave_balances.remaining_days = 0` for compassionate, the visible available count is the derived value.
10. **No new role.** Manager and Admin permissions are reused. `canProposeGrants` and `canManageGrants` are added as named helpers in `lib/auth.ts`.

## Scope

### In scope

- Postgres migration `007_compassionate_grants.sql` — new `leave_grants` table + `leave_grant_status` enum + permissive RLS for dev.
- `lib/types.ts` — add `LeaveGrant`, `LeaveGrantStatus`.
- `lib/validations.ts` — add `compassionateGrantSchema`.
- `lib/auth.ts` — add `canProposeGrants` (manager or admin) and `canManageGrants` (admin only).
- `lib/actions.ts` — add `createCompassionateGrant` and `approveCompassionateGrant`. Tweak `createLeaveRequest` to block compassionate requests when the derived available < requested.
- New folder `components/features/grants/` with:
  - `grant-propose-dialog.tsx` — manager's grant form.
  - `grant-approval-list.tsx` — admin's pending grants queue with approve/reject.
  - `my-grants-list.tsx` — manager's view of their own proposed grants (pending, approved, rejected).
- `app/(dashboard)/approvals/page.tsx` — fetch pending grants + the manager's own grants; render the new components above the existing leave-request approval list. Pass the data in.
- `app/(dashboard)/page.tsx` — for the employee/manager dashboard, fetch the derived compassionate data and update the Compassionate Leave card content. Other cards unchanged.
- `app/(dashboard)/leave/page.tsx` — same compassionate-card update inside the balance grid.
- One Playwright e2e spec covering: manager proposes → admin approves → employee card updates → employee requests → admin approves request → employee card decrements.

### Out of scope (deferred)

- Grant revocation by admin after approval. Rejected grants stay rejected; approved grants stay approved. No "claw back" path. Add when audit needs it.
- Per-grant FIFO tracking (which grant covered which request). The pool model is enough.
- Carry-forward of unused compassionate days into the next year. Spec says end-of-year expiry; unused days drop off.
- Email/notification to the employee when a grant is approved or rejected. Add when notification infra exists.
- Bulk-grant UI. One employee at a time.
- Grant history export / CSV. Add when reporting is needed.

## Data model

### New `leave_grants` table

```sql
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
```

Notes:

- `leave_type_id` is denormalized for forward-compat. All grants in this spec point at the compassionate row. A future check constraint or app-level invariant can lock it down if needed.
- `days` is `NUMERIC(4,1)` to match `leave_requests.days`. Compassionate grants are whole-day, so the input is an integer; the column accepts halves to keep the type uniform.
- `rejection_reason` is optional. Admin can leave it blank.
- The dev-mode permissive RLS mirrors the existing pattern in `001_initial_schema.sql`. Tight policies arrive in a later migration if/when auth is hardened.

## Available-days formula

For employee `E` in year `Y` and leave type `T` = Compassionate:

```sql
granted := COALESCE(SUM(leave_grants.days), 0)
          FROM leave_grants
          WHERE employee_id = E
            AND leave_type_id = T
            AND status = 'approved'
            AND EXTRACT(YEAR FROM approved_at) = Y

used := COALESCE(SUM(leave_requests.days), 0)
        FROM leave_requests
        WHERE employee_id = E
          AND leave_type_id = T
          AND status = 'approved'
          AND EXTRACT(YEAR FROM start_date) = Y

available := GREATEST(granted - used, 0)
```

Year is keyed on `approved_at` for grants and `start_date` for requests. A grant approved late in the year still uses the approval year. A request submitted for a date in the next year is checked against that next year's grants.

## Server actions

### `createCompassionateGrant` (Manager)

```ts
async function createCompassionateGrant(input: {
  employee_id: string;
  days: number;
  reason: string;
}): Promise<{ ok: boolean; error?: string }>
```

- Auth: `canProposeGrants(role)` — manager or admin.
- Validate with `compassionateGrantSchema`: `employee_id` uuid, `days` integer ≥ 1, `reason` 1–500 chars.
- If manager: `employee.manager_id === currentEmployee.id` AND `employee.status === 'active'`. Else `{ok: false, error: "Can only grant to your active direct reports"}`.
- Insert with `status='pending'`, `created_by=currentEmployee.id`, `leave_type_id=compassionate_id`.
- Revalidate `/approvals`.

### `approveCompassionateGrant(grantId, decision)` (Admin)

```ts
async function approveCompassionateGrant(
  grantId: string,
  decision: "approved" | "rejected",
  rejectionReason?: string
): Promise<{ ok: boolean; error?: string }>
```

- Auth: `canManageGrants(role)` — admin only.
- Update only if `status='pending'`. If update affects 0 rows → `{ok: false, error: "Grant no longer pending"}`.
- On approve: set `status='approved'`, `approved_by`, `approved_at = now()`.
- On reject: set `status='rejected'`, `rejected_by`, `rejected_at = now()`, optional `rejection_reason`.
- Revalidate `/approvals`, `/`, `/leave`.

### `createLeaveRequest` tweak (one branch)

After computing `actualDays`, if `input.leave_type_id === compassionate_id`, run the available-days query for the requester. If `available < actualDays`, return `{ok: false, error: "You have no compassionate leave available. Ask your manager to grant it."}`.

The existing `approveLeaveRequest` does not change. The deduction path updates `leave_balances.used_days/remaining_days` for compassionate (currently always 0/0); it stays a no-op. The visible available number is the derived value, which the formula accounts for via the `used` term.

## UI

### Manager — `grant-propose-dialog.tsx`

- Trigger button on the `/approvals` page header (manager + admin only): "Grant Compassionate Leave".
- Fields:
  - **Employee** — `<Select>` populated from `getDirectReports(currentEmployee.id)`. For managers, only their direct reports. For admin (escape hatch), all active employees. Required.
  - **Days** — number input, integer, min 1, max 365. Required.
  - **Reason** — textarea, 1–500 chars. Required.
- On submit: `startTransition` → call `createCompassionateGrant` → on success close dialog and `router.refresh()`. On error, show inline error.

### Admin — `grant-approval-list.tsx`

- Renders pending grants as cards (same card style as `ApprovalList`).
- Each card: employee name, code, department; "Compassionate Leave — N day(s)"; reason; "Granted by: <manager name>".
- Buttons: Approve, Reject.
- Reject opens a confirmation dialog with an optional reason textarea.
- Approve opens the existing destructive-action confirm dialog.
- Both call `approveCompassionateGrant`.

### Manager — `my-grants-list.tsx`

- Renders the manager's own grants (any status) for their visibility.
- Sections: Pending (with Cancel), Approved, Rejected.
- Cancel calls a new `cancelPendingGrant` server action (manager cancels their own pending grant). Admin does not need to be involved in cancellation of a still-pending grant.
- Sorted by `created_at` desc.

### Employee dashboard — compassionate card (updated)

The existing `<Card>` is reused. Internal content changes for the compassionate row only:

```tsx
{isCompassionate ? (
  <>
    <div className="text-3xl font-bold">{compassionateAvailable}</div>
    <p className="text-xs text-gray-500">
      Granted: {compassionateGranted} · Used: {compassionateUsed}
    </p>
    {compassionatePending > 0 && (
      <p className="mt-1 text-xs text-yellow-700">
        {compassionatePending} day(s) pending admin approval
      </p>
    )}
  </>
) : (
  // unchanged: b.remaining_days, allocated + carry_forward
)}
```

Same treatment on the balance grid in `app/(dashboard)/leave/page.tsx`.

## Files touched

| File | Change |
| --- | --- |
| `supabase/migrations/007_compassionate_grants.sql` | New: table, enum, indexes, RLS. |
| `lib/types.ts` | Add `LeaveGrant`, `LeaveGrantStatus`. |
| `lib/validations.ts` | Add `compassionateGrantSchema`. |
| `lib/auth.ts` | Add `canProposeGrants`, `canManageGrants`. |
| `lib/actions.ts` | Add `createCompassionateGrant`, `approveCompassionateGrant`, `cancelPendingGrant`. Tweak `createLeaveRequest`. |
| `components/features/grants/grant-propose-dialog.tsx` | New. |
| `components/features/grants/grant-approval-list.tsx` | New. |
| `components/features/grants/my-grants-list.tsx` | New. |
| `app/(dashboard)/approvals/page.tsx` | Fetch grants; render the three new components above the existing `ApprovalList`. |
| `app/(dashboard)/page.tsx` | Fetch derived compassionate data; update the compassionate card. |
| `app/(dashboard)/leave/page.tsx` | Same card update inside the balance grid. |
| `tests/compassionate-grants.spec.ts` | New Playwright e2e spec. |

## Error handling

- **Manager targets non-direct-report** → `{ok: false, error: "Can only grant to your active direct reports"}`. Same for inactive employees.
- **Manager targets self** → blocked at the dialog level; the server also rejects (employee row's `manager_id` is null for managers, so the check naturally fails).
- **Days < 1 or non-integer** → Zod rejection at the boundary.
- **Reason empty** → Zod rejection.
- **Admin approves already-decided grant** → update filter `status='pending'` matches 0 rows → `{ok: false, error: "Grant no longer pending"}`.
- **Employee requests compassionate with insufficient balance** → `{ok: false, error: "You have no compassionate leave available. Ask your manager to grant it."}`.
- **Network/DB failure on any action** → try/catch wraps the whole body; returns `{ok: false, error: <message>}`. Same pattern as existing actions.

## Testing

One Playwright e2e spec at `tests/compassionate-grants.spec.ts`:

1. Sign in as manager.
2. Open the Grant Compassionate Leave dialog, pick the employee, enter 1 day, "Death of grandmother", submit.
3. Verify the manager's "My Grants" list shows the grant as Pending.
4. Sign in as admin.
5. Verify the grant appears in "Grant Approvals" with the reason visible.
6. Approve the grant.
7. Sign in as the employee.
8. Verify the dashboard compassionate card shows `1` with "Granted: 1 · Used: 0".
9. Submit a 1-day compassionate leave request.
10. Sign in as admin, approve the request.
11. Sign in as the employee, verify the card now shows `0` with "Granted: 1 · Used: 1".

No unit-test framework is in use (per `package.json`); Playwright is the test layer. The project already has a similar e2e pattern for leave-approval routing.

## Open questions

None. All scope decisions resolved during brainstorming.
