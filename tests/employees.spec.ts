import { test, expect } from "@playwright/test";
import { login, navigateTo, USERS } from "./helpers";

test.describe("Employee Management", () => {
  test("HR can see employees page", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Employees");
    await expect(page.locator("h1")).toHaveText("Employees");
    await expect(page.locator("text=Add Employee")).toBeVisible();
  });

  test("HR sees seed employees in list", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Employees");
    await expect(page.locator("text=Alice Nguyen")).toBeVisible();
    await expect(page.locator("text=Bob Tran")).toBeVisible();
    await expect(page.locator("text=Charlie Le")).toBeVisible();
  });

  test("HR can open add employee dialog", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Employees");
    await page.click("text=Add Employee");
    await expect(page.locator("text=First Name")).toBeVisible();
    await expect(page.locator("text=Last Name")).toBeVisible();
    await expect(page.locator('label:has-text("Email")')).toBeVisible();
    await expect(page.locator("text=Department")).toBeVisible();
    await expect(page.locator("text=Role")).toBeVisible();
    await expect(page.locator("text=Join Date")).toBeVisible();
  });

  test("HR can create a new employee", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Employees");
    await page.click("text=Add Employee");

    await page.fill('input[type="text"]', "Frank");
    const textInputs = page.locator('input[type="text"]');
    await textInputs.nth(0).fill("Frank");
    await textInputs.nth(1).fill("Do");
    await page.fill('input[type="email"]', "frank@company.com");
    await textInputs.nth(2).fill("Engineering");

    // Fill join date
    await page.fill('input[type="date"]', "2026-08-01");

    await page.click('button >> text="Create Employee"');
    await page.waitForLoadState("networkidle");
  });

  test("employee can see employees directory but not the Add button", async ({ page }) => {
    await login(page, USERS.employee.email);
    await expect(page.locator("nav >> text=Employees")).toBeVisible();
    await navigateTo(page, "Employees");
    await expect(page.locator("h1")).toHaveText("Employees");
    await expect(page.locator("text=Add Employee")).not.toBeVisible();
  });

  test("manager can see employees directory but not the Add button", async ({ page }) => {
    await login(page, USERS.manager.email);
    await expect(page.locator("nav >> text=Employees")).toBeVisible();
    await navigateTo(page, "Employees");
    await expect(page.locator("h1")).toHaveText("Employees");
    await expect(page.locator("text=Add Employee")).not.toBeVisible();
  });

  test("admin can deactivate an employee, who then loses access", async ({ page }) => {
    // Admin deactivates the manager.
    await login(page, USERS.admin.email);
    await navigateTo(page, "Employees");
    // Find the row for the manager and click its Active pill.
    const row = page.locator("tr", { hasText: USERS.manager.email });
    await row.locator("button:has-text('Active')").click();
    // Confirm in the dialog.
    await page.click('button:has-text("Deactivate")');
    await page.waitForLoadState("networkidle");

    // Now the manager can no longer access the dashboard.
    await page.context().clearCookies();
    await login(page, USERS.manager.email);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);

    // Admin reactivates so the rest of the suite keeps working.
    await page.context().clearCookies();
    await login(page, USERS.admin.email);
    await navigateTo(page, "Employees");
    const row2 = page.locator("tr", { hasText: USERS.manager.email });
    await row2.locator("button:has-text('Inactive')").click();
    await page.click('button:has-text("Reactivate")');
    await page.waitForLoadState("networkidle");
  });
});
