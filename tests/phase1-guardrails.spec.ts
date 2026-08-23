import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveActor } from "../lib/auth/actor";
import { canViewApprovals } from "../lib/auth/permissions";
import * as validations from "../lib/validations";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

type Schema = {
  safeParse: (input: unknown) => { success: boolean };
};

function schema(name: string): Schema {
  const candidate = (validations as unknown as Record<string, unknown>)[name];
  expect(candidate, `${name} must be exported`).toBeDefined();
  return candidate as Schema;
}

test.describe("Phase 1 server entry-point guardrails", () => {
  test("only managers and admins can access approvals", () => {
    expect(canViewApprovals("employee")).toBe(false);
    expect(canViewApprovals("manager")).toBe(true);
    expect(canViewApprovals("admin")).toBe(true);
  });

  test("actor lookup propagates database failures instead of treating them as logout", async () => {
    const databaseError = new Error("database unavailable");
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: databaseError }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(
      resolveActor("auth-user-id", "employee@example.com", supabase)
    ).rejects.toThrow("database unavailable");
  });

  test("leave approval input requires a UUID and known decision", () => {
    const subject = schema("approveLeaveRequestActionSchema");

    expect(subject.safeParse({ requestId: "not-an-id", action: "approved" }).success).toBe(false);
    expect(subject.safeParse({ requestId: VALID_UUID, action: "maybe" }).success).toBe(false);
    expect(subject.safeParse({ requestId: VALID_UUID, action: "rejected" }).success).toBe(true);
  });

  test("employee status updates reject malformed IDs and enums", () => {
    const subject = schema("updateEmployeeStatusActionSchema");

    expect(subject.safeParse({ employeeId: "1", status: "active" }).success).toBe(false);
    expect(subject.safeParse({ employeeId: VALID_UUID, status: "deleted" }).success).toBe(false);
    expect(subject.safeParse({ employeeId: VALID_UUID, status: "inactive" }).success).toBe(true);
  });

  test("leave-type day updates stay within the PostgreSQL integer range", () => {
    const subject = schema("updateLeaveTypeDaysActionSchema");

    for (const annualDays of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
      expect(subject.safeParse({ leaveTypeId: VALID_UUID, annualDays }).success).toBe(false);
    }
    expect(subject.safeParse({ leaveTypeId: VALID_UUID, annualDays: 0 }).success).toBe(true);
    expect(subject.safeParse({ leaveTypeId: VALID_UUID, annualDays: 2_147_483_647 }).success).toBe(true);
  });

  test("grant decisions validate identifiers, decisions, and reason length", () => {
    const subject = schema("approveLeaveGrantActionSchema");

    expect(subject.safeParse({ grantId: "bad", decision: "approved" }).success).toBe(false);
    expect(subject.safeParse({ grantId: VALID_UUID, decision: "pending" }).success).toBe(false);
    expect(
      subject.safeParse({ grantId: VALID_UUID, decision: "rejected", rejectionReason: "x".repeat(501) }).success
    ).toBe(false);
    expect(subject.safeParse({ grantId: VALID_UUID, decision: "approved" }).success).toBe(true);
  });

  test("generic resource IDs must be UUIDs", () => {
    const subject = schema("resourceIdSchema");

    expect(subject.safeParse("42").success).toBe(false);
    expect(subject.safeParse(VALID_UUID).success).toBe(true);
  });

  test("mock login accepts only a bounded email JSON body", () => {
    const subject = schema("mockLoginRequestSchema");

    expect(subject.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(subject.safeParse({ email: `${"x".repeat(250)}@example.com` }).success).toBe(false);
    expect(subject.safeParse({ email: "employee@example.com", role: "admin" }).success).toBe(false);
    expect(subject.safeParse({ email: "employee@example.com" }).success).toBe(true);
  });

  test("unexpected action failures do not expose infrastructure details", async () => {
    const modulePath = "../lib/action-errors";
    const actionErrors = await import(modulePath);
    const originalConsoleError = console.error;
    console.error = () => undefined;
    let result: { ok: boolean; error: string };
    try {
      result = actionErrors.actionFailure(
        new Error("postgresql://service-role-secret@internal/db"),
        "Failed to update request"
      );
    } finally {
      console.error = originalConsoleError;
    }

    expect(result).toEqual({ ok: false, error: "Failed to update request" });
    expect(result.error).not.toContain("service-role-secret");
  });
});
