// Server-only. Never import from a client component.
// Uses the service-role key to bypass RLS — required for server-side
// reads/writes once 004_strict_rls.sql is applied. Application-level
// authorization (role checks, manager-scope filters) is the gate.
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL"
    );
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
