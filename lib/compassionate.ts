import type { SupabaseClient } from "@supabase/supabase-js";

export interface CompassionateAvailability {
  granted: number;
  used: number;
  available: number;
  pending: number;
}

// Compassionate Leave is grant-driven. The employee's available days =
// approved grants in the year minus approved compassionate requests in
// the year. Year is keyed on approved_at for grants, start_date for
// requests. Pool model — no per-grant FIFO.
export async function getCompassionateAvailability(
  supabase: SupabaseClient,
  employeeId: string,
  year: number
): Promise<CompassionateAvailability> {
  // Find the compassionate leave_type_id. The DB has exactly one row
  // named "Compassionate Leave"; if it ever changes, update here.
  const { data: lt } = await supabase
    .from("leave_types")
    .select("id")
    .eq("name", "Compassionate Leave")
    .single();
  const compassionateId = lt?.id;
  if (!compassionateId) {
    return { granted: 0, used: 0, available: 0, pending: 0 };
  }

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31T23:59:59`;

  const [grantedRes, usedRes, pendingRes] = await Promise.all([
    supabase
      .from("leave_grants")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", compassionateId)
      .eq("status", "approved")
      .gte("approved_at", yearStart)
      .lte("approved_at", yearEnd),
    supabase
      .from("leave_requests")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", compassionateId)
      .eq("status", "approved")
      .gte("start_date", yearStart)
      .lte("start_date", yearEnd),
    supabase
      .from("leave_grants")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", compassionateId)
      .eq("status", "pending"),
  ]);

  const sum = (rows: { days: number }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + Number(r.days), 0);

  const granted = sum(grantedRes.data);
  const used = sum(usedRes.data);
  const pending = sum(pendingRes.data);

  return {
    granted,
    used,
    available: Math.max(granted - used, 0),
    pending,
  };
}
