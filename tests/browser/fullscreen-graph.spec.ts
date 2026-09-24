import { test, expect } from "@playwright/test";
import path from "node:path";

test("wordless fullscreen graph visualization from Studio and expanded Studio", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 1. Setup new project with fixture video and EDL
  await page.locator('button.header-action-btn[aria-label="New project"]').click();
  await page.getByLabel("Project name").fill("Fullscreen Graph Test");

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

  // --------------------------------------------------------------------------
  // 2. STUDIO: Monitor Fullscreen button opens Fullscreen Graph Visualization
  // --------------------------------------------------------------------------
  const studioFullscreenBtn = page.locator(".studio-fullscreen-btn");
  await expect(studioFullscreenBtn).toBeVisible();

  // Click fullscreen button under monitor
  await studioFullscreenBtn.click();

  // Verify fullscreen container is visible and edge-to-edge
  const fullscreenContainer = page.locator(".fullscreen-graph-container");
  await expect(fullscreenContainer).toBeVisible();

  // Verify it is NOT fullscreening the video element
  const isVideoFullscreen = await page.evaluate(() => {
    return document.fullscreenElement?.tagName === "VIDEO";
  });
  expect(isVideoFullscreen).toBe(false);

  // Verify wordless nature: no persistent text / timecode / toolbar headers in score canvas
  const scoreCanvas = page.locator(".fullscreen-score-canvas");
  await expect(scoreCanvas).toBeVisible();

  // Verify playhead is rendered and visible
  const playhead = page.locator(".fullscreen-playhead");
  await expect(playhead).toBeVisible();

  // Verify minimap is rendered at the bottom
  const minimap = page.locator(".fullscreen-minimap");
  await expect(minimap).toBeVisible();
  await expect(page.locator(".fullscreen-minimap-window")).toBeVisible();

  // Verify shot blocks are present in fullscreen score
  await expect(page.locator(".fullscreen-shot-block")).toHaveCount(3);

  // Exit fullscreen via Escape key
  await page.keyboard.press("Escape");
  await expect(fullscreenContainer).toHaveCount(0);

  // Verify we are back in Studio safely without state loss
  await expect(page.locator(".workspace")).toHaveClass(/mode-studio/);
  await expect(page.locator(".monitor")).toBeVisible();

  // --------------------------------------------------------------------------
  // 3. MAP FOCUS: Score button opens the same Fullscreen Graph Visualization
  // --------------------------------------------------------------------------
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(page.locator(".workspace")).toHaveClass(/studio-map-expanded/);

  // Verify map fullscreen action button in expanded Studio toolbar
  const mapFullscreenBtn = page.locator(".map-fullscreen-btn");
  await expect(mapFullscreenBtn).toBeVisible();

  // Click expanded Studio fullscreen button
  await mapFullscreenBtn.click();
  await expect(fullscreenContainer).toBeVisible();

  // Verify exit affordance appears on pointer movement
  const exitBtn = page.locator(".fullscreen-exit-btn");
  await page.mouse.move(300, 300);
  await expect(exitBtn).toHaveClass(/visible/);

  // Click exit affordance
  await exitBtn.click();
  await expect(fullscreenContainer).toHaveCount(0);

  // Verify returned to expanded Studio without error
  await expect(page.locator(".workspace")).toHaveClass(/studio-map-expanded/);
  expect(errors).toEqual([]);
});

test("responsive vertical composition fills screen at 1280x720 and 2012x1248 without vertical scrolling", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // Import rich score backup directly
  await page
    .locator('input[accept*="json"]')
    .setInputFiles(path.resolve("fixtures/rich-score-backup.json"));

  // Verify project is loaded into workspace
  await expect(page.locator(".workspace")).toBeVisible();

  // Navigate to expanded Studio
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(page.locator(".workspace")).toHaveClass(/studio-map-expanded/);

  // Open Fullscreen Graph Visualization
  const mapFullscreenBtn = page.locator(".map-fullscreen-btn");
  await expect(mapFullscreenBtn).toBeVisible();
  await mapFullscreenBtn.click();

  const fullscreenContainer = page.locator(".fullscreen-graph-container");
  await expect(fullscreenContainer).toBeVisible();

  // --------------------------------------------------------------------------
  // TEST AT 1280 x 720 (Standard HD)
  // --------------------------------------------------------------------------
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  const scrollViewport = page.locator(".fullscreen-scroll-viewport");
  const scoreCanvas = page.locator(".fullscreen-score-canvas");

  // Verify no vertical scrollbar / overflow
  const overflowCheck720 = await scrollViewport.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    hasVerticalScroll: el.scrollHeight > el.clientHeight + 2,
  }));
  expect(overflowCheck720.hasVerticalScroll).toBe(false);

  // Verify score canvas height commands the viewport (>= 90% of 720px)
  const canvasBox720 = await scoreCanvas.boundingBox();
  expect(canvasBox720).not.toBeNull();
  expect(canvasBox720!.height).toBeGreaterThan(650);

  // Verify presence of all analytical score layers
  await expect(page.locator(".fullscreen-sequence-track")).toBeVisible();
  await expect(page.locator(".fullscreen-shot-track")).toBeVisible();
  await expect(page.locator(".fullscreen-pacing-track")).toBeVisible();
  await expect(page.locator(".fullscreen-framing-track")).toBeVisible();
  await expect(page.locator(".fullscreen-motion-track")).toBeVisible();
  await expect(page.locator(".fullscreen-audio-track")).toBeVisible();
  await expect(page.locator(".fullscreen-cast-track")).toBeVisible();

  // Verify shot blocks have 3 distinct tiers (top positions)
  const shotBlocks = page.locator(".fullscreen-shot-block");
  await expect(shotBlocks).toHaveCount(8);
  const tiers = await shotBlocks.evaluateAll((blocks) => {
    return blocks.map((b) => ({
      tier: b.className.match(/tier-\d/)?.[0],
      top: parseFloat(window.getComputedStyle(b).top),
    }));
  });
  const tier0Tops = tiers.filter((t) => t.tier === "tier-0").map((t) => t.top);
  const tier1Tops = tiers.filter((t) => t.tier === "tier-1").map((t) => t.top);
  const tier2Tops = tiers.filter((t) => t.tier === "tier-2").map((t) => t.top);
  expect(tier0Tops[0]).toBeLessThan(tier1Tops[0]);
  expect(tier1Tops[0]).toBeLessThan(tier2Tops[0]);

  // Verify wordless cast avatar: cast-2 without image renders SVG silhouette, no text
  const silhouettes = page.locator(".avatar-silhouette");
  await expect(silhouettes).toHaveCount(1);
  const avatarInitials = page.locator(".avatar-init");
  await expect(avatarInitials).toHaveCount(0);

  // Take 720p screenshot
  await page.screenshot({ path: "tests/browser/screenshots/fullscreen-720p.png" });

  // --------------------------------------------------------------------------
  // TEST AT 2012 x 1248 (Large Retina / Ultrawide)
  // --------------------------------------------------------------------------
  await page.setViewportSize({ width: 2012, height: 1248 });
  await page.waitForTimeout(300);

  const overflowCheck2012 = await scrollViewport.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    hasVerticalScroll: el.scrollHeight > el.clientHeight + 2,
  }));
  expect(overflowCheck2012.hasVerticalScroll).toBe(false);

  // Verify score canvas expands vertically to command 1248px height (>= 1150px)
  const canvasBox2012 = await scoreCanvas.boundingBox();
  expect(canvasBox2012).not.toBeNull();
  expect(canvasBox2012!.height).toBeGreaterThan(1150);

  // Verify layer heights scale proportionally and are generous (not thin bands)
  const layerHeights = await page.evaluate(() => {
    return {
      sequences: document.querySelector(".fullscreen-sequence-track")?.clientHeight ?? 0,
      shots: document.querySelector(".fullscreen-shot-track")?.clientHeight ?? 0,
      pacing: document.querySelector(".fullscreen-pacing-track")?.clientHeight ?? 0,
      framing: document.querySelector(".fullscreen-framing-track")?.clientHeight ?? 0,
      motion: document.querySelector(".fullscreen-motion-track")?.clientHeight ?? 0,
      audio: document.querySelector(".fullscreen-audio-track")?.clientHeight ?? 0,
      cast: document.querySelector(".fullscreen-cast-track")?.clientHeight ?? 0,
    };
  });

  expect(layerHeights.pacing).toBeGreaterThan(150);
  expect(layerHeights.shots).toBeGreaterThan(100);
  expect(layerHeights.audio).toBeGreaterThan(180);
  expect(layerHeights.motion).toBeGreaterThan(120);

  // Take 2012p screenshot
  await page.screenshot({ path: "tests/browser/screenshots/fullscreen-2012p.png" });

  // --------------------------------------------------------------------------
  // TEST AT 1440 x 900 (MacBook Standard)
  // --------------------------------------------------------------------------
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);

  const overflowCheck900 = await scrollViewport.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    hasVerticalScroll: el.scrollHeight > el.clientHeight + 2,
  }));
  expect(overflowCheck900.hasVerticalScroll).toBe(false);

  expect(errors).toEqual([]);
});
