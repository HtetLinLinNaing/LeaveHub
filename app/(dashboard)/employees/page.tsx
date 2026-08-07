import { createClient } from "@/lib/supabase/admin";
import { EmployeeList } from "@/components/features/employees/employee-list";
import { EmployeeDialog, type Manager } from "@/components/features/employees/employee-dialog";
import type { Role } from "@/lib/types";

interface ManagerRow {
  id: string;
  first_name: string;
  last_name: string;
  users: { role: Role } | { role: Role }[] | null;
}

function normalizeManager(row: ManagerRow): Manager {
  const u = Array.isArray(row.users) ? row.users[0] : row.users;
  return { id: row.id, first_name: row.first_name, last_name: row.last_name, role: u?.role ?? "employee" };
}

export default async function EmployeesPage() {
  const supabase = await createClient();

  const [employeesRes, managersRes] = await Promise.all([
    supabase
      .from("employees")
      .select("*, users(email, role)")
      .order("employee_code"),
    // Only surface users whose role is manager|hr|admin as manager candidates.
    supabase
      .from("employees")
      .select("id, first_name, last_name, users!inner(role)")
      .in("users.role", ["manager", "hr", "admin"])
      .eq("status", "active"),
  ]);

  const managers: Manager[] = (managersRes.data ?? []).map((r) => normalizeManager(r as ManagerRow));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Employees</h1>
        <EmployeeDialog managers={managers} />
      </div>
      <EmployeeList employees={employeesRes.data ?? []} />
    </div>
  );
}
