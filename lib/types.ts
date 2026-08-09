export type Role = "employee" | "manager" | "admin";

export type EmployeeStatus = "active" | "inactive";

export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type DurationType = "full_day" | "half_day";

export interface User {
  id: string;
  email: string;
  role: Role;
  created_at: string;
}

export interface Employee {
  id: string;
  user_id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  department: string;
  manager_id: string | null;
  join_date: string;
  status: EmployeeStatus;
}

export interface LeaveType {
  id: string;
  name: string;
  annual_days: number;
  requires_approval: boolean;
  allow_half_day: boolean;
}

export interface LeaveBalance {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  allocated_days: number;
  used_days: number;
  remaining_days: number;
  carry_forward_days: number;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  duration_type: DurationType;
  reason: string;
  status: LeaveRequestStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
}

// Joined types for UI
export interface LeaveRequestWithDetails extends LeaveRequest {
  employee: Pick<Employee, "first_name" | "last_name" | "employee_code" | "department">;
  leave_type: Pick<LeaveType, "name">;
}

export interface EmployeeWithUser extends Employee {
  users: Pick<User, "email" | "role">;
}

export type LeaveGrantStatus = "pending" | "approved" | "rejected";

export interface LeaveGrant {
  id: string;
  employee_id: string;
  leave_type_id: string;
  days: number;
  reason: string;
  status: LeaveGrantStatus;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface LeaveGrantWithDetails extends LeaveGrant {
  employee: Pick<Employee, "first_name" | "last_name" | "employee_code" | "department">;
  created_by_employee: Pick<Employee, "first_name" | "last_name">;
}
