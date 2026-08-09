import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/features/approvals/approval-list";

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);

  // PostgREST nested joins silently return zero rows on this project.
  // Fetch the raw pending rows, then hydrate employee + leave_type fields
  // in JS — same pattern as the calendar page.
  const { data: rawRequests } = await supabase
    .from("leave_requests")
    .select("id, employee_id, leave_type_id, start_date, end_date, days, duration_type, reason, status, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const requestRows = rawRequests ?? [];
  if (requestRows.length === 0) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Pending Approvals</h1>
        <ApprovalList requests={[]} />
      </div>
    );
  }

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

  // We need the role of each requester for the manager-scope check.
  // Fetch users separately and key by id, then map via employees.user_id.
  const userIds = Array.from(
    new Set((employees ?? []).map((e) => e.user_id))
  );
  const { data: users } = userIds.length
    ? await supabase.from("users").select("id, role").in("id", userIds)
    : { data: [] as { id: string; role: string }[] };

  const employeeMap = new Map((employees ?? []).map((e) => [e.id, e]));
  const leaveTypeMap = new Map((leaveTypes ?? []).map((lt) => [lt.id, lt]));
  const userMap = new Map((users ?? []).map((u) => [u.id, u]));

  let requests = requestRows
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

  // Manager: only direct reports who are not themselves managers.
  if (user?.role === "manager" && employee) {
    requests = requests.filter(
      (r) =>
        r.employees.manager_id === employee.id &&
        r.employees.users.role !== "manager"
    );
  }
  // Admin: no filter.

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Pending Approvals</h1>
      <ApprovalList requests={requests} />
    </div>
  );
}
