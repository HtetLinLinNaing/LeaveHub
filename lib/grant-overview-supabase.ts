import type {
  PostgrestResponse,
  SupabaseClient,
} from "@supabase/supabase-js";
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";
import type { GrantOverviewReader } from "@/lib/grant-overview";

const SUPABASE_PAGE_SIZE = 1000;

async function queryRows<T>(
  promise: PromiseLike<PostgrestResponse<T>>
): Promise<T[]> {
  const result = await promise;
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function queryAllRows<T>(
  loadPage: (
    from: number,
    to: number
  ) => PromiseLike<PostgrestResponse<T>>
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const page = await queryRows(
      loadPage(from, from + SUPABASE_PAGE_SIZE - 1)
    );
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) return rows;
  }
}

// Testable adapter seam: it accepts an already-created client and contains no
// credentials or authorization decisions. Production entry points remain in
// server-only modules; tests use this seam to exercise the emitted queries.
export function createGrantOverviewReader(
  supabase: SupabaseClient,
  employeeId: string,
  year: number
): GrantOverviewReader {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31T23:59:59`;

  return {
    loadTypes: () =>
      queryRows(
        supabase
          .from("leave_types")
          .select("id, name")
          .in("name", [...GRANT_DRIVEN_LEAVE_TYPES])
      ),
    loadApproved: (typeIds) =>
      queryAllRows((from, to) =>
        supabase
          .from("leave_grants")
          .select("id, leave_type_id, days")
          .eq("employee_id", employeeId)
          .in("leave_type_id", typeIds)
          .eq("status", "approved")
          .gte("approved_at", yearStart)
          .lte("approved_at", yearEnd)
          .order("id", { ascending: true })
          .range(from, to)
      ),
    loadUsed: (typeIds) =>
      queryAllRows((from, to) =>
        supabase
          .from("leave_requests")
          .select("id, leave_type_id, days")
          .eq("employee_id", employeeId)
          .in("leave_type_id", typeIds)
          .eq("status", "approved")
          .gte("start_date", yearStart)
          .lte("start_date", yearEnd)
          .order("id", { ascending: true })
          .range(from, to)
      ),
    loadPending: (typeIds) =>
      queryAllRows((from, to) =>
        supabase
          .from("leave_grants")
          .select("id, leave_type_id, days")
          .eq("employee_id", employeeId)
          .in("leave_type_id", typeIds)
          .eq("status", "pending")
          .order("id", { ascending: true })
          .range(from, to)
      ),
  };
}
