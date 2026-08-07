import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "./types";

const MOCK_USER_KEY = "leavehub_mock_user";

// The cookie stores ONLY the email. Role and identity are re-derived
// server-side from the users table on every request — the client cannot
// elevate itself by editing its own cookie.
export interface MockSession {
  email: string;
}

export type CurrentEmployee = {
  user: { id: string; role: Role } | null;
  employee: {
    id: string;
    first_name: string;
    last_name: string;
    department?: string;
  } | null;
};

export function setMockSession(session: MockSession) {
  if (typeof document !== "undefined") {
    document.cookie = `${MOCK_USER_KEY}=${encodeURIComponent(JSON.stringify({ email: session.email }))}; path=/; max-age=86400`;
  }
}

export function clearMockSession() {
  if (typeof document !== "undefined") {
    document.cookie = `${MOCK_USER_KEY}=; path=/; max-age=0`;
  }
}

export function getMockSessionFromCookie(cookieHeader: string): MockSession | null {
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  const match = cookies.find((c) => c.startsWith(`${MOCK_USER_KEY}=`));
  if (!match) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match.split("=").slice(1).join("=")));
    if (typeof parsed !== "object" || parsed === null || typeof parsed.email !== "string") {
      return null;
    }
    return { email: parsed.email };
  } catch {
    return null;
  }
}

// Per-request memoized session lookup. React's `cache()` dedupes calls within
// a single server render, so layout + every page parse the cookie once total.
export const getSessionFromRequest = cache(
  (cookieHeader: string): MockSession | null =>
    getMockSessionFromCookie(cookieHeader)
);

// Per-request memoized user + employee lookup. Returns role from the users
// table — never from the cookie. Replaces the duplicated `users` + `employees`
// query pair in every dashboard page.
const getCurrentEmployeeUncached = async (
  supabase: SupabaseClient,
  email: string | undefined
): Promise<CurrentEmployee> => {
  if (!email) return { user: null, employee: null };
  // Single round-trip with a join instead of 2 sequential selects.
  const { data } = await supabase
    .from("users")
    .select("id, role, employees(id, first_name, last_name, department)")
    .eq("email", email)
    .single();
  if (!data) return { user: null, employee: null };
  const employee = (data as unknown as {
    employees: CurrentEmployee["employee"] | CurrentEmployee["employee"][];
  }).employees;
  return {
    user: { id: data.id, role: data.role as Role },
    employee: Array.isArray(employee) ? (employee[0] ?? null) : (employee ?? null),
  };
};

// Cross-request cache keyed by email. The cookie is the only thing that
// ever triggers a re-lookup, and cookies change at the network layer — so
// a 5s TTL absorbs the burst of navigation calls without serving stale role.
const _getCurrentEmployeeCached = unstable_cache(
  async (email: string) => {
    // Re-create the supabase client inside the cache so the closure
    // doesn't pin a stale request-scoped instance.
    const { createClient } = await import("@/lib/supabase/admin");
    const supabase = createClient();
    return getCurrentEmployeeUncached(supabase, email);
  },
  ["current-employee"],
  { revalidate: 5, tags: ["current-employee"] }
);

export const getCurrentEmployee = cache(
  async (
    supabase: SupabaseClient,
    email: string | undefined
  ): Promise<CurrentEmployee> => {
    if (!email) return { user: null, employee: null };
    return _getCurrentEmployeeCached(email);
  }
);

export function hasRole(userRole: Role, required: Role[]): boolean {
  return required.includes(userRole);
}

export function canApproveLeave(userRole: Role): boolean {
  return ["manager", "hr", "admin"].includes(userRole);
}

export function canManageEmployees(userRole: Role): boolean {
  return ["hr", "admin"].includes(userRole);
}
