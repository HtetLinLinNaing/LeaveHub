import { test, expect } from "@playwright/test";
import { login, USERS } from "./helpers";

test.describe("Role-Based Access Control", () => {
  test.describe("Employee role", () => {
    test("sees correct nav links", async ({ page }) => {
      await login(page, USERS.employee.email);
      await expect(page.locator("nav >> text=Dashboard")).toBeVisible();
      await expect(page.locator("nav >> text=My Leave")).toBeVisible();
      await expect(page.locator("nav >> text=Calendar")).toBeVisible();
      await expect(page.locator("nav >> text=Approvals")).not.toBeVisible();
      await expect(page.locator("nav >> text=Employees")).not.toBeVisible();
      await expect(page.locator("nav >> text=Policies")).not.toBeVisible();
    });
  });

  test.describe("Manager role", () => {
    test("sees correct nav links", async ({ page }) => {
      await login(page, USERS.manager.email);
      await expect(page.locator("nav >> text=Dashboard")).toBeVisible();
      await expect(page.locator("nav >> text=My Leave")).toBeVisible();
      await expect(page.locator("nav >> text=Calendar")).toBeVisible();
      await expect(page.locator("nav >> text=Approvals")).toBeVisible();
      await expect(page.locator("nav >> text=Employees")).not.toBeVisible();
      await expect(page.locator("nav >> text=Policies")).not.toBeVisible();
    });
  });

  test.describe("HR role", () => {
    test("sees correct nav links", async ({ page }) => {
      await login(page, USERS.hr.email);
      await expect(page.locator("nav >> text=Dashboard")).toBeVisible();
      await expect(page.locator("nav >> text=My Leave")).toBeVisible();
      await expect(page.locator("nav >> text=Calendar")).toBeVisible();
      await expect(page.locator("nav >> text=Approvals")).toBeVisible();
      await expect(page.locator("nav >> text=Employees")).toBeVisible();
      await expect(page.locator("nav >> text=Policies")).toBeVisible();
    });
  });

  test.describe("Admin role", () => {
    test("sees all nav links", async ({ page }) => {
      await login(page, USERS.admin.email);
      await expect(page.locator("nav >> text=Dashboard")).toBeVisible();
      await expect(page.locator("nav >> text=My Leave")).toBeVisible();
      await expect(page.locator("nav >> text=Calendar")).toBeVisible();
      await expect(page.locator("nav >> text=Approvals")).toBeVisible();
      await expect(page.locator("nav >> text=Employees")).toBeVisible();
      await expect(page.locator("nav >> text=Policies")).toBeVisible();
    });
  });
});
