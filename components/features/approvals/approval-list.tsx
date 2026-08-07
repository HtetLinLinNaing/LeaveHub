"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveLeaveRequest } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Check, X } from "lucide-react";
import type { Role } from "@/lib/types";

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
    manager_id: string | null;
  } | {
    id: string;
    first_name: string;
    last_name: string;
    employee_code: string;
    department: string;
    manager_id: string | null;
  }[];
  leave_types: { name: string } | { name: string }[] | null;
}

interface Props {
  requests: ApprovalRequest[];
  managerNameById: Record<string, string>;
  viewerRole: Role;
}

export function ApprovalList({ requests, managerNameById, viewerRole }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");

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
        {viewerRole === "employee"
          ? "Employees don't approve leave. Talk to your manager or HR."
          : "No pending approvals."}
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
      {requests.map((req) => {
        const emp = Array.isArray(req.employees) ? req.employees[0] : req.employees;
        const lt = Array.isArray(req.leave_types)
          ? (req.leave_types[0] ?? null)
          : req.leave_types;
        const managerName = emp?.manager_id ? managerNameById[emp.manager_id] : undefined;
        if (!emp) return null;
        return (
          <div key={req.id} className="rounded-lg border bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {emp.first_name} {emp.last_name}
                  </span>
                  <Badge variant="outline">{emp.employee_code}</Badge>
                  <Badge variant="outline">{emp.department}</Badge>
                </div>
                <p className="mt-1 text-sm text-gray-700">
                  {lt?.name} — {req.days} day(s)
                  {req.duration_type === "half_day" ? " (half day)" : ""}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {format(new Date(req.start_date), "MMM d, yyyy")}
                  {req.start_date !== req.end_date &&
                    ` — ${format(new Date(req.end_date), "MMM d, yyyy")}`}
                </p>
                <p className="mt-2 text-sm">{req.reason}</p>
                <p className="mt-2 text-xs text-gray-500">
                  Reporting manager:{" "}
                  <span className="font-medium text-gray-700">
                    {managerName ?? "—"}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-green-600 hover:bg-green-50"
                  onClick={() => handleAction(req.id, "approved")}
                  disabled={pending && processingId === req.id}
                >
                  <Check className="mr-1 h-4 w-4" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => handleAction(req.id, "rejected")}
                  disabled={pending && processingId === req.id}
                >
                  <X className="mr-1 h-4 w-4" />
                  Reject
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
