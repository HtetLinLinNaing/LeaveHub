import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers";

test.describe("Dashboard", () => {
  test("shows leave balance cards", async ({ page }) => {
    await login(page, USERS.employee.email);
    await expect(page.locator("text=Annual Leave")).toBeVisible();
    await expect(page.locator("text=Medical Leave")).toBeVisible();
  });

  test("shows pending requests count", async ({ page }) => {
    await login(page, USERS.employee.email);
    await expect(page.locator("text=Pending Requests")).toBeVisible();
  });

  test("shows upcoming holidays section", async ({ page }) => {
    await login(page, USERS.employee.email);
    await expect(page.locator("text=Upcoming Holidays")).toBeVisible();
  });

  test("shows away today section", async ({ page }) => {
    await login(page, USERS.employee.email);
    await expect(page.locator("text=Away Today")).toBeVisible();
  });

  test("shows recent requests section", async ({ page }) => {
    await login(page, USERS.employee.email);
    await expect(page.locator("text=Recent Requests")).toBeVisible();
  });
});
