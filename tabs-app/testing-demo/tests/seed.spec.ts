import { test, expect } from "playwright/test";

test.describe("Test group", () => {
  test("seed", async ({ page }) => {
    await page.goto("/web/index.php/auth/login");
    await expect(page.getByRole("button", { name: "Login", exact: true })).toBeVisible();
  });
});
