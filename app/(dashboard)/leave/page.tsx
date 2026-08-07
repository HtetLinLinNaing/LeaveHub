import { cookies } from "next/headers";
import { getMockSessionFromCookie } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LeaveRequestList } from "@/components/features/leave/leave-request-list";
import { LeaveRequestDialog } from "@/components/features/leave/leave-request-dialog";

export default async function LeavePage() {
  const cookieStore = await cookies();
  const session = getMockSessionFromCookie(cookieStore.toString());
  const supabase = await createClient();

  // Get user's employee record
  const { data: user } = await supabase
    .from("users")
    .select("id, role")
    .eq("email", session?.email)
    .single();

  const { data: employee } = await supabase
    .from("employees")
    .select("id, first_name, last_name")
    .eq("user_id", user?.id)
    .single();

  // Get leave types for the form
  const { data: leaveTypes } = await supabase
    .from("leave_types")
    .select("*")
    .order("name");

  // Get leave balances
  const { data: balances } = await supabase
    .from("leave_balances")
    .select("*, leave_types(name)")
    .eq("employee_id", employee?.id)
    .eq("year", new Date().getFullYear());

  // Get leave requests
  const { data: requests } = await supabase
    .from("leave_requests")
    .select("*, leave_types(name)")
    .eq("employee_id", employee?.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Leave</h1>
        <LeaveRequestDialog
          leaveTypes={leaveTypes ?? []}
          employeeId={employee?.id ?? ""}
        />
      </div>

      {/* Balance cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {(balances ?? []).map((b) => (
          <div
            key={b.id}
            className="rounded-lg border bg-white p-4"
          >
            <p className="text-sm text-gray-500">{b.leave_types?.name}</p>
            <p className="mt-1 text-2xl font-bold">{b.remaining_days}</p>
            <p className="text-xs text-gray-400">
              of {b.allocated_days + b.carry_forward_days} days remaining
            </p>
          </div>
        ))}
      </div>

      {/* Request list */}
      <LeaveRequestList requests={requests ?? []} />
    </div>
  );
}
