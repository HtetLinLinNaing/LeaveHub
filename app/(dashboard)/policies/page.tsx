import { createClient } from "@/lib/supabase/server";
import { LeaveTypeList } from "@/components/features/policies/leave-type-list";
import { HolidayList } from "@/components/features/policies/holiday-list";
import { HolidayDialog } from "@/components/features/policies/holiday-dialog";

export default async function PoliciesPage() {
  const supabase = await createClient();

  const { data: leaveTypes } = await supabase
    .from("leave_types")
    .select("*")
    .order("name");

  const { data: holidays } = await supabase
    .from("holidays")
    .select("*")
    .order("date");

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
    </div>
  );
}
