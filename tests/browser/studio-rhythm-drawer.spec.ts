import { test, expect } from "@playwright/test";
import path from "node:path";

test("Studio Rhythm drawer design, interactions, seeking, tabs, and layout preservation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 1. Setup new project with fixture video and EDL
  await page.locator('button.header-action-btn[aria-label="New project"]').click();
  await page.getByLabel("Project name").fill("Studio Rhythm Drawer Verification");

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

  await expect(page.locator(".studio-rhythm-ribbon")).toHaveCount(0);
  const shotTrack = page.locator(".shot-track");
  await expect(shotTrack).toBeVisible();

  // 3. Open Rhythm drawer via Rhythm rail button
  const rhythmRailBtn = page.locator('.studio-rail-btn[aria-label="Rhythm"]');
  await rhythmRailBtn.click();

  const drawer = page.locator(".studio-detail-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveClass(/drawer-open/);

  // Drawer overlays left edge: width between 460-520px
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(drawerBox!.width).toBeGreaterThanOrEqual(460);
  expect(drawerBox!.width).toBeLessThanOrEqual(520);
  const railBox = await toolRail.boundingBox();
  expect(drawerBox!.x).toBeCloseTo(railBox!.x, 1);

  // Monitor resizes cleanly when in-flow drawer opens
  const monitorBoxWhileOpen = await monitor.boundingBox();
  expect(monitorBoxWhileOpen!.width).toBeLessThanOrEqual(monitorInitialBox!.width);

  // Timeline below monitor remains visible
  await expect(shotTrack).toBeVisible();

  // 4. Verify Drawer subtabs are visible and redundant title is omitted
  await expect(page.locator(".rhythm-tabs.drawer-subtabs")).toBeVisible();
  await expect(page.locator(".rhythm-drawer-title")).toHaveCount(0);

  // 5. Test close via 'X' button
  const closeBtn = page.locator(".rhythm-drawer-close-btn");
  await closeBtn.click();
  await expect(drawer).not.toBeVisible();

  // 6. Re-open via collapse button, test close via Escape key
  await page.locator(".resize-handle-left .resize-collapse-btn").click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();

  // 7. Re-open for chart & subview tests
  await page.locator(".resize-handle-left .resize-collapse-btn").click();
  await expect(drawer).toBeVisible();
  await expect(drawer).toBeVisible();

  // 8. Shot duration subview: Default view
  await expect(page.locator(".rhythm-scale-toggle")).toBeVisible();
  const compressedBtn = page.locator('.rhythm-scale-btn:has-text("Compressed (log)")');
  const linearBtn = page.locator('.rhythm-scale-btn:has-text("Linear")');
  await expect(compressedBtn).toHaveClass(/active/);

  // Check 3-column metrics
  const metricsCard = page.locator(".rhythm-metrics-card");
  await expect(metricsCard).toBeVisible();
  await expect(metricsCard).toContainText("Typical shot");
  await expect(metricsCard).toContainText("Average");
  await expect(metricsCard).toContainText("Longest");

  // Check Shot duration chart
  await expect(page.locator(".rhythm-chart-eyebrow")).toHaveText("SHOT DURATION (SECONDS)");
  await expect(page.locator(".rhythm-median-tag")).toContainText("Median");
  await expect(page.locator(".rhythm-x-axis-title")).toHaveText("SHOT ORDER");
  await expect(page.locator(".rhythm-action-hint")).toHaveText("Click a bar to select and seek");

  // Toggle Linear scale and back
  await linearBtn.click();
  await expect(linearBtn).toHaveClass(/active/);
  await expect(compressedBtn).not.toHaveClass(/active/);
  await compressedBtn.click();
  await expect(compressedBtn).toHaveClass(/active/);

  // 9. Bar clicking, selection highlight, seeking, and footer detail card
  const shot2Bar = page.locator('button.rhythm-bar[aria-label="Rhythm shot 2"]');
  await expect(shot2Bar).toBeVisible();
  await shot2Bar.click();

  // Selected bar has antique gold styling
  await expect(shot2Bar).toHaveClass(/chosen/);

  // Video sought to shot 2 (start time ~ 1.0s)
  await expect.poll(() => page.locator(".monitor video").evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1, 1);

  // Selected shot detail footer card shows shot 2 info
  const detailCard = page.locator(".rhythm-selected-shot-card");
  await expect(detailCard).toBeVisible();
  await expect(detailCard).toContainText("Shot 002");

  // Inspector also reflects Shot 002
  await page.getByRole("button", { name: "Inspect Shot" }).click();
  await expect(page.locator(".shot-inspector-panel")).toContainText("Shot 002");
  await page.locator(".drawer-close-btn").click();

  // 10. Subtabs navigation and state preservation
  const subtabs = [
    { name: "Local pacing", checkSelector: ".pacing" },
    { name: "Compare", checkSelector: ".comparison-view" },
    { name: "Audiovisual", checkSelector: ".audiovisual-rhythm" },
    { name: "Motion energy", checkSelector: ".motion-energy-arc" },
    { name: "Shot duration", checkSelector: ".rhythm-chart-section" },
  ];

  for (const tab of subtabs) {
    const tabBtn = page.locator(".editing-rhythm-drawer").getByRole("tab", { name: tab.name, exact: true });
    await expect(tabBtn).toBeVisible();
    await tabBtn.click();
    await expect(tabBtn).toHaveClass(/active/);
    await expect(page.locator(tab.checkSelector)).toBeVisible();
  }

  // Ensure framing views are removed from Rhythm
  await expect(page.locator(".editing-rhythm-drawer").getByRole("tab", { name: "Framing summary" })).toHaveCount(0);
  await expect(page.locator(".editing-rhythm-drawer").getByRole("tab", { name: "Framing arc" })).toHaveCount(0);

  // Returning to Shot duration still has shot 2 selected and highlighted
  await expect(shot2Bar).toHaveClass(/chosen/);
  await expect(detailCard).toContainText("Shot 002");

  // 11. Narrow viewport behavior
  await page.setViewportSize({ width: 750, height: 800 });
  await expect(drawer).toBeVisible();
  const narrowBox = await drawer.boundingBox();
  expect(narrowBox!.width).toBeLessThanOrEqual(750);

  // Restore viewport
  await page.setViewportSize({ width: 1440, height: 1000 });

  // 12. Expanded map in Studio mode
  await page.locator(".studio-expand-map-toggle-btn").click();
  await expect(page.locator(".workspace")).toHaveClass(/studio-map-expanded/);
  await page.locator(".studio-expand-map-toggle-btn").click();
  await expect(page.locator(".workspace")).not.toHaveClass(/studio-map-expanded/);

  // Switch to Explore
  await page.getByRole("tab", { name: "Explore" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/mode-explore/);
  await expect(page.locator(".studio-detail-drawer")).not.toBeVisible();

  // Switch back to Studio
  await page.getByRole("tab", { name: "Studio" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/mode-studio/);
  await expect(drawer).toBeVisible(); // Drawer state preserved

  // Take screenshot of Studio with Rhythm drawer for visual verification
  await page.screenshot({
    path: "/Users/indievision/.gemini/antigravity/brain/4c6df2a4-56cd-418c-a1af-1c4e1ccc8883/studio-rhythm-drawer.png",
  });

  expect(errors).toEqual([]);
});
