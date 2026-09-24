import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const ARTIFACT_DIR = "/Users/indievision/.gemini/antigravity/brain/d1fb208b-f675-4e6a-9a53-962bd40d05e6";

test("Capture Studio Munari Layout Screenshots: Compact & Enlarged Cast", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:5173/");

  // Setup project
  await page.locator('button.header-action-btn[aria-label="New project"]').click();
  await page.getByLabel("Project name").fill("Munari Studio Verification");

  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));

  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);
  await page.locator(".shot").first().click();

  // Switch to Cast tab
  const castTab = page.locator('#studio-tab-cast');
  await expect(castTab).toBeVisible();
  await castTab.click();

  // Add characters: Anna, Paul, Mara
  const addBtn = page.locator('.cast-roster-footer .roster-add-btn');
  if (await addBtn.isVisible()) {
    await addBtn.click();
    const addInput = page.locator('.roster-add-input');
    await addInput.fill("Anna");
    await addInput.press("Enter");

    await page.waitForTimeout(300);
    const addBtn2 = page.locator('.cast-roster-footer .roster-add-btn');
    if (await addBtn2.isVisible()) {
      await addBtn2.click();
      await page.locator('.roster-add-input').fill("Paul");
      await page.locator('.roster-add-input').press("Enter");
    }

    await page.waitForTimeout(300);
    const addBtn3 = page.locator('.cast-roster-footer .roster-add-btn');
    if (await addBtn3.isVisible()) {
      await addBtn3.click();
      await page.locator('.roster-add-input').fill("Mara");
      await page.locator('.roster-add-input').press("Enter");
    }
  }

  await page.waitForTimeout(600);

  // Take screenshot of Compact Cast (default left width is ~520px < 620px)
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "studio-munari-compact-cast.png"),
    fullPage: true,
  });

  // Now drag the vertical resize handle between analytical panel and monitor to expand left panel > 640px
  const resizeHandleLeft = page.locator(".resize-handle-left");
  const handleBox = await resizeHandleLeft.boundingBox();
  if (handleBox) {
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 220, handleBox.y + handleBox.height / 2, { steps: 10 });
    await page.mouse.up();
  }

  await page.waitForTimeout(600);

  // Take screenshot of Enlarged Cast
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "studio-munari-enlarged-cast.png"),
    fullPage: true,
  });

  // Switch to Rhythm tab
  const rhythmTab = page.locator('#studio-tab-rhythm');
  await rhythmTab.click();
  await page.waitForTimeout(600);

  // Take screenshot of Rhythm view (analysis left, video right)
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "studio-munari-rhythm-view.png"),
    fullPage: true,
  });
});
