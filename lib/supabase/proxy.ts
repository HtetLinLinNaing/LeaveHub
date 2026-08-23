import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { readSupabasePublicEnv } from "./env";

type CookieMutation = {
  name: string;
  value: string;
  options: CookieOptions;
};

export function isPublicPath(pathname: string) {
  return pathname === "/login";
}

export async function refreshAuthSession(request: NextRequest) {
  const { url, key } = readSupabasePublicEnv();
  const cookieMutations: CookieMutation[] = [];
  const responseHeaders = new Headers();

  const auth = createServerClient(url, key, {
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

  cookieMutations.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options)
  );
  responseHeaders.forEach((value, name) => response.headers.set(name, value));

  return { response, authenticated: Boolean(data?.claims) };
}
