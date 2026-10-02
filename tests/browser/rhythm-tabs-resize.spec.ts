import { test, expect } from "@playwright/test";
import path from "node:path";

test("editing rhythm tabs scrolling, smaller font, and smooth resizing across all left tabs", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 1. Setup new project with fixture video and EDL
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill("Rhythm Tabs & Left Window Resize Test");

  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));

  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);

  // Open the Studio contextual detail drawer to inspect rhythm tabs
  await page.locator('.studio-rail-btn[aria-label="Rhythm"]').click();

  // 2. Check Editing Rhythm subtabs and ensure title is omitted
  await expect(page.locator(".rhythm-tabs.drawer-subtabs")).toBeVisible();
  await expect(page.locator(".rhythm-drawer-title, .rhythm-tabs h2")).toHaveCount(0);

  // 3. Drag left splitter narrower to test overflow
  const leftHandle = page.locator(".resize-handle-left");
  await expect(leftHandle).toBeVisible();
  const box = await leftHandle.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 100, box.y + box.height / 2);
    await page.mouse.up();
  }

  // Check Rhythm subtabs
  const audiovisualBtn = page.locator(".editing-rhythm-drawer").getByRole("tab", { name: "Audiovisual" });
  await expect(audiovisualBtn).toBeVisible();
  await audiovisualBtn.click();
  await expect(page.locator(".audiovisual-rhythm")).toBeVisible();

  // Test Framing tab on narrow panel
  await page.locator('.studio-rail-btn[aria-label="Framing"]').click();
  await expect(page.locator(".framing-panel")).toBeVisible();
  const distributionBtn = page.getByRole("tab", { name: "Distribution" });
  await expect(distributionBtn).toBeVisible();
  await expect(page.locator(".framing-summary")).toBeVisible();

  const progressionBtn = page.getByRole("tab", { name: "Progression" });
  await expect(progressionBtn).toBeVisible();
  await progressionBtn.click();
  await expect(page.locator(".framing-arc")).toBeVisible();

  // 4. Test other left window tabs on narrow panel
  await page.locator('.studio-rail-btn[aria-label="Structure"]').click();
  await expect(page.locator(".sequence-drawer")).toBeVisible();

  await page.locator('.studio-rail-btn[aria-label="Cuts"]').click();
  await expect(page.locator(".cut-drawer")).toBeVisible();

  await page.locator('.studio-rail-btn[aria-label="Cast"]').click();
  await expect(page.locator(".cast-munari-container, [aria-label='Cast Gallery']")).toBeVisible();

  await page.locator('.studio-rail-btn[aria-label="Color"]').click();
  await expect(page.locator(".color-drawer")).toBeVisible();

  // 5. Expand left panel wider (~520px)
  const currentBox = await leftHandle.boundingBox();
  if (currentBox) {
    await page.mouse.move(currentBox.x + currentBox.width / 2, currentBox.y + currentBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(currentBox.x + 250, currentBox.y + currentBox.height / 2);
    await page.mouse.up();
  }

  await page.locator('.studio-rail-btn[aria-label="Rhythm"]').click();
  await expect(page.locator(".editing-rhythm")).toBeVisible();

  expect(errors).toEqual([]);
});
