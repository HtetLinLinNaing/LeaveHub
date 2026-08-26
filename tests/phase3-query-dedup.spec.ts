import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Actor } from "../lib/auth/session";
import {
  composeApprovalsPageData,
  type ApprovalsReader,
  type ManagerScope,
} from "../lib/approvals-read-model";
import {
  loadGrantDrivenOverview,
  type GrantOverviewReader,
} from "../lib/grant-overview";
import { createGrantOverviewReader } from "../lib/grant-overview-supabase";
import { createApprovalsQueries } from "../lib/approvals-supabase-queries";
import { createSharedCacheReader } from "../lib/cache-reader";
import {
  createRecordingSupabase,
  failedResponse,
  hasOperation,
  successfulResponse,
  type RecordedQuery,
} from "./helpers/recording-supabase";

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

test("loads grant overview through four reader methods regardless of type count", async () => {
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
    loadApproved: async () => {
      amountCalls += 1;
      return [];
    },
    loadUsed: async () => {
      amountCalls += 1;
      return [];
    },
    loadPending: async () => {
      amountCalls += 1;
      return [];
    },
  };

  await expect(loadGrantDrivenOverview(reader)).resolves.toEqual([]);
  expect(amountCalls).toBe(0);
});

test("grant adapter paginates complete totals and preserves every amount filter", async () => {
  const firstApprovedPage = Array.from({ length: 1000 }, (_, index) => ({
    id: `grant-${index}`,
    leave_type_id: "type-a",
    days: 1,
  }));
  const { db, queries } = createRecordingSupabase((query) => {
    if (query.table === "leave_types") {
      return successfulResponse([
        { id: "type-a", name: "Compassionate Leave" },
      ]);
    }

    if (
      query.table === "leave_grants" &&
      hasOperation(query, "eq", "status", "approved")
    ) {
      return successfulResponse(
        hasOperation(query, "range", 0, 999)
          ? firstApprovedPage
          : [{ id: "grant-1000", leave_type_id: "type-a", days: 7 }]
      );
    }

    return successfulResponse([]);
  });

  await expect(
    loadGrantDrivenOverview(
      createGrantOverviewReader(db, "employee-1", 2026)
    )
  ).resolves.toEqual([
    {
      leaveTypeId: "type-a",
      leaveTypeName: "Compassionate Leave",
      granted: 1007,
      used: 0,
      available: 1007,
      pending: 0,
    },
  ]);

  const approvedQueries = queries.filter(
    (query) =>
      query.table === "leave_grants" &&
      hasOperation(query, "eq", "status", "approved")
  );
  expect(approvedQueries).toHaveLength(2);
  expect(approvedQueries.map(queryRange)).toEqual([
    [0, 999],
    [1000, 1999],
  ]);
  for (const query of approvedQueries) {
    expect(hasOperation(query, "eq", "employee_id", "employee-1")).toBeTruthy();
    expect(hasOperation(query, "in", "leave_type_id", ["type-a"])).toBeTruthy();
    expect(hasOperation(query, "gte", "approved_at", "2026-01-01")).toBeTruthy();
    expect(
      hasOperation(query, "lte", "approved_at", "2026-12-31T23:59:59")
    ).toBeTruthy();
    expect(hasOperation(query, "order", "id", { ascending: true })).toBeTruthy();
  }

  const usedQuery = queries.find((query) => query.table === "leave_requests");
  expect(usedQuery).toBeTruthy();
  expect(hasOperation(usedQuery!, "eq", "employee_id", "employee-1")).toBeTruthy();
  expect(hasOperation(usedQuery!, "in", "leave_type_id", ["type-a"])).toBeTruthy();
  expect(hasOperation(usedQuery!, "eq", "status", "approved")).toBeTruthy();
  expect(hasOperation(usedQuery!, "gte", "start_date", "2026-01-01")).toBeTruthy();
  expect(
    hasOperation(usedQuery!, "lte", "start_date", "2026-12-31T23:59:59")
  ).toBeTruthy();

  const pendingQuery = queries.find(
    (query) =>
      query.table === "leave_grants" &&
      hasOperation(query, "eq", "status", "pending")
  );
  expect(pendingQuery).toBeTruthy();
  expect(hasOperation(pendingQuery!, "eq", "employee_id", "employee-1")).toBeTruthy();
  expect(hasOperation(pendingQuery!, "in", "leave_type_id", ["type-a"])).toBeTruthy();
  expect(pendingQuery!.operations.some(({ method }) => method === "gte")).toBeFalsy();
  expect(pendingQuery!.operations.some(({ method }) => method === "lte")).toBeFalsy();
});

test("grant adapter propagates a failure after a full first page", async () => {
  const pageFailure = new Error("approved grants page 2 failed");
  const fullPage = Array.from({ length: 1000 }, (_, index) => ({
    id: `grant-${index}`,
    leave_type_id: "type-a",
    days: 1,
  }));
  const { db } = createRecordingSupabase((query) => {
    if (query.table === "leave_types") {
      return successfulResponse([
        { id: "type-a", name: "Compassionate Leave" },
      ]);
    }
    if (
      query.table === "leave_grants" &&
      hasOperation(query, "eq", "status", "approved")
    ) {
      return hasOperation(query, "range", 0, 999)
        ? successfulResponse(fullPage)
        : failedResponse(pageFailure);
    }
    return successfulResponse([]);
  });

  await expect(
    loadGrantDrivenOverview(
      createGrantOverviewReader(db, "employee-1", 2026)
    )
  ).rejects.toBe(pageFailure);
});

test("approvals query seam applies terminal scope filters and batches hydration IDs", async () => {
  const { db, queries } = createRecordingSupabase((query) => {
    if (
      query.table === "employees" &&
      hasOperation(query, "eq", "manager_id", "manager-employee")
    ) {
      return successfulResponse([
        {
          id: "employee-1",
          user_id: "user-1",
          first_name: "E",
          last_name: "One",
          employee_code: "E001",
          status: "active",
        },
        {
          id: "manager-2",
          user_id: "user-2",
          first_name: "M",
          last_name: "Two",
          employee_code: "M002",
          status: "active",
        },
      ]);
    }
    if (query.table === "users" && hasOperation(query, "in", "id", ["user-1", "user-2"])) {
      return successfulResponse([
        { id: "user-1", role: "employee" },
        { id: "user-2", role: "manager" },
      ]);
    }
    if (query.table === "leave_requests") {
      return successfulResponse([
        {
          id: "request-1",
          employee_id: "employee-1",
          leave_type_id: "type-a",
          start_date: "2026-09-01",
          end_date: "2026-09-01",
          days: 1,
          duration_type: "full_day",
          reason: "Rest",
          status: "pending",
          created_at: "2026-08-26T00:00:00Z",
        },
      ]);
    }
    if (query.table === "employees") {
      return successfulResponse([
        {
          id: "employee-1",
          user_id: "user-1",
          first_name: "E",
          last_name: "One",
          employee_code: "E001",
          department: "Engineering",
          manager_id: "manager-employee",
        },
      ]);
    }
    if (query.table === "leave_types") {
      return successfulResponse([{ id: "type-a", name: "Annual Leave" }]);
    }
    if (query.table === "users") {
      return successfulResponse([{ id: "user-1", role: "employee" }]);
    }
    throw new Error(`Unexpected query for ${query.table}`);
  });
  const adapter = createApprovalsQueries(db);

  await expect(adapter.loadDirectReports("manager-employee")).resolves.toHaveLength(2);
  await expect(adapter.loadUsers(["user-1", "user-2"])).resolves.toHaveLength(2);
  await expect(adapter.loadPendingRequestRows(["employee-1"])).resolves.toHaveLength(1);
  await expect(adapter.loadRequestEmployees(["employee-1"])).resolves.toHaveLength(1);
  await expect(adapter.loadLeaveTypesByIds(["type-a"])).resolves.toHaveLength(1);
  await expect(adapter.loadUsers(["user-1"])).resolves.toHaveLength(1);

  const managerQuery = queries.find((query) =>
    hasOperation(query, "eq", "manager_id", "manager-employee")
  );
  expect(managerQuery).toBeTruthy();
  expect(
    hasOperation(
      managerQuery!,
      "select",
      "id,user_id,first_name,last_name,employee_code,status"
    )
  ).toBeTruthy();

  const requestQuery = queries.find((query) => query.table === "leave_requests");
  expect(requestQuery).toBeTruthy();
  expect(hasOperation(requestQuery!, "eq", "status", "pending")).toBeTruthy();
  expect(
    hasOperation(requestQuery!, "in", "employee_id", ["employee-1"])
  ).toBeTruthy();
  expect(
    hasOperation(requestQuery!, "order", "created_at", { ascending: true })
  ).toBeTruthy();

  const employeeHydration = queries.find(
    (query) =>
      query.table === "employees" &&
      hasOperation(query, "in", "id", ["employee-1"])
  );
  const typeHydration = queries.find(
    (query) =>
      query.table === "leave_types" &&
      hasOperation(query, "in", "id", ["type-a"])
  );
  const userHydration = queries.find(
    (query) =>
      query.table === "users" &&
      hasOperation(query, "in", "id", ["user-1"])
  );
  expect(employeeHydration).toBeTruthy();
  expect(typeHydration).toBeTruthy();
  expect(userHydration).toBeTruthy();
});

test("approvals query seam propagates hydration failures", async () => {
  const hydrationFailure = new Error("employee hydration failed");
  const { db } = createRecordingSupabase((query) => {
    if (query.table === "employees") return failedResponse(hydrationFailure);
    throw new Error(`Unexpected query for ${query.table}`);
  });

  await expect(
    createApprovalsQueries(db).loadRequestEmployees(["employee-1"])
  ).rejects.toBe(hydrationFailure);
});

test("every shared cache reader rejects database failures", async () => {
  const cacheFailure = new Error("cache source failed");
  const { db } = createRecordingSupabase(() => failedResponse(cacheFailure));
  const reader = createSharedCacheReader(db);

  await expect(reader.loadLeaveTypes()).rejects.toBe(cacheFailure);
  await expect(reader.loadHolidays()).rejects.toBe(cacheFailure);
  await expect(reader.loadHolidaysFromDate("2026-08-26", 3)).rejects.toBe(
    cacheFailure
  );
  await expect(reader.loadYearHolidays(2026)).rejects.toBe(cacheFailure);
});

function queryRange(query: RecordedQuery) {
  return query.operations.find(({ method }) => method === "range")?.args;
}

function expectOverviewInFirstQueryWave(path: string) {
  const source = readFileSync(path, "utf8");
  const firstQueryWaveStart = source.lastIndexOf("await Promise.all([");
  const firstQueryWaveEnd = source.indexOf("]);", firstQueryWaveStart);
  const firstQueryWave = source.slice(firstQueryWaveStart, firstQueryWaveEnd);

  expect(firstQueryWaveStart).toBeGreaterThan(-1);
  expect(firstQueryWave).toContain("getGrantDrivenOverview(db, actor.employee.id, year)");
  expect(source).not.toContain("? await getGrantDrivenOverview(db, actor.employee.id, year)");
}

test("starts grant overview with the dashboard query wave", () => {
  expectOverviewInFirstQueryWave("app/(dashboard)/page.tsx");
});

test("starts grant overview with the leave query wave", () => {
  expectOverviewInFirstQueryWave("app/(dashboard)/leave/page.tsx");
});

test("calendar propagates request and hydration failures", () => {
  const source = readFileSync("app/(dashboard)/calendar/page.tsx", "utf8");
  expect(source).toContain("if (rawLeaveError) throw rawLeaveError");
  expect(source).toContain("if (employeesRes.error) throw employeesRes.error");
  expect(source).toContain("if (leaveTypesRes.error) throw leaveTypesRes.error");
});

test("dashboard and leave pages propagate every direct read failure", () => {
  const dashboard = readFileSync("app/(dashboard)/page.tsx", "utf8");
  const leave = readFileSync("app/(dashboard)/leave/page.tsx", "utf8");
  const employees = readFileSync("app/(dashboard)/employees/page.tsx", "utf8");

  for (const check of [
    "if (pendingResult.error) throw pendingResult.error",
    "if (approvedResult.error) throw approvedResult.error",
    "if (onLeaveResult.error) throw onLeaveResult.error",
    "if (balancesResult.error) throw balancesResult.error",
    "if (recentRequestsResult.error) throw recentRequestsResult.error",
  ]) {
    expect(dashboard).toContain(check);
  }
  expect(leave).toContain("if (balancesResult.error) throw balancesResult.error");
  expect(leave).toContain("if (requestsResult.error) throw requestsResult.error");
  expect(employees).toContain("if (error) throw error");
});

test("cache wrappers delegate to error-checking readers", () => {
  const source = readFileSync("lib/cache.ts", "utf8");
  for (const method of [
    "loadLeaveTypes",
    "loadHolidays",
    "loadHolidaysFromDate",
    "loadYearHolidays",
  ]) {
    expect(source).toContain(`.${method}(`);
  }
});

test("server-only data boundaries do not add cross-request caching", () => {
  const approvalsDal = readFileSync("lib/dal/approvals.ts", "utf8");
  const grants = readFileSync("lib/grants.ts", "utf8");

  expect(approvalsDal.startsWith('import "server-only";')).toBeTruthy();
  expect(approvalsDal).toContain("export function createApprovalsReader");
  expect(approvalsDal).toContain("createApprovalsQueries(db)");
  expect(approvalsDal).not.toContain("unstable_cache");
  expect(approvalsDal).not.toContain('"use cache"');
  expect(grants).not.toContain("unstable_cache");
  expect(grants).not.toContain('"use cache"');
});

test("protected pages use request context without API self-fetches", () => {
  const protectedPages = [
    "app/(dashboard)/page.tsx",
    "app/(dashboard)/leave/page.tsx",
    "app/(dashboard)/approvals/page.tsx",
    "app/(dashboard)/calendar/page.tsx",
  ];

  for (const path of protectedPages) {
    const source = readFileSync(path, "utf8");
    expect(source).toContain('import { requireRequestContext } from "@/lib/dal/request-context"');
    expect(source).not.toContain("/api/");
  }
});
