import { cookies } from "next/headers";
import { getMockSessionFromCookie } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ApprovalList } from "@/components/features/approvals/approval-list";

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getMockSessionFromCookie(cookieStore.toString());
  const supabase = await createClient();

  // Get user's role and employee record
  const { data: user } = await supabase
    .from("users")
    .select("id, role")
    .eq("email", session?.email)
    .single();

  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", user?.id)
    .single();

  // Get pending requests for this manager's team
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

  // HR sees all pending requests
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
