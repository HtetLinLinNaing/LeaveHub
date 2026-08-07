import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { LeaveRequestList } from "@/components/features/leave/leave-request-list";
import { LeaveRequestDialog } from "@/components/features/leave/leave-request-dialog";
import type { LeaveType } from "@/lib/types";

export default async function LeavePage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { employee } = await getCurrentEmployee(supabase, session?.email);

  const year = new Date().getFullYear();

  // Pull all policy rows (enabled AND disabled) so we can show a disabled
  // Compassionate card with 0 days when HR has not opted the user in.
  const [{ data: policies }, { data: balances }, { data: requests }] =
    await Promise.all([
      supabase
        .from("employee_leave_policies")
        .select("enabled, allocated_days, leave_types(*)")
        .eq("employee_id", employee?.id ?? ""),
      supabase
        .from("leave_balances")
        .select("*, leave_types(name)")
        .eq("employee_id", employee?.id)
        .eq("year", year),
      supabase
        .from("leave_requests")
        .select("*, leave_types(name)")
        .eq("employee_id", employee?.id)
        .order("created_at", { ascending: false }),
    ]);

  const enabledLeaveTypes: LeaveType[] = (policies ?? [])
    .filter((p) => p.enabled)
    .map((p) => (Array.isArray(p.leave_types) ? p.leave_types[0] : p.leave_types))
    .filter((lt): lt is LeaveType => Boolean(lt));

  // Balance cards: one per policy row (enabled or not). Compassionate shows
  // 0 days and an "opt-in required" hint when the row exists but is disabled.
  type Card = { enabled: boolean; allocated_days: number; leaveType: LeaveType };
  const policyCards: Card[] = (policies ?? []).flatMap((p) => {
    const lt = Array.isArray(p.leave_types) ? p.leave_types[0] : p.leave_types;
    if (!lt) return [];
    return [{ enabled: p.enabled, allocated_days: p.allocated_days, leaveType: lt as LeaveType }];
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Leave</h1>
        <LeaveRequestDialog leaveTypes={enabledLeaveTypes} />
      </div>

      {/* Balance cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {policyCards.map((card) => {
          const balance = (balances ?? []).find(
            (b) => b.leave_types?.name === card.leaveType.name
          );
          const remaining = card.enabled ? (balance?.remaining_days ?? card.allocated_days) : 0;
          const allocated = card.enabled
            ? (balance?.allocated_days ?? card.allocated_days) + (balance?.carry_forward_days ?? 0)
            : 0;
          return (
            <div
              key={card.leaveType.id}
              className={`rounded-lg border bg-white p-4 ${!card.enabled ? "opacity-60" : ""}`}
            >
              <p className="text-sm text-gray-500">
                {card.leaveType.name}
                {!card.enabled && (
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                    Not enabled — contact HR
                  </span>
                )}
              </p>
              <p className="mt-1 text-2xl font-bold">{remaining}</p>
              <p className="text-xs text-gray-400">
                {card.enabled
                  ? `of ${allocated} days remaining`
                  : "0 days — opt-in required"}
              </p>
            </div>
          );
        })}
      </div>

      {/* Request list */}
      <LeaveRequestList requests={requests ?? []} />
    </div>
  );
}
