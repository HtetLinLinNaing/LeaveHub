"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { updateTag } from "next/cache";
import { compassionateGrantSchema } from "@/lib/validations";
import { getSessionFromRequest, getCurrentEmployee, canApproveLeave, canManageEmployees } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { employeeSchema, leaveRequestSchema, holidaySchema } from "@/lib/validations";
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

    // Manager scope: only direct reports, and never another manager's self-request.
    // Skip PostgREST joins — fetch the request and its employee separately.
    if (user.role === "manager") {
      if (!employee) return { ok: false, error: "Approver record not found" };
      const { data: req } = await supabase
        .from("leave_requests")
        .select("employee_id")
        .eq("id", requestId)
        .single();
      if (!req) return { ok: false, error: "Request not found" };

      const { data: requesterEmp } = await supabase
        .from("employees")
        .select("manager_id, user_id")
        .eq("id", req.employee_id)
        .single();
      if (!requesterEmp) return { ok: false, error: "Requester not found" };
      if (requesterEmp.manager_id !== employee.id) {
        return { ok: false, error: "Not authorized for this request" };
      }

      const { data: requester } = await supabase
        .from("users")
        .select("role")
        .eq("id", requesterEmp.user_id)
        .single();
      if (requester?.role === "manager") {
        return { ok: false, error: "Manager self-requests are handled by admin" };
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("leave_requests")
      .update({
        status: action,
        approved_by: employee?.id ?? null,
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

// ----- Leave request (self by default; managers/admins can file for someone else) -----

export interface CreateLeaveRequestInput {
  leave_type_id: string;
  start_date: string;
  end_date: string;
  duration_type: "full_day" | "half_day";
  reason: string;
  for_employee_id?: string;
}

export async function createLeaveRequest(
  input: CreateLeaveRequestInput
): Promise<ApprovalResult> {
  try {
    const { supabase, user, employee } = await requireSession();
    if (!employee) return { ok: false, error: "Employee record not found" };

    const parsed = leaveRequestSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    // Server-side date validation
    if (input.start_date > input.end_date) {
      return { ok: false, error: "Start date must be on or before end date" };
    }

    // Filing on behalf of someone else: managers only for their direct reports,
    // admins for anyone. The for_employee_id defaults to the caller's own row.
    let targetEmployeeId = employee.id;
    if (input.for_employee_id && input.for_employee_id !== employee.id) {
      const { data: target } = await supabase
        .from("employees")
        .select("id, manager_id")
        .eq("id", input.for_employee_id)
        .single();
      if (!target) return { ok: false, error: "Target employee not found" };

      if (user.role === "manager") {
        if (target.manager_id !== employee.id) {
          return { ok: false, error: "Can only file leave for your direct reports" };
        }
      } else if (user.role !== "admin") {
        return { ok: false, error: "Not authorized to file leave on behalf of others" };
      }
      targetEmployeeId = target.id;
    }

    const { data: days, error: calcError } = await supabase.rpc(
      "calculate_working_days",
      { start_d: input.start_date, end_d: input.end_date }
    );
    if (calcError) throw calcError;

    const actualDays = input.duration_type === "half_day" ? 0.5 : days;

    // Compassionate Leave is grant-funded: the request draws from the
    // employee's approved-grants-minus-usage pool. Reject if not enough.
    const { data: lt } = await supabase
      .from("leave_types")
      .select("id, name")
      .eq("id", input.leave_type_id)
      .single();
    if (lt?.name === "Compassionate Leave") {
      const available = await getCompassionateAvailableDays(
        supabase,
        targetEmployeeId,
        lt.id
      );
      if (available < actualDays) {
        return {
          ok: false,
          error: `Insufficient compassionate leave balance (${available} day(s) available, ${actualDays} requested). Ask your manager to grant more.`,
        };
      }
    }

    const { error: insertError } = await supabase.from("leave_requests").insert({
      employee_id: targetEmployeeId,
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
    revalidatePath("/approvals");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to submit request" };
  }
}

// ----- Compassionate leave: balance + grant actions -----

// Sum of approved grants minus sum of approved usage requests, in days.
// This is the number of days the employee can still file against.
async function getCompassionateAvailableDays(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  compassionateTypeId: string
): Promise<number> {
  const [{ data: grants }, { data: used }] = await Promise.all([
    supabase
      .from("compassionate_grants")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("status", "approved"),
    supabase
      .from("leave_requests")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", compassionateTypeId)
      .eq("status", "approved"),
  ]);
  const granted = (grants ?? []).reduce((s, g) => s + Number(g.days), 0);
  const usedDays = (used ?? []).reduce((s, r) => s + Number(r.days), 0);
  return Math.max(0, granted - usedDays);
}

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
    if (!employee) return { ok: false, error: "Manager record not found" };
    if (user.role === "employee") {
      return { ok: false, error: "Only managers and admins can grant compassionate leave" };
    }

    const parsed = compassionateGrantSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    if (parsed.data.employee_id === employee.id) {
      return { ok: false, error: "Cannot grant compassionate leave to yourself" };
    }

    // Scope: manager must own the target as a direct report; admin can target anyone.
    const { data: target } = await supabase
      .from("employees")
      .select("id, manager_id")
      .eq("id", parsed.data.employee_id)
      .single();
    if (!target) return { ok: false, error: "Employee not found" };
    if (user.role === "manager" && target.manager_id !== employee.id) {
      return { ok: false, error: "Can only grant compassionate leave to your direct reports" };
    }

    // Find the Compassionate Leave type id.
    const { data: lt } = await supabase
      .from("leave_types")
      .select("id")
      .eq("name", "Compassionate Leave")
      .single();
    if (!lt) return { ok: false, error: "Compassionate Leave type not configured" };

    const { error: insertError } = await supabase.from("compassionate_grants").insert({
      employee_id: target.id,
      leave_type_id: lt.id,
      days: parsed.data.days,
      reason: parsed.data.reason,
      status: "pending",
      created_by: employee.id,
    });
    if (insertError) throw insertError;

    revalidatePath("/leave");
    revalidatePath("/approvals");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to file grant" };
  }
}

export async function approveCompassionateGrant(
  grantId: string,
  action: "approved" | "rejected"
): Promise<ApprovalResult> {
  try {
    const { supabase, user, employee } = await requireSession();
    if (!canApproveLeave(user.role as Role)) {
      return { ok: false, error: "Not authorized" };
    }

    // Manager can only act on grants filed by themselves (for their own direct reports).
    // Admin acts on any grant.
    const { data: grant } = await supabase
      .from("compassionate_grants")
      .select("id, status, created_by")
      .eq("id", grantId)
      .single();
    if (!grant) return { ok: false, error: "Grant not found" };
    if (grant.status !== "pending") return { ok: false, error: "Grant already actioned" };

    if (user.role === "manager" && grant.created_by !== employee?.id) {
      return { ok: false, error: "Not authorized for this grant" };
    }

    const { data: updated, error: updateError } = await supabase
      .from("compassionate_grants")
      .update({
        status: action,
        approved_by: employee?.id ?? null,
        approved_at: new Date().toISOString(),
      })
      .eq("id", grantId)
      .eq("status", "pending")
      .select("id")
      .single();
    if (updateError) throw updateError;
    if (!updated) return { ok: false, error: "Grant no longer pending" };

    revalidatePath("/approvals");
    revalidatePath("/leave");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update grant" };
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
