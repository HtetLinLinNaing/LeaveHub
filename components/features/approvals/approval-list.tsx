"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveLeaveRequest } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { Check, X } from "lucide-react";

interface ApprovalRequest {
  id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  duration_type: string;
  reason: string;
  status: string;
  created_at: string;
  employees: {
    id: string;
    first_name: string;
    last_name: string;
    employee_code: string;
    department: string;
    manager_id: string;
  };
  leave_types: { name: string } | null;
}

interface Props {
  requests: ApprovalRequest[];
}

export function ApprovalList({ requests }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<
    | { id: string; action: "approved" | "rejected"; name: string }
    | null
  >(null);

  function handleAction(id: string, action: "approved" | "rejected") {
    setError("");
    setProcessingId(id);
    startTransition(async () => {
      const result = await approveLeaveRequest(id, action);
      if (!result.ok) {
        setError(result.error ?? "Failed to update request");
      }
      setProcessingId(null);
      router.refresh();
    });
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
        No pending approvals.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {requests.map((req) => (
        <div
          key={req.id}
          className="rounded-lg border bg-white p-4"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {req.employees.first_name} {req.employees.last_name}
                </span>
                <Badge variant="outline">{req.employees.employee_code}</Badge>
                <Badge variant="outline">{req.employees.department}</Badge>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {req.leave_types?.name} — {req.days} day(s)
                {req.duration_type === "half_day" ? " (half day)" : ""}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {format(new Date(req.start_date), "MMM d, yyyy")}
                {req.start_date !== req.end_date &&
                  ` — ${format(new Date(req.end_date), "MMM d, yyyy")}`}
              </p>
              <p className="mt-2 text-sm">{req.reason}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-green-600 hover:bg-green-50"
                onClick={() =>
                  setConfirming({
                    id: req.id,
                    action: "approved",
                    name: `${req.employees.first_name} ${req.employees.last_name}`,
                  })
                }
                disabled={pending && processingId === req.id}
              >
                <Check className="mr-1 h-4 w-4" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:bg-red-50"
                onClick={() =>
                  setConfirming({
                    id: req.id,
                    action: "rejected",
                    name: `${req.employees.first_name} ${req.employees.last_name}`,
                  })
                }
                disabled={pending && processingId === req.id}
              >
                <X className="mr-1 h-4 w-4" />
                Reject
              </Button>
            </div>
          </div>
        </div>
      ))}
      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming?.action === "approved" ? "Approve" : "Reject"}{" "}
              {confirming?.name}&apos;s request?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            {confirming?.action === "approved"
              ? "Approving will deduct the days from their leave balance. This can't be undone from here."
              : "Rejecting will leave their balance unchanged. This can't be undone from here."}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!confirming) return;
                const { id, action } = confirming;
                setConfirming(null);
                handleAction(id, action);
              }}
              disabled={pending}
            >
              {pending
                ? "Saving..."
                : confirming?.action === "approved"
                ? "Approve"
                : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
