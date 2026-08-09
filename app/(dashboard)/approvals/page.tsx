import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/features/approvals/approval-list";

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);

  // Fetch pending requests with the requester's employee + user role. We
  // resolve the role in two steps (employee -> user) to avoid PostgREST
  // relationship resolution issues with nested !inner joins.
  const { data: rawRequests } = await supabase
    .from("leave_requests")
    .select(`
      *,
      employees!inner(id, first_name, last_name, employee_code, department, manager_id, user_id),
      leave_types(name)
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  // Bulk-load the requester users so we can read each one's role.
  const userIds = Array.from(
    new Set((rawRequests ?? []).map((r) => r.employees?.user_id).filter(Boolean) as string[])
  );
  const { data: requesterUsers } = userIds.length
    ? await supabase.from("users").select("id, role").in("id", userIds)
    : { data: [] };
  const roleById = new Map((requesterUsers ?? []).map((u) => [u.id, u.role]));

  // Manager: only direct reports who are not themselves managers.
  // Admin: no filter.
  const requests = (rawRequests ?? []).filter((r) => {
    if (user?.role !== "manager" || !employee) return true;
    if (r.employees.manager_id !== employee.id) return false;
    const requesterRole = roleById.get(r.employees.user_id);
    if (requesterRole === "manager") return false;
    return true;
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Pending Approvals</h1>
      <ApprovalList requests={requests} />
    </div>
  );
}
