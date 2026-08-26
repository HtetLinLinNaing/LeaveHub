import type {
  PostgrestResponse,
  SupabaseClient,
} from "@supabase/supabase-js";
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";

async function queryRows<T>(
  promise: PromiseLike<PostgrestResponse<T>>
): Promise<T[]> {
  const result = await promise;
  if (result.error) throw result.error;
  return result.data ?? [];
}

// Query-only seam used by the server-only approvals DAL. It owns terminal
// filters and database error propagation, but no role or resource decisions.
export function createApprovalsQueries(db: SupabaseClient) {
  return {
    loadDirectReports: (managerEmployeeId: string) =>
      queryRows(
        db
          .from("employees")
          .select("id,user_id,first_name,last_name,employee_code,status")
          .eq("manager_id", managerEmployeeId)
          .order("first_name")
      ),

    loadUsers: (userIds: string[]) =>
      queryRows(db.from("users").select("id,role").in("id", userIds)),

    loadPendingRequestRows: (scopedEmployeeIds: string[] | null) => {
      const requestQuery = db
        .from("leave_requests")
        .select("id,employee_id,leave_type_id,start_date,end_date,days,duration_type,reason,status,created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      return queryRows(
        scopedEmployeeIds === null
          ? requestQuery
          : requestQuery.in("employee_id", scopedEmployeeIds)
      );
    },

    loadRequestEmployees: (employeeIds: string[]) =>
      queryRows(
        db
          .from("employees")
          .select("id,first_name,last_name,employee_code,department,manager_id,user_id")
          .in("id", employeeIds)
      ),

    loadLeaveTypesByIds: (leaveTypeIds: string[]) =>
      queryRows(
        db.from("leave_types").select("id,name").in("id", leaveTypeIds)
      ),

    loadGrantDrivenTypes: () =>
      queryRows(
        db
          .from("leave_types")
          .select("id,name")
          .in("name", [...GRANT_DRIVEN_LEAVE_TYPES])
      ),

    loadAdminPendingGrantRows: (typeIds: string[]) =>
      queryRows(
        db
          .from("leave_grants")
          .select("id,employee_id,leave_type_id,days,reason,created_at,created_by,status")
          .eq("status", "pending")
          .in("leave_type_id", typeIds)
          .order("created_at", { ascending: true })
      ),

    loadManagerGrantRows: (managerEmployeeId: string, typeIds: string[]) =>
      queryRows(
        db
          .from("leave_grants")
          .select("id,employee_id,leave_type_id,days,reason,status,created_at,approved_at,rejected_at")
          .eq("created_by", managerEmployeeId)
          .in("leave_type_id", typeIds)
          .order("created_at", { ascending: false })
      ),

    loadPendingGrantEmployees: (employeeIds: string[]) =>
      queryRows(
        db
          .from("employees")
          .select("id,first_name,last_name,employee_code,department")
          .in("id", employeeIds)
      ),

    loadManagerGrantEmployees: (employeeIds: string[]) =>
      queryRows(
        db
          .from("employees")
          .select("id,first_name,last_name,employee_code")
          .in("id", employeeIds)
      ),

    loadActiveEmployees: () =>
      queryRows(
        db
          .from("employees")
          .select("id,first_name,last_name,employee_code")
          .eq("status", "active")
          .order("first_name")
      ),
  };
}
