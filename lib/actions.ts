"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { updateTag } from "next/cache";
import { getSessionFromRequest, getCurrentEmployee, canApproveLeave, canManageEmployees } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
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

    // Manager scope: only their direct reports
    if (user.role === "manager") {
      const { data: req } = await supabase
        .from("leave_requests")
        .select("employees!inner(manager_id)")
        .eq("id", requestId)
        .single();
      const mgr = (req as { employees: { manager_id: string | null } } | null)?.employees?.manager_id;
      if (mgr !== employee.id) {
        return { ok: false, error: "Not authorized for this request" };
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
  manager_id: string | null;
  join_date: string;
  role: Role;
}

export async function createEmployee(input: CreateEmployeeInput): Promise<ApprovalResult> {
  try {
    const { supabase, user } = await requireSession();
    if (!canManageEmployees(user.role as Role)) {
      return { ok: false, error: "Not authorized" };
    }

    // Generate employee code from current count + fetch leave types in parallel.
    const [countRes, leaveTypesRes] = await Promise.all([
      supabase.from("employees").select("*", { count: "exact", head: true }),
      supabase.from("leave_types").select("id, annual_days, name"),
    ]);
    const code = `EMP${String((countRes.count ?? 0) + 1).padStart(3, "0")}`;

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
        manager_id: input.manager_id,
        join_date: input.join_date,
        status: "active",
      })
      .select("id")
      .single();
    if (empError) throw empError;

    // Seed per-employee leave policies. Compassionate is excluded by default —
    // HR opts in selected employees from the Policies page.
    const leaveTypes = leaveTypesRes.data ?? [];
    const defaultEnabled = leaveTypes.filter(
      (lt) => lt.name !== "Compassionate Leave"
    );
    if (defaultEnabled.length > 0) {
      const { error: polError } = await supabase
        .from("employee_leave_policies")
        .insert(
          defaultEnabled.map((lt) => ({
            employee_id: employee.id,
            leave_type_id: lt.id,
            allocated_days: lt.annual_days,
            enabled: true,
          }))
        );
      if (polError) throw polError;
    }

    revalidatePath("/employees");
    updateTag("current-employee");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create employee" };
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

    // Server-side date validation
    if (input.start_date > input.end_date) {
      return { ok: false, error: "Start date must be on or before end date" };
    }

    // Enforce per-employee policy: only types the employee is opted into.
    const { data: policy } = await supabase
      .from("employee_leave_policies")
      .select("enabled")
      .eq("employee_id", employee.id)
      .eq("leave_type_id", input.leave_type_id)
      .maybeSingle();
    if (!policy || !policy.enabled) {
      return { ok: false, error: "You are not entitled to this leave type" };
    }

    const { data: days, error: calcError } = await supabase.rpc(
      "calculate_working_days",
      { start_d: input.start_date, end_d: input.end_date }
    );
    if (calcError) throw calcError;

    const actualDays = input.duration_type === "half_day" ? 0.5 : days;

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
    const { error } = await supabase.from("holidays").insert(input);
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
