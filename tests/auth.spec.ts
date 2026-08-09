import { test, expect } from "@playwright/test";
import { login, logout, USERS } from "./helpers";

test.describe("Authentication", () => {
  test("redirects unauthenticated user to login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows login page with email form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toHaveText("LeaveHub");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toHaveText("Sign in");
  });

  test("rejects unknown email", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', "unknown@gmail.com");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Employee not found")).toBeVisible();
  });

  test("logs in as HR user", async ({ page }) => {
    await login(page, USERS.admin.email);
    await expect(page.locator("h1")).toContainText("Welcome");
    await expect(page.locator(`text=${USERS.admin.email}`)).toBeVisible();
  });

  test("logs in as manager", async ({ page }) => {
    await login(page, USERS.manager.email);
    await expect(page.locator("h1")).toContainText("Welcome");
  });

  test("logs in as employee", async ({ page }) => {
    await login(page, USERS.employee.email);
    await expect(page.locator("h1")).toContainText("Welcome");
  });

  test("logs out successfully", async ({ page }) => {
    await login(page, USERS.admin.email);
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });

  test("persists session across page refresh", async ({ page }) => {
    await login(page, USERS.admin.email);
    await page.reload();
    await expect(page).toHaveURL("/");
    await expect(page.locator("h1")).toContainText("Welcome");
  });
});
