# Compassionate Leave Grants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Manager-proposes / Admin-approves grant workflow for Compassionate Leave, with derived available-days on the dashboard card, audit trail, and a balance check on compassionate leave requests.

**Architecture:** New `leave_grants` table separate from `leave_requests`. Two new server actions for proposing and approving grants. A small tweak to `createLeaveRequest` to block compassionate requests when no balance. Three new client components for the manager propose dialog, admin approval list, and manager's own-grants list. The existing dashboard and `/leave` page compassionate card switches to a derived value at read time.

**Tech Stack:** Next.js 16 App Router (server actions, server components), React 19, Supabase (Postgres + RLS), Zod, Tailwind 4, shadcn-style UI components, Playwright for e2e.

## Global Constraints

- TypeScript strict; no `any` unless existing pattern requires it.
- Server actions return `{ ok: boolean; error?: string }` (matches existing `ApprovalResult`).
- Validation: Zod schemas in `lib/validations.ts`; first Zod issue message is the user-facing error.
- All mutations revalidate at least the page(s) whose data they change.
- One migration per logical change. Migration file naming: `NNN_description.sql` where `NNN` is the next integer.
- Do NOT use `runtime = 'edge'` (this is Fluid Compute / Node).
- RLS: keep the dev-mode permissive policy pattern; tighten later in a dedicated migration.
- Tests: Playwright e2e only (no unit-test framework in this project). Test file at `tests/<feature>.spec.ts`. Reuse `login` and `USERS` from `tests/helpers.ts`. Each test uses `futureDate(n)` for date inputs.
- The Compassionate Leave card on the dashboard and `/leave` is the SAME `<Card>` component as today; only the inner content swaps to derived values for the compassionate row.

---

### File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/007_compassionate_grants.sql` | New: `leave_grants` table, `leave_grant_status` enum, indexes, dev RLS. |
| `lib/types.ts` | Add `LeaveGrant`, `LeaveGrantStatus`. |
| `lib/validations.ts` | Add `compassionateGrantSchema`. |
| `lib/auth.ts` | Add `canProposeGrants`, `canManageGrants`. |
| `lib/actions.ts` | Add `createCompassionateGrant`, `approveCompassionateGrant`, `cancelPendingGrant`. Tweak `createLeaveRequest` for compassionate balance check. |
| `lib/compassionate.ts` | New: derived available-days helper used by pages. |
| `components/features/grants/grant-propose-dialog.tsx` | New: manager's grant form dialog. |
| `components/features/grants/grant-approval-list.tsx` | New: admin's pending grants with approve/reject. |
| `components/features/grants/my-grants-list.tsx` | New: manager's own grants (pending/approved/rejected) with cancel. |
| `app/(dashboard)/approvals/page.tsx` | Fetch pending grants + own grants; render new components above existing `ApprovalList`. |
| `app/(dashboard)/page.tsx` | Fetch derived compassionate data; update compassionate card content. |
| `app/(dashboard)/leave/page.tsx` | Same card update inside balance grid. |
| `tests/compassionate-grants.spec.ts` | New: e2e spec covering the full grant flow. |

---

## Task 1: Migration — `leave_grants` table

**Files:**
- Create: `supabase/migrations/007_compassionate_grants.sql`

**Produces:** New `leave_grants` table with enum, FKs, indexes, and dev-mode permissive RLS policy. Consumed by Tasks 2–4.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Verify migration is syntactically reasonable**

Run: `cat supabase/migrations/007_compassionate_grants.sql | head -20`
Expected: SQL header and CREATE TYPE line.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/007_compassionate_grants.sql
git commit -m "feat(db): compassionate leave grants table"
```

---

## Task 2: Types, validations, and auth helpers

**Files:**
- Modify: `lib/types.ts` (append)
- Modify: `lib/validations.ts` (append)
- Modify: `lib/auth.ts` (append before the existing `hasRole` / `canApproveLeave` / `canManageEmployees` block, or right after — keep the new helpers adjacent to the existing role checks)

**Consumes:** existing `Role` type from `lib/types.ts`.
**Produces:** `LeaveGrant`, `LeaveGrantStatus`, `compassionateGrantSchema`, `canProposeGrants`, `canManageGrants`.

- [ ] **Step 1: Add `LeaveGrant` types to `lib/types.ts`**

Append at the end of `lib/types.ts`:

```ts
export type LeaveGrantStatus = "pending" | "approved" | "rejected";

export interface LeaveGrant {
  id: string;
  employee_id: string;
  leave_type_id: string;
  days: number;
  reason: string;
  status: LeaveGrantStatus;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface LeaveGrantWithDetails extends LeaveGrant {
  employee: Pick<Employee, "first_name" | "last_name" | "employee_code" | "department">;
  created_by_employee: Pick<Employee, "first_name" | "last_name">;
}
```

- [ ] **Step 2: Add Zod schema to `lib/validations.ts`**

Append:

```ts
export const compassionateGrantSchema = z.object({
  employee_id: z.string().uuid(),
  days: z.number().int().min(1, "Days must be at least 1").max(365, "Days must be at most 365"),
  reason: z.string().min(1, "Reason is required").max(500, "Reason must be at most 500 characters"),
});

export type CompassionateGrantInput = z.infer<typeof compassionateGrantSchema>;
```

- [ ] **Step 3: Add auth helpers to `lib/auth.ts`**

Append at the end of `lib/auth.ts`:

```ts
export function canProposeGrants(userRole: Role): boolean {
  return ["manager", "admin"].includes(userRole);
}

export function canManageGrants(userRole: Role): boolean {
  return userRole === "admin";
}
```

- [ ] **Step 4: Run the type check**

Run: `npx tsc --noEmit`
Expected: 0 errors. (If the project has no `tsc` script, use the IDE's `tsc` invocation — the codebase has `tsconfig.json` and `tsbuildinfo`.)

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/validations.ts lib/auth.ts
git commit -m "feat(core): compassionate grant types, validation, auth helpers"
```

---

## Task 3: Derived available-days helper

**Files:**
- Create: `lib/compassionate.ts`

**Consumes:** Supabase admin client (`createClient` from `lib/supabase/admin`).
**Produces:** `getCompassionateAvailable(supabase, employeeId, year): Promise<{ granted, used, available, pending }>`.

- [ ] **Step 1: Write the helper**

Create `lib/compassionate.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CompassionateAvailability {
  granted: number;
  used: number;
  available: number;
  pending: number;
}

// Compassionate Leave is grant-driven. The employee's available days =
// approved grants in the year minus approved compassionate requests in
// the year. Year is keyed on approved_at for grants, start_date for
// requests. Pool model — no per-grant FIFO.
export async function getCompassionateAvailability(
  supabase: SupabaseClient,
  employeeId: string,
  year: number
): Promise<CompassionateAvailability> {
  // Find the compassionate leave_type_id. The DB has exactly one row
  // named "Compassionate Leave"; if it ever changes, update here.
  const { data: lt } = await supabase
    .from("leave_types")
    .select("id")
    .eq("name", "Compassionate Leave")
    .single();
  const compassionateId = lt?.id;
  if (!compassionateId) {
    return { granted: 0, used: 0, available: 0, pending: 0 };
  }

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31T23:59:59`;

  const [grantedRes, usedRes, pendingRes] = await Promise.all([
    supabase
      .from("leave_grants")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", compassionateId)
      .eq("status", "approved")
      .gte("approved_at", yearStart)
      .lte("approved_at", yearEnd),
    supabase
      .from("leave_requests")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", compassionateId)
      .eq("status", "approved")
      .gte("start_date", yearStart)
      .lte("start_date", yearEnd),
    supabase
      .from("leave_grants")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", compassionateId)
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add lib/compassionate.ts
git commit -m "feat(core): compassionate availability helper"
```

---

## Task 4: Server actions — propose, approve/reject, cancel

**Files:**
- Modify: `lib/actions.ts` (append three new exports; modify `createLeaveRequest`)

**Consumes:** `compassionateGrantSchema`, `canProposeGrants`, `canManageGrants`, `getCompassionateAvailability`, existing `requireSession` helper.

**Produces:** `createCompassionateGrant`, `approveCompassionateGrant`, `cancelPendingGrant`. Modifies `createLeaveRequest` to block compassionate requests with no balance.

- [ ] **Step 1: Add new imports at the top of `lib/actions.ts`**

Add (or merge into the existing import block at the top):

```ts
import { compassionateGrantSchema } from "@/lib/validations";
import { canProposeGrants, canManageGrants } from "@/lib/auth";
import { getCompassionateAvailability } from "@/lib/compassionate";
```

- [ ] **Step 2: Append `createCompassionateGrant` to `lib/actions.ts`**

```ts
// ----- Propose a Compassionate Leave grant (manager or admin) -----

export interface CreateCompassionateGrantInput {
  employee_id: string;
  days: number;
  reason: string;
}

export async function createCompassionateGrant(
  input: CreateCompassionateGrantInput
): Promise<ApprovalResult> {
  try {
    const { supabase, user, employee } = await requireSession();
    if (!canProposeGrants(user.role as Role)) {
      return { ok: false, error: "Not authorized" };
    }
    if (!employee) return { ok: false, error: "Proposer record not found" };

    const parsed = compassionateGrantSchema.safeParse(input);
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

    // Resolve the compassionate leave_type_id.
    const { data: lt } = await supabase
      .from("leave_types")
      .select("id")
      .eq("name", "Compassionate Leave")
      .single();
    if (!lt) return { ok: false, error: "Compassionate Leave type not found" };

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

- [ ] **Step 3: Append `approveCompassionateGrant` to `lib/actions.ts`**

```ts
// ----- Approve or reject a pending grant (admin) -----

export async function approveCompassionateGrant(
  grantId: string,
  decision: "approved" | "rejected",
  rejectionReason?: string
): Promise<ApprovalResult> {
  try {
    const { supabase, user, employee } = await requireSession();
    if (!canManageGrants(user.role as Role)) {
      return { ok: false, error: "Not authorized" };
    }
    if (!employee) return { ok: false, error: "Admin record not found" };

    const now = new Date().toISOString();
    const update =
      decision === "approved"
        ? { status: "approved", approved_by: employee.id, approved_at: now, rejected_by: null, rejected_at: null, rejection_reason: null }
        : { status: "rejected", rejected_by: employee.id, rejected_at: now, rejection_reason: rejectionReason ?? null };

    const { data: updated, error: updateError } = await supabase
      .from("leave_grants")
      .update(update)
      .eq("id", grantId)
      .eq("status", "pending")
      .select("id")
      .single();
    if (updateError) throw updateError;
    if (!updated) return { ok: false, error: "Grant no longer pending" };

    revalidatePath("/approvals");
    revalidatePath("/");
    revalidatePath("/leave");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update grant",
    };
  }
}
```

- [ ] **Step 4: Append `cancelPendingGrant` to `lib/actions.ts`**

```ts
// ----- Cancel a still-pending grant (the manager who proposed it) -----

export async function cancelPendingGrant(grantId: string): Promise<ApprovalResult> {
  try {
    const { supabase, user, employee } = await requireSession();
    if (!canProposeGrants(user.role as Role)) {
      return { ok: false, error: "Not authorized" };
    }
    if (!employee) return { ok: false, error: "Proposer record not found" };

    // Only the original creator can cancel; admin cannot cancel through this path.
    const { data: updated, error: updateError } = await supabase
      .from("leave_grants")
      .update({ status: "rejected", rejected_by: employee.id, rejected_at: new Date().toISOString() })
      .eq("id", grantId)
      .eq("created_by", employee.id)
      .eq("status", "pending")
      .select("id")
      .single();
    if (updateError) throw updateError;
    if (!updated) return { ok: false, error: "Grant no longer pending or not yours" };

    revalidatePath("/approvals");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to cancel grant",
    };
  }
}
```

- [ ] **Step 5: Tweak `createLeaveRequest` to block compassionate requests without balance**

Locate `createLeaveRequest` in `lib/actions.ts`. After the `actualDays <= 0` guard (the "no working days" check) and BEFORE the `leave_requests` insert, add:

```ts
    // Compassionate Leave balance check: derived available >= actualDays.
    if (input.leave_type_id) {
      const { data: ltForCheck } = await supabase
        .from("leave_types")
        .select("id, name")
        .eq("id", input.leave_type_id)
        .single();
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
    }
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/actions.ts
git commit -m "feat(actions): compassionate grant create/approve/cancel + balance check"
```

---

## Task 5: Manager propose dialog

**Files:**
- Create: `components/features/grants/grant-propose-dialog.tsx`

**Consumes:** `createCompassionateGrant` server action.
**Produces:** Client component used on `/approvals` page (Task 8).

- [ ] **Step 1: Write the component**

Create `components/features/grants/grant-propose-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCompassionateGrant } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";

interface EmployeeOption {
  id: string;
  first_name: string;
  last_name: string;
  employee_code: string;
}

interface Props {
  employees: EmployeeOption[];
}

export function GrantProposeDialog({ employees }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [employeeId, setEmployeeId] = useState("");
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState("");

  function reset() {
    setEmployeeId("");
    setDays(1);
    setReason("");
    setError("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await createCompassionateGrant({
        employee_id: employeeId,
        days,
        reason,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to submit grant");
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 h-4 w-4" />
        Grant Compassionate Leave
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant Compassionate Leave</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Employee</label>
            <Select
              value={employeeId}
              onValueChange={(v) => setEmployeeId(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select employee">
                  {employeeId
                    ? (() => {
                        const e = employees.find((x) => x.id === employeeId);
                        return e
                          ? `${e.first_name} ${e.last_name} (${e.employee_code})`
                          : undefined;
                      })()
                    : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.first_name} {e.last_name} ({e.employee_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Number of days
            </label>
            <input
              type="number"
              min={1}
              max={365}
              step={1}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              required
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={3}
              maxLength={500}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="e.g. Death of grandmother"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !employeeId || !reason}
            >
              {pending ? "Submitting..." : "Submit Grant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/features/grants/grant-propose-dialog.tsx
git commit -m "feat(grants): manager propose dialog"
```

---

## Task 6: Admin approval list

**Files:**
- Create: `components/features/grants/grant-approval-list.tsx`

**Consumes:** `approveCompassionateGrant` server action.
**Produces:** Client component used on `/approvals` page (Task 8).

- [ ] **Step 1: Write the component**

Create `components/features/grants/grant-approval-list.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveCompassionateGrant } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, X } from "lucide-react";

interface PendingGrant {
  id: string;
  days: number;
  reason: string;
  created_at: string;
  employee: {
    first_name: string;
    last_name: string;
    employee_code: string;
    department: string;
  };
  created_by_employee: {
    first_name: string;
    last_name: string;
  };
}

interface Props {
  grants: PendingGrant[];
}

export function GrantApprovalList({ grants }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<
    | {
        id: string;
        action: "approved" | "rejected";
        name: string;
      }
    | null
  >(null);
  const [rejectReason, setRejectReason] = useState("");

  function applyDecision() {
    if (!confirming) return;
    const { id, action } = confirming;
    const reason = action === "rejected" ? rejectReason : undefined;
    setError("");
    setProcessingId(id);
    setConfirming(null);
    setRejectReason("");
    startTransition(async () => {
      const result = await approveCompassionateGrant(id, action, reason);
      if (!result.ok) {
        setError(result.error ?? "Failed to update grant");
      }
      setProcessingId(null);
      router.refresh();
    });
  }

  if (grants.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
        No pending grants.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {grants.map((g) => (
        <div key={g.id} className="rounded-lg border bg-white p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {g.employee.first_name} {g.employee.last_name}
                </span>
                <Badge variant="outline">{g.employee.employee_code}</Badge>
                <Badge variant="outline">{g.employee.department}</Badge>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Compassionate Leave — {g.days} day(s)
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Granted by: {g.created_by_employee.first_name}{" "}
                {g.created_by_employee.last_name}
              </p>
              <p className="mt-2 text-sm">{g.reason}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-green-600 hover:bg-green-50"
                onClick={() =>
                  setConfirming({
                    id: g.id,
                    action: "approved",
                    name: `${g.employee.first_name} ${g.employee.last_name}`,
                  })
                }
                disabled={pending && processingId === g.id}
              >
                <Check className="mr-1 h-4 w-4" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:bg-red-50"
                onClick={() =>
                  setConfirming({
                    id: g.id,
                    action: "rejected",
                    name: `${g.employee.first_name} ${g.employee.last_name}`,
                  })
                }
                disabled={pending && processingId === g.id}
              >
                <X className="mr-1 h-4 w-4" />
                Reject
              </Button>
            </div>
          </div>
        </div>
      ))}

      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConfirming(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming?.action === "approved" ? "Approve" : "Reject"} grant
              for {confirming?.name}?
            </DialogTitle>
          </DialogHeader>
          {confirming?.action === "rejected" && (
            <div>
              <label className="mb-1 block text-sm font-medium">
                Rejection reason (optional)
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          )}
          <p className="text-sm text-gray-600">
            {confirming?.action === "approved"
              ? "Approving will add the days to the employee's compassionate leave balance. This can't be undone from here."
              : "Rejecting will not change any balances. This can't be undone from here."}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(null);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={applyDecision} disabled={pending}>
              {pending
                ? "Saving..."
                : confirming?.action === "approved"
                ? "Approve"
                : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/features/grants/grant-approval-list.tsx
git commit -m "feat(grants): admin approval list"
```

---

## Task 7: Manager's own grants list

**Files:**
- Create: `components/features/grants/my-grants-list.tsx`

**Consumes:** `cancelPendingGrant` server action.
**Produces:** Client component used on `/approvals` page (Task 8).

- [ ] **Step 1: Write the component**

Create `components/features/grants/my-grants-list.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelPendingGrant } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";

interface MyGrant {
  id: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  employee: {
    first_name: string;
    last_name: string;
    employee_code: string;
  };
}

interface Props {
  grants: MyGrant[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export function MyGrantsList({ grants }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<MyGrant | null>(null);

  if (grants.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
        No grants proposed yet.
      </div>
    );
  }

  function handleCancel(id: string) {
    setError("");
    setCancellingId(id);
    setConfirming(null);
    startTransition(async () => {
      const result = await cancelPendingGrant(id);
      if (!result.ok) {
        setError(result.error ?? "Failed to cancel grant");
      }
      setCancellingId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {grants.map((g) => (
        <div key={g.id} className="rounded-lg border bg-white p-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {g.employee.first_name} {g.employee.last_name}
                </span>
                <Badge variant="outline">{g.employee.employee_code}</Badge>
                <Badge variant="outline" className={STATUS_COLORS[g.status]}>
                  {g.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Compassionate Leave — {g.days} day(s)
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {format(new Date(g.created_at), "MMM d, yyyy")}
              </p>
              <p className="mt-1 text-sm">{g.reason}</p>
            </div>
            {g.status === "pending" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(g)}
                disabled={pending && cancellingId === g.id}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      ))}
      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this grant proposal?</DialogTitle>
          </DialogHeader>
          {confirming && (
            <p className="text-sm text-gray-600">
              {confirming.employee.first_name} {confirming.employee.last_name} —{" "}
              {confirming.days} day(s). This can't be undone from here.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Keep proposal
            </Button>
            <Button
              onClick={() => confirming && handleCancel(confirming.id)}
              disabled={pending}
            >
              {pending ? "Cancelling..." : "Cancel proposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/features/grants/my-grants-list.tsx
git commit -m "feat(grants): manager own-grants list"
```

---

## Task 8: Wire approvals page

**Files:**
- Modify: `app/(dashboard)/approvals/page.tsx`

**Consumes:** Three new components from Tasks 5–7. Existing data-fetching pattern in the page (PostgREST hydration in JS — see `leave-approval-routing-design.md`).

**Produces:** Page that shows grant sections above the existing leave-request approval list, with the right data fetched per role.

- [ ] **Step 1: Replace the page body**

Replace the entire body of `app/(dashboard)/approvals/page.tsx` with:

```tsx
import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/features/approvals/approval-list";
import { GrantProposeDialog } from "@/components/features/grants/grant-propose-dialog";
import { GrantApprovalList } from "@/components/features/grants/grant-approval-list";
import { MyGrantsList } from "@/components/features/grants/my-grants-list";

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);
  const currentEmployeeId = employee?.id ?? null;

  // ---- Existing leave-request approvals (unchanged data shape) ----
  const { data: rawRequests } = await supabase
    .from("leave_requests")
    .select("id, employee_id, leave_type_id, start_date, end_date, days, duration_type, reason, status, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const requestRows = rawRequests ?? [];
  let requestsForList: Parameters<typeof ApprovalList>[0]["requests"] = [];

  if (requestRows.length > 0) {
    const employeeIds = Array.from(new Set(requestRows.map((r) => r.employee_id)));
    const leaveTypeIds = Array.from(new Set(requestRows.map((r) => r.leave_type_id)));
    const [{ data: employees }, { data: leaveTypes }] = await Promise.all([
      supabase
        .from("employees")
        .select("id, first_name, last_name, employee_code, department, manager_id, user_id")
        .in("id", employeeIds),
      supabase
        .from("leave_types")
        .select("id, name")
        .in("id", leaveTypeIds),
    ]);
    const userIds = Array.from(new Set((employees ?? []).map((e) => e.user_id)));
    const { data: users } = userIds.length
      ? await supabase.from("users").select("id, role").in("id", userIds)
      : { data: [] as { id: string; role: string }[] };

    const employeeMap = new Map((employees ?? []).map((e) => [e.id, e]));
    const leaveTypeMap = new Map((leaveTypes ?? []).map((lt) => [lt.id, lt]));
    const userMap = new Map((users ?? []).map((u) => [u.id, u]));

    let mapped = requestRows
      .map((r) => {
        const emp = employeeMap.get(r.employee_id);
        if (!emp) return null;
        const u = userMap.get(emp.user_id);
        return {
          ...r,
          employees: {
            id: emp.id,
            first_name: emp.first_name,
            last_name: emp.last_name,
            employee_code: emp.employee_code,
            department: emp.department,
            manager_id: emp.manager_id,
            users: { role: u?.role ?? "employee" },
          },
          leave_types: leaveTypeMap.get(r.leave_type_id) ?? null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (user?.role === "manager" && currentEmployeeId) {
      mapped = mapped.filter(
        (r) =>
          r.employees.manager_id === currentEmployeeId &&
          r.employees.users.role !== "manager"
      );
    }
    requestsForList = mapped;
  }

  // ---- Compassionate grants ----
  // Admin: pending grants across the org.
  // Manager: their own grants (any status), and the list of direct reports
  // for the propose dialog.
  let pendingGrants: Parameters<typeof GrantApprovalList>[0]["grants"] = [];
  let myGrants: Parameters<typeof MyGrantsList>[0]["grants"] = [];
  let directReportsForDialog: { id: string; first_name: string; last_name: string; employee_code: string }[] = [];

  if (user?.role === "admin") {
    const { data: raw } = await supabase
      .from("leave_grants")
      .select("id, employee_id, days, reason, created_at, created_by, status")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    const rows = raw ?? [];
    if (rows.length > 0) {
      const empIds = Array.from(new Set([...rows.map((r) => r.employee_id), ...rows.map((r) => r.created_by)]));
      const { data: emps } = await supabase
        .from("employees")
        .select("id, first_name, last_name, employee_code, department")
        .in("id", empIds);
      const empMap = new Map((emps ?? []).map((e) => [e.id, e]));
      pendingGrants = rows
        .map((g) => {
          const emp = empMap.get(g.employee_id);
          const creator = empMap.get(g.created_by);
          if (!emp || !creator) return null;
          return {
            id: g.id,
            days: Number(g.days),
            reason: g.reason,
            created_at: g.created_at,
            employee: {
              first_name: emp.first_name,
              last_name: emp.last_name,
              employee_code: emp.employee_code,
              department: emp.department,
            },
            created_by_employee: {
              first_name: creator.first_name,
              last_name: creator.last_name,
            },
          };
        })
        .filter((g): g is NonNullable<typeof g> => g !== null);
    }
  } else if (user?.role === "manager" && currentEmployeeId) {
    // Own grants (any status), newest first.
    const { data: raw } = await supabase
      .from("leave_grants")
      .select("id, employee_id, days, reason, status, created_at, approved_at, rejected_at")
      .eq("created_by", currentEmployeeId)
      .order("created_at", { ascending: false });
    const rows = raw ?? [];
    if (rows.length > 0) {
      const empIds = Array.from(new Set(rows.map((r) => r.employee_id)));
      const { data: emps } = await supabase
        .from("employees")
        .select("id, first_name, last_name, employee_code")
        .in("id", empIds);
      const empMap = new Map((emps ?? []).map((e) => [e.id, e]));
      myGrants = rows
        .map((g) => {
          const emp = empMap.get(g.employee_id);
          if (!emp) return null;
          return {
            id: g.id,
            days: Number(g.days),
            reason: g.reason,
            status: g.status as "pending" | "approved" | "rejected",
            created_at: g.created_at,
            approved_at: g.approved_at,
            rejected_at: g.rejected_at,
            employee: {
              first_name: emp.first_name,
              last_name: emp.last_name,
              employee_code: emp.employee_code,
            },
          };
        })
        .filter((g): g is NonNullable<typeof g> => g !== null);
    }
    // Direct reports for the propose dialog.
    const { data: drs } = await supabase
      .from("employees")
      .select("id, first_name, last_name, employee_code")
      .eq("manager_id", currentEmployeeId)
      .eq("status", "active")
      .order("first_name");
    directReportsForDialog = drs ?? [];
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Pending Approvals</h1>

      {(user?.role === "manager" || user?.role === "admin") && (
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Compassionate Leave Grants</h2>
          <GrantProposeDialog employees={directReportsForDialog} />
        </div>
      )}

      {user?.role === "admin" && (
        <section className="mb-8">
          <h3 className="mb-2 text-sm font-medium text-gray-500">Pending grants</h3>
          <GrantApprovalList grants={pendingGrants} />
        </section>
      )}

      {user?.role === "manager" && (
        <section className="mb-8">
          <h3 className="mb-2 text-sm font-medium text-gray-500">My grants</h3>
          <MyGrantsList grants={myGrants} />
        </section>
      )}

      <h2 className="mb-2 text-lg font-semibold">Leave Requests</h2>
      <ApprovalList requests={requestsForList} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Manual smoke test (optional, dev only)**

Run: `npm run dev`
Then sign in as manager — confirm "Compassionate Leave Grants" section shows. Sign in as admin — confirm "Pending grants" section shows.
Expected: no runtime errors. Press Ctrl-C after.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/approvals/page.tsx
git commit -m "feat(approvals): wire compassionate grant sections"
```

---

## Task 9: Update dashboard compassionate card

**Files:**
- Modify: `app/(dashboard)/page.tsx`

**Consumes:** `getCompassionateAvailability` from `lib/compassionate.ts`.

**Produces:** Dashboard's employee/manager view shows derived available days on the Compassionate Leave card; other cards unchanged.

- [ ] **Step 1: Add the import**

At the top of `app/(dashboard)/page.tsx`, add to the import block:

```ts
import { getCompassionateAvailability } from "@/lib/compassionate";
```

- [ ] **Step 2: Update the balance-cards query**

In the `else` branch (employee/manager path), the `Promise.all` array starts with the `balances` query. Add a parallel query for compassionate availability. The `balances` query is:

```ts
supabase
  .from("leave_balances")
  .select("*, leave_types(name)")
  .eq("employee_id", employee?.id ?? "")
  .eq("year", year),
```

Right after that entry in the `Promise.all` array, add a tuple element. Because the helper returns a Promise, wrap it in an `async` IIFE or change the array shape. The cleanest patch is to extract the data after the `Promise.all`:

Replace:

```ts
  const [
    { data: balances },
    { count: pendingCount },
    { data: recentRequests },
    holidays,
  ] = await Promise.all([...]);
```

With:

```ts
  const [
    { data: balances },
    { count: pendingCount },
    { data: recentRequests },
    holidays,
  ] = await Promise.all([...]);

  const compassionate = employee
    ? await getCompassionateAvailability(supabase, employee.id, year)
    : { granted: 0, used: 0, available: 0, pending: 0 };
```

(The `Promise.all` array is unchanged.)

- [ ] **Step 3: Update the balance cards rendering**

Find the balance-cards `<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">` block in the employee/manager branch. Replace the inner `.map((b) => ...)` with a version that branches on compassionate:

```tsx
        {(balances ?? []).map((b) => {
          const isCompassionate = b.leave_types?.name === "Compassionate Leave";
          if (isCompassionate) {
            return (
              <Card key={b.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500">
                    Compassionate Leave
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{compassionate.available}</div>
                  <p className="text-xs text-gray-500">
                    Granted: {compassionate.granted} · Used: {compassionate.used}
                  </p>
                  {compassionate.pending > 0 && (
                    <p className="mt-1 text-xs text-yellow-700">
                      {compassionate.pending} day(s) pending admin approval
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          }
          return (
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
          );
        })}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/page.tsx
git commit -m "feat(dashboard): compassionate card derived availability"
```

---

## Task 10: Update `/leave` page balance grid

**Files:**
- Modify: `app/(dashboard)/leave/page.tsx`

**Consumes:** `getCompassionateAvailability`.

**Produces:** `/leave` balance grid uses the same derived card for the compassionate row.

- [ ] **Step 1: Add the import**

At the top of `app/(dashboard)/leave/page.tsx`, add:

```ts
import { getCompassionateAvailability } from "@/lib/compassionate";
```

- [ ] **Step 2: Fetch the data after the existing `Promise.all`**

Right after the `await Promise.all([...])` line, add:

```ts
  const compassionate = employee
    ? await getCompassionateAvailability(supabase, employee.id, new Date().getFullYear())
    : { granted: 0, used: 0, available: 0, pending: 0 };
```

- [ ] **Step 3: Update the balance-cards `.map`**

Replace the balance-cards `<div className="mb-6 grid gap-4 sm:grid-cols-3">` block's `.map` with:

```tsx
        {(balances ?? []).map((b) => {
          const isCompassionate = b.leave_types?.name === "Compassionate Leave";
          if (isCompassionate) {
            return (
              <div key={b.id} className="rounded-lg border bg-white p-4">
                <p className="text-sm text-gray-500">Compassionate Leave</p>
                <p className="mt-1 text-2xl font-bold">{compassionate.available}</p>
                <p className="text-xs text-gray-400">
                  Granted: {compassionate.granted} · Used: {compassionate.used}
                </p>
                {compassionate.pending > 0 && (
                  <p className="mt-1 text-xs text-yellow-700">
                    {compassionate.pending} day(s) pending admin approval
                  </p>
                )}
              </div>
            );
          }
          return (
            <div key={b.id} className="rounded-lg border bg-white p-4">
              <p className="text-sm text-gray-500">{b.leave_types?.name}</p>
              <p className="mt-1 text-2xl font-bold">{b.remaining_days}</p>
              <p className="text-xs text-gray-400">
                of {b.allocated_days + b.carry_forward_days} days remaining
              </p>
            </div>
          );
        })}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/leave/page.tsx
git commit -m "feat(leave): compassionate card derived availability"
```

---

## Task 11: End-to-end Playwright spec

**Files:**
- Create: `tests/compassionate-grants.spec.ts`

**Consumes:** `login`, `USERS` from `tests/helpers.ts`. Seed data with `bob` as manager of `charlie` and `diana` as employees, `eve` as admin (per existing helpers).

**Produces:** E2E spec asserting the full grant → approve → request → approve → card-decrement flow.

- [ ] **Step 1: Write the spec**

Create `tests/compassionate-grants.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { login, logout, navigateTo, USERS } from "./helpers";

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function proposeGrant(
  page: import("@playwright/test").Page,
  opts: { employeeName: string; days: number; reason: string }
) {
  await navigateTo(page, "Approvals");
  await page.click("text=Grant Compassionate Leave");
  // Employee select.
  await page.locator('[role="combobox"]').first().click();
  await page.click(`[role="option"]:text("${opts.employeeName}")`);
  // Days.
  await page.locator('input[type="number"]').fill(String(opts.days));
  // Reason.
  await page.fill("textarea", opts.reason);
  await page.click('button:has-text("Submit Grant")');
  await page.waitForLoadState("networkidle");
}

test.describe("Compassionate leave grants", () => {
  test("manager proposes, admin approves, employee uses", async ({ page }) => {
    const employeeShort = USERS.employee.email.split("@")[0]; // "charlie"

    // 1. Manager proposes 1 day.
    await login(page, USERS.manager.email);
    await proposeGrant(page, {
      employeeName: "charlie", // first name in seed
      days: 1,
      reason: "Death of grandmother",
    });
    // Pending entry visible in "My grants".
    await expect(page.locator(`text=Compassionate Leave — 1 day(s)`).first()).toBeVisible();
    await expect(page.locator("text=pending").first()).toBeVisible();

    // 2. Admin approves the grant.
    await logout(page);
    await login(page, USERS.admin.email);
    await navigateTo(page, "Approvals");
    await expect(page.locator("text=charlie").first()).toBeVisible();
    await page.locator("text=Approve").first().click();
    // Confirm dialog → Approve.
    await page.locator('[role="dialog"] >> text=Approve').last().click();
    await page.waitForLoadState("networkidle");

    // 3. Employee sees the card with 1 available.
    await logout(page);
    await login(page, USERS.employee.email);
    await expect(page.locator("text=Compassionate Leave").first()).toBeVisible();
    await expect(
      page.locator("text=Granted: 1 · Used: 0").first()
    ).toBeVisible();

    // 4. Employee submits a 1-day compassionate request.
    await navigateTo(page, "My Leave");
    await page.click("text=Request Leave");
    await page.locator('[role="combobox"]').first().click();
    await page.click('[role="option"]:text("Compassionate Leave")');
    const dates = page.locator('input[type="date"]');
    await dates.nth(0).fill(futureDate(21));
    await dates.nth(1).fill(futureDate(21));
    await page.fill("textarea", "Family ceremony");
    await page.click('button:has-text("Submit Request")');
    await page.waitForLoadState("networkidle");

    // 5. Admin approves the request.
    await logout(page);
    await login(page, USERS.admin.email);
    await navigateTo(page, "Approvals");
    await expect(page.locator(`text=${employeeShort}`).first()).toBeVisible();
    await page.locator("text=Approve").first().click();
    await page.locator('[role="dialog"] >> text=Approve').last().click();
    await page.waitForLoadState("networkidle");

    // 6. Employee card decrements to 0.
    await logout(page);
    await login(page, USERS.employee.email);
    await expect(
      page.locator("text=Granted: 1 · Used: 1").first()
    ).toBeVisible();
  });

  test("employee cannot request compassionate without balance", async ({ page }) => {
    // Use Diana — no grants.
    await login(page, USERS.employee2.email);
    await navigateTo(page, "My Leave");
    await page.click("text=Request Leave");
    await page.locator('[role="combobox"]').first().click();
    await page.click('[role="option"]:text("Compassionate Leave")');
    const dates = page.locator('input[type="date"]');
    await dates.nth(0).fill(futureDate(22));
    await dates.nth(1).fill(futureDate(22));
    await page.fill("textarea", "Should fail");
    await page.click('button:has-text("Submit Request")');
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("text=You have no compassionate leave available").first()
    ).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test tests/compassionate-grants.spec.ts --project=desktop`
Expected: both tests pass. (If a test fails, fix the underlying issue — re-check the role mapping in `USERS` and the seed data; `charlie`/`diana` must be direct reports of `bob`.)

- [ ] **Step 3: Run the full Playwright suite to make sure nothing else regressed**

Run: `npx playwright test --project=desktop`
Expected: all tests pass. (Pre-existing tests that depend on Compassionate Leave being effectively zero (`leave_requests` tests) should still pass because the new balance check only fires when the leave type is Compassionate.)

- [ ] **Step 4: Commit**

```bash
git add tests/compassionate-grants.spec.ts
git commit -m "test(grants): e2e for compassionate leave grant flow"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Data model: Task 1.
  - Types / validations / auth helpers: Task 2.
  - Available-days formula: Task 3 (helper) + Tasks 9/10 (callers).
  - Manager propose: Task 4 action + Task 5 component + Task 8 wiring.
  - Admin approve/reject: Task 4 action + Task 6 component + Task 8 wiring.
  - Manager cancel own: Task 4 action + Task 7 component + Task 8 wiring.
  - Balance check on compassionate requests: Task 4 (action tweak).
  - Dashboard card update: Task 9.
  - `/leave` card update: Task 10.
  - End-of-year expiry: covered by the year filter in `getCompassionateAvailability` (Task 3).
  - Audit trail: `created_by`, `approved_by`/`approved_at`, `rejected_by`/`rejected_at`, `rejection_reason` (Tasks 1, 4).
  - No auto-allocation: `annual_days=0` unchanged for compassionate (no migration touches it).
  - E2E test: Task 11.
- **Placeholders:** None.
- **Type consistency:** `LeaveGrant` interface in Task 2 matches the fields used in `getCompassionateAvailability` (Task 3) and the action signatures (Task 4) and component props (Tasks 5–7). `MyGrantsList` component type signature matches the data shape assembled in the approvals page (Task 8). `getCompassionateAvailability` is called in Tasks 3, 4, 9, 10 with consistent `(supabase, employeeId, year)` signature.
