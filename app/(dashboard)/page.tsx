import { cookies } from "next/headers";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCachedHolidaysFromDate } from "@/lib/cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STATUS_COLORS } from "@/lib/constants";
import { format } from "date-fns";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { employee } = await getCurrentEmployee(supabase, session?.email);
  const today = format(new Date(), "yyyy-MM-dd");
  const year = new Date().getFullYear();

  const [
    { data: balances },
    { count: pendingCount },
    { data: recentRequests },
    holidays,
    { data: awayToday },
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
    getCachedHolidaysFromDate(today, 3),
    supabase
      .from("leave_requests")
      .select("employees(first_name, last_name)")
      .eq("status", "approved")
      .lte("start_date", today)
      .gte("end_date", today),
  ]);

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
              Pending Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pendingCount ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Away Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{awayToday?.length ?? 0}</div>
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
                  <li key={req.id} className="flex items-center justify-between">
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
            <CardTitle>Upcoming Holidays</CardTitle>
          </CardHeader>
          <CardContent>
            {(holidays ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No upcoming holidays</p>
            ) : (
              <ul className="space-y-3">
                {(holidays ?? []).map((h) => (
                  <li key={h.id} className="flex justify-between text-sm">
                    <span className="font-medium">{h.name}</span>
                    <span className="text-gray-500">
                      {format(new Date(h.date), "MMM d, yyyy")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
