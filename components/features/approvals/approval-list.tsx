"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Check, X } from "lucide-react";

interface ApprovalRequest {
  id: string;
  start_date: string;
  end_date: string;
  days: number;
  duration_type: string;
  reason: string;
  status: string;
  created_at: string;
  employees: {
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
  approverId: string;
  approverRole: string;
}

export function ApprovalList({ requests, approverId, approverRole }: Props) {
  const router = useRouter();
  const [processingId, setProcessingId] = useState<string | null>(null);

  async function handleAction(id: string, action: "approved" | "rejected") {
    setProcessingId(id);
    const supabase = createClient();

    const update: Record<string, unknown> = {
      status: action,
      approved_by: approverId,
      approved_at: new Date().toISOString(),
    };

    await supabase
      .from("leave_requests")
      .update(update)
      .eq("id", id);

    // If approved, update leave balance
    if (action === "approved") {
      const req = requests.find((r) => r.id === id);
      if (req) {
        // Get current balance
        const { data: balance } = await supabase
          .from("leave_balances")
          .select("id, used_days, remaining_days")
          .eq("employee_id", req.employees.manager_id ? approverId : "")
          .single();

        if (balance) {
          await supabase
            .from("leave_balances")
            .update({
              used_days: balance.used_days + req.days,
              remaining_days: balance.remaining_days - req.days,
            })
            .eq("id", balance.id);
        }
      }
    }

    setProcessingId(null);
    router.refresh();
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
                onClick={() => handleAction(req.id, "approved")}
                disabled={processingId === req.id}
              >
                <Check className="mr-1 h-4 w-4" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:bg-red-50"
                onClick={() => handleAction(req.id, "rejected")}
                disabled={processingId === req.id}
              >
                <X className="mr-1 h-4 w-4" />
                Reject
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
