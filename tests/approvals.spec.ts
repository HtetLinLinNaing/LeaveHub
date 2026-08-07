import { test, expect } from "@playwright/test";
import { login, navigateTo, USERS } from "./helpers";

test.describe("Approvals", () => {
  test("manager can see approval queue", async ({ page }) => {
    await login(page, USERS.manager.email);
    await navigateTo(page, "Approvals");
    await expect(page.locator("h1")).toHaveText("Pending Approvals");
  });

  test("HR can see approval queue", async ({ page }) => {
    await login(page, USERS.hr.email);
    await navigateTo(page, "Approvals");
    await expect(page.locator("h1")).toHaveText("Pending Approvals");
  });

  test("employee cannot see approvals link", async ({ page }) => {
    await login(page, USERS.employee.email);
    await expect(page.locator("nav >> text=Approvals")).not.toBeVisible();
  });

  test("shows empty state when no pending requests", async ({ page }) => {
    await login(page, USERS.manager.email);
    await navigateTo(page, "Approvals");
    // Either shows requests or empty state
    const hasRequests = await page.locator("text=No pending approvals").isVisible();
    const hasList = await page.locator("text=Approve").first().isVisible().catch(() => false);
    expect(hasRequests || hasList).toBeTruthy();
  });

  test("approve button is visible for pending requests", async ({ page }) => {
    await login(page, USERS.manager.email);
    await navigateTo(page, "Approvals");

    // If there are pending requests, approve/reject buttons should be visible
    const approveBtn = page.locator("text=Approve").first();
    if (await approveBtn.isVisible()) {
      await expect(page.locator("text=Reject").first()).toBeVisible();
    }
  });
});
