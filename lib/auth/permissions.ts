import type { Role } from "@/lib/types";

export function hasRole(userRole: Role, required: Role[]): boolean {
  return required.includes(userRole);
}

export function canApproveLeave(userRole: Role): boolean {
  return ["manager", "admin"].includes(userRole);
}

export function canViewApprovals(userRole: Role): boolean {
  return canApproveLeave(userRole);
}

export function canManageEmployees(userRole: Role): boolean {
  return userRole === "admin";
}

export function canProposeGrants(userRole: Role): boolean {
  return ["manager", "admin"].includes(userRole);
}

export function canManageGrants(userRole: Role): boolean {
  return userRole === "admin";
}
