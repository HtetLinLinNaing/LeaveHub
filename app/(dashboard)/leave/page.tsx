import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { getCachedLeaveTypes, getCachedYearHolidays } from "@/lib/cache";
import { getGrantDrivenOverview } from "@/lib/grants";
import { LeaveRequestList } from "@/components/features/leave/leave-request-list";
import { LeaveRequestDialog } from "@/components/features/leave/leave-request-dialog";

export default async function LeavePage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);

  // Admin has no employees row and no leave to manage.
  if (user?.role === "admin") redirect("/");

  const year = new Date().getFullYear();
  const [leaveTypes, { data: balances }, { data: requests }, holidays] =
    await Promise.all([
      getCachedLeaveTypes(),
      supabase
        .from("leave_balances")
        .select("*, leave_types(name)")
        .eq("employee_id", employee?.id)
        .eq("year", year),
      supabase
        .from("leave_requests")
        .select("*, leave_types(name), leave_request_days(date, duration)")
        .eq("employee_id", employee?.id)
        .order("created_at", { ascending: false }),
      getCachedYearHolidays(year),
    ]);

  const grantDrivenOverview = employee
    ? await getGrantDrivenOverview(supabase, employee.id, year)
    : [];

  // Look up the Compassionate entry so we can keep the existing
  // `compassionateAvailable` prop behavior on the request dialog.
  const compassionateEntry = grantDrivenOverview.find(
    (g) => g.leaveTypeName === "Compassionate Leave"
  );

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
        <LeaveRequestDialog
          leaveTypes={leaveTypes ?? []}
          compassionateAvailable={compassionateEntry?.available ?? 0}
          holidays={holidays ?? []}
        />
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
          <p className="mt-1 text-2xl font-bold">
            {compassionateEntry?.available ?? 0}
          </p>
          <p className="text-xs text-gray-400">
            Granted: {compassionateEntry?.granted ?? 0} · Used:{" "}
            {compassionateEntry?.used ?? 0}
          </p>
          {(compassionateEntry?.pending ?? 0) > 0 && (
            <p className="mt-1 text-xs text-yellow-700">
              {compassionateEntry?.pending} day(s) pending admin approval
            </p>
          )}
        </div>
      </div>

      {/* Request list */}
      <LeaveRequestList requests={requests ?? []} />
    </div>
  );
}
