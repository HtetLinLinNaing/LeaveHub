import { requireRequestContext } from "@/lib/dal/request-context";
import { getCachedYearHolidays } from "@/lib/cache";
import { TeamCalendar } from "@/components/features/calendar/team-calendar";

export default async function CalendarPage() {
  const { db } = await requireRequestContext();
  const year = new Date().getFullYear();

  // Fetch raw approved rows, then hydrate employee + leave_type in JS.
  // PostgREST nested joins silently return 0 rows in this project; the
  // JS-side pattern is what makes /approvals render correctly.
  const { data: rawLeave, error: rawLeaveError } = await db
    .from("leave_requests")
    .select("id, employee_id, leave_type_id, start_date, end_date, days, duration_type")
    .eq("status", "approved")
    .gte("end_date", `${year}-01-01`)
    .lte("start_date", `${year}-12-31`);
  if (rawLeaveError) throw rawLeaveError;

  const employeeIds = Array.from(
    new Set((rawLeave ?? []).map((r) => r.employee_id).filter(Boolean) as string[])
  );
  const leaveTypeIds = Array.from(
    new Set((rawLeave ?? []).map((r) => r.leave_type_id).filter(Boolean) as string[])
  );

  const [holidays, employeesRes, leaveTypesRes] = await Promise.all([
    getCachedYearHolidays(year),
    employeeIds.length
      ? db
          .from("employees")
          .select("id, first_name, last_name, department")
          .in("id", employeeIds)
      : Promise.resolve({ data: [] as Array<{ id: string; first_name: string; last_name: string; department: string }>, error: null }),
    leaveTypeIds.length
      ? db.from("leave_types").select("id, name").in("id", leaveTypeIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
  ]);
  if (employeesRes.error) throw employeesRes.error;
  if (leaveTypesRes.error) throw leaveTypesRes.error;

  const empById = new Map((employeesRes.data ?? []).map((e) => [e.id, e]));
  const typeById = new Map((leaveTypesRes.data ?? []).map((t) => [t.id, t]));

  const leaveRequests = (rawLeave ?? [])
    .map((r) => {
      const emp = empById.get(r.employee_id);
      const lt = typeById.get(r.leave_type_id);
      if (!emp || !lt) return null;
      return {
        id: r.id,
        start_date: r.start_date,
        end_date: r.end_date,
        employees: emp,
        leave_types: lt,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Team Calendar</h1>
      <TeamCalendar
        holidays={holidays ?? []}
        leaveRequests={leaveRequests}
        year={year}
      />
    </div>
  );
}
