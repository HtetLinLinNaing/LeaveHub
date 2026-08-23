import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";

export interface GrantDrivenAvailability {
  granted: number;
  used: number;
  available: number;
  pending: number;
}

export interface GrantDrivenOverviewEntry extends GrantDrivenAvailability {
  leaveTypeId: string;
  leaveTypeName: string;
}

// Pool model for a single grant-driven leave type.
// available = max(approved grants this year - approved requests this year, 0).
export async function getGrantDrivenAvailability(
  supabase: SupabaseClient,
  employeeId: string,
  year: number,
  leaveTypeId: string
): Promise<GrantDrivenAvailability> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31T23:59:59`;

  const [grantedRes, usedRes, pendingRes] = await Promise.all([
    supabase
      .from("leave_grants")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", leaveTypeId)
      .eq("status", "approved")
      .gte("approved_at", yearStart)
      .lte("approved_at", yearEnd),
    supabase
      .from("leave_requests")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", leaveTypeId)
      .eq("status", "approved")
      .gte("start_date", yearStart)
      .lte("start_date", yearEnd),
    supabase
      .from("leave_grants")
      .select("days")
      .eq("employee_id", employeeId)
      .eq("leave_type_id", leaveTypeId)
      .eq("status", "pending"),
  ]);

  for (const result of [grantedRes, usedRes, pendingRes]) {
    if (result.error) throw result.error;
  }

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

// Returns one entry per grant-driven type that has any activity in the year.
// Activity = granted > 0 OR used > 0 OR pending > 0.
export async function getGrantDrivenOverview(
  supabase: SupabaseClient,
  employeeId: string,
  year: number
): Promise<GrantDrivenOverviewEntry[]> {
  const { data: types, error: typesError } = await supabase
    .from("leave_types")
    .select("id, name")
    .in("name", [...GRANT_DRIVEN_LEAVE_TYPES]);
  if (typesError) throw typesError;

  const matched = (types ?? []).filter((t): t is { id: string; name: string } =>
    (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(t.name)
  );
  if (matched.length === 0) return [];

  const entries = await Promise.all(
    matched.map(async (t) => {
      const a = await getGrantDrivenAvailability(supabase, employeeId, year, t.id);
      return { leaveTypeId: t.id, leaveTypeName: t.name, ...a };
    })
  );

  return entries.filter(
    (e) => e.granted > 0 || e.used > 0 || e.pending > 0
  );
}
