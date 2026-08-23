"use client";

import { useState, useTransition } from "react";
import { approveLeaveGrant } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, X } from "lucide-react";

interface PendingGrant {
  id: string;
  leave_type_name: string;
  days: number;
  reason: string;
  created_at: string;
  employee: {
    first_name: string;
    last_name: string;
    employee_code: string;
    department: string;
  };
  created_by_employee: {
    first_name: string;
    last_name: string;
  };
}

interface Props {
  grants: PendingGrant[];
}

export function GrantApprovalList({ grants }: Props) {
  const [pending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<
    | {
        id: string;
        action: "approved" | "rejected";
        name: string;
        leaveTypeName: string;
      }
    | null
  >(null);
  const [rejectReason, setRejectReason] = useState("");

  function applyDecision() {
    if (!confirming) return;
    const { id, action } = confirming;
    const reason = action === "rejected" ? rejectReason : undefined;
    setError("");
    setProcessingId(id);
    setConfirming(null);
    setRejectReason("");
    startTransition(async () => {
      const result = await approveLeaveGrant(id, action, reason);
      if (!result.ok) {
        setError(result.error ?? "Failed to update grant");
      }
      setProcessingId(null);
    });
  }

  if (grants.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
        No pending grants.
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
      {grants.map((g) => (
        <div key={g.id} className="rounded-lg border bg-white p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {g.employee.first_name} {g.employee.last_name}
                </span>
                <Badge variant="outline">{g.employee.employee_code}</Badge>
                <Badge variant="outline">{g.employee.department}</Badge>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {g.leave_type_name} — {g.days} day(s)
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Granted by: {g.created_by_employee.first_name}{" "}
                {g.created_by_employee.last_name}
              </p>
              <p className="mt-2 text-sm">{g.reason}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-green-600 hover:bg-green-50"
                onClick={() =>
                  setConfirming({
                    id: g.id,
                    action: "approved",
                    name: `${g.employee.first_name} ${g.employee.last_name}`,
                    leaveTypeName: g.leave_type_name,
                  })
                }
                disabled={pending && processingId === g.id}
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
                    id: g.id,
                    action: "rejected",
                    name: `${g.employee.first_name} ${g.employee.last_name}`,
                    leaveTypeName: g.leave_type_name,
                  })
                }
                disabled={pending && processingId === g.id}
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
        onOpenChange={(o) => {
          if (!o) {
            setConfirming(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming?.action === "approved" ? "Approve" : "Reject"}{" "}
              {confirming?.leaveTypeName} for {confirming?.name}?
            </DialogTitle>
          </DialogHeader>
          {confirming?.action === "rejected" && (
            <div>
              <label className="mb-1 block text-sm font-medium">
                Rejection reason (optional)
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          )}
          <p className="text-sm text-gray-600">
            {confirming?.action === "approved"
              ? `Approving will add the days to the employee's ${confirming.leaveTypeName} balance. This can't be undone from here.`
              : "Rejecting will not change any balances. This can't be undone from here."}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(null);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={applyDecision} disabled={pending}>
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
