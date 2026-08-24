import { type Page } from "@playwright/test";

type DemoAuthEnvironment = Readonly<Record<string, string | undefined>>;

export function requireDemoAuthPassword(env: DemoAuthEnvironment): string {
  const password = env.DEMO_AUTH_PASSWORD;
  if (!password) {
    throw new Error("Missing DEMO_AUTH_PASSWORD for E2E auth tests");
  }

  return password;
}

const DEMO_PASSWORD = requireDemoAuthPassword(process.env);

export const USERS = {
  manager: { email: "bob@company.com", role: "Manager" },
  employee: { email: "charlie@company.com", role: "Employee" },
  employee2: { email: "diana@company.com", role: "Employee" },
  admin: { email: "eve@company.com", role: "Admin" },
} as const;

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', DEMO_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("/");
}

export async function logout(page: Page) {
  const openNavigation = page.getByRole("button", { name: "Open navigation" });
  if (await openNavigation.isVisible()) {
    await openNavigation.click();
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("/login");
}

export async function navigateTo(page: Page, section: string) {
  await page.click(`nav >> text="${section}"`);
  await page.waitForLoadState("networkidle");
}
