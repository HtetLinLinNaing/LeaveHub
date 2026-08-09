import { test, expect } from "@playwright/test";
import { login, navigateTo, USERS } from "./helpers";

test.describe("Mobile responsive", () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test("drawer opens and closes on phone", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Dashboard");

    // Sidebar aside hidden on phone
    await expect(page.locator("aside.hidden.md\\:flex")).toBeHidden();

    // Hamburger visible
    const hamburger = page.getByTestId("mobile-hamburger");
    await expect(hamburger).toBeVisible();

    // Open drawer
    await hamburger.click();
    const drawerLink = page.locator("[data-slot=sheet-content] >> text=Employees");
    await expect(drawerLink).toBeVisible();

    // Click link navigates and closes drawer
    await drawerLink.click();
    await expect(page).toHaveURL(/\/employees/);
    await expect(page.locator("[data-slot=sheet-content]")).toBeHidden();
  });

  test("employee list renders as cards on phone", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Employees");

    // Table hidden
    await expect(page.locator("table")).toBeHidden();
    // Cards visible (seed data)
    await expect(page.getByText("Alice Nguyen")).toBeVisible();
    await expect(page.getByText("eve@company.com")).toBeVisible();
  });

  test("dialog is bottom-sheet on phone", async ({ page }) => {
    await login(page, USERS.employee.email);
    await navigateTo(page, "My Leave");
    await page.click("text=Request Leave");

    const content = page.locator("[data-slot=dialog-content]");
    await expect(content).toBeVisible();
    const classes = await content.getAttribute("class");
    expect(classes).toContain("bottom-0");
    expect(classes).toContain("inset-x-0");
  });

  test("no horizontal scroll on phone on dashboard", async ({ page }) => {
    await login(page, USERS.employee.email);
    await navigateTo(page, "Dashboard");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("no horizontal scroll on employees page on phone", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Employees");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("top bar sticky on scroll", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Employees");
    const bar = page.locator(".md\\:hidden.sticky");
    await expect(bar).toBeVisible();
    await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 400));
    const top = await bar.evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBe(0);
  });
});

test.describe("Tablet responsive", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("employees renders as table on tablet", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Employees");
    await expect(page.locator("table")).toBeVisible();
    await expect(page.getByText("Alice Nguyen")).toBeVisible();
  });

  test("sidebar visible on tablet", async ({ page }) => {
    await login(page, USERS.admin.email);
    await navigateTo(page, "Dashboard");
    await expect(page.locator("aside.hidden.md\\:flex")).toBeVisible();
    await expect(page.getByTestId("mobile-hamburger")).toBeHidden();
  });
});
