import { test, expect } from "playwright/test";

// Public demo credentials only. Never use production HR data in this demo.
test("login, dashboard, employee list and time navigation", async ({ page }) => {
  await page.goto("/web/index.php/auth/login");
  await page.getByRole("textbox", { name: "Username" }).fill("Admin");
  await page.locator('input[name="password"]').fill("admin123");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/index/);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "PIM", exact: true }).click();
  await expect(page).toHaveURL(/\/pim\/viewEmployeeList/);
  await expect(
    page.getByRole("heading", { name: "Employee Information", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Time", exact: true }).click();
  await expect(page).toHaveURL(/\/time\/viewEmployeeTimesheet/);
  await expect(page.getByRole("heading", { name: "Select Employee", exact: true })).toBeVisible();
});
