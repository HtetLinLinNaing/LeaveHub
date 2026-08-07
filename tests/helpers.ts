import { type Page, expect } from "@playwright/test";

export const USERS = {
  hr: { email: "alice@company.com", role: "HR" },
  manager: { email: "bob@company.com", role: "Manager" },
  employee: { email: "charlie@company.com", role: "Employee" },
  employee2: { email: "diana@company.com", role: "Employee" },
  admin: { email: "eve@company.com", role: "Admin" },
} as const;

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.click('button[type="submit"]');
  await page.waitForURL("/");
}

export async function logout(page: Page) {
  await page.click("text=Sign out");
  await page.waitForURL("/login");
}

export async function navigateTo(page: Page, section: string) {
  await page.click(`nav >> text="${section}"`);
  await page.waitForLoadState("networkidle");
}
