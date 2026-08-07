import { getCachedLeaveTypes, getCachedHolidays } from "@/lib/cache";
import { createClient } from "@/lib/supabase/admin";
import { LeaveTypeList } from "@/components/features/policies/leave-type-list";
import { HolidayList } from "@/components/features/policies/holiday-list";
import { HolidayDialog } from "@/components/features/policies/holiday-dialog";
import { CompassionatePolicy, type PolicyEmployee } from "@/components/features/policies/compassionate-policy";

export default async function PoliciesPage() {
  const supabase = await createClient();
  const [leaveTypes, holidays, compassionateRes, allEmployeesRes, allPoliciesRes] =
    await Promise.all([
      getCachedLeaveTypes(),
      getCachedHolidays(),
      supabase
        .from("leave_types")
        .select("id")
        .eq("name", "Compassionate Leave")
        .maybeSingle(),
      supabase
        .from("employees")
        .select("id, first_name, last_name")
        .eq("status", "active")
        .order("first_name"),
      supabase
        .from("employee_leave_policies")
        .select("employee_id, leave_type_id, enabled"),
    ]);

  const compassionateId = compassionateRes.data?.id;
  const allEmployees = allEmployeesRes.data ?? [];
  const policies = allPoliciesRes.data ?? [];

  const compassionateEmployees: PolicyEmployee[] = compassionateId
    ? allEmployees.map((e) => {
        const pol = policies.find(
          (p) => p.employee_id === e.id && p.leave_type_id === compassionateId
        );
        return { ...e, enabled: pol?.enabled ?? false };
      })
    : [];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Policies</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-4 text-lg font-semibold">Leave Types</h2>
          <LeaveTypeList leaveTypes={leaveTypes ?? []} />
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Public Holidays</h2>
            <HolidayDialog />
          </div>
          <HolidayList holidays={holidays ?? []} />
        </div>
      </div>

      {compassionateId && (
        <div className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">Compassionate Leave — Per-Employee</h2>
          <p className="mb-4 text-sm text-gray-500">
            Compassionate Leave is opt-in. Enable only the employees who are entitled to use it.
          </p>
          <CompassionatePolicy
            compassionateId={compassionateId}
            employees={compassionateEmployees}
          />
        </div>
      )}
    </div>
  );
}
