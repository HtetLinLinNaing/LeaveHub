"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_COLORS } from "@/lib/constants";
import { format } from "date-fns";
import type { LeaveRequestStatus } from "@/lib/types";

interface Request {
  id: string;
  start_date: string;
  end_date: string;
  days: number;
  duration_type: string;
  reason: string;
  status: LeaveRequestStatus;
  created_at: string;
  leave_types: { name: string } | null;
}

export function LeaveRequestList({ requests }: { requests: Request[] }) {
  const router = useRouter();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function handleCancel(id: string) {
    setCancellingId(id);
    const supabase = createClient();
    await supabase
      .from("leave_requests")
      .update({ status: "cancelled" })
      .eq("id", id);
    setCancellingId(null);
    router.refresh();
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
        No leave requests yet. Click &quot;Request Leave&quot; to create one.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50 text-left">
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Dates</th>
            <th className="px-4 py-3 font-medium">Days</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((req) => (
            <tr key={req.id} className="border-b last:border-0">
              <td className="px-4 py-3">{req.leave_types?.name}</td>
              <td className="px-4 py-3">
                {format(new Date(req.start_date), "MMM d")}
                {req.start_date !== req.end_date &&
                  ` — ${format(new Date(req.end_date), "MMM d")}`}
              </td>
              <td className="px-4 py-3">
                {req.days} {req.duration_type === "half_day" ? "(½)" : ""}
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant="outline"
                  className={STATUS_COLORS[req.status]}
                >
                  {req.status}
                </Badge>
              </td>
              <td className="px-4 py-3">
                {req.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCancel(req.id)}
                    disabled={cancellingId === req.id}
                  >
                    Cancel
                  </Button>
                )}
                {req.status === "approved" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCancel(req.id)}
                    disabled={cancellingId === req.id}
                  >
                    Cancel
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
