import { createClient } from "@/lib/supabase/server";
import type { User } from "./types";

// Server-only auth functions (uses next/headers via supabase/server)

export async function getCurrentUser(): Promise<{ user: User; employee_id: string } | null> {
  const supabase = await createClient();

  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (authUser) {
    const { data } = await supabase
      .from("users")
      .select("*, employees(id)")
      .eq("id", authUser.id)
      .single();

    if (!data) return null;
    return {
      user: { id: data.id, email: data.email, role: data.role, created_at: data.created_at },
      employee_id: data.employees?.[0]?.id ?? "",
    };
  }

  return null;
}
