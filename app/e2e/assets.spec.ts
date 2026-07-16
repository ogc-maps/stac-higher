import { test, expect } from "@playwright/test";

// Phase 3 asset-upload flow (flow C / §6.3): pick a file in the item form,
// upload it via the presigned-PUT path, and confirm the item's asset href
// resolves through the asset route back to the uploaded bytes. Needs the
// Docker backend (MinIO) up; the dev-bypass identity is an operator, so the
// gated /api/uploads route authorizes without a login.
//
// The storage key is deterministic (fixed collection/item/filename), so re-runs
// overwrite the same object rather than accumulating — no cleanup needed.

test.describe.configure({ mode: "serial" });

const COLLECTION = "e2e-assets";
const ITEM_ID = "asset-e2e-001";
const FILENAME = "e2e-asset.txt";
const CONTENT = "phase-3 e2e asset bytes";
const EXPECTED_HREF = `/api/assets/${COLLECTION}/${ITEM_ID}/${FILENAME}`;

test.describe("Asset upload (item form)", () => {
  test("uploads a file and the asset href resolves through /api/assets", async ({
    page,
    request,
  }) => {
    await page.goto(`/collections/${COLLECTION}/items/new`);

    // Item ID first — the upload control is disabled until the item id is set
    // (the canonical storage key is scoped by item id).
    await page.getByLabel("Item ID").fill(ITEM_ID);

    // Add an asset row. Scope to the Assets card header so we don't hit the
    // Properties card's "Add" (CardTitle is a div, so target it by text).
    await page
      .getByText("Assets", { exact: true })
      .locator("..")
      .getByRole("button", { name: "Add" })
      .click();

    // Upload through the hidden file input inside the asset row.
    await page.locator('input[type="file"]').setInputFiles({
      name: FILENAME,
      mimeType: "text/plain",
      buffer: Buffer.from(CONTENT),
    });

    // On success the href field is filled with the asset-route URL, and the
    // key/media-type default from the file.
    await expect(page.getByPlaceholder("https://... or upload a file")).toHaveValue(
      EXPECTED_HREF,
      { timeout: 15_000 },
    );
    await expect(page.getByPlaceholder("data")).toHaveValue(FILENAME);
    await expect(page.getByPlaceholder("image/tiff")).toHaveValue("text/plain");

    // The href resolves: the asset route 302s to a presigned URL; following it
    // returns the exact bytes we uploaded.
    const res = await request.get(EXPECTED_HREF);
    expect(res.ok()).toBe(true);
    expect(await res.text()).toBe(CONTENT);
  });
});
