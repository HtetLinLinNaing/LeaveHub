"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { updateTag } from "next/cache";
import {
  canApproveLeave,
  canManageEmployees,
  canManageGrants,
  canProposeGrants,
} from "@/lib/auth/permissions";
import { requireRequestContext } from "@/lib/dal/request-context";
import {
  createLeaveRequestSchema,
  employeeSchema,
  holidaySchema,
  leaveGrantSchema,
  approveLeaveGrantActionSchema,
  approveLeaveRequestActionSchema,
  resourceIdSchema,
  updateEmployeeStatusActionSchema,
  updateLeaveTypeDaysActionSchema,
} from "@/lib/validations";
import { getGrantDrivenAvailability } from "@/lib/grants";
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";
import { actionFailure } from "@/lib/action-errors";
import type { DayDuration, Role } from "@/lib/types";

// ----- Per-day duration helpers -----

const UNITS: Record<DayDuration, number> = {
  full_day: 1,
  half_day_morning: 0.5,
  half_day_evening: 0.5,
};

// Roll a per-day array up to the parent's (duration_type, days) pair so
// approval / balance / calendar code keeps reading the same shape.
// All-half → "half_day", all-full or mixed → "full_day", half-month-like
// cases always flatten to full_day when at least one full day is in the mix.
function rollUpParent(days: { duration: DayDuration }[]) {
  const total = days.reduce((sum, d) => sum + UNITS[d.duration], 0);
  const anyFull = days.some((d) => d.duration === "full_day");
  const allHalf = days.every((d) => d.duration !== "full_day");
  const durationType: "full_day" | "half_day" = anyFull || !allHalf ? "full_day" : "half_day";
  return { total, durationType };
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
    const { actor, db } = await requireRequestContext();
    if (!canApproveLeave(actor.role)) {
      return { ok: false, error: "Not authorized" };
    }
    if (!actor.employee) return { ok: false, error: "Approver record not found" };

    const parsed = approveLeaveRequestActionSchema.safeParse({ requestId, action });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const validatedRequestId = parsed.data.requestId;
    const validatedAction = parsed.data.action;

    // Manager scope: only direct reports, and never another manager's self-request.
    // PostgREST nested joins silently return zero rows on this project, so
    // hydrate via separate queries in JS.
    if (actor.role === "manager") {
      const { data: req, error: requestError } = await db
        .from("leave_requests")
        .select("id, employee_id")
        .eq("id", validatedRequestId)
        .maybeSingle();
      if (requestError) throw requestError;
      if (!req) return { ok: false, error: "Not authorized for this request" };
      const { data: emp, error: employeeError } = await db
        .from("employees")
        .select("manager_id, user_id")
        .eq("id", req.employee_id)
        .maybeSingle();
      if (employeeError) throw employeeError;
      if (!emp || emp.manager_id !== actor.employee.id) {
        return { ok: false, error: "Not authorized for this request" };
      }
      const { data: u, error: roleError } = await db
        .from("users")
        .select("role")
        .eq("id", emp.user_id)
        .maybeSingle();
      if (roleError) throw roleError;
      if (!u) return { ok: false, error: "Not authorized for this request" };
      if (u?.role === "manager") {
        return { ok: false, error: "Manager self-requests are handled by admin" };
      }
    }

    const { data: updated, error: updateError } = await db
      .from("leave_requests")
      .update({
        status: validatedAction,
        approved_by: actor.employee.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", validatedRequestId)
      .eq("status", "pending")
      .select("id, employee_id, leave_type_id, start_date, end_date, days")
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) return { ok: false, error: "Request not pending" };

    // On approve, defense-in-depth: if another approved request for the
    // same employee already covers any of these dates, the submitter-side
    // check was bypassed (e.g. an old request without the check) and we
    // must not double-book. Reject and roll back the approval.
    if (validatedAction === "approved") {
      const { data: conflicts, error: conflictsError } = await db
        .from("leave_requests")
        .select("id, start_date, end_date")
        .eq("employee_id", updated.employee_id)
        .eq("status", "approved")
        .neq("id", updated.id)
        .lte("start_date", updated.end_date)
        .gte("end_date", updated.start_date);
      if (conflictsError) throw conflictsError;
      if (conflicts && conflicts.length > 0) {
        await db
          .from("leave_requests")
          .update({
            status: "pending",
            approved_by: null,
            approved_at: null,
          })
          .eq("id", updated.id);
        return {
          ok: false,
          error:
            "Another approved leave already covers one or more of these dates.",
        };
      }
    }

    // If approved, decrement the requester's leave balance
    if (validatedAction === "approved") {
      const year = new Date(updated.start_date).getFullYear();
      const { data: balance, error: balanceLookupError } = await db
        .from("leave_balances")
        .select("id, used_days, remaining_days")
        .eq("employee_id", updated.employee_id)
        .eq("leave_type_id", updated.leave_type_id)
        .eq("year", year)
        .maybeSingle();
      if (balanceLookupError) throw balanceLookupError;

      if (balance) {
        const { error: balanceError } = await db
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
    return actionFailure(err, "Failed to update request");
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
    const { actor, db } = await requireRequestContext();
    if (!canManageEmployees(actor.role)) {
      return { ok: false, error: "Not authorized" };
    }

    // Validate shape and role enum. Zod rejects anything other than "employee".
    const parsed = employeeSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    // Default to the only manager if caller didn't pick one.
    // Single-manager org: leave_requests.employees.manager_id drives approvals.
    const validatedInput = parsed.data;
    let managerId = validatedInput.manager_id;
    if (managerId === null) {
      const { data: mgrs, error: managersError } = await db
        .from("employees")
        .select("id")
        .eq("status", "active")
        .eq("users.role", "manager")
        .limit(2);
      if (managersError) throw managersError;
      if (mgrs && mgrs.length === 1) managerId = mgrs[0].id;
    }

    // Generate employee code from current count
    const { count, error: countError } = await db
      .from("employees")
      .select("*", { count: "exact", head: true });
    if (countError) throw countError;
    const code = `EMP${String((count ?? 0) + 1).padStart(3, "0")}`;

    // Create user
    const { data: created, error: userError } = await db
      .from("users")
      .insert({ email: validatedInput.email, role: validatedInput.role })
      .select("id")
      .single();
    if (userError) throw userError;

    // Create employee
    const { data: employee, error: empError } = await db
      .from("employees")
      .insert({
        user_id: created.id,
        employee_code: code,
        first_name: validatedInput.first_name,
        last_name: validatedInput.last_name,
        department: validatedInput.department,
        manager_id: managerId,
        join_date: validatedInput.join_date,
        status: "active",
      })
      .select("id")
      .single();
    if (empError) throw empError;

    // Seed leave balances for current year
    const { data: leaveTypes, error: leaveTypesError } = await db
      .from("leave_types")
      .select("id, annual_days")
      .gt("annual_days", 0);
    if (leaveTypesError) throw leaveTypesError;

    if (leaveTypes && leaveTypes.length > 0) {
      const year = new Date().getFullYear();
      const { error: balError } = await db.from("leave_balances").insert(
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
    return actionFailure(err, "Failed to create employee");
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
    const { actor, db } = await requireRequestContext();
    if (!canManageEmployees(actor.role)) {
      return { ok: false, error: "Not authorized" };
    }

    const parsed = updateEmployeeStatusActionSchema.safeParse({
      employeeId: input.employee_id,
      status: input.status,
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const { data: updated, error: updateError } = await db
      .from("employees")
      .update({ status: parsed.data.status })
      .eq("id", parsed.data.employeeId)
      .select("id, status")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return { ok: false, error: "Employee not found" };

    revalidatePath("/employees");
    revalidatePath("/");
    revalidatePath("/approvals");
    return { ok: true };
  } catch (err) {
    return actionFailure(err, "Failed to update status");
  }
}

// ----- Self-service leave request (own employee_id) -----

export type CreateLeaveRequestInput = {
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: { date: string; duration: DayDuration }[];
  reason: string;
  emergency_contact?: { name: string; phone: string; relationship: string };
  mc?: { path: string; name: string };
};

export async function createLeaveRequest(
  input: CreateLeaveRequestInput
): Promise<ApprovalResult> {
  try {
    const { actor, db } = await requireRequestContext();
    if (!actor.employee) return { ok: false, error: "Employee record not found" };

    const parsed = createLeaveRequestSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    // Server-side date validation
    if (parsed.data.start_date > parsed.data.end_date) {
      return { ok: false, error: "Start date must be on or before end date" };
    }

    // Drop any weekend / holiday days the UI included. The picker shows
    // the full range, but the user may have left defaults on a Saturday;
    // we strip them here so the child rows only hold real working days.
    const dates = Array.from(new Set(parsed.data.days.map((d) => d.date))).sort();
    if (dates.length === 0) {
      return { ok: false, error: "Select at least one day" };
    }
    const earliest = dates[0];
    const latest = dates[dates.length - 1];

    const { data: holidayRows, error: holidaysError } = await db
      .from("holidays")
      .select("date")
      .gte("date", earliest)
      .lte("date", latest);
    if (holidaysError) throw holidaysError;
    const holidaySet = new Set((holidayRows ?? []).map((h) => h.date));

    const isWorking = (d: string) => {
      const dow = new Date(d + "T00:00:00Z").getUTCDay();
      return dow !== 0 && dow !== 6 && !holidaySet.has(d);
    };

    const dayRows = parsed.data.days.filter((d) => isWorking(d.date));
    if (dayRows.length === 0) {
      return {
        ok: false,
        error:
          "Selected range has no working days. Every day falls on a weekend or public holiday.",
      };
    }

    // Overlap check: reject if any pending or approved request for this
    // employee already covers any of the same dates. Range overlap:
    // existing.start <= new.end AND existing.end >= new.start.
    const { data: conflicts, error: conflictsError } = await db
      .from("leave_requests")
      .select("id, start_date, end_date, status")
      .eq("employee_id", actor.employee.id)
      .in("status", ["pending", "approved"])
      .lte("start_date", latest)
      .gte("end_date", earliest);
    if (conflictsError) throw conflictsError;
    if (conflicts && conflicts.length > 0) {
      return {
        ok: false,
        error:
          "You already have a leave request covering one or more of these dates.",
      };
    }

    const { total, durationType } = rollUpParent(dayRows);

    // Compassionate Leave balance check: derived available >= total.
    if (parsed.data.leave_type_id) {
      const { data: ltForCheck, error: leaveTypeError } = await db
        .from("leave_types")
        .select("id, name")
        .eq("id", parsed.data.leave_type_id)
        .maybeSingle();
      if (leaveTypeError) throw leaveTypeError;
      if (!ltForCheck) return { ok: false, error: "Leave type not found" };
      if (ltForCheck && (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(ltForCheck.name)) {
        const year = new Date(parsed.data.start_date).getFullYear();
        const { available } = await getGrantDrivenAvailability(
          db,
          actor.employee.id,
          year,
          ltForCheck.id
        );
        if (available < total) {
          return {
            ok: false,
            error: `You have no ${ltForCheck.name} available. Ask your manager to grant it.`,
          };
        }
      }
    }

    // Parent row stays shape-compatible with existing approval / balance
    // / calendar code. Child rows carry the per-day breakdown.
    const { data: created, error: insertError } = await db
      .from("leave_requests")
      .insert({
        employee_id: actor.employee.id,
        leave_type_id: parsed.data.leave_type_id,
        start_date: parsed.data.start_date,
        end_date: parsed.data.end_date,
        days: total,
        duration_type: durationType,
        reason: parsed.data.reason,
        status: "pending",
        emergency_contact_name: parsed.data.emergency_contact?.name ?? null,
        emergency_contact_phone: parsed.data.emergency_contact?.phone ?? null,
        emergency_contact_relationship:
          parsed.data.emergency_contact?.relationship ?? null,
        mc_file_path: parsed.data.mc?.path ?? null,
        mc_file_name: parsed.data.mc?.name ?? null,
        mc_uploaded_at: parsed.data.mc ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    if (!created) return { ok: false, error: "Failed to submit request" };

    const { error: daysError } = await db.from("leave_request_days").insert(
      dayRows.map((d) => ({
        leave_request_id: created.id,
        date: d.date,
        duration: d.duration,
        units: UNITS[d.duration],
      }))
    );
    if (daysError) throw daysError;

    revalidatePath("/leave");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return actionFailure(err, "Failed to submit request");
  }
}

// ----- MC upload (Supabase Storage) -----

const MC_BUCKET = "mc-certificates";
const MC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MC_ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

function extFor(file: File): string {
  const name = file.name || "";
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  if (m) return m[1].toLowerCase();
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg" || file.type === "image/jpg") return "jpg";
  return "bin";
}

export async function uploadMcCertificate(
  formData: FormData
): Promise<{ ok: true; path: string; name: string } | { ok: false; error: string }> {
  try {
    const { actor, db } = await requireRequestContext();
    if (!actor.employee) return { ok: false, error: "Employee record not found" };

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: "No file provided" };
    }
    if (file.size === 0) return { ok: false, error: "File is empty" };
    if (file.size > MC_MAX_BYTES) {
      return { ok: false, error: "File exceeds 5 MB limit" };
    }
    // Some browsers report an empty type for files dragged from chat apps;
    // fall back to the extension when MIME is blank.
    const mime = file.type || (file.name.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : file.name.toLowerCase().endsWith(".png")
      ? "image/png"
      : "image/jpeg");
    if (!MC_ALLOWED_MIME.has(mime)) {
      return { ok: false, error: "Only PDF, JPG, or PNG files are accepted" };
    }

    // Ensure the bucket exists. The migration creates the table metadata
    // but Storage buckets are separate; create on demand with private
    // visibility so only authenticated users can read.
    await ensureBucket(db, MC_BUCKET);

    const ext = extFor(file);
    const objectKey = `${actor.employee.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await db.storage
      .from(MC_BUCKET)
      .upload(objectKey, buf, { contentType: mime, upsert: false });
    if (uploadError) throw uploadError;

    return { ok: true, path: objectKey, name: file.name };
  } catch (err) {
    return actionFailure(err, "Upload failed");
  }
}

// Bucket lookup is per-session cached to avoid hammering Storage.listBuckets
// on every upload. The first call from a given server runtime pays the
// round-trip; subsequent calls hit the Set.
const _bucketCache = new Set<string>();
async function ensureBucket(
  db: SupabaseClient,
  name: string
) {
  if (_bucketCache.has(name)) return;
  const { data: existing, error: lookupError } = await db.storage.getBucket(name);
  if (lookupError && !/not found/i.test(lookupError.message)) {
    throw lookupError;
  }
  if (!existing) {
    const { error } = await db.storage.createBucket(name, {
      public: false,
      fileSizeLimit: MC_MAX_BYTES,
      allowedMimeTypes: Array.from(MC_ALLOWED_MIME),
    });
    // Race: another request may have created it concurrently. If create
    // fails because it already exists, treat as success.
    if (error && !/already exists|duplicate/i.test(error.message)) {
      throw error;
    }
  }
  _bucketCache.add(name);
}

// ----- Cancel own leave request -----

export async function cancelLeaveRequest(requestId: string): Promise<ApprovalResult> {
  try {
    const { actor, db } = await requireRequestContext();
    if (!actor.employee) return { ok: false, error: "Employee record not found" };

    const parsedId = resourceIdSchema.safeParse(requestId);
    if (!parsedId.success) {
      return { ok: false, error: parsedId.error.issues[0]?.message ?? "Invalid input" };
    }

    // Only own + still pending
    const { data: updated, error: updateError } = await db
      .from("leave_requests")
      .update({ status: "cancelled" })
      .eq("id", parsedId.data)
      .eq("employee_id", actor.employee.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return { ok: false, error: "Request no longer pending or not yours" };

    revalidatePath("/leave");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return actionFailure(err, "Failed to cancel request");
  }
}

// ----- Holiday create (HR/admin) -----

export async function createHoliday(input: { name: string; date: string }): Promise<ApprovalResult> {
  try {
    const { actor, db } = await requireRequestContext();
    if (!canManageEmployees(actor.role)) {
      return { ok: false, error: "Not authorized" };
    }

    const parsed = holidaySchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const { error } = await db.from("holidays").insert(parsed.data);
    if (error) throw error;
    updateTag("holidays");
    revalidatePath("/policies");
    return { ok: true };
  } catch (err) {
    return actionFailure(err, "Failed to add holiday");
  }
}

// ----- Holiday delete (HR/admin) -----

export async function deleteHoliday(id: string): Promise<ApprovalResult> {
  try {
    const { actor, db } = await requireRequestContext();
    if (!canManageEmployees(actor.role)) {
      return { ok: false, error: "Not authorized" };
    }
    const parsedId = resourceIdSchema.safeParse(id);
    if (!parsedId.success) {
      return { ok: false, error: parsedId.error.issues[0]?.message ?? "Invalid input" };
    }
    const { error } = await db.from("holidays").delete().eq("id", parsedId.data);
    if (error) throw error;
    updateTag("holidays");
    revalidatePath("/policies");
    return { ok: true };
  } catch (err) {
    return actionFailure(err, "Failed to delete holiday");
  }
}

// ----- Leave type update days (HR/admin) -----

export async function updateLeaveTypeDays(
  id: string,
  annualDays: number
): Promise<ApprovalResult> {
  try {
    const { actor, db } = await requireRequestContext();
    if (!canManageEmployees(actor.role)) {
      return { ok: false, error: "Not authorized" };
    }
    const parsed = updateLeaveTypeDaysActionSchema.safeParse({ leaveTypeId: id, annualDays });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const { data: updated, error } = await db
      .from("leave_types")
      .update({ annual_days: parsed.data.annualDays })
      .eq("id", parsed.data.leaveTypeId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!updated) return { ok: false, error: "Leave type not found" };
    updateTag("leave-types");
    revalidatePath("/policies");
    return { ok: true };
  } catch (err) {
    return actionFailure(err, "Failed to update leave type");
  }
}

// ----- Propose a leave grant (manager or admin) -----

export interface CreateLeaveGrantInput {
  employee_id: string;
  leave_type_name: string;
  days: number;
  reason: string;
}

export async function createLeaveGrant(
  input: CreateLeaveGrantInput
): Promise<ApprovalResult> {
  try {
    const { actor, db } = await requireRequestContext();
    if (!canProposeGrants(actor.role)) {
      return { ok: false, error: "Not authorized" };
    }
    if (!actor.employee) return { ok: false, error: "Proposer record not found" };

    const parsed = leaveGrantSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const validatedInput = parsed.data;

    // Verify target employee is active. Manager scope: must be a direct
    // report. Admin scope: any active employee.
    const { data: target, error: targetError } = await db
      .from("employees")
      .select("id, status, manager_id")
      .eq("id", validatedInput.employee_id)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return { ok: false, error: "Employee not found" };
    if (target.status !== "active") {
      return { ok: false, error: "Employee is not active" };
    }
    if (actor.role === "manager" && target.manager_id !== actor.employee.id) {
      return {
        ok: false,
        error: "Can only grant to your active direct reports",
      };
    }

    // Resolve leave type id from name and confirm it's grant-driven.
    const { data: lt, error: leaveTypeError } = await db
      .from("leave_types")
      .select("id, name")
      .eq("name", validatedInput.leave_type_name)
      .maybeSingle();
    if (leaveTypeError) throw leaveTypeError;
    if (!lt) return { ok: false, error: "Leave type not found" };
    if (!(GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(lt.name)) {
      return { ok: false, error: "This leave type is not grant-driven" };
    }

    const { error: insertError } = await db.from("leave_grants").insert({
      employee_id: validatedInput.employee_id,
      leave_type_id: lt.id,
      days: validatedInput.days,
      reason: validatedInput.reason,
      status: "pending",
      created_by: actor.employee.id,
    });
    if (insertError) throw insertError;

    revalidatePath("/approvals");
    return { ok: true };
  } catch (err) {
    return actionFailure(err, "Failed to create grant");
  }
}

// ----- Approve or reject a pending grant (admin) -----

export async function approveLeaveGrant(
  grantId: string,
  decision: "approved" | "rejected",
  rejectionReason?: string
): Promise<ApprovalResult> {
  try {
    const { actor, db } = await requireRequestContext();
    if (!canManageGrants(actor.role)) {
      return { ok: false, error: "Not authorized" };
    }
    if (!actor.employee) return { ok: false, error: "Admin record not found" };

    const parsed = approveLeaveGrantActionSchema.safeParse({
      grantId,
      decision,
      rejectionReason,
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const now = new Date().toISOString();
    const update =
      parsed.data.decision === "approved"
        ? { status: "approved", approved_by: actor.employee.id, approved_at: now, rejected_by: null, rejected_at: null, rejection_reason: null }
        : { status: "rejected", rejected_by: actor.employee.id, rejected_at: now, rejection_reason: parsed.data.rejectionReason ?? null };

    const { data: updated, error: updateError } = await db
      .from("leave_grants")
      .update(update)
      .eq("id", parsed.data.grantId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return { ok: false, error: "Grant no longer pending" };

    revalidatePath("/approvals");
    revalidatePath("/");
    revalidatePath("/leave");
    return { ok: true };
  } catch (err) {
    return actionFailure(err, "Failed to update grant");
  }
}

// ----- Cancel a still-pending grant (the manager who proposed it) -----

export async function cancelPendingGrant(grantId: string): Promise<ApprovalResult> {
  try {
    const { actor, db } = await requireRequestContext();
    if (!canProposeGrants(actor.role)) {
      return { ok: false, error: "Not authorized" };
    }
    if (!actor.employee) return { ok: false, error: "Proposer record not found" };

    const parsedId = resourceIdSchema.safeParse(grantId);
    if (!parsedId.success) {
      return { ok: false, error: parsedId.error.issues[0]?.message ?? "Invalid input" };
    }

    // Only the original creator can cancel; admin cannot cancel through this path.
    const { data: updated, error: updateError } = await db
      .from("leave_grants")
      .update({ status: "rejected", rejected_by: actor.employee.id, rejected_at: new Date().toISOString() })
      .eq("id", parsedId.data)
      .eq("created_by", actor.employee.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return { ok: false, error: "Grant no longer pending or not yours" };

    revalidatePath("/approvals");
    return { ok: true };
  } catch (err) {
    return actionFailure(err, "Failed to cancel grant");
  }
}
