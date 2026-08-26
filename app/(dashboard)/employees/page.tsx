import { requireRequestContext } from "@/lib/dal/request-context";
import { EmployeeList } from "@/components/features/employees/employee-list";
import { EmployeeDialog } from "@/components/features/employees/employee-dialog";

export default async function EmployeesPage() {
  const { actor, db } = await requireRequestContext();

  const { data: employees, error } = await db
    .from("employees")
    .select("*, users(email, role)")
    .order("employee_code");
  if (error) throw error;

  const canManage = actor.role === "admin";

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Employees</h1>
        {canManage && <EmployeeDialog />}
      </div>
      <EmployeeList
        employees={employees ?? []}
        currentEmployeeId={actor.employee?.id ?? null}
        canManage={canManage}
      />
    </div>
  );
}
