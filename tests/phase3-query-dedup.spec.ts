import { readFileSync } from "node:fs";
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
