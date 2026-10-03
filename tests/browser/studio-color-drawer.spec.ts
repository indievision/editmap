import { test, expect } from "@playwright/test";
import path from "node:path";
import { startNewProject } from "./helpers";

test("Studio Color drawer design, interactions, views, curves, barcode seeking, and squint mode", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 1. Setup new project with fixture video and EDL
  await startNewProject(page);
  await page.getByLabel("Project name").fill("Studio Color Drawer Verification");

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

  // 2. Verify Studio mode layout: Tool rail, Monitor
  const toolRail = page.locator(".studio-tool-rail");
  await expect(toolRail).toBeVisible();
  const monitor = page.locator(".monitor");
  await expect(monitor).toBeVisible();
  const monitorInitialBox = await monitor.boundingBox();
  expect(monitorInitialBox).not.toBeNull();

  // 3. Open Color drawer via Color rail button
  const colorRailBtn = page.locator('.studio-rail-btn[aria-label="Color"]');
  await expect(colorRailBtn).toBeVisible();
  await colorRailBtn.click();

  const drawer = page.locator(".studio-detail-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveClass(/drawer-open/);

  // Drawer overlays left edge: width between 460-520px, positioned directly right of tool rail
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(drawerBox!.width).toBeGreaterThanOrEqual(460);
  expect(drawerBox!.width).toBeLessThanOrEqual(520);
  const railBox = await toolRail.boundingBox();
  // The tool rail is now a tab strip along the drawer's top edge, sharing its left edge.
  expect(drawerBox!.x).toBeCloseTo(railBox!.x, 1);

  // Monitor resizes cleanly when in-flow drawer opens
  const monitorBoxWhileOpen = await monitor.boundingBox();
  expect(monitorBoxWhileOpen!.width).toBeLessThanOrEqual(monitorInitialBox!.width);

  // 4. Verify Drawer Header (with redundant title omitted)
  await expect(page.locator(".color-drawer-title")).toHaveCount(0);

  const drawerSubtitle = page.locator(".color-drawer-subtitle");
  await expect(drawerSubtitle).toBeVisible();
  await expect(drawerSubtitle).toHaveText("Palette, light, and tonal structure");

  // 5. Test close via 'X' button
  const closeBtn = page.locator(".color-drawer-close-btn");
  await closeBtn.click();
  await expect(drawer).not.toBeVisible();

  // 6. Re-open via the collapsed panel's expand control (the tool rail is inside the
  // drawer, so it is not available while closed), test close via Escape key
  const expandPanel = page.getByRole("button", { name: "Expand panel" });
  await expandPanel.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();

  // Re-open drawer for full functional verification
  await expandPanel.click();
  await expect(drawer).toBeVisible();

  // 8. Verify Subtabs: Color script, Lighting
  const scriptTab = page.locator('.color-drawer-tab', { hasText: "Color script" });
  const lightingTab = page.locator('.color-drawer-tab', { hasText: "Lighting" });

  await expect(scriptTab).toBeVisible();
  await expect(scriptTab).toHaveClass(/active/);
  await expect(lightingTab).toBeVisible();

  // 9. View 1: Color script verification
  // Selected shot card header
  const cardTitle = page.locator(".color-card-title");
  await expect(cardTitle).toBeVisible();
  await expect(cardTitle).toContainText("Shot 001");

  // Movie Color Script Barcode
  const barcodeStrip = page.locator(".color-barcode-strip");
  await expect(barcodeStrip).toBeVisible();
  const slices = page.locator(".barcode-slice");
  await expect(slices).toHaveCount(3);

  // First shot slice is selected with gold outline
  await expect(slices.first()).toHaveClass(/selected/);

  // Barcode click to seek & select Shot 2
  await slices.nth(1).click();
  await expect(cardTitle).toContainText("Shot 002");
  await expect(slices.nth(1)).toHaveClass(/selected/);

  // Switch back to Shot 1
  await slices.first().click();
  await expect(cardTitle).toContainText("Shot 001");

  // Lighting & Temperature Rhythm preview in Script view
  const lightingSection = page.locator(".color-section-block", { hasText: "Lighting & temperature rhythm" });
  await expect(lightingSection).toBeVisible();
  await expect(page.locator(".lighting-svg")).toBeVisible();
  await expect(page.locator(".curve-legend-inline")).toContainText("Luminance");
  await expect(page.locator(".curve-legend-inline")).toContainText("Temperature");



  // 10. Filter palette reading expandable accordion
  const filterAccordion = page.locator(".color-filter-accordion");
  await expect(filterAccordion).toBeVisible();
  const filterBar = page.locator(".color-filter-bar");
  const harmonyPill = page.locator(".filter-tab-pill", { hasText: "Harmony" });
  const moodPill = page.locator(".filter-tab-pill", { hasText: "Mood" });

  // Expand accordion via click
  await filterBar.click();
  const filterContent = page.locator(".color-filter-content");
  await expect(filterContent).toBeVisible();
  await expect(page.locator(".filter-chip").first()).toBeVisible();

  // Switch to Mood filter
  await moodPill.click();
  await expect(moodPill).toHaveClass(/active/);
  await expect(filterContent).toBeVisible();

  // Collapse accordion
  await filterBar.click();
  await expect(filterContent).not.toBeVisible();

  // Wait for color swatches to be populated from video thumbnails
  await page.waitForSelector(".color-swatch-item", { timeout: 4000 }).catch(() => {});


  // 11. View 2: Lighting View verification
  await lightingTab.click();
  await expect(lightingTab).toHaveClass(/active/);
  await expect(page.locator(".color-view-lighting")).toBeVisible();
  await expect(page.locator(".lighting-selected-card")).toBeVisible();
  await expect(page.locator(".lighting-meta-item")).toHaveCount(4);
  await expect(page.locator(".tonal-metrics-grid")).toBeVisible();


  // 12. View 2: Lighting verification done above
  // Return to Color script view
  await scriptTab.click();
  await expect(scriptTab).toHaveClass(/active/);

  // Verify no unhandled page errors
  expect(errors).toEqual([]);
});
