import { createClient } from "@/lib/supabase/server";
import { getCachedYearHolidays } from "@/lib/cache";
import { TeamCalendar } from "@/components/features/calendar/team-calendar";

export default async function CalendarPage() {
  const supabase = await createClient();
  const year = new Date().getFullYear();

  const [holidays, { data: leaveRequests }] = await Promise.all([
    getCachedYearHolidays(year),
    supabase
      .from("leave_requests")
      .select("*, employees(first_name, last_name, department), leave_types(name)")
      .eq("status", "approved")
      .gte("end_date", `${year}-01-01`)
      .lte("start_date", `${year}-12-31`),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Team Calendar</h1>
      <TeamCalendar
        holidays={holidays ?? []}
        leaveRequests={leaveRequests ?? []}
        year={year}
      />
    </div>
  );
}
