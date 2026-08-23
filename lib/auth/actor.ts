import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/types";

export type Actor = {
  authUserId: string;
  userId: string;
  email: string;
  role: Role;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    department?: string;
  } | null;
};

export async function resolveActor(
  authUserId: string,
  _email: string,
  db: SupabaseClient
): Promise<Actor | null> {
  const { data: user, error: userError } = await db
    .from("users")
    .select("id,email,role")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (userError) throw userError;
  if (!user) return null;

  const { data: employee, error: employeeError } = await db
    .from("employees")
    .select("id,first_name,last_name,department,status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (employeeError) throw employeeError;
  if (employee && employee.status !== "active") return null;
  if (!employee && user.role !== "admin") return null;

  return {
    authUserId,
    userId: user.id,
    email: user.email,
    role: user.role as Role,
    employee: employee
      ? {
          id: employee.id,
          firstName: employee.first_name,
          lastName: employee.last_name,
          department: employee.department ?? undefined,
        }
      : null,
  };
}
