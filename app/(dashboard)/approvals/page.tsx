import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/features/approvals/approval-list";

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);

  // Base query: pending requests + requester + their manager.
  // `!employees!leave_requests_employee_id_fkey` is the explicit FK; using
  // the relation hint here avoids ambiguity since the table has multiple
  // employees-* relations (employee, approved_by, manager).
  const baseSelect = supabase
    .from("leave_requests")
    .select(`
      id, leave_type_id, start_date, end_date, days, duration_type, reason,
      status, created_at,
      employees!leave_requests_employee_id_fkey(
        id, first_name, last_name, employee_code, department, manager_id
      ),
      leave_types(name)
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  // Scope by role:
  //   - manager: only their direct reports
  //   - hr / admin: all pending requests
  //   - employee: see no pending requests, page shows explanatory empty state
  let scoped = baseSelect;
  if (user?.role === "manager" && employee) {
    scoped = scoped.eq("employees.manager_id", employee.id);
  }

  const { data: requests } = await scoped;

  // Pull the managers' names so the UI can show "Manager: X" for each
  // request — clarifies who *can* approve.
  const managerIds = Array.from(
    new Set(
      (requests ?? [])
        .map((r) => {
          const empList = (r as unknown as { employees: { manager_id: string | null }[] }).employees;
          const emp = Array.isArray(empList) ? empList[0] : null;
          return emp?.manager_id;
        })
        .filter((id): id is string => Boolean(id))
    )
  );
  const { data: managers } = managerIds.length
    ? await supabase
        .from("employees")
        .select("id, first_name, last_name")
        .in("id", managerIds)
    : { data: [] as { id: string; first_name: string; last_name: string }[] };

  const managerNameById = new Map(
    (managers ?? []).map((m) => [m.id, `${m.first_name} ${m.last_name}`])
  );

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Pending Approvals</h1>
      <p className="mb-6 text-sm text-gray-500">
        {user?.role === "manager"
          ? "You can approve leave for your direct reports only."
          : user?.role === "hr" || user?.role === "admin"
          ? "You can approve any pending leave request."
          : "Employees cannot approve leave. Contact your manager or HR."}
      </p>
      <ApprovalList
        requests={requests ?? []}
        managerNameById={Object.fromEntries(managerNameById)}
        viewerRole={user?.role ?? "employee"}
      />
    </div>
  );
}
