import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/admin";
import { getCurrentEmployee, getSessionFromRequest } from "@/lib/auth";
import { EmployeeList } from "@/components/features/employees/employee-list";
import { EmployeeDialog } from "@/components/features/employees/employee-dialog";

export default async function EmployeesPage() {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  const supabase = await createClient();
  const { employee } = await getCurrentEmployee(supabase, session?.email);

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
      <EmployeeList employees={employees ?? []} currentEmployeeId={employee?.id ?? null} />
    </div>
  );
}
