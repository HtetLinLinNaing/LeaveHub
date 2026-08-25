import type { CookieOptions } from "@supabase/ssr";

export function getSupabaseCookieOptions(
  nodeEnv: string | undefined = process.env.NODE_ENV
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: nodeEnv === "production",
  };
}
