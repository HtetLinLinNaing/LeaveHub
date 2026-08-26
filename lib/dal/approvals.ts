import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  composeApprovalsPageData,
  type ApprovalRequestView,
  type ApprovalsReader,
  type EmployeeOption,
  type MyGrantView,
  type PendingGrantView,
} from "@/lib/approvals-read-model";
import type { Actor } from "@/lib/auth/session";
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";
import { createApprovalsQueries } from "@/lib/approvals-supabase-queries";

export function createApprovalsReader(db: SupabaseClient): ApprovalsReader {
  const queries = createApprovalsQueries(db);

  return {
    async loadManagerScope(managerEmployeeId) {
      const directReports = await queries.loadDirectReports(managerEmployeeId);

      const reportUserIds = Array.from(
        new Set((directReports ?? []).map((report) => report.user_id))
      );
      const reportUsers = reportUserIds.length
        ? await queries.loadUsers(reportUserIds)
        : [];

      const roleByUserId = new Map(
        (reportUsers ?? []).map((reportUser) => [reportUser.id, reportUser.role])
      );
      const scopedEmployeeIds = (directReports ?? [])
        .filter((report) => roleByUserId.get(report.user_id) !== "manager")
        .map((report) => report.id);
      const dialogEmployees: EmployeeOption[] = (directReports ?? [])
        .filter((report) => report.status === "active")
        .map(({ id, first_name, last_name, employee_code }) => ({
          id,
          first_name,
          last_name,
          employee_code,
        }));

      return { scopedEmployeeIds, dialogEmployees };
    },

    async loadPendingRequests(scopedEmployeeIds) {
      const requestRows = await queries.loadPendingRequestRows(
        scopedEmployeeIds
      );
      if (requestRows.length === 0) return [];

      const employeeIds = Array.from(
        new Set(requestRows.map((request) => request.employee_id))
      );
      const leaveTypeIds = Array.from(
        new Set(requestRows.map((request) => request.leave_type_id))
      );
      const [employees, leaveTypes] = await Promise.all([
        queries.loadRequestEmployees(employeeIds),
        queries.loadLeaveTypesByIds(leaveTypeIds),
      ]);
      const userIds = Array.from(
        new Set(employees.map((employee) => employee.user_id))
      );
      const users = userIds.length ? await queries.loadUsers(userIds) : [];

      const employeeMap = new Map(
        employees.map((employee) => [employee.id, employee])
      );
      const leaveTypeMap = new Map(
        leaveTypes.map((leaveType) => [leaveType.id, leaveType])
      );
      const userMap = new Map((users ?? []).map((user) => [user.id, user]));

      return requestRows
        .map((request): ApprovalRequestView | null => {
          const employee = employeeMap.get(request.employee_id);
          if (!employee) return null;
          const user = userMap.get(employee.user_id);
          if (scopedEmployeeIds !== null && user?.role === "manager") return null;

          return {
            id: request.id,
            leave_type_id: request.leave_type_id,
            start_date: request.start_date,
            end_date: request.end_date,
            days: Number(request.days),
            duration_type: request.duration_type,
            reason: request.reason,
            status: request.status,
            created_at: request.created_at,
            employees: {
              id: employee.id,
              first_name: employee.first_name,
              last_name: employee.last_name,
              employee_code: employee.employee_code,
              department: employee.department,
              manager_id: employee.manager_id,
            },
            leave_types: leaveTypeMap.get(request.leave_type_id) ?? null,
          };
        })
        .filter((request): request is ApprovalRequestView => request !== null);
    },

    async loadAdminPendingGrants() {
      const allTypes = await queries.loadGrantDrivenTypes();

      const matchedTypes = (allTypes ?? []).filter((type) =>
        (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(type.name)
      );
      const typeIds = matchedTypes.map((type) => type.id);
      const typeMap = new Map(
        matchedTypes.map((type) => [type.id, type.name])
      );

      const grantRows = await queries.loadAdminPendingGrantRows(typeIds);
      if (grantRows.length === 0) return [];

      const employeeIds = Array.from(
        new Set([
          ...grantRows.map((grant) => grant.employee_id),
          ...grantRows.map((grant) => grant.created_by),
        ])
      );
      const employees = await queries.loadPendingGrantEmployees(employeeIds);

      const employeeMap = new Map(
        (employees ?? []).map((employee) => [employee.id, employee])
      );
      return grantRows
        .map((grant): PendingGrantView | null => {
          const employee = employeeMap.get(grant.employee_id);
          const creator = employeeMap.get(grant.created_by);
          if (!employee || !creator) return null;

          return {
            id: grant.id,
            leave_type_name: typeMap.get(grant.leave_type_id) ?? "Unknown",
            days: Number(grant.days),
            reason: grant.reason,
            created_at: grant.created_at,
            employee: {
              first_name: employee.first_name,
              last_name: employee.last_name,
              employee_code: employee.employee_code,
              department: employee.department,
            },
            created_by_employee: {
              first_name: creator.first_name,
              last_name: creator.last_name,
            },
          };
        })
        .filter((grant): grant is PendingGrantView => grant !== null);
    },

    async loadManagerOwnGrants(managerEmployeeId) {
      const allTypes = await queries.loadGrantDrivenTypes();

      const matchedTypes = (allTypes ?? []).filter((type) =>
        (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(type.name)
      );
      const typeMap = new Map(
        matchedTypes.map((type) => [type.id, type.name])
      );

      const grantRows = await queries.loadManagerGrantRows(
        managerEmployeeId,
        matchedTypes.map((type) => type.id)
      );
      if (grantRows.length === 0) return [];

      const employeeIds = Array.from(
        new Set(grantRows.map((grant) => grant.employee_id))
      );
      const employees = await queries.loadManagerGrantEmployees(employeeIds);

      const employeeMap = new Map(
        (employees ?? []).map((employee) => [employee.id, employee])
      );
      return grantRows
        .map((grant): MyGrantView | null => {
          const employee = employeeMap.get(grant.employee_id);
          if (!employee) return null;

          return {
            id: grant.id,
            leave_type_name: typeMap.get(grant.leave_type_id) ?? "Unknown",
            days: Number(grant.days),
            reason: grant.reason,
            status: grant.status as MyGrantView["status"],
            created_at: grant.created_at,
            approved_at: grant.approved_at,
            rejected_at: grant.rejected_at,
            employee: {
              first_name: employee.first_name,
              last_name: employee.last_name,
              employee_code: employee.employee_code,
            },
          };
        })
        .filter((grant): grant is MyGrantView => grant !== null);
    },

    async loadActiveEmployees() {
      return queries.loadActiveEmployees();
    },
  };
}

export function loadApprovalsPageData(actor: Actor, db: SupabaseClient) {
  return composeApprovalsPageData(actor, createApprovalsReader(db));
}
