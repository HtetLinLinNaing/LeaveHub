import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { readSupabasePublicEnv } from "../lib/supabase/env";
import { isPublicPath } from "../lib/supabase/proxy";
import { config } from "../proxy";

const migration = readFileSync("supabase/migrations/009_supabase_password_auth.sql", "utf8");

test.describe("Phase 2 authentication contracts", () => {
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
