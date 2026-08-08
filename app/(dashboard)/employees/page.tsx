import { createClient } from "@/lib/supabase/admin";
import { EmployeeList } from "@/components/features/employees/employee-list";
import { EmployeeDialog } from "@/components/features/employees/employee-dialog";

export default async function EmployeesPage() {
  const supabase = await createClient();

  const { data: employees } = await supabase
    .from("employees")
    .select("*, users(email, role)")
    .order("employee_code");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Employees</h1>
        <EmployeeDialog />
      </div>
      <EmployeeList employees={employees ?? []} />
    </div>
  );
}
