import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { canApproveLeave, getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { ApprovalList } from "@/components/features/approvals/approval-list";
import type { Role } from "@/lib/types";

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);

  if (!user || !canApproveLeave(user.role as Role)) {
    redirect("/");
  }

  let query = supabase
    .from("leave_requests")
    .select(`
      *,
      employees!inner(id, first_name, last_name, employee_code, department, manager_id),
      leave_types(name)
    `)
    .in("status", ["pending", "approved", "rejected"])
    .order("created_at", { ascending: true });

  // Managers only see their direct reports. HR / admin see all.
  if (user.role === "manager" && employee) {
    query = query.eq("employees.manager_id", employee.id);
  }

  const { data: requests } = await query;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Approvals</h1>
      <ApprovalList requests={requests ?? []} />
    </div>
  );
}
