import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/features/approvals/approval-list";

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);

  // Routing per org chart:
  //   employee request → manager
  //   manager request  → HR
  //   admin sees everything
  let query = supabase
    .from("leave_requests")
    .select(`
      *,
      employees!leave_requests_employee_id_fkey(
        id, first_name, last_name, employee_code, department, manager_id,
        users!employees_user_id_fkey(role)
      ),
      leave_types(name)
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (user?.role === "manager") {
    query = query.eq("employees.users.role", "employee");
  } else if (user?.role === "hr") {
    query = query.eq("employees.users.role", "manager");
  }
  // admin: no filter

  const { data: requests } = await query;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Pending Approvals</h1>
      <ApprovalList requests={requests ?? []} />
    </div>
  );
}
