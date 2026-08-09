import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/features/approvals/approval-list";

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);

  // Simplest possible query: just the rows. If this returns nothing, the
  // problem is the .eq("status", "pending") filter or RLS, not the joins.
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

  // If we got rows, hydrate the related employee + leave_type in JS so we
  // never touch PostgREST's relationship resolver.
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
      : Promise.resolve({ data: [] as Array<{ id: string; user_id: string }> }),
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

  const empById = new Map((employees ?? []).map((e) => [e.id, e]));
  const typeById = new Map((leaveTypes ?? []).map((t) => [t.id, t]));
  const roleById = new Map((users ?? []).map((u) => [u.id, u.role]));

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

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Pending Approvals</h1>
      {rawRequests && rawRequests.length > requests.length && (
        <p className="mb-2 text-sm text-amber-600">
          Debug: {rawRequests.length} raw rows, {requests.length} after filter.
        </p>
      )}
      <ApprovalList requests={requests} />
    </div>
  );
}
