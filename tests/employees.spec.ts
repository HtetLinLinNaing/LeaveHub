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

  test("employee cannot see employees link", async ({ page }) => {
    await login(page, USERS.employee.email);
    await expect(page.locator("nav >> text=Employees")).not.toBeVisible();
  });

  test("manager cannot see employees link", async ({ page }) => {
    await login(page, USERS.manager.email);
    await expect(page.locator("nav >> text=Employees")).not.toBeVisible();
  });
});
