import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { getCachedLeaveTypes } from "@/lib/cache";
import { getCompassionateAvailability } from "@/lib/compassionate";
import { LeaveRequestList } from "@/components/features/leave/leave-request-list";
import { LeaveRequestDialog } from "@/components/features/leave/leave-request-dialog";

export default async function LeavePage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);

  // Admin has no employees row and no leave to manage.
  if (user?.role === "admin") redirect("/");

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

  const compassionate = employee
    ? await getCompassionateAvailability(supabase, employee.id, new Date().getFullYear())
    : { granted: 0, used: 0, available: 0, pending: 0 };

  // Compassionate Leave is rendered separately with derived values. Drop
  // any stale leave_balances row for it so the old card doesn't appear.
  // PostgREST nested-join filters silently return zero rows on this project,
  // so we filter in JS after hydration.
  const visibleBalances = (balances ?? []).filter(
    (b) => b.leave_types?.name !== "Compassionate Leave"
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Leave</h1>
        <LeaveRequestDialog leaveTypes={leaveTypes ?? []} />
      </div>

      {/* Balance cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {visibleBalances.map((b) => (
          <div key={b.id} className="rounded-lg border bg-white p-4">
            <p className="text-sm text-gray-500">{b.leave_types?.name}</p>
            <p className="mt-1 text-2xl font-bold">{b.remaining_days}</p>
            <p className="text-xs text-gray-400">
              of {b.allocated_days + b.carry_forward_days} days remaining
            </p>
          </div>
        ))}
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Compassionate Leave</p>
          <p className="mt-1 text-2xl font-bold">{compassionate.available}</p>
          <p className="text-xs text-gray-400">
            Granted: {compassionate.granted} · Used: {compassionate.used}
          </p>
          {compassionate.pending > 0 && (
            <p className="mt-1 text-xs text-yellow-700">
              {compassionate.pending} day(s) pending admin approval
            </p>
          )}
        </div>
      </div>

      {/* Request list */}
      <LeaveRequestList requests={requests ?? []} />
    </div>
  );
}
