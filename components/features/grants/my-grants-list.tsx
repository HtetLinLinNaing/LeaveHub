"use client";

import { useState, useTransition } from "react";
import { cancelPendingGrant } from "@/lib/actions";
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

interface MyGrant {
  id: string;
  leave_type_name: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  employee: {
    first_name: string;
    last_name: string;
    employee_code: string;
  };
}

interface Props {
  grants: MyGrant[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export function MyGrantsList({ grants }: Props) {
  const [pending, startTransition] = useTransition();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<MyGrant | null>(null);

  if (grants.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
        No grants proposed yet.
      </div>
    );
  }

  function handleCancel(id: string) {
    setError("");
    setCancellingId(id);
    setConfirming(null);
    startTransition(async () => {
      const result = await cancelPendingGrant(id);
      if (!result.ok) {
        setError(result.error ?? "Failed to cancel grant");
      }
      setCancellingId(null);
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {grants.map((g) => (
        <div key={g.id} className="rounded-lg border bg-white p-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {g.employee.first_name} {g.employee.last_name}
                </span>
                <Badge variant="outline">{g.employee.employee_code}</Badge>
                <Badge variant="outline" className={STATUS_COLORS[g.status]}>
                  {g.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {g.leave_type_name} — {g.days} day(s)
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {format(new Date(g.created_at), "MMM d, yyyy")}
              </p>
              <p className="mt-1 text-sm">{g.reason}</p>
            </div>
            {g.status === "pending" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(g)}
                disabled={pending && cancellingId === g.id}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      ))}
      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {confirming?.leave_type_name} grant proposal?</DialogTitle>
          </DialogHeader>
          {confirming && (
            <p className="text-sm text-gray-600">
              {confirming.employee.first_name} {confirming.employee.last_name} —{" "}
              {confirming.days} day(s). This can't be undone from here.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Keep proposal
            </Button>
            <Button
              onClick={() => confirming && handleCancel(confirming.id)}
              disabled={pending}
            >
              {pending ? "Cancelling..." : "Cancel proposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
