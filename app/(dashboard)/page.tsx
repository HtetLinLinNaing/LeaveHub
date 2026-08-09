import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/admin";
import { getCachedYearHolidays } from "@/lib/cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STATUS_COLORS } from "@/lib/constants";
import { getCompassionateAvailability } from "@/lib/compassionate";
import { differenceInCalendarDays, format } from "date-fns";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { user, employee } = await getCurrentEmployee(supabase, session?.email);
  const today = format(new Date(), "yyyy-MM-dd");
  const year = new Date().getFullYear();

  if (user?.role === "admin") {
    const startOfMonth = format(new Date(year, new Date().getMonth(), 1), "yyyy-MM-dd");
    const [
      { count: pendingCount },
      { count: approvedThisMonth },
      { count: onLeaveToday },
      holidays,
    ] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("leave_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "approved")
        .gte("approved_at", startOfMonth),
      supabase
        .from("leave_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "approved")
        .lte("start_date", today)
        .gte("end_date", today),
      getCachedYearHolidays(year),
    ]);

    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Admin Dashboard</h1>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Pending Approvals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{pendingCount ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Approved This Month
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{approvedThisMonth ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                On Leave Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{onLeaveToday ?? 0}</div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Holidays — {year}</CardTitle>
            </CardHeader>
            <CardContent>
              <HolidayList holidays={holidays ?? []} today={today} />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const [
    { data: balances },
    { count: pendingCount },
    { data: recentRequests },
    holidays,
  ] = await Promise.all([
    supabase
      .from("leave_balances")
      .select("*, leave_types(name)")
      .eq("employee_id", employee?.id ?? "")
      .eq("year", year),
    supabase
      .from("leave_requests")
      .select("*", { count: "exact", head: true })
      .eq("employee_id", employee?.id ?? "")
      .eq("status", "pending"),
    supabase
      .from("leave_requests")
      .select("*, leave_types(name)")
      .eq("employee_id", employee?.id ?? "")
      .order("created_at", { ascending: false })
      .limit(5),
    getCachedYearHolidays(year),
  ]);

  const compassionate = employee
    ? await getCompassionateAvailability(supabase, employee.id, year)
    : { granted: 0, used: 0, available: 0, pending: 0 };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">
        Welcome{employee ? `, ${employee.first_name}` : ""}
      </h1>

      {/* Balance cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(balances ?? []).map((b) => (
          <Card key={b.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                {b.leave_types?.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{b.remaining_days}</div>
              <p className="text-xs text-gray-500">
                of {b.allocated_days + b.carry_forward_days} days
              </p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Compassionate Leave
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{compassionate.available}</div>
            <p className="text-xs text-gray-500">
              Granted: {compassionate.granted} · Used: {compassionate.used}
            </p>
            {compassionate.pending > 0 && (
              <p className="mt-1 text-xs text-yellow-700">
                {compassionate.pending} day(s) pending admin approval
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Pending Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pendingCount ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Recent requests */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Requests</CardTitle>
          </CardHeader>
          <CardContent>
            {(recentRequests ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No recent requests</p>
            ) : (
              <ul className="space-y-3">
                {(recentRequests ?? []).map((req) => (
                  <li
                    key={req.id}
                    className="flex items-center justify-between"
                  >
                    <div>
                      <span className="text-sm font-medium">
                        {req.leave_types?.name}
                      </span>
                      <span className="ml-2 text-xs text-gray-500">
                        {req.days} day(s)
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className={STATUS_COLORS[req.status]}
                    >
                      {req.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Upcoming holidays */}
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Holidays — {year}</CardTitle>
          </CardHeader>
          <CardContent>
            <HolidayList holidays={holidays ?? []} today={today} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface HolidayListProps {
  holidays: { id: string; name: string; date: string }[];
  today: string;
}

function HolidayList({ holidays, today }: HolidayListProps) {
  const upcoming = holidays.filter((h) => h.date >= today);
  if (upcoming.length === 0) {
    return <p className="text-sm text-gray-500">No upcoming holidays</p>;
  }

  // Highlight the nearest one: smallest positive days-away wins.
  const todayDate = new Date(today);
  let nearestId: string | null = null;
  let nearestDays = Infinity;
  for (const h of upcoming) {
    const days = differenceInCalendarDays(new Date(h.date), todayDate);
    if (days >= 0 && days < nearestDays) {
      nearestDays = days;
      nearestId = h.id;
    }
  }

  return (
    <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
      {upcoming.map((h) => {
        const isNearest = h.id === nearestId;
        return (
          <li
            key={h.id}
            className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
              isNearest ? "bg-red-50 ring-1 ring-red-200" : ""
            }`}
          >
            <span className={isNearest ? "font-semibold" : "font-medium"}>
              {h.name}
            </span>
            <span className={isNearest ? "text-red-700" : "text-gray-500"}>
              {format(new Date(h.date), "MMM d, yyyy")}
              {isNearest && nearestDays <= 7 ? ` · in ${nearestDays} day${nearestDays === 1 ? "" : "s"}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
