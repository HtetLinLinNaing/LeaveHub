"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
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

// Color per leave type name. Stable, deterministic — same type always same
// color across all users and the whole year.
const LEAVE_TYPE_COLORS: Record<string, string> = {
  "Annual Leave": "bg-blue-100 text-blue-800 ring-blue-300",
  "Medical Leave": "bg-green-100 text-green-800 ring-green-300",
  "Compassionate Leave": "bg-purple-100 text-purple-800 ring-purple-300",
};

const FALLBACK_LEAVE_COLORS = [
  "bg-orange-100 text-orange-800 ring-orange-300",
  "bg-pink-100 text-pink-800 ring-pink-300",
  "bg-teal-100 text-teal-800 ring-teal-300",
  "bg-amber-100 text-amber-800 ring-amber-300",
];

function colorForType(name: string, index: number): string {
  return LEAVE_TYPE_COLORS[name] ?? FALLBACK_LEAVE_COLORS[index % FALLBACK_LEAVE_COLORS.length];
}

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
      for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
        const key = format(d, "yyyy-MM-dd");
        const bucket = map.get(key);
        if (bucket) bucket.push(lr);
        else map.set(key, [lr]);
      }
    }
    return map;
  }, [leaveRequests]);

  // Stable color per leave type name (not per employee). Build a name → index
  // map on first encounter so the same type always gets the same color.
  const typeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    let fallbackIdx = 0;
    leaveRequests.forEach((lr) => {
      const name = lr.leave_types.name;
      if (!map.has(name)) {
        map.set(name, colorForType(name, fallbackIdx++));
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
                !inMonth ? "bg-gray-50 text-gray-400" : ""
              } ${weekend ? "bg-gray-50" : ""} ${isToday ? "bg-blue-50" : ""}`}
            >
              <div
                className={`mb-1 text-xs font-medium ${
                  isToday
                    ? "flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white"
                    : weekend
                    ? "text-gray-400"
                    : ""
                }`}
              >
                {format(day, "d")}
              </div>
              {holiday && (
                <div className="mb-0.5 truncate rounded bg-red-50 px-1 py-0.5 text-[10px] text-red-700">
                  {holiday.name}
                </div>
              )}
              {leave.slice(0, 2).map((lr) => {
                const name = `${lr.employees.first_name} ${lr.employees.last_name}`;
                const typeName = lr.leave_types.name;
                const color = typeColorMap.get(typeName) ?? colorForType(typeName, 0);
                return (
                  <div
                    key={lr.id}
                    className={`mb-0.5 truncate rounded px-1 py-0.5 text-[10px] ring-1 ${color}`}
                    title={`${name} — ${typeName}`}
                  >
                    {name}
                  </div>
                );
              })}
              {leave.length > 2 && (
                <div className="text-[10px] text-gray-500">
                  +{leave.length - 2} more
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
