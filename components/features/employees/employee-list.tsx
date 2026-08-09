"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { ROLE_LABELS } from "@/lib/constants";
import { updateEmployeeStatus } from "@/lib/actions";
import type { Role } from "@/lib/types";

interface Employee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  department: string;
  join_date: string;
  status: string;
  users: { email: string; role: Role } | null;
}

function StatusToggle({
  employee,
}: {
  employee: Employee;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const isActive = employee.status === "active";
  const nextStatus: "active" | "inactive" = isActive ? "inactive" : "active";

  function apply() {
    startTransition(async () => {
      const result = await updateEmployeeStatus({
        employee_id: employee.id,
        status: nextStatus,
      });
      if (!result.ok) {
        // Surface the error in the console; the row's stale badge is the
        // best visible signal that nothing changed.
        console.error(result.error);
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        disabled={pending}
        className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium transition-colors ${
          isActive
            ? "bg-green-100 text-green-800 hover:bg-green-200"
            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
        }`}
      >
        {isActive ? "Active" : "Inactive"}
      </button>
      <Dialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isActive ? "Deactivate" : "Reactivate"} {employee.first_name}{" "}
              {employee.last_name}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            {isActive
              ? "They'll be signed out and unable to access the system until reactivated."
              : "They'll regain access on their next page load."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={pending}>
              {pending ? "Saving..." : isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const buildColumns = (
  currentEmployeeId: string | null,
  canManage: boolean
): Column<Employee>[] => [
  { key: "code", header: "Code", cell: (e) => <span className="font-mono text-xs">{e.employee_code}</span> },
  { key: "name", header: "Name", cell: (e) => (
    <span className="font-medium">
      {e.first_name} {e.last_name}
      {e.id === currentEmployeeId && <span className="ml-2 text-xs font-normal text-blue-700">(You)</span>}
    </span>
  ) },
  { key: "email", header: "Email", cell: (e) => e.users?.email },
  { key: "department", header: "Department", cell: (e) => e.department },
  { key: "role", header: "Role", cell: (e) => <Badge variant="outline">{ROLE_LABELS[e.users?.role ?? "employee"]}</Badge> },
  { key: "status", header: "Status", cell: (e) => (
    canManage ? <StatusToggle employee={e} /> : (
      <Badge variant="outline" className={e.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
        {e.status}
      </Badge>
    )
  ) },
];

function MobileEmployeeCard({
  employee,
  isMe,
  canManage,
}: {
  employee: Employee;
  isMe: boolean;
  canManage: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {employee.first_name} {employee.last_name}
          {isMe && <span className="ml-2 text-xs font-normal text-blue-700">(You)</span>}
        </span>
        <span className="font-mono text-xs text-gray-500">{employee.employee_code}</span>
      </div>
      <div className="text-sm text-gray-500">{employee.users?.email}</div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{employee.department}</span>
        <Badge variant="outline">{ROLE_LABELS[employee.users?.role ?? "employee"]}</Badge>
        {canManage ? (
          <StatusToggle employee={employee} />
        ) : (
          <Badge variant="outline" className={employee.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
            {employee.status}
          </Badge>
        )}
      </div>
    </div>
  );
}

export function EmployeeList({
  employees,
  currentEmployeeId,
  canManage,
}: {
  employees: Employee[];
  currentEmployeeId: string | null;
  canManage: boolean;
}) {
  return (
    <ResponsiveTable
      columns={buildColumns(currentEmployeeId, canManage)}
      rows={employees}
      keyOf={(e) => e.id}
      mobileCard={(e) => (
        <MobileEmployeeCard
          employee={e}
          isMe={e.id === currentEmployeeId}
          canManage={canManage}
        />
      )}
      rowClassName={(e) => (e.id === currentEmployeeId ? "bg-blue-50" : undefined)}
      empty={
        <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
          No employees found.
        </div>
      }
    />
  );
}
