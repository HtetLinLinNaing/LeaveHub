import { test, expect } from "@playwright/test";
import { login, logout, USERS } from "./helpers";

test.describe("Authentication", () => {
  test("redirects unauthenticated user to login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows login page with email and password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toHaveText("LeaveHub");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toHaveText("Sign in");
  });

  test("rejects invalid credentials without revealing account existence", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "unknown@gmail.com");
    await page.fill('input[name="password"]', "definitely-not-the-demo-password");
    await page.click('button[type="submit"]');
    await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
    await expect(page).toHaveURL(/\/login/);
  });

  test("rejects a known email with the same generic invalid-credential message", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', USERS.admin.email);
    await page.fill('input[name="password"]', "definitely-not-the-demo-password");
    await page.click('button[type="submit"]');
    await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
    await expect(page).toHaveURL(/\/login/);
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

  test("Server Action logout invalidates protected navigation", async ({ page }) => {
    await login(page, USERS.admin.email);
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("persists session across page refresh", async ({ page }) => {
    await login(page, USERS.admin.email);
    await page.reload();
    await expect(page).toHaveURL("/");
    await expect(page.locator("h1")).toContainText("Welcome");
  });

  test("legacy mock cookie does not authenticate", async ({ context, page }) => {
    await context.addCookies([
      {
        name: "leavehub_mock_user",
        value: encodeURIComponent(JSON.stringify({ email: USERS.admin.email })),
        url: "http://localhost:3000",
      },
    ]);

    await page.goto("/");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("h1")).toHaveText("LeaveHub");
  });
});
