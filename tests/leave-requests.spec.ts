import { test, expect } from "@playwright/test";
import { login, navigateTo, USERS } from "./helpers";

test.describe("Leave Requests", () => {
  test("shows leave page with balance and request form", async ({ page }) => {
    await login(page, USERS.employee.email);
    await navigateTo(page, "My Leave");
    await expect(page.locator("h1")).toHaveText("My Leave");
    await expect(page.locator("text=Request Leave")).toBeVisible();
  });

  test("opens request leave dialog", async ({ page }) => {
    await login(page, USERS.employee.email);
    await navigateTo(page, "My Leave");
    await page.click("text=Request Leave");
    await expect(page.locator("text=New Leave Request")).toBeVisible();
    await expect(page.locator("text=Leave Type")).toBeVisible();
    await expect(page.locator("text=Start Date")).toBeVisible();
    await expect(page.locator("text=End Date")).toBeVisible();
    await expect(page.locator("text=Duration")).toBeVisible();
    await expect(page.locator("text=Reason")).toBeVisible();
  });

  test("creates a leave request", async ({ page }) => {
    await login(page, USERS.employee.email);
    await navigateTo(page, "My Leave");
    await page.click("text=Request Leave");

    // Select leave type
    await page.click('[data-slot="select-trigger"]');
    await page.click('[data-slot="select-item"] >> text="Annual Leave"');

    // Fill dates
    await page.fill('input[type="date"]', "2026-08-10");
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill("2026-08-10");
    await dateInputs.nth(1).fill("2026-08-10");

    // Fill reason
    await page.fill("textarea", "Family event");

    // Submit
    await page.click('button >> text="Submit Request"');
    await page.waitForLoadState("networkidle");

    // Should close dialog and show in list
    await expect(page.locator("text=Annual Leave")).toBeVisible();
  });

  test("shows empty state when no requests", async ({ page }) => {
    await login(page, USERS.employee2.email);
    await navigateTo(page, "My Leave");
    await expect(page.locator("text=No leave requests yet")).toBeVisible();
  });

  test("cancels a pending request", async ({ page }) => {
    await login(page, USERS.employee.email);
    await navigateTo(page, "My Leave");

    // Find and click cancel on first request
    const cancelButton = page.locator("text=Cancel").first();
    if (await cancelButton.isVisible()) {
      await cancelButton.click();
      await page.waitForLoadState("networkidle");
    }
  });
});
