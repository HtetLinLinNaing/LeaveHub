import type { SupabaseClient } from "@supabase/supabase-js";
import type { Holiday, LeaveType } from "@/lib/types";

export interface SharedCacheReader {
  loadLeaveTypes(): Promise<LeaveType[]>;
  loadHolidays(): Promise<Holiday[]>;
  loadHolidaysFromDate(fromDate: string, limit: number): Promise<Holiday[]>;
  loadYearHolidays(year: number): Promise<Holiday[]>;
}

// Testable adapter seam. The server-only cache module owns client creation and
// cross-request caching; this reader only checks database responses.
export function createSharedCacheReader(
  supabase: SupabaseClient
): SharedCacheReader {
  return {
    async loadLeaveTypes() {
      const { data, error } = await supabase
        .from("leave_types")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as LeaveType[];
    },

    async loadHolidays() {
      const { data, error } = await supabase
        .from("holidays")
        .select("*")
        .order("date");
      if (error) throw error;
      return (data ?? []) as Holiday[];
    },

    async loadHolidaysFromDate(fromDate, limit) {
      const { data, error } = await supabase
        .from("holidays")
        .select("*")
        .gte("date", fromDate)
        .order("date")
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Holiday[];
    },

    async loadYearHolidays(year) {
      const { data, error } = await supabase
        .from("holidays")
        .select("*")
        .gte("date", `${year}-01-01`)
        .lte("date", `${year}-12-31`)
        .order("date");
      if (error) throw error;
      return (data ?? []) as Holiday[];
    },
  };
}
