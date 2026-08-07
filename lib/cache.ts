import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { LeaveType, Holiday } from "@/lib/types";

// Cross-request cached data accessors. The wrapped fns are re-invoked
// at most once per `revalidate` window per arg-set, so subsequent page
// navigations within that window skip the Supabase round-trip entirely.
//
// Mutations (cancel request, add holiday, edit leave type days) call
// router.refresh() which re-runs the server component; the cached fn
// returns its memoized value, and once the TTL expires a fresh fetch
// lands. To invalidate eagerly from a mutation, add a server action
// that calls revalidateTag() with the matching tag.

export const getCachedLeaveTypes = unstable_cache(
  async (): Promise<LeaveType[]> => {
    const supabase = await createClient();
    const { data } = await supabase.from("leave_types").select("*").order("name");
    return (data ?? []) as LeaveType[];
  },
  ["leave-types"],
  { revalidate: 60, tags: ["leave-types"] }
);

export const getCachedHolidays = unstable_cache(
  async (): Promise<Holiday[]> => {
    const supabase = await createClient();
    const { data } = await supabase.from("holidays").select("*").order("date");
    return (data ?? []) as Holiday[];
  },
  ["holidays"],
  { revalidate: 60, tags: ["holidays"] }
);

export const getCachedHolidaysFromDate = unstable_cache(
  async (fromDate: string, limit: number): Promise<Holiday[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("holidays")
      .select("*")
      .gte("date", fromDate)
      .order("date")
      .limit(limit);
    return (data ?? []) as Holiday[];
  },
  ["holidays-from"],
  { revalidate: 60, tags: ["holidays"] }
);

export const getCachedYearHolidays = unstable_cache(
  async (year: number): Promise<Holiday[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("holidays")
      .select("*")
      .gte("date", `${year}-01-01`)
      .lte("date", `${year}-12-31`)
      .order("date");
    return (data ?? []) as Holiday[];
  },
  ["holidays-year"],
  { revalidate: 300, tags: ["holidays"] }
);
