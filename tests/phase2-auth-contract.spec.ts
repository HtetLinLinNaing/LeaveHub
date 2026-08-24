import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  AuthApiError,
  AuthRetryableFetchError,
} from "@supabase/supabase-js";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveActor } from "../lib/auth/actor";
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
import { readSupabasePublicEnv } from "../lib/supabase/env";
import { isPublicPath } from "../lib/supabase/proxy";
import { loginSchema } from "../lib/validations";
import { config } from "../proxy";

const migration = readFileSync("supabase/migrations/009_supabase_password_auth.sql", "utf8");

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

  test("maps Auth identities without changing application IDs", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS auth_user_id UUID");
    expect(migration).toContain("SET auth_user_id = id");
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

  test("treats only the login page as public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/leave")).toBe(false);
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
});
