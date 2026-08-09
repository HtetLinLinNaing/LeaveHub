import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const { email } = await request.json();

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, role")
    .eq("email", email)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  // Block inactive employees from logging in. Admin has no employees
  // row, so the join returns null and we let admin through.
  if (user.role !== "admin") {
    const { data: employee } = await supabase
      .from("employees")
      .select("status")
      .eq("user_id", user.id)
      .single();
    if (employee && employee.status !== "active") {
      return NextResponse.json(
        { error: "Account is inactive. Contact admin to reactivate." },
        { status: 403 }
      );
    }
  }

  return NextResponse.json({ user });
}
