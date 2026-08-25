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

test("server-only data boundaries do not add cross-request caching", () => {
  const approvalsDal = readFileSync("lib/dal/approvals.ts", "utf8");
  const grants = readFileSync("lib/grants.ts", "utf8");

  expect(approvalsDal.startsWith('import "server-only";')).toBeTruthy();
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
