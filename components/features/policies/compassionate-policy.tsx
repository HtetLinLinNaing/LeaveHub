"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { CheckCircle2, Circle } from "lucide-react";

export interface PolicyEmployee {
  id: string;
  first_name: string;
  last_name: string;
  enabled: boolean;
}

interface Props {
  compassionateId: string;
  employees: PolicyEmployee[];
}

export function CompassionatePolicy({ compassionateId, employees }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function toggle(emp: PolicyEmployee) {
    setBusyId(emp.id);
    startTransition(async () => {
      if (emp.enabled) {
        // Disable = remove the policy row.
        await fetch(`/api/employee-leave-policies?employee_id=${emp.id}&leave_type_id=${compassionateId}`, {
          method: "DELETE",
        });
      } else {
        await fetch(`/api/employee-leave-policies`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ employee_id: emp.id, leave_type_id: compassionateId, enabled: true }),
        });
      }
      setBusyId(null);
      router.refresh();
    });
  }

  const columns: Column<PolicyEmployee>[] = [
    { key: "name", header: "Employee", cell: (e) => <span className="font-medium">{e.first_name} {e.last_name}</span> },
    { key: "status", header: "Status", cell: (e) => (
      <Badge variant="outline" className={e.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
        {e.enabled ? "Enabled" : "Disabled"}
      </Badge>
    ) },
    { key: "action", header: "Action", cell: (e) => (
      <Button size="sm" variant="ghost" onClick={() => toggle(e)} disabled={pending && busyId === e.id}>
        {e.enabled ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Circle className="h-4 w-4 text-gray-400" />}
        {e.enabled ? "Disable" : "Enable"}
      </Button>
    ) },
  ];

  return (
    <ResponsiveTable
      columns={columns}
      rows={employees}
      keyOf={(e) => e.id}
      mobileCard={(e) => (
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium">{e.first_name} {e.last_name}</div>
            <div className="text-sm text-gray-500">{e.enabled ? "Enabled" : "Disabled"}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => toggle(e)} disabled={pending && busyId === e.id}>
            {e.enabled ? "Disable" : "Enable"}
          </Button>
        </div>
      )}
      empty={<div className="rounded-lg border bg-white p-8 text-center text-gray-500">No employees.</div>}
    />
  );
}
