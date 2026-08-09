import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/features/approvals/approval-list";
import { GrantProposeDialog } from "@/components/features/grants/grant-propose-dialog";
import { GrantApprovalList } from "@/components/features/grants/grant-approval-list";
import { MyGrantsList } from "@/components/features/grants/my-grants-list";

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);
  const currentEmployeeId = employee?.id ?? null;

  // ---- Existing leave-request approvals (unchanged data shape) ----
  const { data: rawRequests } = await supabase
    .from("leave_requests")
    .select("id, employee_id, leave_type_id, start_date, end_date, days, duration_type, reason, status, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const requestRows = rawRequests ?? [];
  let requestsForList: Parameters<typeof ApprovalList>[0]["requests"] = [];

  if (requestRows.length > 0) {
    const employeeIds = Array.from(new Set(requestRows.map((r) => r.employee_id)));
    const leaveTypeIds = Array.from(new Set(requestRows.map((r) => r.leave_type_id)));
    const [{ data: employees }, { data: leaveTypes }] = await Promise.all([
      supabase
        .from("employees")
        .select("id, first_name, last_name, employee_code, department, manager_id, user_id")
        .in("id", employeeIds),
      supabase
        .from("leave_types")
        .select("id, name")
        .in("id", leaveTypeIds),
    ]);
    const userIds = Array.from(new Set((employees ?? []).map((e) => e.user_id)));
    const { data: users } = userIds.length
      ? await supabase.from("users").select("id, role").in("id", userIds)
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

    if (user?.role === "manager" && currentEmployeeId) {
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

  if (user?.role === "admin") {
    const { data: raw } = await supabase
      .from("leave_grants")
      .select("id, employee_id, days, reason, created_at, created_by, status")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    const rows = raw ?? [];
    if (rows.length > 0) {
      const empIds = Array.from(new Set([...rows.map((r) => r.employee_id), ...rows.map((r) => r.created_by)]));
      const { data: emps } = await supabase
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
  } else if (user?.role === "manager" && currentEmployeeId) {
    // Own grants (any status), newest first.
    const { data: raw } = await supabase
      .from("leave_grants")
      .select("id, employee_id, days, reason, status, created_at, approved_at, rejected_at")
      .eq("created_by", currentEmployeeId)
      .order("created_at", { ascending: false });
    const rows = raw ?? [];
    if (rows.length > 0) {
      const empIds = Array.from(new Set(rows.map((r) => r.employee_id)));
      const { data: emps } = await supabase
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
            days: Number(g.days),
            reason: g.reason,
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
    // Direct reports for the propose dialog.
    const { data: drs } = await supabase
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

      {(user?.role === "manager" || user?.role === "admin") && (
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Compassionate Leave Grants</h2>
          <GrantProposeDialog employees={directReportsForDialog} />
        </div>
      )}

      {user?.role === "admin" && (
        <section className="mb-8">
          <h3 className="mb-2 text-sm font-medium text-gray-500">Pending grants</h3>
          <GrantApprovalList grants={pendingGrants} />
        </section>
      )}

      {user?.role === "manager" && (
        <section className="mb-8">
          <h3 className="mb-2 text-sm font-medium text-gray-500">My grants</h3>
          <MyGrantsList grants={myGrants} />
        </section>
      )}

      <h2 className="mb-2 text-lg font-semibold">Leave Requests</h2>
      <ApprovalList requests={requestsForList} />
    </div>
  );
}
