import { test, expect } from "@playwright/test";
import path from "node:path";

test("Studio Structure drawer design, interactions, range selection, metrics, named spans, and layout preservation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 1. Setup new project with fixture video and EDL
  await page.locator('button.header-action-btn[aria-label="New project"]').click();
  await page.getByLabel("Project name").fill("Studio Structure Drawer Verification");

  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));

  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);

  // 2. Verify Studio mode layout: Tool rail, Monitor, Ribbon
  const toolRail = page.locator(".studio-tool-rail");
  await expect(toolRail).toBeVisible();
  const monitor = page.locator(".monitor");
  await expect(monitor).toBeVisible();
  const monitorInitialBox = await monitor.boundingBox();
  expect(monitorInitialBox).not.toBeNull();

  // 3. Open Structure drawer via Structure rail button
  const structureRailBtn = page.locator('.studio-rail-btn[aria-label="Structure"]');
  await structureRailBtn.click();

  const drawer = page.locator(".studio-detail-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveClass(/drawer-open/);

  // Drawer overlays left edge: width between 460-520px
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(drawerBox!.width).toBeGreaterThanOrEqual(460);
  expect(drawerBox!.width).toBeLessThanOrEqual(520);
  const railBox = await toolRail.boundingBox();
  expect(drawerBox!.x).toBeCloseTo(railBox!.x + railBox!.width, 1); // Anchored immediately right of rail

  // Monitor has not shrunk or permanently reflowed
  const monitorBoxWhileOpen = await monitor.boundingBox();
  expect(monitorBoxWhileOpen!.width).toBeCloseTo(monitorInitialBox!.width, 5);

  // 4. Verify Drawer Header and Empty State
  const drawerTitle = page.locator(".sequence-drawer-title");
  await expect(drawerTitle).toBeVisible();
  await expect(drawerTitle).toHaveText("SEQUENCE READING");

  const drawerSubtitle = page.locator(".sequence-drawer-subtitle");
  await expect(drawerSubtitle).toBeVisible();
  await expect(drawerSubtitle).toHaveText("Evidence first; interpretation stays yours.");

  // Empty state message before range selection
  const emptyMsg = page.locator(".sequence-empty-msg");
  await expect(emptyMsg).toBeVisible();
  await expect(emptyMsg).toContainText("Shift-drag on the editing map to select a passage");

  // 5. Test close via 'X' button
  const closeBtn = page.locator(".sequence-drawer-close-btn");
  await closeBtn.click();
  await expect(drawer).not.toBeVisible();

  // 6. Re-open via Structure rail button, test close via Escape key
  await structureRailBtn.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();

  // 7. Re-open and test close via clicking Structure rail button again
  await structureRailBtn.click();
  await expect(drawer).toBeVisible();
  await structureRailBtn.click();
  await expect(drawer).not.toBeVisible();

  // Re-open for range selection and metrics tests
  await structureRailBtn.click();
  await expect(drawer).toBeVisible();

  // 8. Range selection via Editing Map Shift-Drag
  await page.locator(".shot-track").scrollIntoViewIfNeeded();
  const shot1 = page.getByRole("button", { name: "Shot 1", exact: true });
  await expect(shot1).toBeVisible();
  const shot1Box = await shot1.boundingBox();
  expect(shot1Box).not.toBeNull();

  const shot2 = page.getByRole("button", { name: "Shot 2", exact: true });
  await expect(shot2).toBeVisible();
  const shot2Box = await shot2.boundingBox();
  expect(shot2Box).not.toBeNull();

  // Shift-drag across shots 1 and 2
  await page.keyboard.down("Shift");
  await page.mouse.move(shot1Box!.x + 25, shot1Box!.y + 20);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(shot2Box!.x + shot2Box!.width - 10, shot2Box!.y + 20);
  await page.mouse.up({ button: "left" });
  await page.keyboard.up("Shift");

  // 9. Verify Selected Range Header & Timecode buttons
  const tcPills = page.locator(".sequence-tc-pill");
  await expect(tcPills).toHaveCount(2);
  const startTcText = await tcPills.first().textContent();
  const endTcText = await tcPills.nth(1).textContent();
  expect(startTcText).toBeTruthy();
  expect(endTcText).toBeTruthy();

  const durationText = page.locator(".sequence-range-duration");
  await expect(durationText).toBeVisible();
  await expect(durationText).toContainText("sec");

  // Test seeking via timecode button
  await tcPills.first().click();

  // 10. Verify 4-Column Metrics Card
  const metricsGrid = page.locator(".sequence-metrics-grid");
  await expect(metricsGrid).toBeVisible();

  const metricCols = page.locator(".sequence-metric-col");
  await expect(metricCols).toHaveCount(4);
  await expect(metricCols.nth(0)).toContainText("shots");
  await expect(metricCols.nth(1)).toContainText("hard cuts");
  await expect(metricCols.nth(2)).toContainText("median");
  await expect(metricCols.nth(3)).toContainText("duration variation");

  // 11. Verify Across cuts & Rhythm evidence rows
  const detailBlocks = page.locator(".sequence-detail-block");
  await expect(detailBlocks).toHaveCount(2);
  await expect(detailBlocks.first()).toContainText("Across cuts");
  await expect(detailBlocks.nth(1)).toContainText("Rhythm");

  // 12. Name and save the span
  const nameInput = page.locator(".sequence-name-input");
  await expect(nameInput).toBeVisible();
  await nameInput.fill("Opening sequence");

  const saveBtn = page.locator(".sequence-save-btn");
  await saveBtn.click();

  // Verify Named spans list displays saved span
  const spanRows = page.locator(".sequence-span-row");
  await expect(spanRows).toHaveCount(1);
  await expect(spanRows.first()).toContainText("Opening sequence");
  // Active span has active styling and gold accent
  await expect(spanRows.first()).toHaveClass(/active/);

  // 13. Test Clear selection action
  const clearBtn = page.locator(".sequence-clear-btn");
  await expect(clearBtn).toBeVisible();
  await clearBtn.click();

  // Empty state message reappears
  await expect(emptyMsg).toBeVisible();
  // But named spans list remains visible
  await expect(spanRows).toHaveCount(1);

  // 14. Click the named span in list to restore selection
  await spanRows.first().click();
  // Selection restored, metrics grid reappears
  await expect(metricsGrid).toBeVisible();
  await expect(spanRows.first()).toHaveClass(/active/);

  // Take screenshot of Studio with Structure drawer for visual inspection
  await page.screenshot({
    path: "/Users/indievision/.gemini/antigravity/brain/4c6df2a4-56cd-418c-a1af-1c4e1ccc8883/studio-structure-drawer.png",
  });

  // 15. Delete named span
  const deleteBtn = page.locator(".sequence-span-action-btn");
  await deleteBtn.click();
  await expect(spanRows).toHaveCount(0);

  // 16. State preservation across subtabs and modes
  // Switch to Rhythm drawer
  const rhythmRailBtn = page.locator('.studio-rail-btn[aria-label="Rhythm"]');
  await rhythmRailBtn.click();
  await expect(page.locator(".editing-rhythm-drawer")).toBeVisible();

  // Switch back to Structure drawer
  await structureRailBtn.click();
  await expect(page.locator(".sequence-drawer")).toBeVisible();

  // Switch to Map Focus mode and back
  await page.getByRole("tab", { name: "Map" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/mode-map/);
  await expect(drawer).not.toBeVisible();

  await page.getByRole("tab", { name: "Studio" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/mode-studio/);
  await expect(drawer).toBeVisible(); // Preserved

  expect(errors).toEqual([]);
});
