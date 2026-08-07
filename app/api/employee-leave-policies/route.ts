import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/admin";
import { canManageEmployees, getSessionFromRequest } from "@/lib/auth";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  if (!session) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const supabase = createClient();
  const body = (await req.json()) as { employee_id: string; leave_type_id: string; enabled?: boolean };
  if (!body.employee_id || !body.leave_type_id) {
    return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  }

  // Authz: only HR/admin can change policies. Reuse the existing helper.
  // We avoid the heavier requireSession() because this is a tiny CRUD route.
  const { data: user } = await supabase
    .from("users")
    .select("role")
    .eq("email", session.email)
    .single();
  if (!user || !canManageEmployees(user.role as "hr" | "admin")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("employee_leave_policies")
    .upsert(
      { employee_id: body.employee_id, leave_type_id: body.leave_type_id, enabled: body.enabled ?? true },
      { onConflict: "employee_id,leave_type_id" }
    );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  revalidatePath("/policies");
  revalidatePath("/leave");
  updateTag("current-employee");
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(cookieStore.toString());
  if (!session) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const url = new URL(req.url);
  const employee_id = url.searchParams.get("employee_id");
  const leave_type_id = url.searchParams.get("leave_type_id");
  if (!employee_id || !leave_type_id) {
    return NextResponse.json({ ok: false, error: "missing params" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: user } = await supabase
    .from("users")
    .select("role")
    .eq("email", session.email)
    .single();
  if (!user || !canManageEmployees(user.role as "hr" | "admin")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("employee_leave_policies")
    .delete()
    .eq("employee_id", employee_id)
    .eq("leave_type_id", leave_type_id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  revalidatePath("/policies");
  revalidatePath("/leave");
  updateTag("current-employee");
  return NextResponse.json({ ok: true });
}
