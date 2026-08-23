import { type NextRequest, NextResponse } from "next/server";
import {
  isPublicPath,
  refreshAuthSession,
} from "@/lib/supabase/proxy";

const REFRESH_RESPONSE_HEADERS = ["cache-control", "expires", "pragma"];

function redirectWithRefreshCookies(
  request: NextRequest,
  destination: string,
  refreshResponse: NextResponse
) {
  const redirectResponse = NextResponse.redirect(
    new URL(destination, request.url)
  );

  refreshResponse.cookies
    .getAll()
    .forEach((cookie) => redirectResponse.cookies.set(cookie));

  for (const name of REFRESH_RESPONSE_HEADERS) {
    const value = refreshResponse.headers.get(name);
    if (value) redirectResponse.headers.set(name, value);
  }

  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  const { response, authenticated } = await refreshAuthSession(request);
  const publicPath = isPublicPath(request.nextUrl.pathname);

  if (!authenticated && !publicPath) {
    return redirectWithRefreshCookies(request, "/login", response);
  }

  if (authenticated && publicPath) {
    return redirectWithRefreshCookies(request, "/", response);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:css|js|mjs|map|svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|otf|eot)$).*)",
  ],
};
