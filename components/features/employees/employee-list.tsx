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
  {
    key: "name",
    header: "Name",
    cell: (e) => (
      <span className="font-medium">
        {e.first_name} {e.last_name}
      </span>
    ),
  },
  { key: "email", header: "Email", cell: (e) => e.users?.email },
  { key: "department", header: "Department", cell: (e) => e.department },
  {
    key: "role",
    header: "Role",
    cell: (e) => <Badge variant="outline">{ROLE_LABELS[e.users?.role ?? "employee"]}</Badge>,
  },
  {
    key: "status",
    header: "Status",
    cell: (e) => (
      <Badge variant="outline" className={e.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
        {e.status}
      </Badge>
    ),
  },
];

function MobileEmployeeCard({ employee, isMe }: { employee: Employee; isMe: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {employee.first_name} {employee.last_name}
          {isMe && <span className="ml-1 text-blue-700">(You)</span>}
        </span>
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
      columns={columns}
      rows={employees}
      keyOf={(e) => e.id}
      rowClassName={(e) => (e.id === currentEmployeeId ? "bg-blue-50 ring-1 ring-blue-200" : "")}
      mobileCard={(e) => (
        <MobileEmployeeCard employee={e} isMe={e.id === currentEmployeeId} />
      )}
      empty={
        <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
          No employees found.
        </div>
      }
    />
  );
}
