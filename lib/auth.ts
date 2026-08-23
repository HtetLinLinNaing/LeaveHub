import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "./types";

export {
  canApproveLeave,
  canManageEmployees,
  canManageGrants,
  canProposeGrants,
  canViewApprovals,
  hasRole,
} from "@/lib/auth/permissions";

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
export const getCurrentEmployee = cache(
  async (
    supabase: SupabaseClient,
    email: string | undefined
  ): Promise<CurrentEmployee> => {
    if (!email) return { user: null, employee: null };
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, role")
      .eq("email", email)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) return { user: null, employee: null };
    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("id, first_name, last_name, department, status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (employeeError) throw employeeError;
    // Inactive employees are treated as having no record. Admin has no
    // employees row, so the user object is still returned for admin.
    if (employee && employee.status !== "active") {
      return { user, employee: null };
    }
    return { user, employee: employee ?? null };
  }
);
