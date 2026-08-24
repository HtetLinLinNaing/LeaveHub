import { expect, test } from "@playwright/test";
import { readBootstrapConfig } from "../scripts/bootstrap-demo-auth.mjs";
import {
  indexAuthUsers,
  normalizeEmail,
  planDemoAuthChanges,
  summarizeDemoAuthPlan,
} from "../scripts/bootstrap-demo-auth-core.mjs";

test.describe("demo Auth bootstrap reconciliation", () => {
  test("normalizes email with trim and lowercase", () => {
    expect(normalizeEmail("  Demo.User@Example.COM  ")).toBe(
      "demo.user@example.com"
    );
  });

  test("links an existing matching Auth user instead of recreating it", () => {
    const plan = planDemoAuthChanges(
      [{ id: "public-1", email: " Demo@Example.com ", auth_user_id: null }],
      [{ id: "auth-1", email: "demo@example.com" }]
    );

    expect(plan).toEqual({
      create: [],
      updatePassword: [
        { authUserId: "auth-1", email: "demo@example.com" },
      ],
      link: [
        {
          publicUserId: "public-1",
          authUserId: "auth-1",
          email: "demo@example.com",
        },
      ],
    });
  });

  test("updates the password without relinking an already linked user", () => {
    const plan = planDemoAuthChanges(
      [
        {
          id: "public-1",
          email: "demo@example.com",
          auth_user_id: "auth-1",
        },
      ],
      [{ id: "auth-1", email: "DEMO@example.com" }]
    );

    expect(plan).toEqual({
      create: [],
      updatePassword: [
        { authUserId: "auth-1", email: "demo@example.com" },
      ],
      link: [],
    });
  });

  test("plans creation without inventing an Auth ID or link", () => {
    const plan = planDemoAuthChanges(
      [{ id: "public-1", email: "new@example.com", auth_user_id: null }],
      []
    );

    expect(plan).toEqual({
      create: [{ publicUserId: "public-1", email: "new@example.com" }],
      updatePassword: [],
      link: [],
    });
  });

  test("rejects duplicate normalized Auth emails", () => {
    expect(() =>
      indexAuthUsers([
        { id: "auth-1", email: "demo@example.com" },
        { id: "auth-2", email: " DEMO@example.com " },
      ])
    ).toThrow(/duplicate auth email.*demo@example\.com/i);
  });

  test("rejects a public link whose Auth identity has another email", () => {
    expect(() =>
      planDemoAuthChanges(
        [
          {
            id: "public-1",
            email: "demo@example.com",
            auth_user_id: "auth-1",
          },
        ],
        [{ id: "auth-1", email: "other@example.com" }]
      )
    ).toThrow(/email mismatch.*public-1.*auth-1/i);
  });

  test("rejects a public link to an Auth identity that does not exist", () => {
    expect(() =>
      planDemoAuthChanges(
        [
          {
            id: "public-1",
            email: "demo@example.com",
            auth_user_id: "missing-auth",
          },
        ],
        []
      )
    ).toThrow(/conflicting auth link.*public-1.*missing-auth/i);
  });

  test("rejects two public users targeting one Auth ID", () => {
    expect(() =>
      planDemoAuthChanges(
        [
          {
            id: "public-1",
            email: "demo@example.com",
            auth_user_id: "auth-1",
          },
          {
            id: "public-2",
            email: "other@example.com",
            auth_user_id: "auth-1",
          },
        ],
        [{ id: "auth-1", email: "demo@example.com" }]
      )
    ).toThrow(/auth identity auth-1.*multiple public users/i);
  });

  test("rejects duplicate normalized public emails before creation", () => {
    expect(() =>
      planDemoAuthChanges(
        [
          { id: "public-1", email: "demo@example.com", auth_user_id: null },
          { id: "public-2", email: " DEMO@example.com ", auth_user_id: null },
        ],
        []
      )
    ).toThrow(/duplicate public email.*demo@example\.com/i);
  });

  test("omits password and service-key values from plans and summaries", () => {
    const password = "demo-password-that-must-not-leak";
    const serviceKey = "service-key-that-must-not-leak";
    const plan = planDemoAuthChanges(
      [
        {
          id: "public-1",
          email: "demo@example.com",
          auth_user_id: null,
          password,
        },
      ],
      [{ id: "auth-1", email: "demo@example.com", serviceKey }]
    );
    const summary = summarizeDemoAuthPlan(plan);

    expect(summary).toEqual({
      create: { count: 0, emails: [] },
      updatePassword: { count: 1, emails: ["demo@example.com"] },
      link: { count: 1, emails: ["demo@example.com"] },
    });
    expect(JSON.stringify({ plan, summary })).not.toContain(password);
    expect(JSON.stringify({ plan, summary })).not.toContain(serviceKey);
  });
});

test("the explicit bootstrap rejects a disabled safety flag before client creation", () => {
  const password = "disabled-demo-password";
  const serviceKey = "disabled-service-key";
  let message = "";

  try {
    readBootstrapConfig({
      ALLOW_DEMO_AUTH_BOOTSTRAP: "false",
      NEXT_PUBLIC_SUPABASE_URL: "https://127.0.0.1:9",
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      DEMO_AUTH_PASSWORD: password,
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  expect(message).toContain("ALLOW_DEMO_AUTH_BOOTSTRAP=true");
  expect(message).not.toContain(password);
  expect(message).not.toContain(serviceKey);
});

for (const {
  name,
  env,
  expectedMessage,
} of [
  {
    name: "a Supabase URL",
    env: { NEXT_PUBLIC_SUPABASE_URL: "" },
    expectedMessage: "NEXT_PUBLIC_SUPABASE_URL",
  },
  {
    name: "a service-role key",
    env: { SUPABASE_SERVICE_ROLE_KEY: "" },
    expectedMessage: "SUPABASE_SERVICE_ROLE_KEY",
  },
  {
    name: "a demo password",
    env: { DEMO_AUTH_PASSWORD: "" },
    expectedMessage: "DEMO_AUTH_PASSWORD",
  },
  {
    name: "a demo password of at least 12 characters",
    env: { DEMO_AUTH_PASSWORD: "too-short" },
    expectedMessage: "at least 12 characters",
  },
]) {
  test(`the explicit bootstrap requires ${name} before client creation`, () => {
    expect(() =>
      readBootstrapConfig(
        Object.assign(
          {
            ALLOW_DEMO_AUTH_BOOTSTRAP: "true",
            NEXT_PUBLIC_SUPABASE_URL: "https://127.0.0.1:9",
            SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
            DEMO_AUTH_PASSWORD: "test-password-at-least-12",
          },
          env
        )
      )
    ).toThrow(expectedMessage);
  });
}
