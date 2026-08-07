import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCachedLeaveTypes } from "@/lib/cache";
import { LeaveRequestList } from "@/components/features/leave/leave-request-list";
import { LeaveRequestDialog } from "@/components/features/leave/leave-request-dialog";

export default async function LeavePage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { employee } = await getCurrentEmployee(supabase, session?.email);

  const [leaveTypes, { data: balances }, { data: requests }] =
    await Promise.all([
      getCachedLeaveTypes(),
      supabase
        .from("leave_balances")
        .select("*, leave_types(name)")
        .eq("employee_id", employee?.id)
        .eq("year", new Date().getFullYear()),
      supabase
        .from("leave_requests")
        .select("*, leave_types(name)")
        .eq("employee_id", employee?.id)
        .order("created_at", { ascending: false }),
    ]);

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
