import type { Role } from "./types";

export const ROLES: Role[] = ["employee", "manager", "admin"];

export const ROLE_LABELS: Record<Role, string> = {
  employee: "Employee",
  manager: "Manager",
  admin: "Admin",
};

export const LEAVE_TYPE_DEFAULTS = {
  annual: { name: "Annual Leave", annual_days: 14, requires_approval: true, allow_half_day: true },
  medical: { name: "Medical Leave", annual_days: 7, requires_approval: true, allow_half_day: true },
  compassionate: { name: "Compassionate Leave", annual_days: 0, requires_approval: true, allow_half_day: false },
} as const;

export const GRANT_DRIVEN_LEAVE_TYPES = [
  "Childcare Leave",
  "Hospitalisation Leave",
  "Maternity Leave",
  "Paternity Leave",
  "Unpaid Leave",
  "Off-in-Lieu",
  "Training",
  "Compassionate Leave",
  "Marriage Leave",
  "Shared Parental Leave",
] as const;

export type GrantDrivenLeaveTypeName = (typeof GRANT_DRIVEN_LEAVE_TYPES)[number];

export const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-800",
};
