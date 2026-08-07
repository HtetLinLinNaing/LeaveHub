"use client";

import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { ROLE_LABELS } from "@/lib/constants";
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

interface Props {
  employees: Employee[];
  currentEmployeeId?: string;
}

const columns: Column<Employee>[] = [
  { key: "code", header: "Code", cell: (e) => <span className="font-mono text-xs">{e.employee_code}</span> },
  { key: "name", header: "Name", cell: (e) => <span className="font-medium">{e.first_name} {e.last_name}</span> },
  { key: "email", header: "Email", cell: (e) => e.users?.email },
  { key: "department", header: "Department", cell: (e) => e.department },
  { key: "role", header: "Role", cell: (e) => <Badge variant="outline">{ROLE_LABELS[e.users?.role ?? "employee"]}</Badge> },
  { key: "status", header: "Status", cell: (e) => (
    <Badge variant="outline" className={e.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
      {e.status}
    </Badge>
  ) },
];

function MobileEmployeeCard({ employee, isMe }: { employee: Employee; isMe: boolean }) {
  return (
    <div className={`space-y-2 rounded-md p-1 ${isMe ? "bg-blue-50 ring-1 ring-blue-200" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{employee.first_name} {employee.last_name}{isMe ? " (You)" : ""}</span>
        <span className="font-mono text-xs text-gray-500">{employee.employee_code}</span>
      </div>
      <div className="text-sm text-gray-500">{employee.users?.email}</div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{employee.department}</span>
        <Badge variant="outline">{ROLE_LABELS[employee.users?.role ?? "employee"]}</Badge>
        <Badge variant="outline" className={employee.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
          {employee.status}
        </Badge>
      </div>
    </div>
  );
}

export function EmployeeList({ employees, currentEmployeeId }: Props) {
  return (
    <ResponsiveTable
      columns={columns.map((c) => ({
        ...c,
        cell: (e: Employee) => {
          const isMe = e.id === currentEmployeeId;
          return (
            <span className={isMe ? "rounded bg-blue-50 px-1 py-0.5 font-medium ring-1 ring-blue-200" : ""}>
              {c.key === "name" && isMe ? `${e.first_name} ${e.last_name} (You)` : null}
              {c.key === "code" ? <span className="font-mono text-xs">{e.employee_code}</span> : null}
              {c.key === "email" ? e.users?.email : null}
              {c.key === "department" ? e.department : null}
              {c.key === "role" ? <Badge variant="outline">{ROLE_LABELS[e.users?.role ?? "employee"]}</Badge> : null}
              {c.key === "status" ? (
                <Badge variant="outline" className={e.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
                  {e.status}
                </Badge>
              ) : null}
            </span>
          );
        },
      }))}
      rows={employees}
      keyOf={(e) => e.id}
      mobileCard={(e) => <MobileEmployeeCard employee={e} isMe={e.id === currentEmployeeId} />}
      empty={
        <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
          No employees found.
        </div>
      }
    />
  );
}
