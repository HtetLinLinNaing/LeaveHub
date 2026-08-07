"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { updateTag } from "next/cache";
import { getSessionFromRequest, getCurrentEmployee, canApproveLeave, canManageEmployees } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
        manager_id: input.manager_id,
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
