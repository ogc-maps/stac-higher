import { test, expect } from "@playwright/test";

test.describe("Catalogs page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/catalogs");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test("seeds the built-in catalog as active and undeletable", async ({ page }) => {
    const builtIn = page.getByTestId("catalog-card-built-in");
    await expect(builtIn.getByText("Built-in Catalog")).toBeVisible();
    await expect(builtIn.getByText("Built-in", { exact: true })).toBeVisible();
    await expect(builtIn.getByText("Active", { exact: true })).toBeVisible();
    await expect(builtIn.getByRole("button", { name: "Edit catalog" })).toHaveCount(0);
    await expect(builtIn.getByRole("button", { name: "Delete catalog" })).toHaveCount(0);
  });

  test("can add a catalog and it appears in the list", async ({ page }) => {
    await page.getByRole("button", { name: "Add Catalog" }).click();

    await page.getByLabel("Name").fill("Local STAC API");
    await page.getByLabel("URL").fill("http://localhost:8082");
    await page.getByRole("button", { name: "Add" }).click();

    const card = page
      .locator('[data-testid^="catalog-card-"]')
      .filter({ hasText: "Local STAC API" });
    await expect(card).toBeVisible();
    await expect(card.getByText("http://localhost:8082")).toBeVisible();
  });

  test("built-in stays active until a new catalog is set active", async ({ page }) => {
    await page.getByRole("button", { name: "Add Catalog" }).click();
    await page.getByLabel("Name").fill("Test API");
    await page.getByLabel("URL").fill("http://localhost:9999");
    await page.getByRole("button", { name: "Add" }).click();

    const builtIn = page.getByTestId("catalog-card-built-in");
    const added = page
      .locator('[data-testid^="catalog-card-"]')
      .filter({ hasText: "Test API" });

    await expect(builtIn.getByText("Active", { exact: true })).toBeVisible();

    await added.getByRole("button", { name: "Set Active" }).click();
    await expect(added.getByText("Active", { exact: true })).toBeVisible();
    await expect(builtIn.getByText("Active", { exact: true })).not.toBeVisible();
  });

  test("can delete a catalog and active falls back to built-in", async ({ page }) => {
    await page.getByRole("button", { name: "Add Catalog" }).click();
    await page.getByLabel("Name").fill("To Delete");
    await page.getByLabel("URL").fill("http://localhost:1234");
    await page.getByRole("button", { name: "Add" }).click();

    const added = page
      .locator('[data-testid^="catalog-card-"]')
      .filter({ hasText: "To Delete" });
    await expect(added).toBeVisible();

    await added.getByRole("button", { name: "Delete catalog" }).click();
    await page.getByRole("button", { name: "Delete" }).last().click();

    await expect(added).not.toBeVisible();
    const builtIn = page.getByTestId("catalog-card-built-in");
    await expect(builtIn.getByText("Active", { exact: true })).toBeVisible();
  });
});
