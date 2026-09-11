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

  // Take screenshot at initial / default width (380px)
  await page.screenshot({ path: "/Users/indievision/.gemini/antigravity/brain/4341f6bd-881a-4b5d-b84f-524d3af592de/rhythm-tabs-default.png" });

  // 2. Check Editing Rhythm Title and font size
  const rhythmTitle = page.locator(".rhythm-tabs h2");
  await expect(rhythmTitle).toBeVisible();
  await expect(rhythmTitle).toHaveText("Editing rhythm");

  const fontSize = await rhythmTitle.evaluate((el) => window.getComputedStyle(el).fontSize);
  expect(parseFloat(fontSize)).toBeLessThanOrEqual(12);

  // 3. Drag left splitter narrower to test overflow
  const leftHandle = page.locator(".resize-handle-left");
  const box = await leftHandle.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 100, box.y + box.height / 2);
    await page.mouse.up();
  }

  // Check scroll track and scroll buttons
  const scrollNextBtn = page.locator(".rhythm-tab-scroll-btn.next");
  const framingSummaryBtn = page.getByRole("button", { name: "Framing summary", exact: true });
  const framingArcBtn = page.getByRole("button", { name: "Framing arc", exact: true });

  if (await scrollNextBtn.isVisible()) {
    await scrollNextBtn.click();
  }

  await expect(framingSummaryBtn).toBeVisible();
  await framingSummaryBtn.click();
  await expect(page.locator(".framing-summary")).toBeVisible();

  await expect(framingArcBtn).toBeVisible();
  await framingArcBtn.click();
  await expect(page.locator(".framing-arc")).toBeVisible();

  await page.screenshot({ path: "/Users/indievision/.gemini/antigravity/brain/4341f6bd-881a-4b5d-b84f-524d3af592de/rhythm-tabs-narrow.png" });

  // 4. Test other left window tabs on narrow panel
  await page.getByRole("tab", { name: "Sequence Reading" }).click();
  await expect(page.locator(".sequence-reading")).toBeVisible();

  const cutSlider = page.getByLabel("Cut between Shot 1 and Shot 2");
  if (await cutSlider.isVisible()) {
    await cutSlider.click();
    await expect(page.locator(".cut-reading")).toBeVisible();
    const eyeTraceBtn = page.locator(".eye-trace-toggle-btn").first();
    if (await eyeTraceBtn.isVisible()) {
      const display = await eyeTraceBtn.evaluate((el) => window.getComputedStyle(el).display);
      expect(["inline-flex", "flex"]).toContain(display);
    }
  }

  await page.getByRole("tab", { name: "Cast & AI" }).click();
  await expect(page.locator(".all-shots-analysis")).toBeVisible();

  await page.getByRole("tab", { name: "Color Reading" }).click();
  await expect(page.locator(".color-reading-panel")).toBeVisible();

  // 5. Expand left panel wider (~520px)
  const currentBox = await leftHandle.boundingBox();
  if (currentBox) {
    await page.mouse.move(currentBox.x + currentBox.width / 2, currentBox.y + currentBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(currentBox.x + 250, currentBox.y + currentBox.height / 2);
    await page.mouse.up();
  }

  await page.getByRole("tab", { name: "Rhythm & Pacing" }).click();
  await expect(page.locator(".editing-rhythm")).toBeVisible();
  await page.screenshot({ path: "/Users/indievision/.gemini/antigravity/brain/4341f6bd-881a-4b5d-b84f-524d3af592de/rhythm-tabs-wide.png" });

  expect(errors).toEqual([]);
});
