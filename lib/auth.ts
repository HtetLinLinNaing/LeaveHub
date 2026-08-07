import type { Role } from "./types";

const MOCK_USER_KEY = "leavehub_mock_user";

// Client-safe auth utilities (no server imports)

export interface MockSession {
  email: string;
  role: Role;
}

export function setMockSession(session: MockSession) {
  if (typeof document !== "undefined") {
    document.cookie = `${MOCK_USER_KEY}=${encodeURIComponent(JSON.stringify(session))}; path=/; max-age=86400`;
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
    return JSON.parse(decodeURIComponent(match.split("=").slice(1).join("=")));
  } catch {
    return null;
  }
}

export function hasRole(userRole: Role, required: Role[]): boolean {
  return required.includes(userRole);
}

export function canApproveLeave(userRole: Role): boolean {
  return ["manager", "hr", "admin"].includes(userRole);
}

export function canManageEmployees(userRole: Role): boolean {
  return ["hr", "admin"].includes(userRole);
}
