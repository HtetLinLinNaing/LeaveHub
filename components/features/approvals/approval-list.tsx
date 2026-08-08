"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveLeaveRequest } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

type Tab = "pending" | "approved" | "rejected";

export function ApprovalList({ requests }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("pending");

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

  const counts: Record<Tab, number> = {
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  };
  const visible = requests.filter((r) => r.status === tab);

  const tabs: { key: Tab; label: string; color: string }[] = [
    { key: "pending", label: "Pending", color: "bg-yellow-100 text-yellow-800" },
    { key: "approved", label: "Approved", color: "bg-green-100 text-green-800" },
    { key: "rejected", label: "Rejected", color: "bg-red-100 text-red-800" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${t.color}`}>
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
          No {tab} requests.
        </div>
      ) : (
        visible.map((req) => (
          <div key={req.id} className="rounded-lg border bg-white p-4">
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
              {tab === "pending" && (
                <div className="flex gap-2">
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
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
