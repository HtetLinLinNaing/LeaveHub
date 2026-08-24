import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseCookieOptions } from "./cookie-options";
import { readSupabasePublicEnv } from "./env";

type CookieMutation = {
  name: string;
  value: string;
  options: CookieOptions;
};

export function isPublicPath(pathname: string) {
  return pathname === "/login";
}

export function applyCookieMutations(
  response: NextResponse,
  mutations: readonly CookieMutation[]
) {
  mutations.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options)
  );
}

export async function refreshAuthSession(request: NextRequest) {
  const { url, key } = readSupabasePublicEnv();
  const cookieMutations: CookieMutation[] = [];
  const responseHeaders = new Headers();

  const auth = createServerClient(url, key, {
    cookieOptions: getSupabaseCookieOptions(),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items, headers) => {
        items.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        cookieMutations.push(...items);
        Object.entries(headers).forEach(([name, value]) =>
          responseHeaders.set(name, value)
        );
      },
    },
  });

  const { data } = await auth.auth.getClaims();
  const response = NextResponse.next({ request });

  applyCookieMutations(response, cookieMutations);
  responseHeaders.forEach((value, name) => response.headers.set(name, value));

  return { response, authenticated: Boolean(data?.claims) };
}
