# Phase 3 Query and Authorization Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce authenticated page query fan-out and sequential waterfalls while preserving every actor, role, and manager-resource authorization boundary.

**Architecture:** Keep pages as Server Components that call server-only read models with a verified `Actor` and Supabase service client. Batch grant totals across all configured types, compose approvals data through an injectable reader, and parallelize only branches whose authorization inputs are already known. React `cache()` remains request-scoped for identity verification; Phase 3 adds no cross-request or client cache.

**Tech Stack:** Next.js 16.3.0 App Router, React 19.2.8, TypeScript 5, Supabase JS 2.112.x, Playwright 1.62 unit/contract tests, ESLint 9

**Spec:** `docs/superpowers/specs/2026-08-25-phase-3-query-deduplication-design.md`

## Global Constraints

- Work on `refactor/phase-3-query-dedup` in `/home/administrator/LeaveHub-V2/.worktrees/phase-3-query-dedup`.
- Read the relevant installed Next.js 16.3 guides in `node_modules/next/dist/docs/` before application-code edits; this repository explicitly forbids relying on generic Next.js assumptions.
- Keep all privileged query code server-only and create no Route Handler or self-HTTP hop.
- Preserve the Phase 1 role/resource permission matrix and Phase 2 verified Actor boundary.
- Never place authorization decisions or user-specific data in `unstable_cache`, `use cache`, module globals, or client state.
- Manager leave-request scope must be applied to the database query before request rows enter process memory.
- Do not add a migration, Cache Components, client data fetching, streaming changes, or mutation refactors.
- Propagate database errors; do not turn infrastructure failures into empty arrays, validation errors, or not-found responses.
- Keep one implementation commit per task. A focused review-fix commit is allowed after a task commit when preserving review history is clearer than rewriting it.

---

### Task 1: Batch grant-driven overview reads

**Files:**
- Create: `tests/phase3-query-dedup.spec.ts`
- Create: `lib/grant-overview.ts`
- Modify: `playwright.unit.config.ts:5-10`
- Modify: `lib/grants.ts:1-105`
- Modify: `app/(dashboard)/page.tsx:91-118`
- Modify: `app/(dashboard)/leave/page.tsx:14-33`

**Interfaces:**
- Consumes: `GRANT_DRIVEN_LEAVE_TYPES`, `SupabaseClient`, existing `GrantDrivenOverviewEntry`, and the unchanged single-type `getGrantDrivenAvailability(db, employeeId, year, leaveTypeId)` mutation guard.
- Produces: pure `GrantOverviewReader` and `loadGrantDrivenOverview(reader)` from `lib/grant-overview.ts`, plus the unchanged server-only `getGrantDrivenOverview(db, employeeId, year): Promise<GrantDrivenOverviewEntry[]>` signature from `lib/grants.ts`.

- [ ] **Step 1: Register the Phase 3 contract suite**

Add `"phase3-query-dedup.spec.ts"` to `playwright.unit.config.ts` `testMatch` without removing the four existing suites.

- [ ] **Step 2: Write failing batched-overview tests**

Create `tests/phase3-query-dedup.spec.ts` with a fake reader and these contracts:

```ts
import { expect, test } from "@playwright/test";
import {
  loadGrantDrivenOverview,
  type GrantOverviewReader,
} from "../lib/grant-overview";

test("loads grant overview in four calls regardless of type count", async () => {
  const calls: string[] = [];
  const reader: GrantOverviewReader = {
    loadTypes: async () => {
      calls.push("types");
      return [
        { id: "type-a", name: "Compassionate Leave" },
        { id: "type-b", name: "Training" },
      ];
    },
    loadApproved: async (typeIds) => {
      calls.push(`approved:${typeIds.join(",")}`);
      return [
        { leave_type_id: "type-a", days: 4 },
        { leave_type_id: "type-b", days: 2 },
      ];
    },
    loadUsed: async (typeIds) => {
      calls.push(`used:${typeIds.join(",")}`);
      return [{ leave_type_id: "type-a", days: 1 }];
    },
    loadPending: async (typeIds) => {
      calls.push(`pending:${typeIds.join(",")}`);
      return [{ leave_type_id: "type-b", days: 3 }];
    },
  };

  await expect(loadGrantDrivenOverview(reader)).resolves.toEqual([
    {
      leaveTypeId: "type-a",
      leaveTypeName: "Compassionate Leave",
      granted: 4,
      used: 1,
      available: 3,
      pending: 0,
    },
    {
      leaveTypeId: "type-b",
      leaveTypeName: "Training",
      granted: 2,
      used: 0,
      available: 2,
      pending: 3,
    },
  ]);
  expect(calls).toEqual([
    "types",
    "approved:type-a,type-b",
    "used:type-a,type-b",
    "pending:type-a,type-b",
  ]);
});

test("does not query amount tables when no configured type exists", async () => {
  let amountCalls = 0;
  const reader: GrantOverviewReader = {
    loadTypes: async () => [],
    loadApproved: async () => { amountCalls += 1; return []; },
    loadUsed: async () => { amountCalls += 1; return []; },
    loadPending: async () => { amountCalls += 1; return []; },
  };

  await expect(loadGrantDrivenOverview(reader)).resolves.toEqual([]);
  expect(amountCalls).toBe(0);
});
```

Also add a source contract that reads `app/(dashboard)/page.tsx` and `app/(dashboard)/leave/page.tsx` and asserts the `getGrantDrivenOverview(...)` promise is part of the same `Promise.all` as balances/requests/holidays rather than awaited afterward.

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/phase3-query-dedup.spec.ts
```

Expected: FAIL because `GrantOverviewReader` and `loadGrantDrivenOverview` do not exist and the two pages still await the overview after their first query wave.

- [ ] **Step 4: Implement the reader contract and pure aggregation**

Create pure `lib/grant-overview.ts` with:

```ts
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";

type GrantAmountRow = { leave_type_id: string; days: number };
type GrantTypeRow = { id: string; name: string };

export interface GrantDrivenOverviewEntry {
  leaveTypeId: string;
  leaveTypeName: string;
  granted: number;
  used: number;
  available: number;
  pending: number;
}

export interface GrantOverviewReader {
  loadTypes(): Promise<GrantTypeRow[]>;
  loadApproved(typeIds: string[]): Promise<GrantAmountRow[]>;
  loadUsed(typeIds: string[]): Promise<GrantAmountRow[]>;
  loadPending(typeIds: string[]): Promise<GrantAmountRow[]>;
}

function totalsByType(rows: GrantAmountRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(
      row.leave_type_id,
      (totals.get(row.leave_type_id) ?? 0) + Number(row.days)
    );
  }
  return totals;
}

export async function loadGrantDrivenOverview(
  reader: GrantOverviewReader
): Promise<GrantDrivenOverviewEntry[]> {
  const types = (await reader.loadTypes()).filter((type) =>
    (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(type.name)
  );
  if (types.length === 0) return [];

  const typeIds = types.map((type) => type.id);
  const [approvedRows, usedRows, pendingRows] = await Promise.all([
    reader.loadApproved(typeIds),
    reader.loadUsed(typeIds),
    reader.loadPending(typeIds),
  ]);
  const approved = totalsByType(approvedRows);
  const used = totalsByType(usedRows);
  const pending = totalsByType(pendingRows);

  return types
    .map((type) => {
      const granted = approved.get(type.id) ?? 0;
      const consumed = used.get(type.id) ?? 0;
      const waiting = pending.get(type.id) ?? 0;
      return {
        leaveTypeId: type.id,
        leaveTypeName: type.name,
        granted,
        used: consumed,
        available: Math.max(granted - consumed, 0),
        pending: waiting,
      };
    })
    .filter((entry) =>
      entry.granted > 0 || entry.used > 0 || entry.pending > 0
    );
}
```

Move the existing `GrantDrivenOverviewEntry` definition out of `lib/grants.ts`
to this module and import the type back into `lib/grants.ts`. Do not add
`server-only` to the pure aggregation module; tests import it directly and it
contains no client capability, credentials, or database access.

- [ ] **Step 5: Implement the Supabase-backed batched reader**

Import `PostgrestResponse`, `GrantOverviewReader`, and
`loadGrantDrivenOverview` into server-only `lib/grants.ts`, then create the
reader inside `getGrantDrivenOverview`. Preserve the existing date semantics
exactly: approved grants use `approved_at`, used requests use `start_date`, and
pending grants remain unbounded by year.

```ts
export async function getGrantDrivenOverview(
  supabase: SupabaseClient,
  employeeId: string,
  year: number
): Promise<GrantDrivenOverviewEntry[]> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31T23:59:59`;

  const queryRows = async <T>(
    promise: PromiseLike<PostgrestResponse<T>>
  ): Promise<T[]> => {
    const result = await promise;
    if (result.error) throw result.error;
    return result.data ?? [];
  };

  return loadGrantDrivenOverview({
    loadTypes: () => queryRows(
      supabase.from("leave_types").select("id, name").in("name", [...GRANT_DRIVEN_LEAVE_TYPES])
    ),
    loadApproved: (typeIds) => queryRows(
      supabase.from("leave_grants").select("leave_type_id, days")
        .eq("employee_id", employeeId).in("leave_type_id", typeIds)
        .eq("status", "approved").gte("approved_at", yearStart).lte("approved_at", yearEnd)
    ),
    loadUsed: (typeIds) => queryRows(
      supabase.from("leave_requests").select("leave_type_id, days")
        .eq("employee_id", employeeId).in("leave_type_id", typeIds)
        .eq("status", "approved").gte("start_date", yearStart).lte("start_date", yearEnd)
    ),
    loadPending: (typeIds) => queryRows(
      supabase.from("leave_grants").select("leave_type_id, days")
        .eq("employee_id", employeeId).in("leave_type_id", typeIds)
        .eq("status", "pending")
    ),
  });
}
```

Keep `getGrantDrivenAvailability` unchanged because `createLeaveRequest` uses it for the single selected type.

- [ ] **Step 6: Start overview reads in the pages' first query wave**

In both employee dashboard and leave pages, include:

```ts
actor.employee
  ? getGrantDrivenOverview(db, actor.employee.id, year)
  : Promise.resolve([])
```

as another element of the existing `Promise.all`. Remove the later standalone `await getGrantDrivenOverview(...)`. Do not change the admin dashboard branch.

- [ ] **Step 7: Verify Task 1**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/phase3-query-dedup.spec.ts
npx playwright test --config=playwright.unit.config.ts
npx tsc --noEmit
npx eslint lib/grants.ts 'app/(dashboard)/page.tsx' 'app/(dashboard)/leave/page.tsx' tests/phase3-query-dedup.spec.ts playwright.unit.config.ts
git diff --check
```

Expected: all commands exit 0; the complete unit suite now includes the new Phase 3 tests.

- [ ] **Step 8: Commit Task 1**

```bash
git add playwright.unit.config.ts tests/phase3-query-dedup.spec.ts lib/grant-overview.ts lib/grants.ts 'app/(dashboard)/page.tsx' 'app/(dashboard)/leave/page.tsx'
git commit -m "perf(grants): batch overview queries"
```

---

### Task 2: Deduplicate and parallelize approvals reads

**Files:**
- Create: `lib/dal/approvals.ts`
- Modify: `app/(dashboard)/approvals/page.tsx:1-266`
- Modify: `tests/phase3-query-dedup.spec.ts`

**Interfaces:**
- Consumes: `Actor`, `SupabaseClient`, `canViewApprovals`, `GRANT_DRIVEN_LEAVE_TYPES`, and the existing component prop shapes.
- Produces: `ApprovalsPageData`, `ApprovalsReader`, `composeApprovalsPageData(actor, reader): Promise<ApprovalsPageData | null>`, and `loadApprovalsPageData(actor, db): Promise<ApprovalsPageData | null>`.

- [ ] **Step 1: Write failing authorization and reuse tests**

Add tests using an `ApprovalsReader` fake. The reader records calls and exposes these exact methods:

```ts
export interface ApprovalsReader {
  loadManagerScope(managerEmployeeId: string): Promise<ManagerScope>;
  loadPendingRequests(scopedEmployeeIds: string[] | null): Promise<ApprovalRequestView[]>;
  loadAdminPendingGrants(): Promise<PendingGrantView[]>;
  loadManagerOwnGrants(managerEmployeeId: string): Promise<MyGrantView[]>;
  loadActiveEmployees(): Promise<EmployeeOption[]>;
}
```

Define stable test actors and the recording reader:

```ts
import type { Actor } from "../lib/auth/session";
import {
  composeApprovalsPageData,
  type ApprovalsReader,
  type ManagerScope,
} from "../lib/dal/approvals";

const employeeActor: Actor = {
  authUserId: "auth-employee",
  userId: "user-employee",
  email: "employee@company.com",
  role: "employee",
  employee: { id: "employee-self", firstName: "E", lastName: "Self" },
};

const managerActor: Actor = {
  authUserId: "auth-manager",
  userId: "user-manager",
  email: "manager@company.com",
  role: "manager",
  employee: { id: "manager-employee", firstName: "M", lastName: "One" },
};

const adminActor: Actor = {
  authUserId: "auth-admin",
  userId: "user-admin",
  email: "admin@company.com",
  role: "admin",
  employee: null,
};

function recordingReader(
  calls: string[],
  options: { managerScope?: ManagerScope } = {}
): ApprovalsReader {
  return {
    loadManagerScope: async () => {
      calls.push("manager-scope");
      return options.managerScope ?? { scopedEmployeeIds: [], dialogEmployees: [] };
    },
    loadPendingRequests: async (scope) => {
      calls.push(`requests:${scope?.join(",") ?? "all"}`);
      return [];
    },
    loadAdminPendingGrants: async () => {
      calls.push("admin-grants");
      return [];
    },
    loadManagerOwnGrants: async () => {
      calls.push("manager-grants");
      return [];
    },
    loadActiveEmployees: async () => {
      calls.push("active-employees");
      return [];
    },
  };
}
```

Cover:

```ts
test("rejects an employee before starting an approvals query", async () => {
  const calls: string[] = [];
  const result = await composeApprovalsPageData(employeeActor, recordingReader(calls));
  expect(result).toBeNull();
  expect(calls).toEqual([]);
});

test("loads manager scope once and passes only authorized IDs to requests", async () => {
  const calls: string[] = [];
  const reader = recordingReader(calls, {
    managerScope: {
      scopedEmployeeIds: ["employee-1"],
      dialogEmployees: [{ id: "employee-1", first_name: "E", last_name: "One", employee_code: "E001" }],
    },
  });
  const result = await composeApprovalsPageData(managerActor, reader);
  expect(calls.filter((call) => call === "manager-scope")).toHaveLength(1);
  expect(calls).toContain("requests:employee-1");
  expect(result?.directReportsForDialog).toHaveLength(1);
});
```

Add this deferred-promise test proving request and manager-grant branches both
start after the single scope promise resolves and before either branch is
released:

```ts
test("starts independent manager approval branches together after scope", async () => {
  const started: string[] = [];
  let releaseRequests!: () => void;
  let releaseGrants!: () => void;
  const requestsGate = new Promise<void>((resolve) => { releaseRequests = resolve; });
  const grantsGate = new Promise<void>((resolve) => { releaseGrants = resolve; });
  const reader = recordingReader(started, {
    managerScope: {
      scopedEmployeeIds: ["employee-1"],
      dialogEmployees: [],
    },
  });
  reader.loadPendingRequests = async () => {
    started.push("requests-started");
    await requestsGate;
    return [];
  };
  reader.loadManagerOwnGrants = async () => {
    started.push("grants-started");
    await grantsGate;
    return [];
  };

  const resultPromise = composeApprovalsPageData(managerActor, reader);
  await Promise.resolve();
  await Promise.resolve();
  expect(started).toEqual([
    "manager-scope",
    "requests-started",
    "grants-started",
  ]);
  releaseRequests();
  releaseGrants();
  await expect(resultPromise).resolves.toBeTruthy();
});

test("uses organization scope and active employees only for admin", async () => {
  const calls: string[] = [];
  await composeApprovalsPageData(adminActor, recordingReader(calls));
  expect(calls).toContain("requests:all");
  expect(calls).toContain("active-employees");
  expect(calls).not.toContain("manager-scope");
});
```

- [ ] **Step 2: Run Task 2 tests and confirm RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/phase3-query-dedup.spec.ts -g "approvals|manager scope|employee before"
```

Expected: FAIL because `lib/dal/approvals.ts` and its interfaces do not exist.

- [ ] **Step 3: Create the server-only approvals contract and composer**

Start `lib/dal/approvals.ts` with:

```ts
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { canViewApprovals } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/session";

export type EmployeeOption = {
  id: string;
  first_name: string;
  last_name: string;
  employee_code: string;
};

export type ManagerScope = {
  scopedEmployeeIds: string[];
  dialogEmployees: EmployeeOption[];
};

export type ApprovalRequestView = {
  id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  duration_type: string;
  reason: string;
  status: string;
  created_at: string;
  employees: {
    id: string;
    first_name: string;
    last_name: string;
    employee_code: string;
    department: string;
    manager_id: string;
  };
  leave_types: { name: string } | null;
};

export type PendingGrantView = {
  id: string;
  leave_type_name: string;
  days: number;
  reason: string;
  created_at: string;
  employee: {
    first_name: string;
    last_name: string;
    employee_code: string;
    department: string;
  };
  created_by_employee: { first_name: string; last_name: string };
};

export type MyGrantView = {
  id: string;
  leave_type_name: string;
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
};

export interface ApprovalsPageData {
  requestsForList: ApprovalRequestView[];
  pendingGrants: PendingGrantView[];
  myGrants: MyGrantView[];
  directReportsForDialog: EmployeeOption[];
}

export interface ApprovalsReader {
  loadManagerScope(managerEmployeeId: string): Promise<ManagerScope>;
  loadPendingRequests(scopedEmployeeIds: string[] | null): Promise<ApprovalRequestView[]>;
  loadAdminPendingGrants(): Promise<PendingGrantView[]>;
  loadManagerOwnGrants(managerEmployeeId: string): Promise<MyGrantView[]>;
  loadActiveEmployees(): Promise<EmployeeOption[]>;
}

export async function composeApprovalsPageData(
  actor: Actor,
  reader: ApprovalsReader
): Promise<ApprovalsPageData | null> {
  if (!canViewApprovals(actor.role)) return null;
  if (actor.role === "manager" && !actor.employee) return null;

  const managerScope = actor.role === "manager"
    ? await reader.loadManagerScope(actor.employee!.id)
    : null;
  const requestScope = managerScope?.scopedEmployeeIds ?? null;

  const [requestsForList, grantData, directReportsForDialog] = await Promise.all([
    requestScope?.length === 0
      ? Promise.resolve([])
      : reader.loadPendingRequests(requestScope),
    actor.role === "admin"
      ? reader.loadAdminPendingGrants().then((pendingGrants) => ({ pendingGrants, myGrants: [] }))
      : reader.loadManagerOwnGrants(actor.employee!.id).then((myGrants) => ({ pendingGrants: [], myGrants })),
    actor.role === "admin"
      ? reader.loadActiveEmployees()
      : Promise.resolve(managerScope!.dialogEmployees),
  ]);

  return { requestsForList, ...grantData, directReportsForDialog };
}
```

Do not use `redirect()` inside the DAL. Returning `null` gives the page a framework-native redirect decision while guaranteeing zero reader calls for unauthorized actors.

- [ ] **Step 4: Implement the Supabase reader**

Add `createApprovalsReader(db: SupabaseClient): ApprovalsReader`. Move the existing page queries and transformations into its five methods, preserving component data shapes. Required changes while moving:

- `loadManagerScope` selects `id,user_id,first_name,last_name,employee_code,status` once, loads those users' roles once, derives non-manager `scopedEmployeeIds`, and derives active `dialogEmployees` from the same employee rows.
- `loadPendingRequests` applies `.in("employee_id", scopedEmployeeIds)` whenever the argument is an array; `null` is the admin-only organization scope. It retains batched employee/type hydration and the following user hydration.
- `loadAdminPendingGrants` and `loadManagerOwnGrants` retain their role-specific filters and batched employee hydration.
- `loadActiveEmployees` retains the admin-only `.eq("status", "active")` query.
- Every Supabase result is checked and its `error` thrown before transformation.

Then add:

```ts
export function loadApprovalsPageData(actor: Actor, db: SupabaseClient) {
  return composeApprovalsPageData(actor, createApprovalsReader(db));
}
```

- [ ] **Step 5: Reduce the page to authorization-aware rendering**

Replace page-local query orchestration with:

```ts
const { actor, db } = await requireRequestContext();
const data = await loadApprovalsPageData(actor, db);
if (!data) redirect("/");

const {
  requestsForList,
  pendingGrants,
  myGrants,
  directReportsForDialog,
} = data;
```

Keep the existing JSX and role-conditional sections unchanged. Remove page imports used only by the moved query code.

- [ ] **Step 6: Verify Task 2**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/phase3-query-dedup.spec.ts
npx playwright test --config=playwright.unit.config.ts
npx tsc --noEmit
npx eslint lib/dal/approvals.ts 'app/(dashboard)/approvals/page.tsx' tests/phase3-query-dedup.spec.ts
git diff --check
```

Expected: all commands exit 0. Confirm the manager test observes one scope load and never observes a `requests:*` call with null/organization scope.

- [ ] **Step 7: Commit Task 2**

```bash
git add lib/dal/approvals.ts 'app/(dashboard)/approvals/page.tsx' tests/phase3-query-dedup.spec.ts
git commit -m "perf(approvals): deduplicate scoped reads"
```

---

### Task 3: Close error-handling gaps and record query evidence

**Files:**
- Modify: `app/(dashboard)/calendar/page.tsx:12-55`
- Modify: `tests/phase3-query-dedup.spec.ts`
- Create: `docs/performance/phase-3-query-deduplication.md`

**Interfaces:**
- Consumes: Task 1's four-query overview and Task 2's `loadApprovalsPageData` read model.
- Produces: calendar error propagation, static before/after query-wave evidence, and the final Phase 3 verification record. No new runtime API is introduced.

- [ ] **Step 1: Write failing calendar error contracts**

Add source contracts that verify the calendar page checks all three uncached Supabase results:

```ts
test("calendar propagates request and hydration failures", () => {
  const source = readFileSync("app/(dashboard)/calendar/page.tsx", "utf8");
  expect(source).toContain("if (rawLeaveError) throw rawLeaveError");
  expect(source).toContain("if (employeesRes.error) throw employeesRes.error");
  expect(source).toContain("if (leaveTypesRes.error) throw leaveTypesRes.error");
});
```

Also add final source-boundary checks asserting:

- `lib/dal/approvals.ts` begins with `import "server-only"`;
- neither `lib/dal/approvals.ts` nor `lib/grants.ts` contains `unstable_cache` or `"use cache"`;
- protected pages still import `requireRequestContext` directly and contain no `/api/` self-fetch.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts tests/phase3-query-dedup.spec.ts -g "calendar|server-only|self-fetch"
```

Expected: FAIL because the current calendar page ignores the three Supabase errors.

- [ ] **Step 3: Propagate calendar failures without changing query shape**

Change the first result binding and add checks:

```ts
const { data: rawLeave, error: rawLeaveError } = await db
  .from("leave_requests")
  // existing filters unchanged
if (rawLeaveError) throw rawLeaveError;

const [holidays, employeesRes, leaveTypesRes] = await Promise.all([
  // existing three branches unchanged
]);
if (employeesRes.error) throw employeesRes.error;
if (leaveTypesRes.error) throw leaveTypesRes.error;
```

Do not create a calendar DAL solely to wrap this one already-correct dependency chain.

- [ ] **Step 4: Write the query evidence report**

Create `docs/performance/phase-3-query-deduplication.md` with:

```markdown
# Phase 3 query-deduplication evidence

## Environment

- Next.js: 16.3.0
- React: 19.2.8
- Measurement status: code-derived static counts unless a migrated approved Supabase target was available

## Query-path comparison

| Path | Before | After | Main change |
| --- | ---: | ---: | --- |
| Employee dashboard, cold holiday cache | up to 35 queries / 3 data waves | up to 8 queries / 2 data waves | Batch overview and start it with page reads |
| Leave page, cold shared caches | up to 35 queries / 3 data waves | up to 8 queries / 2 data waves | Batch overview and start it with page reads |
| Manager approvals, populated branches | 10 queries / 9 data waves | 9 queries / 5 data waves | Reuse manager scope and overlap independent branches |
| Admin approvals, populated branches | 8 queries / 7 data waves | 8 queries / 3 data waves | Overlap independent branches |
| Calendar | up to 4 queries / 2 data waves | up to 4 queries / 2 data waves | Preserve shape; propagate failures |

Actor verification remains one Auth claims read plus up to two actor database reads per render. It is request-scoped and is not cached across users.

## Verification

Record exact test, TypeScript, ESLint, build, and optional production-request results here. Do not claim latency improvement when live measurement is unavailable.
```

Validate every count against the final source and update the table if
implementation evidence differs. Include a short dependency-wave trace for all
five rows. Explain cache-hit versus cache-miss differences for the pre-existing
holiday and leave-type caches; do not count a cache hit as a database query.

- [ ] **Step 5: Run final verification**

Run:

```bash
npx playwright test --config=playwright.unit.config.ts
npx tsc --noEmit
npx eslint lib/grants.ts lib/dal/approvals.ts 'app/(dashboard)/page.tsx' 'app/(dashboard)/leave/page.tsx' 'app/(dashboard)/approvals/page.tsx' 'app/(dashboard)/calendar/page.tsx' tests/phase3-query-dedup.spec.ts playwright.unit.config.ts
npm run build -- --webpack
git diff --check main...HEAD
```

Expected: unit/contract tests, TypeScript, focused ESLint, webpack production build, and whitespace check all exit 0.

Attempt full repository lint separately:

```bash
npm run lint
```

If it still fails only at the unchanged `components/features/grants/my-grants-list.tsx` apostrophe and unchanged employee-dialog warning recorded in Phase 2, report those as pre-existing rather than changing unrelated files. Any new failure in changed files blocks completion.

When an approved, migrated Supabase environment and `DEMO_AUTH_PASSWORD` are available, run the existing production-mode browser suite and record request/query timing. Otherwise write `Blocked: no approved migrated measurement target` in the evidence report and label all latency conclusions static.

- [ ] **Step 6: Commit Task 3**

```bash
git add 'app/(dashboard)/calendar/page.tsx' tests/phase3-query-dedup.spec.ts docs/performance/phase-3-query-deduplication.md
git commit -m "test(perf): record query dedup evidence"
```

---

### Final review and GitOps gate

- [ ] Run `superpowers:requesting-code-review` over `main...HEAD`, focusing on manager database scoping, service-role boundaries, error propagation, query-count claims, and accidental cross-request caching.
- [ ] Address every validated Critical, Important, and Minor finding with focused tests and review-fix commits.
- [ ] Run `superpowers:verification-before-completion` and repeat the complete Task 3 verification commands on the final HEAD.
- [ ] Use `superpowers:finishing-a-development-branch`; push `refactor/phase-3-query-dedup` and create one Phase 3 PR against `main` only after final review passes. Do not merge automatically.
