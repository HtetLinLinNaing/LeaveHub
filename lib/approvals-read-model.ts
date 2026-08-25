import { canViewApprovals } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/session";

export type EmployeeOption = {
  id: string;
  first_name: string;
  last_name: string;
  employee_code: string;
};

export type ManagerScope = {
  scopedEmployeeIds: string[];
  dialogEmployees: EmployeeOption[];
};

export type ApprovalRequestView = {
  id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  duration_type: string;
  reason: string;
  status: string;
  created_at: string;
  employees: {
    id: string;
    first_name: string;
    last_name: string;
    employee_code: string;
    department: string;
    manager_id: string;
  };
  leave_types: { name: string } | null;
};

export type PendingGrantView = {
  id: string;
  leave_type_name: string;
  days: number;
  reason: string;
  created_at: string;
  employee: {
    first_name: string;
    last_name: string;
    employee_code: string;
    department: string;
  };
  created_by_employee: { first_name: string; last_name: string };
};

export type MyGrantView = {
  id: string;
  leave_type_name: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  employee: {
    first_name: string;
    last_name: string;
    employee_code: string;
  };
};

export interface ApprovalsPageData {
  requestsForList: ApprovalRequestView[];
  pendingGrants: PendingGrantView[];
  myGrants: MyGrantView[];
  directReportsForDialog: EmployeeOption[];
}

export interface ApprovalsReader {
  loadManagerScope(managerEmployeeId: string): Promise<ManagerScope>;
  loadPendingRequests(scopedEmployeeIds: string[] | null): Promise<ApprovalRequestView[]>;
  loadAdminPendingGrants(): Promise<PendingGrantView[]>;
  loadManagerOwnGrants(managerEmployeeId: string): Promise<MyGrantView[]>;
  loadActiveEmployees(): Promise<EmployeeOption[]>;
}

export async function composeApprovalsPageData(
  actor: Actor,
  reader: ApprovalsReader
): Promise<ApprovalsPageData | null> {
  if (!canViewApprovals(actor.role)) return null;
  if (actor.role === "manager" && !actor.employee) return null;

  const managerScope = actor.role === "manager"
    ? await reader.loadManagerScope(actor.employee!.id)
    : null;
  const requestScope = managerScope?.scopedEmployeeIds ?? null;

  const [requestsForList, grantData, directReportsForDialog] = await Promise.all([
    requestScope?.length === 0
      ? Promise.resolve([])
      : reader.loadPendingRequests(requestScope),
    actor.role === "admin"
      ? reader.loadAdminPendingGrants().then((pendingGrants) => ({ pendingGrants, myGrants: [] }))
      : reader.loadManagerOwnGrants(actor.employee!.id).then((myGrants) => ({ pendingGrants: [], myGrants })),
    actor.role === "admin"
      ? reader.loadActiveEmployees()
      : Promise.resolve(managerScope!.dialogEmployees),
  ]);

  return { requestsForList, ...grantData, directReportsForDialog };
}
