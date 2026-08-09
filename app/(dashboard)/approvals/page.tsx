import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/features/approvals/approval-list";
import { GrantApprovalList } from "@/components/features/approvals/grant-approval-list";

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);

  // Leave requests queue: raw rows + JS-side hydration. Avoids the
  // PostgREST nested-join failure that surfaces as "no pending approvals"
  // when rows do exist.
  const { data: rawRequests, error: reqError } = await supabase
    .from("leave_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (reqError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Pending Approvals</h1>
        <p className="text-red-600">Error: {reqError.message}</p>
      </div>
    );
  }

  const employeeIds = Array.from(
    new Set((rawRequests ?? []).map((r) => r.employee_id).filter(Boolean) as string[])
  );
  const leaveTypeIds = Array.from(
    new Set((rawRequests ?? []).map((r) => r.leave_type_id).filter(Boolean) as string[])
  );

  const [employeesRes, leaveTypesRes] = await Promise.all([
    employeeIds.length
      ? supabase
          .from("employees")
          .select("id, first_name, last_name, employee_code, department, manager_id, user_id")
          .in("id", employeeIds)
      : Promise.resolve({ data: [] as Array<{ id: string; user_id: string; first_name: string; last_name: string; employee_code: string; department: string; manager_id: string }> }),
    leaveTypeIds.length
      ? supabase.from("leave_types").select("id, name").in("id", leaveTypeIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);
  const employees = employeesRes.data ?? [];
  const leaveTypes = leaveTypesRes.data ?? [];

  const userIds = Array.from(
    new Set(employees.map((e) => e.user_id).filter(Boolean) as string[])
  );
  const usersRes = userIds.length
    ? await supabase.from("users").select("id, role").in("id", userIds)
    : { data: [] as Array<{ id: string; role: string }> };
  const users = usersRes.data ?? [];

  const empById = new Map(employees.map((e) => [e.id, e]));
  const typeById = new Map(leaveTypes.map((t) => [t.id, t]));
  const roleById = new Map(users.map((u) => [u.id, u.role]));

  const requests = (rawRequests ?? [])
    .map((r) => {
      const emp = empById.get(r.employee_id);
      if (!emp) return null;
      return {
        ...r,
        employees: emp,
        leave_types: typeById.get(r.leave_type_id) ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .filter((r) => {
      if (user?.role !== "manager" || !employee) return true;
      if (r.employees.manager_id !== employee.id) return false;
      const requesterRole = roleById.get(r.employees.user_id);
      if (requesterRole === "manager") return false;
      return true;
    });

  // Grants queue: pending compassionate leave grants. Manager sees only
  // their own filings; admin sees all.
  const grantsQuery = supabase
    .from("compassionate_grants")
    .select("id, employee_id, days, reason, status, created_by, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const { data: rawGrants } =
    user?.role === "manager" && employee
      ? await grantsQuery.eq("created_by", employee.id)
      : await grantsQuery;

  // Hydrate grants with employee + filer info.
  const grantEmpIds = Array.from(
    new Set((rawGrants ?? []).map((g) => g.employee_id).filter(Boolean) as string[])
  );
  const grantFilerIds = Array.from(
    new Set((rawGrants ?? []).map((g) => g.created_by).filter(Boolean) as string[])
  );
  const allGrantIds = Array.from(new Set([...grantEmpIds, ...grantFilerIds]));
  const { data: grantEmps } = allGrantIds.length
    ? await supabase
        .from("employees")
        .select("id, first_name, last_name, employee_code, department")
        .in("id", allGrantIds)
    : { data: [] };
  const grantEmpById = new Map((grantEmps ?? []).map((e) => [e.id, e]));

  const grants = (rawGrants ?? [])
    .map((g) => {
      const employee = grantEmpById.get(g.employee_id);
      const filer = grantEmpById.get(g.created_by);
      if (!employee || !filer) return null;
      return {
        id: g.id,
        days: Number(g.days),
        reason: g.reason,
        status: g.status,
        created_at: g.created_at,
        employee,
        filer,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  const hasGrants = grants.length > 0;
  const hasRequests = requests.length > 0;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Pending Approvals</h1>

      {hasGrants && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Compassionate Leave Grants</h2>
          <GrantApprovalList grants={grants} />
        </section>
      )}

      {hasRequests && (
        <section>
          {hasGrants && (
            <h2 className="mb-3 text-lg font-semibold">Leave Requests</h2>
          )}
          <ApprovalList requests={requests} />
        </section>
      )}

      {!hasGrants && !hasRequests && (
        <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
          No pending approvals.
        </div>
      )}
    </div>
  );
}
