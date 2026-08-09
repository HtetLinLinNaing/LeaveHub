import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { getCachedLeaveTypes } from "@/lib/cache";
import { LeaveRequestList } from "@/components/features/leave/leave-request-list";
import { LeaveRequestDialog } from "@/components/features/leave/leave-request-dialog";
import { GrantCompassionateDialog } from "@/components/features/leave/grant-compassionate-dialog";

interface DirectReport {
  id: string;
  first_name: string;
  last_name: string;
  employee_code: string;
}

export default async function LeavePage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);

  // Admin has no employees row and no leave to manage.
  if (user?.role === "admin") redirect("/");

  // Managers can grant Compassionate Leave for their direct reports.
  const { data: directReports } =
    user?.role === "manager" && employee
      ? await supabase
          .from("employees")
          .select("id, first_name, last_name, employee_code")
          .eq("manager_id", employee.id)
          .eq("status", "active")
          .order("first_name")
      : { data: [] as DirectReport[] };

  // Compassionate leave available = sum(approved grants) - sum(approved usage).
  let compassionateAvailable = 0;
  if (employee) {
    const { data: lt } = await supabase
      .from("leave_types")
      .select("id")
      .eq("name", "Compassionate Leave")
      .maybeSingle();
    if (lt) {
      const [{ data: grants }, { data: used }] = await Promise.all([
        supabase
          .from("compassionate_grants")
          .select("days")
          .eq("employee_id", employee.id)
          .eq("status", "approved"),
        supabase
          .from("leave_requests")
          .select("days")
          .eq("employee_id", employee.id)
          .eq("leave_type_id", lt.id)
          .eq("status", "approved"),
      ]);
      const granted = (grants ?? []).reduce((s, g) => s + Number(g.days), 0);
      const usedDays = (used ?? []).reduce((s, r) => s + Number(r.days), 0);
      compassionateAvailable = Math.max(0, granted - usedDays);
    }
  }

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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">My Leave</h1>
        <div className="flex gap-2">
          {user?.role === "manager" && (directReports ?? []).length > 0 && (
            <GrantCompassionateDialog directReports={directReports ?? []} />
          )}
          <LeaveRequestDialog
            leaveTypes={leaveTypes ?? []}
            compassionateAvailableDays={compassionateAvailable}
          />
        </div>
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
        {employee && (
          <div className="rounded-lg border bg-white p-4">
            <p className="text-sm text-gray-500">Compassionate Leave</p>
            <p className="mt-1 text-2xl font-bold">{compassionateAvailable}</p>
            <p className="text-xs text-gray-400">
              day(s) available from approved grants
            </p>
          </div>
        )}
      </div>

      {/* Request list */}
      <LeaveRequestList requests={requests ?? []} />
    </div>
  );
}
