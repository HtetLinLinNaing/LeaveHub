# Multi-Type Leave Grants

Date: 2026-08-10
Status: approved
Branch: feat/multi-type-leave-grants

## Goal

Generalize the existing "Compassionate Leave grant" flow so that the same
manager-proposes / admin-approves mechanism works for any of the
**grant-driven leave types**. Today only Compassionate Leave uses this flow.
After this change, 10 types use it. Annual Leave and Medical Leave keep
their fixed annual balance and are out of scope.

## Scope

### In scope (10 grant-driven types)

Childcare Leave, Hospitalisation Leave, Maternity Leave, Paternity Leave,
Unpaid Leave, Off-in-Lieu, Training, Compassionate Leave, Marriage Leave,
Shared Parental Leave.

### Out of scope

- Annual Leave (fixed 14 days/year, balance from `leave_balances`).
- Medical Leave (fixed 7 days/year, balance from `leave_balances`).
- Any UI/UX changes unrelated to grants.

## Behavior

### Propose (manager or admin)

On `/approvals`, the existing single **"Propose Grant"** button opens a
dialog with these fields, in order:

1. **Leave Type** — `<Select>` populated from the 10 grant-driven types.
2. **Employee** — `<Select>` (unchanged).
3. **Number of days** — `<input type="number">` (unchanged).
4. **Reason** — `<textarea>` (unchanged).

The dialog title becomes "Propose Leave Grant". The submit button label
becomes "Submit Grant".

### Approve / reject (admin only)

Unchanged. The `GrantApprovalList` card displays the granted leave type
name alongside employee and reason.

### Employee view

When an admin approves a grant, the employee sees it on their dashboard.
The dashboard renders a card for **each grant-driven type** that has any
granted, used, pending, or available activity this year.

### Balance derivation

For the 10 grant-driven types, "available days" is computed by the same
formula Compassionate uses today:

```
granted = sum(leave_grants.days where employee=X, leave_type=T,
              status='approved', approved_at in year)
used    = sum(leave_requests.days where employee=X, leave_type=T,
              status='approved', start_date in year)
pending = sum(leave_grants.days where employee=X, leave_type=T,
              status='pending')
available = max(granted - used, 0)
```

### Submit-request validation

When an employee submits a `leave_request`, the existing check that
blocks submission when the requested type has insufficient compassionate
balance is generalized to any of the 10 grant-driven types. Annual and
Medical skip the check.

## Data layer

No new tables. `leave_grants.leave_type_id` already exists.

A new constant is added to `lib/constants.ts`:

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
```

## Code changes

### New / renamed

- `lib/grants.ts` — replaces `lib/compassionate.ts`. Exports
  `getGrantDrivenAvailability(supabase, employeeId, year, leaveTypeId)`
  and `getGrantDrivenOverview(supabase, employeeId, year)`.
- `lib/actions.ts`:
  - `createCompassionateGrant` → `createLeaveGrant`, takes
    `{ employee_id, leave_type_name, days, reason }` and resolves the
    id inside the action.
  - `approveCompassionateGrant` → `approveLeaveGrant`.
  - `createLeaveRequest` — replaces the Compassionate-specific block
    with a generic check for any of the 10 types.
- `app/(dashboard)/approvals/page.tsx`: fetches all grant-driven types,
  renders grants across them, attaches leave type name.
- `components/features/grants/grant-propose-dialog.tsx`: adds Leave Type
  `<Select>` as first field.
- `components/features/grants/grant-approval-list.tsx`: shows leave type
  name in cards.
- `components/features/grants/my-grants-list.tsx`: same.
- `app/(dashboard)/page.tsx`: replaces single Compassionate card with N
  cards (one per grant-driven type with activity).

### Removed

- `lib/compassionate.ts`.

## Tests

- Update existing `tests/compassionate-grants.spec.ts` →
  `tests/leave-grants.spec.ts` for the new selectors.
- Add a second test that asserts the same flow works for Unpaid Leave.

## Risks

- **Type-name drift.** Action validates the resolved type name against
  `GRANT_DRIVEN_LEAVE_TYPE_NAMES`.
- **Dashboard noise.** Cards render only when activity > 0.