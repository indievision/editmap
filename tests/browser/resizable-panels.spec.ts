import { test, expect } from "@playwright/test";
import path from "node:path";
import { startNewProject } from "./helpers";

test("resizable connected panels and splitters", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 1. Setup new project with fixture video and EDL
  await startNewProject(page);
  await page.getByLabel("Project name").fill("Resizable Panels Test");

  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));

  await expect(page.locator(".video-meta")).toContainText("640 × 360");

  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);

  // In Studio mode, open the contextual detail drawer to inspect and resize the left analytical deck
  await page.locator('.studio-rail-btn[aria-label="Rhythm"]').click();

  // Check splitters are mounted
  const leftHandle = page.locator(".resize-handle-left");
  const rightHandle = page.locator(".resize-handle-right");
  const middleHandle = page.locator(".resize-handle-middle");

  await expect(leftHandle).toBeVisible();
  await expect(rightHandle).toBeVisible();
  await expect(middleHandle).toBeVisible();

  // Test Left Splitter Collapse and Expand
  const leftDeck = page.locator(".analytical-deck");
  await expect(leftDeck).toBeVisible();

  // Click collapse button on left splitter
  await leftHandle.locator(".resize-collapse-btn").click();
  await expect(leftDeck).toBeHidden();

  // Click expand button to restore
  await leftHandle.locator(".resize-collapse-btn").click();
  await expect(leftDeck).toBeVisible();

  // Test Right Splitter Collapse and Expand
  const rightInspector = page.locator(".shot-inspector-panel");
  await expect(rightInspector).toBeVisible();

  await rightHandle.locator(".resize-collapse-btn").click();
  await expect(rightInspector).toBeHidden();

  await rightHandle.locator(".resize-collapse-btn").click();
  await expect(rightInspector).toBeVisible();

  // Test Dragging Horizontal Splitter (Vertical resize of timeline)
  const bottomStage = page.locator(".bottom-stage");
  const initialBottomBox = await bottomStage.boundingBox();
  expect(initialBottomBox).not.toBeNull();

  const middleBox = await middleHandle.boundingBox();
  expect(middleBox).not.toBeNull();

  // Drag middle handle upwards by 60px
  await page.mouse.move(middleBox!.x + middleBox!.width / 2, middleBox!.y + middleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(middleBox!.x + middleBox!.width / 2, middleBox!.y - 60);
  await page.mouse.up();

  // Bottom stage height should have increased
  const newBottomBox = await bottomStage.boundingBox();
  expect(newBottomBox!.height).toBeGreaterThan(initialBottomBox!.height + 30);

  // Test Double-click middle handle to reset
  await middleHandle.dblclick();
  const resetBottomBox = await bottomStage.boundingBox();
  expect(Math.abs(resetBottomBox!.height - initialBottomBox!.height)).toBeLessThan(15);

  // Capture screenshot of custom layout
  await page.screenshot({ path: "tests/browser/resizable-layout.png", fullPage: true });

  expect(errors).toEqual([]);
});
