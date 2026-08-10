"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelLeaveRequest } from "@/lib/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { STATUS_COLORS } from "@/lib/constants";
import { format } from "date-fns";
import type { DayDuration, LeaveRequestStatus } from "@/lib/types";
import { Phone, FileText } from "lucide-react";

interface RequestDay {
  date: string;
  duration: DayDuration;
}

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
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  mc_file_name: string | null;
  leave_request_days?: RequestDay[] | null;
}

function dateRange(start: string, end: string) {
  if (start === end) return format(new Date(start), "MMM d, yyyy");
  return `${format(new Date(start), "MMM d")} — ${format(new Date(end), "MMM d, yyyy")}`;
}

function breakdown(req: Request): string | null {
  const rows = req.leave_request_days;
  if (!rows || rows.length === 0) return null;
  const full = rows.filter((r) => r.duration === "full_day").length;
  const morn = rows.filter((r) => r.duration === "half_day_morning").length;
  const eve = rows.filter((r) => r.duration === "half_day_evening").length;
  const parts: string[] = [];
  if (full) parts.push(`${full} full`);
  if (morn) parts.push(`${morn} AM`);
  if (eve) parts.push(`${eve} PM`);
  return parts.join(" + ");
}

function StatusBadge({ status }: { status: LeaveRequestStatus }) {
  return (
    <Badge variant="outline" className={STATUS_COLORS[status]}>
      {status}
    </Badge>
  );
}

function RequestMeta({ req }: { req: Request }) {
  const bd = breakdown(req);
  const hasEc = Boolean(req.emergency_contact_name);
  const hasMc = Boolean(req.mc_file_name);
  if (!bd && !hasEc && !hasMc) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
      {bd && <span>{bd}</span>}
      {hasEc && (
        <span className="inline-flex items-center gap-1">
          <Phone className="h-3 w-3" />
          EC: {req.emergency_contact_name} ({req.emergency_contact_relationship})
        </span>
      )}
      {hasMc && (
        <span className="inline-flex items-center gap-1">
          <FileText className="h-3 w-3" />
          MC: {req.mc_file_name}
        </span>
      )}
    </div>
  );
}

function CancelButton({
  request,
  onAsk,
  disabled,
}: {
  request: Request;
  onAsk: (r: Request) => void;
  disabled: boolean;
}) {
  return (
    <Button variant="ghost" size="sm" onClick={() => onAsk(request)} disabled={disabled}>
      Cancel
    </Button>
  );
}

export function LeaveRequestList({ requests }: { requests: Request[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<Request | null>(null);

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
    {
      key: "days",
      header: "Days",
      cell: (r) => {
        const bd = breakdown(r);
        return (
          <div>
            <div>
              {r.days}{bd ? "" : r.duration_type === "half_day" ? " (½)" : ""}
            </div>
            {bd && (
              <div className="text-xs text-gray-500">{bd}</div>
            )}
          </div>
        );
      },
    },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "actions", header: "Actions", cell: (r) => r.status === "pending" ? (
      <CancelButton
        request={r}
        onAsk={setConfirming}
        disabled={pending && cancellingId === r.id}
      />
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
              {r.days} day{r.days === 1 ? "" : "s"}
              {r.duration_type === "half_day" ? " (half day)" : ""}
            </div>
            <RequestMeta req={r} />
            {r.status === "pending" && (
              <div className="pt-1">
                <CancelButton
                  request={r}
                  onAsk={setConfirming}
                  disabled={pending && cancellingId === r.id}
                />
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
      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this leave request?</DialogTitle>
          </DialogHeader>
          {confirming && (
            <p className="text-sm text-gray-600">
              {confirming.leave_types?.name} — {dateRange(confirming.start_date, confirming.end_date)} ({confirming.days} day{confirming.days === 1 ? "" : "s"})
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Keep request
            </Button>
            <Button
              onClick={() => {
                if (!confirming) return;
                const id = confirming.id;
                setConfirming(null);
                handleCancel(id);
              }}
              disabled={pending}
            >
              {pending ? "Cancelling..." : "Cancel request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
