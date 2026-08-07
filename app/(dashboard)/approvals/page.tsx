import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ApprovalList } from "@/components/features/approvals/approval-list";

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);

  let query = supabase
    .from("leave_requests")
    .select(`
      *,
      employees!inner(first_name, last_name, employee_code, department, manager_id),
      leave_types(name)
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  // If manager, filter to direct reports
  if (user?.role === "manager" && employee) {
    query = query.eq("employees.manager_id", employee.id);
  }

  const { data: requests } = await query;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Pending Approvals</h1>
      <ApprovalList
        requests={requests ?? []}
        approverId={employee?.id ?? ""}
        approverRole={user?.role ?? "employee"}
      />
    </div>
  );
}
