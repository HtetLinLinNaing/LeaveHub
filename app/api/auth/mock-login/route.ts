import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  return NextResponse.json({ user });
}

export async function DELETE() {
  return NextResponse.json({ ok: true });
}
