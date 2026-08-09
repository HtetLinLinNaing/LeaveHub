import { test, expect } from "@playwright/test";
import { login, navigateTo, USERS } from "./helpers";

// Use a future date so the working-days calculation accepts the range
// regardless of when the tests run. Each test gets a unique offset.
function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function submitLeaveRequest(
  page: import("@playwright/test").Page,
  opts: {
    leaveType: string;
    startDate: string;
    endDate: string;
    reason: string;
  }
) {
  await page.click("text=Request Leave");
  await page.locator('[role="combobox"]').first().click();
  await page.click(`[role="option"]:text("${opts.leaveType}")`);
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill(opts.startDate);
  await dates.nth(1).fill(opts.endDate);
  await page.fill("textarea", opts.reason);
  await page.click('button:has-text("Submit Request")');
  await page.waitForLoadState("networkidle");
}

test.describe("Leave approval routing", () => {
  test("manager can approve a direct report's request", async ({ page }) => {
    // Employee submits.
    await login(page, USERS.employee.email);
    await submitLeaveRequest(page, {
      leaveType: "Annual Leave",
      startDate: futureDate(14),
      endDate: futureDate(14),
      reason: "Personal day",
    });
    // Manager logs in and approves.
    await page.context().clearCookies();
    await login(page, USERS.manager.email);
    await navigateTo(page, "Approvals");
    await expect(
      page.locator(`text=${USERS.employee.email.split("@")[0]}`).first()
    ).toBeVisible();
    await page.locator("text=Approve").first().click();
    await expect(page.locator("text=approved").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("manager's self-request is hidden from their own queue", async ({ page }) => {
    // Manager submits a request for themselves.
    await login(page, USERS.manager.email);
    await submitLeaveRequest(page, {
      leaveType: "Annual Leave",
      startDate: futureDate(15),
      endDate: futureDate(15),
      reason: "Manager self day",
    });
    // Reload and check the manager's own queue: their request should not appear.
    await page.reload();
    await navigateTo(page, "Approvals");
    await expect(page.locator("text=No pending approvals")).toBeVisible();
  });

  test("admin sees and approves a manager's self-request", async ({ page }) => {
    // Manager submits.
    await login(page, USERS.manager.email);
    await submitLeaveRequest(page, {
      leaveType: "Annual Leave",
      startDate: futureDate(17),
      endDate: futureDate(17),
      reason: "Manager vacation",
    });
    // Admin logs in and approves.
    await page.context().clearCookies();
    await login(page, USERS.admin.email);
    await navigateTo(page, "Approvals");
    await expect(
      page.locator(`text=${USERS.manager.email.split("@")[0]}`).first()
    ).toBeVisible();
    await page.locator("text=Approve").first().click();
    await expect(page.locator("text=approved").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("admin sees all pending requests, including direct-report submissions", async ({ page }) => {
    // Employee submits.
    await login(page, USERS.employee.email);
    await submitLeaveRequest(page, {
      leaveType: "Annual Leave",
      startDate: futureDate(18),
      endDate: futureDate(18),
      reason: "Employee day",
    });
    // Admin logs in and sees the request.
    await page.context().clearCookies();
    await login(page, USERS.admin.email);
    await navigateTo(page, "Approvals");
    await expect(
      page.locator(`text=${USERS.employee.email.split("@")[0]}`).first()
    ).toBeVisible();
  });

  test("admin is redirected from /leave to /", async ({ page }) => {
    await login(page, USERS.admin.email);
    await page.goto("/leave");
    await expect(page).toHaveURL("/");
  });

  test("manager grants Compassionate, admin approves, employee uses", async ({ page }) => {
    // Manager files a Compassionate grant for their direct report.
    await login(page, USERS.manager.email);
    await page.click("text=Grant Compassionate Leave");
    await page.locator('[role="combobox"]').first().click();
    await page.click(`[role="option"]:text("${USERS.employee.email.split("@")[0]}")`);
    await page.locator('input[type="number"]').fill("1");
    await page.fill("textarea", "Death of grandmother");
    await page.click('button:has-text("File Grant")');
    await page.waitForLoadState("networkidle");

    // Admin sees the grant queue and approves.
    await page.context().clearCookies();
    await login(page, USERS.admin.email);
    await navigateTo(page, "Approvals");
    await expect(page.locator("text=Compassionate Leave Grants")).toBeVisible();
    await page.locator("text=Approve").first().click();
    await page.waitForLoadState("networkidle");

    // Employee logs in, sees available balance, files usage request.
    await page.context().clearCookies();
    await login(page, USERS.employee.email);
    await navigateTo(page, "My Leave");
    await expect(page.locator("text=Compassionate Leave").first()).toBeVisible();
    await page.click("text=Request Leave");
    await page.locator('[role="combobox"]').first().click();
    await page.click('[role="option"]:text("Compassionate Leave")');
    const dates = page.locator('input[type="date"]');
    await dates.nth(0).fill(futureDate(21));
    await dates.nth(1).fill(futureDate(21));
    await page.fill("textarea", "Taking bereavement day");
    await page.click('button:has-text("Submit Request")');
    await page.waitForLoadState("networkidle");
  });
});
