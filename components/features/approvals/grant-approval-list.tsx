"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveCompassionateGrant } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Check, X } from "lucide-react";

interface GrantApproval {
  id: string;
  days: number;
  reason: string;
  status: string;
  created_at: string;
  employee: { first_name: string; last_name: string; employee_code: string; department: string };
  filer: { first_name: string; last_name: string };
}

interface Props {
  grants: GrantApproval[];
}

export function GrantApprovalList({ grants }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  function handleAction(id: string, action: "approved" | "rejected") {
    setError("");
    setProcessingId(id);
    startTransition(async () => {
      const result = await approveCompassionateGrant(id, action);
      if (!result.ok) {
        setError(result.error ?? "Failed to update grant");
      }
      setProcessingId(null);
      router.refresh();
    });
  }

  if (grants.length === 0) return null;

  return (
    <div className="space-y-3">
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
                Compassionate Leave Grant — {g.days} day(s)
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Filed by {g.filer.first_name} {g.filer.last_name} on{" "}
                {format(new Date(g.created_at), "MMM d, yyyy")}
              </p>
              <p className="mt-2 text-sm">{g.reason}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-green-600 hover:bg-green-50"
                onClick={() => handleAction(g.id, "approved")}
                disabled={pending && processingId === g.id}
              >
                <Check className="mr-1 h-4 w-4" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:bg-red-50"
                onClick={() => handleAction(g.id, "rejected")}
                disabled={pending && processingId === g.id}
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
