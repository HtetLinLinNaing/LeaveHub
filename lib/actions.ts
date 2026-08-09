"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { updateTag } from "next/cache";
import { getSessionFromRequest, getCurrentEmployee, canApproveLeave, canManageEmployees } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { employeeSchema, leaveRequestSchema, holidaySchema, compassionateGrantSchema } from "@/lib/validations";
import { canProposeGrants, canManageGrants } from "@/lib/auth";
import { getCompassionateAvailability } from "@/lib/compassionate";
import type { Role } from "@/lib/types";

// ----- Tag-based revalidation (existing) -----

export async function revalidateHolidays() {
  updateTag("holidays");
}

export async function revalidateLeaveTypes() {
  updateTag("leave-types");
}

// ----- Helpers -----

async function requireSession() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  if (!session) throw new Error("Not authenticated");
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session.email);
  if (!user) throw new Error("Not authenticated");
  return { supabase, user, employee, role: user.role as Role };
}

// ----- Approve / reject a leave request -----

export interface ApprovalResult {
  ok: boolean;
  error?: string;
}

export async function approveLeaveRequest(
  requestId: string,
  action: "approved" | "rejected"
): Promise<ApprovalResult> {
  try {
    const { supabase, user, employee } = await requireSession();
    if (!canApproveLeave(user.role as Role)) {
      return { ok: false, error: "Not authorized" };
    }
    if (!employee) return { ok: false, error: "Approver record not found" };

    // Manager scope: only direct reports, and never another manager's self-request.
    // PostgREST nested joins silently return zero rows on this project, so
    // hydrate via separate queries in JS.
    if (user.role === "manager") {
      const { data: req } = await supabase
        .from("leave_requests")
        .select("id, employee_id")
        .eq("id", requestId)
        .single();
      if (!req) return { ok: false, error: "Not authorized for this request" };
      const { data: emp } = await supabase
        .from("employees")
        .select("manager_id, user_id")
        .eq("id", req.employee_id)
        .single();
      if (!emp || emp.manager_id !== employee.id) {
        return { ok: false, error: "Not authorized for this request" };
      }
      const { data: u } = await supabase
        .from("users")
        .select("role")
        .eq("id", emp.user_id)
        .single();
      if (u?.role === "manager") {
        return { ok: false, error: "Manager self-requests are handled by admin" };
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("leave_requests")
      .update({
        status: action,
        approved_by: employee.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("id, employee_id, leave_type_id, start_date, days")
      .single();

    if (updateError) throw updateError;
    if (!updated) return { ok: false, error: "Request not pending" };

    // If approved, decrement the requester's leave balance
    if (action === "approved") {
      const year = new Date(updated.start_date).getFullYear();
      const { data: balance } = await supabase
        .from("leave_balances")
        .select("id, used_days, remaining_days")
        .eq("employee_id", updated.employee_id)
        .eq("leave_type_id", updated.leave_type_id)
        .eq("year", year)
        .maybeSingle();

      if (balance) {
        const { error: balanceError } = await supabase
          .from("leave_balances")
          .update({
            used_days: balance.used_days + updated.days,
            remaining_days: balance.remaining_days - updated.days,
          })
          .eq("id", balance.id);
        if (balanceError) throw balanceError;
      }
    }

    revalidatePath("/approvals");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update request" };
  }
}

// ----- Create an employee (HR/admin) -----

export interface CreateEmployeeInput {
  first_name: string;
  last_name: string;
  email: string;
  department: string;
  manager_id?: string | null;
  join_date: string;
  role: Role;
}

export async function createEmployee(input: CreateEmployeeInput): Promise<ApprovalResult> {
  try {
    const { supabase, user } = await requireSession();
    if (!canManageEmployees(user.role as Role)) {
      return { ok: false, error: "Not authorized" };
    }

    // Validate shape and role enum. Zod rejects anything other than "employee".
    const parsed = employeeSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    // Default to the only manager if caller didn't pick one.
    // Single-manager org: leave_requests.employees.manager_id drives approvals.
    let managerId = input.manager_id;
    if (managerId === null) {
      const { data: mgrs } = await supabase
        .from("employees")
        .select("id")
        .eq("status", "active")
        .eq("users.role", "manager")
        .limit(2);
      if (mgrs && mgrs.length === 1) managerId = mgrs[0].id;
    }

    // Generate employee code from current count
    const { count } = await supabase
      .from("employees")
      .select("*", { count: "exact", head: true });
    const code = `EMP${String((count ?? 0) + 1).padStart(3, "0")}`;

    // Create user
    const { data: created, error: userError } = await supabase
      .from("users")
      .insert({ email: input.email, role: input.role })
      .select("id")
      .single();
    if (userError) throw userError;

    // Create employee
    const { data: employee, error: empError } = await supabase
      .from("employees")
      .insert({
        user_id: created.id,
        employee_code: code,
        first_name: input.first_name,
        last_name: input.last_name,
        department: input.department,
        manager_id: managerId,
        join_date: input.join_date,
        status: "active",
      })
      .select("id")
      .single();
    if (empError) throw empError;

    // Seed leave balances for current year
    const { data: leaveTypes } = await supabase
      .from("leave_types")
      .select("id, annual_days")
      .gt("annual_days", 0);

    if (leaveTypes && leaveTypes.length > 0) {
      const year = new Date().getFullYear();
      const { error: balError } = await supabase.from("leave_balances").insert(
        leaveTypes.map((lt) => ({
          employee_id: employee.id,
          leave_type_id: lt.id,
          year,
          allocated_days: lt.annual_days,
          used_days: 0,
          remaining_days: lt.annual_days,
          carry_forward_days: 0,
        }))
      );
      if (balError) throw balError;
    }

    revalidatePath("/employees");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create employee" };
  }
}

// ----- Toggle employee active/inactive (admin) -----

export interface UpdateEmployeeStatusInput {
  employee_id: string;
  status: "active" | "inactive";
}

export async function updateEmployeeStatus(
  input: UpdateEmployeeStatusInput
): Promise<ApprovalResult> {
  try {
    const { supabase, user } = await requireSession();
    if (!canManageEmployees(user.role as Role)) {
      return { ok: false, error: "Not authorized" };
    }

    const { data: updated, error: updateError } = await supabase
      .from("employees")
      .update({ status: input.status })
      .eq("id", input.employee_id)
      .select("id, status")
      .single();
    if (updateError) throw updateError;
    if (!updated) return { ok: false, error: "Employee not found" };

    revalidatePath("/employees");
    revalidatePath("/");
    revalidatePath("/approvals");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update status" };
  }
}

// ----- Self-service leave request (own employee_id) -----

export interface CreateLeaveRequestInput {
  leave_type_id: string;
  start_date: string;
  end_date: string;
  duration_type: "full_day" | "half_day";
  reason: string;
}

export async function createLeaveRequest(
  input: CreateLeaveRequestInput
): Promise<ApprovalResult> {
  try {
    const { supabase, employee } = await requireSession();
    if (!employee) return { ok: false, error: "Employee record not found" };

    const parsed = leaveRequestSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    // Server-side date validation
    if (input.start_date > input.end_date) {
      return { ok: false, error: "Start date must be on or before end date" };
    }

    const { data: days, error: calcError } = await supabase.rpc(
      "calculate_working_days",
      { start_d: input.start_date, end_d: input.end_date }
    );
    if (calcError) throw calcError;

    const actualDays = input.duration_type === "half_day" ? 0.5 : days;

    // Reject weekend-only / holiday-only ranges. calculate_working_days
    // already excludes weekends and public holidays, so actualDays == 0
    // means the entire range was non-working days.
    if (actualDays <= 0) {
      return {
        ok: false,
        error:
          "Selected range has no working days. Every day falls on a weekend or public holiday.",
      };
    }

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

    const { error: insertError } = await supabase.from("leave_requests").insert({
      employee_id: employee.id,
      leave_type_id: input.leave_type_id,
      start_date: input.start_date,
      end_date: input.end_date,
      days: actualDays,
      duration_type: input.duration_type,
      reason: input.reason,
      status: "pending",
    });
    if (insertError) throw insertError;

    revalidatePath("/leave");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to submit request" };
  }
}

// ----- Cancel own leave request -----

export async function cancelLeaveRequest(requestId: string): Promise<ApprovalResult> {
  try {
    const { supabase, employee } = await requireSession();
    if (!employee) return { ok: false, error: "Employee record not found" };

    // Only own + still pending
    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({ status: "cancelled" })
      .eq("id", requestId)
      .eq("employee_id", employee.id)
      .eq("status", "pending");
    if (updateError) throw updateError;

    revalidatePath("/leave");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to cancel request" };
  }
}

// ----- Holiday create (HR/admin) -----

export async function createHoliday(input: { name: string; date: string }): Promise<ApprovalResult> {
  try {
    const { supabase, user } = await requireSession();
    if (!canManageEmployees(user.role as Role)) {
      return { ok: false, error: "Not authorized" };
    }

    const parsed = holidaySchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const { error } = await supabase.from("holidays").insert(parsed.data);
    if (error) throw error;
    updateTag("holidays");
    revalidatePath("/policies");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add holiday" };
  }
}

// ----- Holiday delete (HR/admin) -----

export async function deleteHoliday(id: string): Promise<ApprovalResult> {
  try {
    const { supabase, user } = await requireSession();
    if (!canManageEmployees(user.role as Role)) {
      return { ok: false, error: "Not authorized" };
    }
    const { error } = await supabase.from("holidays").delete().eq("id", id);
    if (error) throw error;
    updateTag("holidays");
    revalidatePath("/policies");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete holiday" };
  }
}

// ----- Leave type update days (HR/admin) -----

export async function updateLeaveTypeDays(
  id: string,
  annualDays: number
): Promise<ApprovalResult> {
  try {
    const { supabase, user } = await requireSession();
    if (!canManageEmployees(user.role as Role)) {
      return { ok: false, error: "Not authorized" };
    }
    if (annualDays < 0) return { ok: false, error: "Days must be non-negative" };
    const { error } = await supabase
      .from("leave_types")
      .update({ annual_days: annualDays })
      .eq("id", id);
    if (error) throw error;
    updateTag("leave-types");
    revalidatePath("/policies");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update leave type" };
  }
}

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
