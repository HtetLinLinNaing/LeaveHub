import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/admin";
import { mockLoginRequestSchema } from "@/lib/validations";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = mockLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { email } = parsed.data;

  const supabase = await createClient();

  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, role")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    console.error("Failed to look up mock-login user", error);
    return NextResponse.json({ error: "Login service unavailable" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  // Block inactive employees from logging in. Admin has no employees
  // row, so the join returns null and we let admin through.
  if (user.role !== "admin") {
    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (employeeError) {
      console.error("Failed to look up mock-login employee", employeeError);
      return NextResponse.json({ error: "Login service unavailable" }, { status: 500 });
    }
    if (!employee || employee.status !== "active") {
      return NextResponse.json(
        { error: "Account is inactive. Contact admin to reactivate." },
        { status: 403 }
      );
    }
  }

  return NextResponse.json({ user });
}
