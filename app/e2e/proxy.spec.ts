import { test, expect } from "@playwright/test";

test.describe("Proxy feature", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/catalogs");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test("can add catalog with proxy enabled and see Proxied badge", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Add Catalog" }).click();

    await page.getByLabel("Name").fill("Proxied API");
    await page.getByLabel("URL").fill("http://localhost:8082");
    await page.getByLabel("Proxy through server").click();
    await page.getByRole("button", { name: "Add" }).click();

    const card = page
      .locator('[data-testid^="catalog-card-"]')
      .filter({ hasText: "Proxied API" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Proxied", { exact: true })).toBeVisible();
  });

  test("catalog without proxy does not show Proxied badge", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Add Catalog" }).click();

    await page.getByLabel("Name").fill("Direct API");
    await page.getByLabel("URL").fill("http://localhost:8082");
    await page.getByRole("button", { name: "Add" }).click();

    const card = page
      .locator('[data-testid^="catalog-card-"]')
      .filter({ hasText: "Direct API" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Proxied", { exact: true })).not.toBeVisible();
  });

  test("test connection works through proxy when backend is running", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Add Catalog" }).click();

    await page.getByLabel("Name").fill("Proxied Local");
    await page.getByLabel("URL").fill("http://localhost:8082");
    await page.getByLabel("Proxy through server").click();
    await page.getByRole("button", { name: "Add" }).click();

    const card = page
      .locator('[data-testid^="catalog-card-"]')
      .filter({ hasText: "Proxied Local" });
    await card.getByRole("button", { name: "Test Connection" }).click();

    await expect(
      page.getByText(/Connected to Proxied Local/),
    ).toBeVisible({ timeout: 10000 });
  });
});
