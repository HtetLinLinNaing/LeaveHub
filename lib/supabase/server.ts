import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseCookieOptions } from "./cookie-options";
import { readSupabasePublicEnv } from "./env";

export async function createAuthClient() {
  const cookieStore = await cookies();
  const { url, key } = readSupabasePublicEnv();

  return createServerClient(url, key, {
    cookieOptions: getSupabaseCookieOptions(),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Proxy owns refresh writes during Server Component rendering.
        }
      },
    },
  });
}
