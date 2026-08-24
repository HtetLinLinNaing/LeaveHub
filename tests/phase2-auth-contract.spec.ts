import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  AuthApiError,
  AuthRetryableFetchError,
} from "@supabase/supabase-js";
import {
  getRedirectUrl,
  unstable_doesMiddlewareMatch,
} from "next/experimental/testing/server";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveActor } from "../lib/auth/actor";
import { parseLoginFormData } from "../lib/auth/login-input";
import {
  authenticatePassword,
  loginFailureState,
  type PasswordAuthenticationDependencies,
} from "../lib/auth/password";
import {
  canApproveLeave,
  canManageEmployees,
  canManageGrants,
  canProposeGrants,
  canViewApprovals,
  hasRole,
} from "../lib/auth/permissions";
import { getSupabaseCookieOptions } from "../lib/supabase/cookie-options";
import { readSupabasePublicEnv } from "../lib/supabase/env";
import {
  applyCookieMutations,
  isPublicPath,
} from "../lib/supabase/proxy";
import { loginSchema } from "../lib/validations";
import { config, routeRefreshedSession } from "../proxy";

const migration = readFileSync("supabase/migrations/009_supabase_password_auth.sql", "utf8");
const legacyAuthMigration = readFileSync("supabase/migrations/003_add_auth_fk.sql", "utf8");
const serverClientSource = readFileSync("lib/supabase/server.ts", "utf8");
const proxyClientSource = readFileSync("lib/supabase/proxy.ts", "utf8");

const protectedServerComponents = [
  "app/(dashboard)/layout.tsx",
  "app/(dashboard)/page.tsx",
  "app/(dashboard)/leave/page.tsx",
  "app/(dashboard)/approvals/page.tsx",
  "app/(dashboard)/employees/page.tsx",
  "app/(dashboard)/calendar/page.tsx",
  "app/(dashboard)/policies/page.tsx",
] as const;

const protectedPages = protectedServerComponents.filter(
  (path) => !path.endsWith("layout.tsx")
);
const legacyAuthImport = ['from "@/lib', '/auth"'].join("");
const legacyAdminImport = ['from "@/lib/supabase', '/admin"'].join("");
const legacySessionHelper = ["require", "Session"].join("");

type ActorQueryRow = Record<string, unknown> | null;

function createActorDatabase({
  user,
  employee,
  employeeError = null,
}: {
  user: ActorQueryRow;
  employee: ActorQueryRow;
  employeeError?: Error | null;
}) {
  return {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            if (
              table === "users" &&
              columns === "id,email,role" &&
              column === "auth_user_id" &&
              value === "auth-user-id"
            ) {
              return { data: user, error: null };
            }
            if (
              table === "employees" &&
              columns === "id,first_name,last_name,department,status" &&
              column === "user_id" &&
              value === "app-user-id"
            ) {
              return { data: employee, error: employeeError };
            }
            throw new Error(`Unexpected actor query: ${table}.${columns}.${column}.${value}`);
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function createPasswordDependencies({
  signInError = null,
  actor = { userId: "app-user-id" },
  actorError,
}: {
  signInError?: unknown;
  actor?: { userId: string } | null;
  actorError?: Error;
} = {}) {
  let signedOut = false;

  const dependencies: PasswordAuthenticationDependencies = {
    signInWithPassword: async () => ({
      user: signInError
        ? null
        : { id: "auth-user-id", email: "employee@example.com" },
      error: signInError,
    }),
    resolveActor: async () => {
      if (actorError) throw actorError;
      return actor;
    },
    signOut: async () => {
      signedOut = true;
    },
  };

  return { dependencies, wasSignedOut: () => signedOut };
}

test.describe("Phase 2 authentication contracts", () => {
  test("ignores Next Server Action metadata when parsing login fields", () => {
    const formData = new FormData();
    formData.set("email", "employee@example.com");
    formData.set("password", "password");
    formData.set("$ACTION_REF_1", "server-action-reference");
    formData.set("$ACTION_1:0", "server-action-bound-argument");

    const parsed = parseLoginFormData(formData);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        email: "employee@example.com",
        password: "password",
      });
    }
  });

  test("rejects malformed login email addresses", () => {
    expect(
      loginSchema.safeParse({ email: "not-an-email", password: "password" })
        .success
    ).toBe(false);
  });

  test("rejects an empty login password", () => {
    expect(
      loginSchema.safeParse({ email: "employee@example.com", password: "" })
        .success
    ).toBe(false);
  });

  test("rejects a login password over 128 characters", () => {
    expect(
      loginSchema.safeParse({
        email: "employee@example.com",
        password: "x".repeat(129),
      }).success
    ).toBe(false);
  });

  test("rejects extra login fields", () => {
    expect(
      loginSchema.safeParse({
        email: "employee@example.com",
        password: "password",
        role: "admin",
      }).success
    ).toBe(false);
  });

  test("does not enumerate invalid password credentials", async () => {
    const { dependencies, wasSignedOut } = createPasswordDependencies({
      signInError: new AuthApiError(
        "provider detail must stay private",
        400,
        "invalid_credentials"
      ),
    });

    await expect(
      authenticatePassword(
        { email: "employee@example.com", password: "wrong" },
        dependencies
      )
    ).resolves.toEqual({ error: "Invalid email or password." });
    expect(wasSignedOut()).toBe(true);
  });

  test("signs out an authenticated identity without an active linked actor", async () => {
    const { dependencies, wasSignedOut } = createPasswordDependencies({
      actor: null,
    });

    await expect(
      authenticatePassword(
        { email: "employee@example.com", password: "password" },
        dependencies
      )
    ).resolves.toEqual({
      error: "Your account is not enabled for LeaveHub.",
    });
    expect(wasSignedOut()).toBe(true);
  });

  test("throws retryable Auth failures for operational handling", async () => {
    const authError = new AuthRetryableFetchError(
      "provider unavailable",
      503
    );
    const { dependencies } = createPasswordDependencies({
      signInError: authError,
    });

    await expect(
      authenticatePassword(
        { email: "employee@example.com", password: "password" },
        dependencies
      )
    ).rejects.toBe(authError);
  });

  test("throws rate-limit Auth responses for operational handling", async () => {
    const authError = new AuthApiError(
      "rate limit detail must stay private",
      429,
      "over_request_rate_limit"
    );
    const { dependencies } = createPasswordDependencies({
      signInError: authError,
    });

    await expect(
      authenticatePassword(
        { email: "employee@example.com", password: "password" },
        dependencies
      )
    ).rejects.toBe(authError);
  });

  test("signs out before propagating actor lookup failures", async () => {
    const databaseError = new Error("database connection detail");
    const { dependencies, wasSignedOut } = createPasswordDependencies({
      actorError: databaseError,
    });

    await expect(
      authenticatePassword(
        { email: "employee@example.com", password: "password" },
        dependencies
      )
    ).rejects.toBe(databaseError);
    expect(wasSignedOut()).toBe(true);
  });

  test("sanitizes and logs unexpected login failures", () => {
    const operationalError = new Error("database connection detail");
    const logged: Array<{ message: string; error: unknown }> = [];

    expect(
      loginFailureState(operationalError, (message, error) => {
        logged.push({ message, error });
      })
    ).toEqual({ error: "Sign in is temporarily unavailable." });
    expect(logged).toEqual([
      { message: "Password sign-in failed", error: operationalError },
    ]);
  });

  test("resolves a linked active employee to the approved Actor shape", async () => {
    const db = createActorDatabase({
      user: {
        id: "app-user-id",
        email: "database@example.com",
        role: "employee",
      },
      employee: {
        id: "employee-id",
        first_name: "Ada",
        last_name: "Lovelace",
        department: "Engineering",
        status: "active",
      },
    });

    await expect(
      resolveActor("auth-user-id", "claims@example.com", db)
    ).resolves.toEqual({
      authUserId: "auth-user-id",
      userId: "app-user-id",
      email: "database@example.com",
      role: "employee",
      employee: {
        id: "employee-id",
        firstName: "Ada",
        lastName: "Lovelace",
        department: "Engineering",
      },
    });
  });

  test("accepts a linked admin without an employee row", async () => {
    const db = createActorDatabase({
      user: { id: "app-user-id", email: "admin@example.com", role: "admin" },
      employee: null,
    });

    await expect(
      resolveActor("auth-user-id", "admin@example.com", db)
    ).resolves.toEqual({
      authUserId: "auth-user-id",
      userId: "app-user-id",
      email: "admin@example.com",
      role: "admin",
      employee: null,
    });
  });

  test("rejects an unlinked Auth identity", async () => {
    const db = createActorDatabase({ user: null, employee: null });

    await expect(
      resolveActor("auth-user-id", "unknown@example.com", db)
    ).resolves.toBeNull();
  });

  test("rejects an inactive employee", async () => {
    const db = createActorDatabase({
      user: {
        id: "app-user-id",
        email: "inactive@example.com",
        role: "employee",
      },
      employee: {
        id: "employee-id",
        first_name: "Inactive",
        last_name: "Employee",
        department: "Operations",
        status: "inactive",
      },
    });

    await expect(
      resolveActor("auth-user-id", "inactive@example.com", db)
    ).resolves.toBeNull();
  });

  for (const role of ["employee", "manager"] as const) {
    test(`rejects a linked ${role} without an employee row`, async () => {
      const db = createActorDatabase({
        user: { id: "app-user-id", email: `${role}@example.com`, role },
        employee: null,
      });

      await expect(
        resolveActor("auth-user-id", `${role}@example.com`, db)
      ).resolves.toBeNull();
    });
  }

  test("propagates employee lookup failures", async () => {
    const db = createActorDatabase({
      user: {
        id: "app-user-id",
        email: "employee@example.com",
        role: "employee",
      },
      employee: null,
      employeeError: new Error("employee lookup unavailable"),
    });

    await expect(
      resolveActor("auth-user-id", "employee@example.com", db)
    ).rejects.toThrow("employee lookup unavailable");
  });

  test("preserves the Phase 1 permission matrix", () => {
    const roles = ["employee", "manager", "admin"] as const;

    expect(hasRole("manager", ["employee", "manager"])).toBe(true);
    expect(hasRole("admin", ["employee", "manager"])).toBe(false);

    expect(roles.map(canApproveLeave)).toEqual([
      false,
      true,
      true,
    ]);
    expect(roles.map(canViewApprovals)).toEqual([
      false,
      true,
      true,
    ]);
    expect(roles.map(canManageEmployees)).toEqual([
      false,
      false,
      true,
    ]);
    expect(roles.map(canProposeGrants)).toEqual([
      false,
      true,
      true,
    ]);
    expect(roles.map(canManageGrants)).toEqual([
      false,
      false,
      true,
    ]);
  });

  test("keeps seeded public users from blocking a fresh migration chain", () => {
    expect(legacyAuthMigration).toMatch(
      /FOREIGN KEY \(id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE\s+NOT VALID;/
    );
  });

  test("maps only existing Auth identities without changing application IDs", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS auth_user_id UUID");
    expect(migration).toContain("UPDATE public.users AS app_user");
    expect(migration).toContain("SET auth_user_id = app_user.id");
    expect(migration).toContain("FROM auth.users AS auth_user");
    expect(migration).toContain("auth_user.id = app_user.id");
    expect(migration).toContain("REFERENCES auth.users(id) ON DELETE SET NULL");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS users_id_fkey");
  });

  test("resolves RLS identity through auth_user_id", () => {
    expect(migration).toContain("WHERE auth_user_id = auth.uid()");
    expect(migration).toContain("JOIN users u ON u.id = e.user_id");
    expect(migration).toContain("u.auth_user_id = auth.uid()");
  });

  test("removes anonymous policies on post-RLS tables", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "dev_allow_all_leave_grants"');
    expect(migration).toContain('DROP POLICY IF EXISTS "dev_allow_all_leave_request_days"');
  });

  test("requires both public Supabase credentials", () => {
    expect(() =>
      readSupabasePublicEnv({} as unknown as NodeJS.ProcessEnv)
    ).toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_URL"
    );
    expect(() =>
      readSupabasePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

    expect(
      readSupabasePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "must-not-be-exposed",
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual({
      url: "https://project.supabase.co",
      key: "public-anon-key",
    });
  });

  test("uses the same hardened cookie options in both SSR clients", () => {
    expect(getSupabaseCookieOptions("development")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
    });
    expect(getSupabaseCookieOptions("production")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
    });

    for (const source of [serverClientSource, proxyClientSource]) {
      expect(source).toContain(
        'import { getSupabaseCookieOptions } from "./cookie-options"'
      );
      expect(source).toContain("cookieOptions: getSupabaseCookieOptions()");
    }
  });

  for (const { nodeEnv, secure } of [
    { nodeEnv: "development", secure: false },
    { nodeEnv: "production", secure: true },
  ] as const) {
    test(`preserves hardened ${nodeEnv} cookies through Proxy mutation and redirect`, () => {
      const request = new NextRequest("https://leavehub.example/leave");
      const refreshResponse = NextResponse.next({ request });
      const options = getSupabaseCookieOptions(nodeEnv);
      const cookieName = "sb-project-auth-token";

      applyCookieMutations(refreshResponse, [
        { name: cookieName, value: "opaque-session", options },
      ]);
      refreshResponse.headers.set(
        "cache-control",
        "private, no-cache, no-store, must-revalidate, max-age=0"
      );
      refreshResponse.headers.set("expires", "0");
      refreshResponse.headers.set("pragma", "no-cache");

      expect(refreshResponse.cookies.get(cookieName)).toMatchObject({
        name: cookieName,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure,
      });

      const redirectResponse = routeRefreshedSession(request, {
        response: refreshResponse,
        authenticated: false,
      });

      expect(redirectResponse.cookies.get(cookieName)).toMatchObject({
        name: cookieName,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure,
      });
      expect(redirectResponse.headers.get("cache-control")).toBe(
        "private, no-cache, no-store, must-revalidate, max-age=0"
      );
      expect(redirectResponse.headers.get("expires")).toBe("0");
      expect(redirectResponse.headers.get("pragma")).toBe("no-cache");

      const setCookie = redirectResponse.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("Path=/");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=lax");
      expect(setCookie.includes("Secure")).toBe(secure);
    });
  }

  test("treats only the login page as public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/leave")).toBe(false);
  });

  test("keeps login reachable for claims-bearing sessions rejected by actor verification", () => {
    const request = new NextRequest("https://leavehub.example/login");
    const refreshResponse = NextResponse.next({ request });

    const response = routeRefreshedSession(request, {
      response: refreshResponse,
      authenticated: true,
    });

    expect(response).toBe(refreshResponse);
    expect(getRedirectUrl(response)).toBeNull();
  });

  test("redirects a claims-missing protected request to login", () => {
    const request = new NextRequest("https://leavehub.example/leave");

    const response = routeRefreshedSession(request, {
      response: NextResponse.next({ request }),
      authenticated: false,
    });

    expect(getRedirectUrl(response)).toBe("https://leavehub.example/login");
  });

  test("leaves claims-bearing protected requests for secure actor verification", () => {
    const request = new NextRequest("https://leavehub.example/leave");
    const refreshResponse = NextResponse.next({ request });

    const response = routeRefreshedSession(request, {
      response: refreshResponse,
      authenticated: true,
    });

    expect(response).toBe(refreshResponse);
    expect(getRedirectUrl(response)).toBeNull();
  });

  test("excludes framework and static assets from Proxy", () => {
    for (const url of [
      "/_next/static/chunks/app.js",
      "/_next/image?url=%2Flogo.png&w=64&q=75",
      "/favicon.ico",
      "/logo.svg",
      "/fonts/inter.woff2",
    ]) {
      expect(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }),
        `${url} should bypass Proxy`
      ).toBe(false);
    }
  });

  test("keeps pages and Server Action POST routes behind Proxy", () => {
    for (const url of ["/", "/leave"]) {
      expect(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }),
        `${url} should run Proxy`
      ).toBe(true);
    }

    expect(
      unstable_doesMiddlewareMatch({
        config,
        headers: { "next-action": "server-action-id" },
        nextConfig: {},
        url: "/leave",
      })
    ).toBe(true);
  });

  test("keeps protected Server Components behind the verified request context", () => {
    for (const path of protectedServerComponents) {
      const source = readFileSync(path, "utf8");

      expect(source, `${path} must not read request cookies directly`).not.toContain(
        'from "next/headers"'
      );
      expect(source, `${path} must not use legacy mock-session helpers`).not.toContain(
        legacyAuthImport
      );
      expect(source, `${path} must not create an admin client directly`).not.toContain(
        legacyAdminImport
      );
    }

    const layoutSource = readFileSync(protectedServerComponents[0], "utf8");
    expect(layoutSource).toContain(
      'import { requireActor } from "@/lib/auth/session"'
    );
    expect(layoutSource).toContain("const actor = await requireActor()");

    for (const path of protectedPages) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path} must import the verified request context`).toContain(
        'import { requireRequestContext } from "@/lib/dal/request-context"'
      );
      expect(source, `${path} must independently verify its request`).toContain(
        "await requireRequestContext()"
      );
    }
  });

  test("authenticates every Server Action through the verified request context", () => {
    const source = readFileSync("lib/actions.ts", "utf8");

    expect(source).toContain(
      'import { requireRequestContext } from "@/lib/dal/request-context"'
    );
    expect(source).toContain(
      'from "@/lib/auth/permissions"'
    );
    expect(source).not.toContain('from "next/headers"');
    expect(source).not.toContain(legacyAuthImport);
    expect(source).not.toContain(legacyAdminImport);
    expect(source).not.toContain(legacySessionHelper);

    expect(source.match(/await requireRequestContext\(\)/g)).toHaveLength(12);
  });
});
