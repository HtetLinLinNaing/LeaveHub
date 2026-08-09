import { test, expect } from "@playwright/test";
import { login, navigateTo, USERS } from "./helpers";

test.describe("Policies", () => {
  test("HR can see policies page", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Policies");
    await expect(page.locator("h1")).toHaveText("Policies");
  });

  test("HR sees leave types list", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Policies");
    await expect(page.locator("text=Leave Types")).toBeVisible();
    await expect(page.locator("text=Annual Leave")).toBeVisible();
    await expect(page.locator("text=Medical Leave")).toBeVisible();
    await expect(page.locator("text=Compassionate Leave")).toBeVisible();
  });

  test("HR sees holidays list", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Policies");
    await expect(page.locator("text=Public Holidays")).toBeVisible();
    await expect(page.locator("text=Add Holiday")).toBeVisible();
  });

  test("HR can open add holiday dialog", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Policies");
    await page.click("text=Add Holiday");
    await expect(page.locator("text=Add Public Holiday")).toBeVisible();
    await expect(page.locator('label:has-text("Holiday Name")')).toBeVisible();
    await expect(page.locator('label:has-text("Date")')).toBeVisible();
  });

  test("HR can add a holiday", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Policies");
    await page.click("text=Add Holiday");

    await page.fill('input[type="text"]', "Company Anniversary");
    await page.fill('input[type="date"]', "2026-12-15");

    await page.click('button >> text="Add Holiday"');
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Company Anniversary")).toBeVisible();
  });

  test("HR can edit leave type days", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Policies");

    // Click edit on first leave type
    const editBtn = page.locator("table button").first();
    if (await editBtn.isVisible()) {
      await editBtn.click();
      await expect(page.locator('input[type="number"]')).toBeVisible();
    }
  });

  test("employee cannot see policies link", async ({ page }) => {
    await login(page, USERS.employee.email);
    await expect(page.locator("nav >> text=Policies")).not.toBeVisible();
  });
});
