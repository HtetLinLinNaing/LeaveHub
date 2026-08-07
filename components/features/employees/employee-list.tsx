"use client";

import { Badge } from "@/components/ui/badge";
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

export function EmployeeList({ employees }: { employees: Employee[] }) {
  if (employees.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
        No employees found.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50 text-left">
            <th className="px-4 py-3 font-medium">Code</th>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Department</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.id} className="border-b last:border-0">
              <td className="px-4 py-3 font-mono text-xs">{emp.employee_code}</td>
              <td className="px-4 py-3 font-medium">
                {emp.first_name} {emp.last_name}
              </td>
              <td className="px-4 py-3 text-gray-500">{emp.users?.email}</td>
              <td className="px-4 py-3">{emp.department}</td>
              <td className="px-4 py-3">
                <Badge variant="outline">
                  {ROLE_LABELS[emp.users?.role ?? "employee"]}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant="outline"
                  className={
                    emp.status === "active"
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  }
                >
                  {emp.status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
