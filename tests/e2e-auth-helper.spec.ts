import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const DEMO_PASSWORD = "task-8-demo-password";
const originalDemoPassword = process.env.DEMO_AUTH_PASSWORD;

type AuthHelpers = typeof import("./helpers");
let authHelpers: AuthHelpers;

test.beforeAll(async () => {
  process.env.DEMO_AUTH_PASSWORD = DEMO_PASSWORD;
  authHelpers = await import("./helpers");
});

test.afterAll(() => {
  if (originalDemoPassword === undefined) {
    delete process.env.DEMO_AUTH_PASSWORD;
  } else {
    process.env.DEMO_AUTH_PASSWORD = originalDemoPassword;
  }
});

test.describe("E2E auth helper", () => {
  test("derives a schema-valid wrong password different from the demo password", () => {
    const firstCandidate = "leavehub-known-wrong-password-a";
    const secondCandidate = "leavehub-known-wrong-password-b";

    expect(authHelpers.deriveWrongDemoAuthPassword(firstCandidate)).toBe(
      secondCandidate
    );
    expect(authHelpers.deriveWrongDemoAuthPassword(secondCandidate)).toBe(
      firstCandidate
    );

    for (const demoPassword of [
      firstCandidate,
      secondCandidate,
      "configured-demo-password",
    ]) {
      const wrongPassword =
        authHelpers.deriveWrongDemoAuthPassword(demoPassword);
      expect(wrongPassword).not.toBe(demoPassword);
      expect(wrongPassword.length).toBeGreaterThan(0);
      expect(wrongPassword.length).toBeLessThanOrEqual(128);
    }
  });

  test("rejects a Playwright process without the demo password", () => {
    expect(() => authHelpers.requireDemoAuthPassword({})).toThrow(
      "Missing DEMO_AUTH_PASSWORD for E2E auth tests"
    );
  });

  test("submits named email and password fields", async () => {
    const calls: string[] = [];
    const page = {
      goto: async (url: string) => calls.push(`goto:${url}`),
      fill: async (selector: string, value: string) =>
        calls.push(`fill:${selector}:${value}`),
      click: async (selector: string) => calls.push(`click:${selector}`),
      waitForURL: async (url: string) => calls.push(`waitForURL:${url}`),
    } as unknown as Page;

    await authHelpers.login(page, "charlie@company.com");

    expect(calls).toEqual([
      "goto:/login",
      'fill:input[name="email"]:charlie@company.com',
      `fill:input[name="password"]:${DEMO_PASSWORD}`,
      'click:button[type="submit"]',
      "waitForURL:/",
    ]);
  });

  test("opens visible mobile navigation before submitting logout", async () => {
    const calls: string[] = [];
    const page = {
      getByRole: (role: string, options: { name: string }) => {
        calls.push(`getByRole:${role}:${options.name}`);

        if (options.name === "Open navigation") {
          return {
            isVisible: async () => {
              calls.push("isVisible:open-navigation:true");
              return true;
            },
            click: async () => calls.push("click:open-navigation"),
          };
        }

        return {
          click: async () => calls.push("click:sign-out"),
        };
      },
      waitForURL: async (url: string) => calls.push(`waitForURL:${url}`),
    } as unknown as Page;

    await authHelpers.logout(page);

    expect(calls).toEqual([
      "getByRole:button:Open navigation",
      "isVisible:open-navigation:true",
      "click:open-navigation",
      "getByRole:button:Sign out",
      "click:sign-out",
      "waitForURL:/login",
    ]);
  });

  test("leaves hidden desktop navigation closed before submitting logout", async () => {
    const calls: string[] = [];
    const page = {
      getByRole: (role: string, options: { name: string }) => {
        calls.push(`getByRole:${role}:${options.name}`);

        if (options.name === "Open navigation") {
          return {
            isVisible: async () => {
              calls.push("isVisible:open-navigation:false");
              return false;
            },
            click: async () => calls.push("click:open-navigation"),
          };
        }

        return {
          click: async () => calls.push("click:sign-out"),
        };
      },
      waitForURL: async (url: string) => calls.push(`waitForURL:${url}`),
    } as unknown as Page;

    await authHelpers.logout(page);

    expect(calls).toEqual([
      "getByRole:button:Open navigation",
      "isVisible:open-navigation:false",
      "getByRole:button:Sign out",
      "click:sign-out",
      "waitForURL:/login",
    ]);
  });
});
