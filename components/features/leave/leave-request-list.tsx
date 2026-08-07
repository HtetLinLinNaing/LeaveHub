"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelLeaveRequest } from "@/lib/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
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

function dateRange(start: string, end: string) {
  if (start === end) return format(new Date(start), "MMM d, yyyy");
  return `${format(new Date(start), "MMM d")} — ${format(new Date(end), "MMM d, yyyy")}`;
}

function StatusBadge({ status }: { status: LeaveRequestStatus }) {
  return (
    <Badge variant="outline" className={STATUS_COLORS[status]}>
      {status}
    </Badge>
  );
}

function CancelButton({ id, onCancel, disabled }: { id: string; onCancel: (id: string) => void; disabled: boolean }) {
  return (
    <Button variant="ghost" size="sm" onClick={() => onCancel(id)} disabled={disabled}>
      Cancel
    </Button>
  );
}

export function LeaveRequestList({ requests }: { requests: Request[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  function handleCancel(id: string) {
    setError("");
    setCancellingId(id);
    startTransition(async () => {
      const result = await cancelLeaveRequest(id);
      if (!result.ok) {
        setError(result.error ?? "Failed to cancel request");
      }
      setCancellingId(null);
      router.refresh();
    });
  }

  const columns: Column<Request>[] = [
    { key: "type", header: "Type", cell: (r) => r.leave_types?.name },
    { key: "dates", header: "Dates", cell: (r) => dateRange(r.start_date, r.end_date) },
    { key: "days", header: "Days", cell: (r) => `${r.days}${r.duration_type === "half_day" ? " (½)" : ""}` },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "actions", header: "Actions", cell: (r) => (r.status === "pending" || r.status === "approved") ? (
      <CancelButton id={r.id} onCancel={handleCancel} disabled={pending && cancellingId === r.id} />
    ) : null },
  ];

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <ResponsiveTable
        columns={columns}
        rows={requests}
        keyOf={(r) => r.id}
      mobileCard={(r) => (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">{r.leave_types?.name}</span>
            <StatusBadge status={r.status} />
          </div>
          <div className="text-sm text-gray-500">{dateRange(r.start_date, r.end_date)}</div>
          <div className="text-sm text-gray-500">
            {r.days} day{r.days === 1 ? "" : "s"}{r.duration_type === "half_day" ? " (half day)" : ""}
          </div>
          {(r.status === "pending" || r.status === "approved") && (
            <div className="pt-1">
              <CancelButton id={r.id} onCancel={handleCancel} disabled={pending && cancellingId === r.id} />
            </div>
          )}
        </div>
      )}
      empty={
        <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
          No leave requests yet. Click &quot;Request Leave&quot; to create one.
        </div>
      }
      />
    </div>
  );
}
