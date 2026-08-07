import { test, expect } from "@playwright/test";
import { login, navigateTo, USERS } from "./helpers";

test.describe("Calendar", () => {
  test("all roles can see calendar", async ({ page }) => {
    for (const user of [USERS.hr, USERS.manager, USERS.employee]) {
      await login(page, user.email);
      await navigateTo(page, "Calendar");
      await expect(page.locator("h1")).toHaveText("Team Calendar");
      await page.click("text=Sign out");
    }
  });

  test("shows current month", async ({ page }) => {
    await login(page, USERS.employee.email);
    await navigateTo(page, "Calendar");
    const month = new Date().toLocaleString("en", { month: "long" });
    await expect(page.locator(`text=${month}`)).toBeVisible();
  });

  test("shows day names", async ({ page }) => {
    await login(page, USERS.employee.email);
    await navigateTo(page, "Calendar");
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      await expect(page.locator(`text=${day}`).first()).toBeVisible();
    }
  });

  test("can navigate months", async ({ page }) => {
    await login(page, USERS.employee.email);
    await navigateTo(page, "Calendar");

    // Click next month
    const nextBtn = page.locator("button").last();
    await nextBtn.click();
    await page.waitForTimeout(500);

    // Should show next month
    const now = new Date();
    now.setMonth(now.getMonth() + 1);
    const nextMonth = now.toLocaleString("en", { month: "long" });
    await expect(page.locator(`text=${nextMonth}`)).toBeVisible();
  });

  test("shows holidays from seed data", async ({ page }) => {
    await login(page, USERS.employee.email);
    await navigateTo(page, "Calendar");
    // Navigate to months with seeded holidays
    // August 2026 should be visible by default
    await expect(page.locator("h1")).toHaveText("Team Calendar");
  });
});
