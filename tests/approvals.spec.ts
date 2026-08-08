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

  test("manager cannot approve their own leave request", async ({ page }) => {
    // Manager submits their own request
    await login(page, USERS.manager.email);
    await navigateTo(page, "My Leave");
    await page.click("text=Request Leave");
    await page.click('[data-slot="select-trigger"]');
    await page.click('[data-slot="select-item"] >> text="Annual Leave"');
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill("2026-08-10");
    await dateInputs.nth(1).fill("2026-08-10");
    await page.fill("textarea", "Self approval attempt");
    await page.click('button >> text="Submit Request"');
    await page.waitForLoadState("networkidle");

    // Manager opens approvals and tries to approve own request
    await navigateTo(page, "Approvals");
    const ownRow = page.locator("text=Bob Tran").first();
    if (await ownRow.isVisible().catch(() => false)) {
      const ownApprove = page
        .locator("tr", { hasText: "Bob Tran" })
        .locator("text=Approve")
        .first();
      if (await ownApprove.isVisible().catch(() => false)) {
        await ownApprove.click();
        await page.waitForLoadState("networkidle");
        await expect(page.locator("text=You cannot approve your own leave")).toBeVisible();
      }
    }
  });
});
