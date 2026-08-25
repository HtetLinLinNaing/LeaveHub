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

export function createApprovalsReader(db: SupabaseClient): ApprovalsReader {
  return {
    async loadManagerScope(managerEmployeeId) {
      const { data: directReports, error: reportsError } = await db
        .from("employees")
        .select("id,user_id,first_name,last_name,employee_code,status")
        .eq("manager_id", managerEmployeeId)
        .order("first_name");
      if (reportsError) throw reportsError;

      const reportUserIds = Array.from(
        new Set((directReports ?? []).map((report) => report.user_id))
      );
      const { data: reportUsers, error: usersError } = reportUserIds.length
        ? await db.from("users").select("id,role").in("id", reportUserIds)
        : { data: [] as { id: string; role: string }[], error: null };
      if (usersError) throw usersError;

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
      const requestQuery = db
        .from("leave_requests")
        .select("id,employee_id,leave_type_id,start_date,end_date,days,duration_type,reason,status,created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      const { data: rawRequests, error: requestsError } = await (
        scopedEmployeeIds === null
          ? requestQuery
          : requestQuery.in("employee_id", scopedEmployeeIds)
      );
      if (requestsError) throw requestsError;

      const requestRows = rawRequests ?? [];
      if (requestRows.length === 0) return [];

      const employeeIds = Array.from(
        new Set(requestRows.map((request) => request.employee_id))
      );
      const leaveTypeIds = Array.from(
        new Set(requestRows.map((request) => request.leave_type_id))
      );
      const [employeesResult, leaveTypesResult] = await Promise.all([
        db
          .from("employees")
          .select("id,first_name,last_name,employee_code,department,manager_id,user_id")
          .in("id", employeeIds),
        db
          .from("leave_types")
          .select("id,name")
          .in("id", leaveTypeIds),
      ]);
      if (employeesResult.error) throw employeesResult.error;
      if (leaveTypesResult.error) throw leaveTypesResult.error;

      const employees = employeesResult.data ?? [];
      const leaveTypes = leaveTypesResult.data ?? [];
      const userIds = Array.from(
        new Set(employees.map((employee) => employee.user_id))
      );
      const { data: users, error: usersError } = userIds.length
        ? await db.from("users").select("id,role").in("id", userIds)
        : { data: [] as { id: string; role: string }[], error: null };
      if (usersError) throw usersError;

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
      const { data: allTypes, error: typesError } = await db
        .from("leave_types")
        .select("id,name")
        .in("name", [...GRANT_DRIVEN_LEAVE_TYPES]);
      if (typesError) throw typesError;

      const matchedTypes = (allTypes ?? []).filter((type) =>
        (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(type.name)
      );
      const typeIds = matchedTypes.map((type) => type.id);
      const typeMap = new Map(
        matchedTypes.map((type) => [type.id, type.name])
      );

      const { data: rawGrants, error: grantsError } = await db
        .from("leave_grants")
        .select("id,employee_id,leave_type_id,days,reason,created_at,created_by,status")
        .eq("status", "pending")
        .in("leave_type_id", typeIds)
        .order("created_at", { ascending: true });
      if (grantsError) throw grantsError;

      const grantRows = rawGrants ?? [];
      if (grantRows.length === 0) return [];

      const employeeIds = Array.from(
        new Set([
          ...grantRows.map((grant) => grant.employee_id),
          ...grantRows.map((grant) => grant.created_by),
        ])
      );
      const { data: employees, error: employeesError } = await db
        .from("employees")
        .select("id,first_name,last_name,employee_code,department")
        .in("id", employeeIds);
      if (employeesError) throw employeesError;

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
      const { data: allTypes, error: typesError } = await db
        .from("leave_types")
        .select("id,name")
        .in("name", [...GRANT_DRIVEN_LEAVE_TYPES]);
      if (typesError) throw typesError;

      const matchedTypes = (allTypes ?? []).filter((type) =>
        (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(type.name)
      );
      const typeMap = new Map(
        matchedTypes.map((type) => [type.id, type.name])
      );

      const { data: rawGrants, error: grantsError } = await db
        .from("leave_grants")
        .select("id,employee_id,leave_type_id,days,reason,status,created_at,approved_at,rejected_at")
        .eq("created_by", managerEmployeeId)
        .in("leave_type_id", matchedTypes.map((type) => type.id))
        .order("created_at", { ascending: false });
      if (grantsError) throw grantsError;

      const grantRows = rawGrants ?? [];
      if (grantRows.length === 0) return [];

      const employeeIds = Array.from(
        new Set(grantRows.map((grant) => grant.employee_id))
      );
      const { data: employees, error: employeesError } = await db
        .from("employees")
        .select("id,first_name,last_name,employee_code")
        .in("id", employeeIds);
      if (employeesError) throw employeesError;

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
      const { data: employees, error } = await db
        .from("employees")
        .select("id,first_name,last_name,employee_code")
        .eq("status", "active")
        .order("first_name");
      if (error) throw error;
      return employees ?? [];
    },
  };
}

export function loadApprovalsPageData(actor: Actor, db: SupabaseClient) {
  return composeApprovalsPageData(actor, createApprovalsReader(db));
}
