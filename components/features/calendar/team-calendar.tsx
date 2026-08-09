"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  isWeekend,
  addMonths,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Holiday {
  id: string;
  name: string;
  date: string;
}

interface LeaveRequest {
  id: string;
  start_date: string;
  end_date: string;
  employees: { first_name: string; last_name: string; department: string };
  leave_types: { name: string };
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const LEAVE_COLORS = [
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-purple-100 text-purple-800",
  "bg-orange-100 text-orange-800",
  "bg-pink-100 text-pink-800",
  "bg-teal-100 text-teal-800",
];

export function TeamCalendar({
  holidays,
  leaveRequests,
  year,
}: {
  holidays: Holiday[];
  leaveRequests: LeaveRequest[];
  year: number;
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date(year, new Date().getMonth(), 1));
  const [openDay, setOpenDay] = useState<Date | null>(null);

  const holidayMap = useMemo(() => {
    const map = new Map<string, Holiday>();
    holidays.forEach((h) => map.set(h.date, h));
    return map;
  }, [holidays]);

  const leaveByDate = useMemo(() => {
    const map = new Map<string, LeaveRequest[]>();
    for (const lr of leaveRequests) {
      const start = new Date(lr.start_date);
      const end = new Date(lr.end_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        // Skip weekends and public holidays: leave shouldn't render on
        // days the employee wouldn't have been at work anyway.
        if (isWeekend(d)) continue;
        const key = format(d, "yyyy-MM-dd");
        if (holidayMap.has(key)) continue;
        const bucket = map.get(key);
        if (bucket) bucket.push(lr);
        else map.set(key, [lr]);
      }
    }
    return map;
  }, [leaveRequests, holidayMap]);

  const employeeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    let i = 0;
    leaveRequests.forEach((lr) => {
      const key = `${lr.employees.first_name} ${lr.employees.last_name}`;
      if (!map.has(key)) {
        map.set(key, LEAVE_COLORS[i % LEAVE_COLORS.length]);
        i++;
      }
    });
    return map;
  }, [leaveRequests]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  return (
    <div className="rounded-lg border bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-lg font-semibold">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day names */}
      <div className="grid grid-cols-7 border-b bg-gray-50">
        {DAY_NAMES.map((d) => (
          <div key={d} className="px-2 py-2 text-center text-xs font-medium text-gray-500">
            {d}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inMonth = isSameMonth(day, currentMonth);
          const weekend = isWeekend(day);
          const dateStr = format(day, "yyyy-MM-dd");
          const holiday = holidayMap.get(dateStr);
          const leave = leaveByDate.get(dateStr) ?? [];
          const isToday = isSameDay(day, new Date());

          return (
            <div
              key={dateStr}
              className={`min-h-[80px] border-b border-r p-1.5 ${
                holiday
                  ? "bg-red-100"
                  : !inMonth
                  ? "bg-gray-50 text-gray-400"
                  : ""
              } ${weekend ? "bg-gray-50" : ""} ${isToday ? "bg-blue-50" : ""}`}
            >
              <div
                className={`mb-1 text-xs font-medium ${
                  isToday
                    ? "flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white"
                    : weekend
                    ? "text-gray-400"
                    : holiday
                    ? "font-bold text-red-800"
                    : ""
                }`}
              >
                {format(day, "d")}
              </div>
              {holiday && (
                <div className="mb-0.5 truncate rounded bg-red-600 px-1 py-0.5 text-[10px] font-semibold text-white">
                  {holiday.name}
                </div>
              )}
              {leave.slice(0, 2).map((lr) => {
                const name = `${lr.employees.first_name} ${lr.employees.last_name}`;
                const color = employeeColorMap.get(name) ?? LEAVE_COLORS[0];
                return (
                  <div
                    key={lr.id}
                    className={`mb-0.5 truncate rounded px-1 py-0.5 text-[10px] ${color}`}
                    title={`${name} — ${lr.leave_types.name}`}
                  >
                    {name}
                  </div>
                );
              })}
              {leave.length > 2 && (
                <button
                  type="button"
                  onClick={() => setOpenDay(day)}
                  className="text-[10px] font-medium text-blue-700 hover:underline"
                >
                  +{leave.length - 2} more
                </button>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={openDay !== null} onOpenChange={(o) => !o && setOpenDay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {openDay ? format(openDay, "EEEE, MMMM d, yyyy") : ""}
            </DialogTitle>
          </DialogHeader>
          {openDay && (
            <ul className="space-y-1">
              {(leaveByDate.get(format(openDay, "yyyy-MM-dd")) ?? []).map((lr) => {
                const name = `${lr.employees.first_name} ${lr.employees.last_name}`;
                const color = employeeColorMap.get(name) ?? LEAVE_COLORS[0];
                return (
                  <li
                    key={lr.id}
                    className={`flex items-center justify-between rounded px-2 py-1 text-sm ${color}`}
                  >
                    <span className="font-medium">{name}</span>
                    <span className="text-xs opacity-80">{lr.leave_types.name}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
