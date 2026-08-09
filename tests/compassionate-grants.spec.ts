import { test, expect } from "@playwright/test";
import { login, logout, navigateTo, USERS } from "./helpers";

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function proposeGrant(
  page: import("@playwright/test").Page,
  opts: { employeeName: string; days: number; reason: string }
) {
  await navigateTo(page, "Approvals");
  await page.click("text=Grant Compassionate Leave");
  // Employee select.
  await page.locator('[role="combobox"]').first().click();
  await page.click(`[role="option"]:text("${opts.employeeName}")`);
  // Days.
  await page.locator('input[type="number"]').fill(String(opts.days));
  // Reason.
  await page.fill("textarea", opts.reason);
  await page.click('button:has-text("Submit Grant")');
  await page.waitForLoadState("networkidle");
}

test.describe("Compassionate leave grants", () => {
  test("manager proposes, admin approves, employee uses", async ({ page }) => {
    const employeeShort = USERS.employee.email.split("@")[0]; // "charlie"

    // 1. Manager proposes 1 day.
    await login(page, USERS.manager.email);
    await proposeGrant(page, {
      employeeName: "charlie", // first name in seed
      days: 1,
      reason: "Death of grandmother",
    });
    // Pending entry visible in "My grants".
    await expect(page.locator(`text=Compassionate Leave — 1 day(s)`).first()).toBeVisible();
    await expect(page.locator("text=pending").first()).toBeVisible();

    // 2. Admin approves the grant.
    await logout(page);
    await login(page, USERS.admin.email);
    await navigateTo(page, "Approvals");
    await expect(page.locator("text=charlie").first()).toBeVisible();
    await page.locator("text=Approve").first().click();
    // Confirm dialog → Approve.
    await page.locator('[role="dialog"] >> text=Approve').last().click();
    await page.waitForLoadState("networkidle");

    // 3. Employee sees the card with 1 available.
    await logout(page);
    await login(page, USERS.employee.email);
    await expect(page.locator("text=Compassionate Leave").first()).toBeVisible();
    await expect(
      page.locator("text=Granted: 1 · Used: 0").first()
    ).toBeVisible();

    // 4. Employee submits a 1-day compassionate request.
    await navigateTo(page, "My Leave");
    await page.click("text=Request Leave");
    await page.locator('[role="combobox"]').first().click();
    await page.click('[role="option"]:text("Compassionate Leave")');
    const dates = page.locator('input[type="date"]');
    await dates.nth(0).fill(futureDate(21));
    await dates.nth(1).fill(futureDate(21));
    await page.fill("textarea", "Family ceremony");
    await page.click('button:has-text("Submit Request")');
    await page.waitForLoadState("networkidle");

    // 5. Admin approves the request.
    await logout(page);
    await login(page, USERS.admin.email);
    await navigateTo(page, "Approvals");
    await expect(page.locator(`text=${employeeShort}`).first()).toBeVisible();
    await page.locator("text=Approve").first().click();
    await page.locator('[role="dialog"] >> text=Approve').last().click();
    await page.waitForLoadState("networkidle");

    // 6. Employee card decrements to 0.
    await logout(page);
    await login(page, USERS.employee.email);
    await expect(
      page.locator("text=Granted: 1 · Used: 1").first()
    ).toBeVisible();
  });

  test("employee cannot request compassionate without balance", async ({ page }) => {
    // Use Diana — no grants.
    await login(page, USERS.employee2.email);
    await navigateTo(page, "My Leave");
    await page.click("text=Request Leave");
    await page.locator('[role="combobox"]').first().click();
    await page.click('[role="option"]:text("Compassionate Leave")');
    const dates = page.locator('input[type="date"]');
    await dates.nth(0).fill(futureDate(22));
    await dates.nth(1).fill(futureDate(22));
    await page.fill("textarea", "Should fail");
    await page.click('button:has-text("Submit Request")');
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("text=You have no compassionate leave available").first()
    ).toBeVisible();
  });
});
