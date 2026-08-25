import { redirect } from "next/navigation";
import { canViewApprovals } from "@/lib/auth/permissions";
import { requireRequestContext } from "@/lib/dal/request-context";
import { GRANT_DRIVEN_LEAVE_TYPES } from "@/lib/constants";
import { ApprovalList } from "@/components/features/approvals/approval-list";
import { GrantProposeDialog } from "@/components/features/grants/grant-propose-dialog";
import { GrantApprovalList } from "@/components/features/grants/grant-approval-list";
import { MyGrantsList } from "@/components/features/grants/my-grants-list";

export default async function ApprovalsPage() {
  const { actor, db } = await requireRequestContext();
  const currentEmployeeId = actor.employee?.id ?? null;

  if (!canViewApprovals(actor.role)) {
    redirect("/");
  }
  if (actor.role === "manager" && !currentEmployeeId) {
    redirect("/");
  }

  // Scope manager data before loading leave requests. This keeps requests
  // outside the manager's authorization boundary out of process memory.
  let scopedEmployeeIds: string[] | null = null;
  if (actor.role === "manager" && currentEmployeeId) {
    const { data: directReports, error: reportsError } = await db
      .from("employees")
      .select("id, user_id")
      .eq("manager_id", currentEmployeeId);
    if (reportsError) throw reportsError;

    const reportUserIds = (directReports ?? []).map((report) => report.user_id);
    const { data: reportUsers, error: usersError } = reportUserIds.length
      ? await db.from("users").select("id, role").in("id", reportUserIds)
      : { data: [] as { id: string; role: string }[], error: null };
    if (usersError) throw usersError;

    const roleByUserId = new Map((reportUsers ?? []).map((reportUser) => [reportUser.id, reportUser.role]));
    scopedEmployeeIds = (directReports ?? [])
      .filter((report) => roleByUserId.get(report.user_id) !== "manager")
      .map((report) => report.id);
  }

  // ---- Existing leave-request approvals (unchanged data shape) ----
  const requestQuery = db
      .from("leave_requests")
      .select("id, employee_id, leave_type_id, start_date, end_date, days, duration_type, reason, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
  const { data: rawRequests, error: requestsError } = scopedEmployeeIds?.length === 0
    ? { data: [], error: null }
    : await (scopedEmployeeIds ? requestQuery.in("employee_id", scopedEmployeeIds) : requestQuery);
  if (requestsError) throw requestsError;

  const requestRows = rawRequests ?? [];
  let requestsForList: Parameters<typeof ApprovalList>[0]["requests"] = [];

  if (requestRows.length > 0) {
    const employeeIds = Array.from(new Set(requestRows.map((r) => r.employee_id)));
    const leaveTypeIds = Array.from(new Set(requestRows.map((r) => r.leave_type_id)));
    const [{ data: employees }, { data: leaveTypes }] = await Promise.all([
      db
        .from("employees")
        .select("id, first_name, last_name, employee_code, department, manager_id, user_id")
        .in("id", employeeIds),
      db
        .from("leave_types")
        .select("id, name")
        .in("id", leaveTypeIds),
    ]);
    const userIds = Array.from(new Set((employees ?? []).map((e) => e.user_id)));
    const { data: users } = userIds.length
      ? await db.from("users").select("id, role").in("id", userIds)
      : { data: [] as { id: string; role: string }[] };

    const employeeMap = new Map((employees ?? []).map((e) => [e.id, e]));
    const leaveTypeMap = new Map((leaveTypes ?? []).map((lt) => [lt.id, lt]));
    const userMap = new Map((users ?? []).map((u) => [u.id, u]));

    let mapped = requestRows
      .map((r) => {
        const emp = employeeMap.get(r.employee_id);
        if (!emp) return null;
        const u = userMap.get(emp.user_id);
        return {
          ...r,
          employees: {
            id: emp.id,
            first_name: emp.first_name,
            last_name: emp.last_name,
            employee_code: emp.employee_code,
            department: emp.department,
            manager_id: emp.manager_id,
            users: { role: u?.role ?? "employee" },
          },
          leave_types: leaveTypeMap.get(r.leave_type_id) ?? null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (actor.role === "manager" && currentEmployeeId) {
      mapped = mapped.filter(
        (r) =>
          r.employees.manager_id === currentEmployeeId &&
          r.employees.users.role !== "manager"
      );
    }
    requestsForList = mapped;
  }

  // ---- Compassionate grants ----
  // Admin: pending grants across the org.
  // Manager: their own grants (any status), and the list of direct reports
  // for the propose dialog.
  let pendingGrants: Parameters<typeof GrantApprovalList>[0]["grants"] = [];
  let myGrants: Parameters<typeof MyGrantsList>[0]["grants"] = [];
  let directReportsForDialog: { id: string; first_name: string; last_name: string; employee_code: string }[] = [];

  if (actor.role === "admin") {
    const { data: allTypes } = await db
      .from("leave_types")
      .select("id, name")
      .in("name", [...GRANT_DRIVEN_LEAVE_TYPES]);
    const matchedTypes = (allTypes ?? []).filter((t) =>
      (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(t.name)
    );
    const typeIds = matchedTypes.map((t) => t.id);
    const typeMap = new Map(matchedTypes.map((t) => [t.id, t.name]));

    const { data: raw } = await db
      .from("leave_grants")
      .select("id, employee_id, leave_type_id, days, reason, created_at, created_by, status")
      .eq("status", "pending")
      .in("leave_type_id", typeIds)
      .order("created_at", { ascending: true });
    const rows = raw ?? [];
    if (rows.length > 0) {
      const empIds = Array.from(new Set([...rows.map((r) => r.employee_id), ...rows.map((r) => r.created_by)]));
      const { data: emps } = await db
        .from("employees")
        .select("id, first_name, last_name, employee_code, department")
        .in("id", empIds);
      const empMap = new Map((emps ?? []).map((e) => [e.id, e]));
      pendingGrants = rows
        .map((g) => {
          const emp = empMap.get(g.employee_id);
          const creator = empMap.get(g.created_by);
          if (!emp || !creator) return null;
          return {
            id: g.id,
            leave_type_name: typeMap.get(g.leave_type_id) ?? "Unknown",
            days: Number(g.days),
            reason: g.reason,
            created_at: g.created_at,
            employee: {
              first_name: emp.first_name,
              last_name: emp.last_name,
              employee_code: emp.employee_code,
              department: emp.department,
            },
            created_by_employee: {
              first_name: creator.first_name,
              last_name: creator.last_name,
            },
          };
        })
        .filter((g): g is NonNullable<typeof g> => g !== null);
    }
  } else if (actor.role === "manager" && currentEmployeeId) {
    // Own grants (any status), newest first.
    const { data: allTypes } = await db
      .from("leave_types")
      .select("id, name")
      .in("name", [...GRANT_DRIVEN_LEAVE_TYPES]);
    const matchedTypes = (allTypes ?? []).filter((t) =>
      (GRANT_DRIVEN_LEAVE_TYPES as readonly string[]).includes(t.name)
    );
    const typeMap = new Map(matchedTypes.map((t) => [t.id, t.name]));

    const { data: raw } = await db
      .from("leave_grants")
      .select("id, employee_id, leave_type_id, days, reason, status, created_at, approved_at, rejected_at")
      .eq("created_by", currentEmployeeId)
      .in("leave_type_id", matchedTypes.map((t) => t.id))
      .order("created_at", { ascending: false });
    const rows = raw ?? [];
    if (rows.length > 0) {
      const empIds = Array.from(new Set(rows.map((r) => r.employee_id)));
      const { data: emps } = await db
        .from("employees")
        .select("id, first_name, last_name, employee_code")
        .in("id", empIds);
      const empMap = new Map((emps ?? []).map((e) => [e.id, e]));
      myGrants = rows
        .map((g) => {
          const emp = empMap.get(g.employee_id);
          if (!emp) return null;
          return {
            id: g.id,
            leave_type_name: typeMap.get(g.leave_type_id) ?? "Unknown",
            days: Number(g.days),
            reason: g.reason,
            // schema-constrained enum
            status: g.status as "pending" | "approved" | "rejected",
            created_at: g.created_at,
            approved_at: g.approved_at,
            rejected_at: g.rejected_at,
            employee: {
              first_name: emp.first_name,
              last_name: emp.last_name,
              employee_code: emp.employee_code,
            },
          };
        })
        .filter((g): g is NonNullable<typeof g> => g !== null);
    }
  }

  // Employees for the propose dialog: admins get all active employees
  // (escape hatch), managers get their own direct reports.
  if (actor.role === "admin") {
    const { data: all } = await db
      .from("employees")
      .select("id, first_name, last_name, employee_code")
      .eq("status", "active")
      .order("first_name");
    directReportsForDialog = all ?? [];
  } else if (actor.role === "manager" && currentEmployeeId) {
    const { data: drs } = await db
      .from("employees")
      .select("id, first_name, last_name, employee_code")
      .eq("manager_id", currentEmployeeId)
      .eq("status", "active")
      .order("first_name");
    directReportsForDialog = drs ?? [];
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Pending Approvals</h1>

      {(actor.role === "manager" || actor.role === "admin") && (
        <div className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">Leave Grants</h2>
          <GrantProposeDialog employees={directReportsForDialog} />
        </div>
      )}

      {actor.role === "admin" && (
        <section className="mb-8">
          <h3 className="mb-2 text-sm font-medium text-gray-500">Pending leave grants</h3>
          <GrantApprovalList grants={pendingGrants} />
        </section>
      )}

      {actor.role === "manager" && (
        <section className="mb-8">
          <h3 className="mb-2 text-sm font-medium text-gray-500">My leave grants</h3>
          <MyGrantsList grants={myGrants} />
        </section>
      )}

      <h2 className="mb-2 text-lg font-semibold">Leave Requests</h2>
      <ApprovalList requests={requestsForList} />
    </div>
  );
}
