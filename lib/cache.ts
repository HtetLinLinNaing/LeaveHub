import "server-only";

import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/dal/admin-client";
import { createSharedCacheReader } from "@/lib/cache-reader";

// Cross-request cached data accessors. The wrapped fns are re-invoked
// at most once per `revalidate` window per arg-set, so subsequent page
// navigations within that window skip the Supabase round-trip entirely.
//
// Mutations invalidate the matching tags in their Server Actions. Next.js
// then returns the refreshed server payload in the same action round trip.

export const getCachedLeaveTypes = unstable_cache(
  async () => createSharedCacheReader(createAdminClient()).loadLeaveTypes(),
  ["leave-types"],
  { revalidate: 60, tags: ["leave-types"] }
);

export const getCachedHolidays = unstable_cache(
  async () => createSharedCacheReader(createAdminClient()).loadHolidays(),
  ["holidays"],
  { revalidate: 60, tags: ["holidays"] }
);

export const getCachedHolidaysFromDate = unstable_cache(
  async (fromDate: string, limit: number) =>
    createSharedCacheReader(createAdminClient()).loadHolidaysFromDate(
      fromDate,
      limit
    ),
  ["holidays-from"],
  { revalidate: 60, tags: ["holidays"] }
);

export const getCachedYearHolidays = unstable_cache(
  async (year: number) =>
    createSharedCacheReader(createAdminClient()).loadYearHolidays(year),
  ["holidays-year"],
  { revalidate: 300, tags: ["holidays"] }
);
