import { createClient } from "@/lib/supabase/admin";
import { EmployeeList } from "@/components/features/employees/employee-list";
import { EmployeeDialog } from "@/components/features/employees/employee-dialog";

export default async function EmployeesPage() {
  const supabase = await createClient();

  const { data: employees } = await supabase
    .from("employees")
    .select("*, users(email, role)")
    .order("employee_code");

  const { data: managers } = await supabase
    .from("employees")
    .select("id, first_name, last_name")
    .eq("status", "active");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Employees</h1>
        <EmployeeDialog managers={managers ?? []} />
      </div>
      <EmployeeList employees={employees ?? []} />
    </div>
  );
}
