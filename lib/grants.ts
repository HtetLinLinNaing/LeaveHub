import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostgrestResponse } from "@supabase/postgrest-js";
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";
import {
  loadGrantDrivenOverview,
  type GrantDrivenOverviewEntry,
  type GrantOverviewReader,
} from "@/lib/grant-overview";

export interface GrantDrivenAvailability {
  granted: number;
  used: number;
  available: number;
  pending: number;
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
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31T23:59:59`;

  const queryRows = async <T>(
    promise: PromiseLike<PostgrestResponse<T>>
  ): Promise<T[]> => {
    const result = await promise;
    if (result.error) throw result.error;
    return result.data ?? [];
  };

  const reader: GrantOverviewReader = {
    loadTypes: () =>
      queryRows(
        supabase
          .from("leave_types")
          .select("id, name")
          .in("name", [...GRANT_DRIVEN_LEAVE_TYPES])
      ),
    loadApproved: (typeIds) =>
      queryRows(
        supabase
          .from("leave_grants")
          .select("leave_type_id, days")
          .eq("employee_id", employeeId)
          .in("leave_type_id", typeIds)
          .eq("status", "approved")
          .gte("approved_at", yearStart)
          .lte("approved_at", yearEnd)
      ),
    loadUsed: (typeIds) =>
      queryRows(
        supabase
          .from("leave_requests")
          .select("leave_type_id, days")
          .eq("employee_id", employeeId)
          .in("leave_type_id", typeIds)
          .eq("status", "approved")
          .gte("start_date", yearStart)
          .lte("start_date", yearEnd)
      ),
    loadPending: (typeIds) =>
      queryRows(
        supabase
          .from("leave_grants")
          .select("leave_type_id, days")
          .eq("employee_id", employeeId)
          .in("leave_type_id", typeIds)
          .eq("status", "pending")
      ),
  };

  return loadGrantDrivenOverview(reader);
}
