import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

test("Studio timeline simplification, interactions, viewports, and mode verification", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => console.log("BROWSER_CONSOLE:", msg.text()));

  const artifactDir = "/Users/indievision/.gemini/antigravity/brain/fa6e800f-b6cc-4a69-8cf9-c8c29ba79b16";
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }

  // Create a 37-shot EDL fixture dynamically for the test
  let edl37 = "TITLE: 37_SHOT_PROJECT\nFCM: NON-DROP FRAME\n";
  for (let i = 1; i <= 37; i++) {
    const startSec = (i - 1) * 2;
    const endSec = i * 2;
    const sFrames = startSec * 24;
    const eFrames = endSec * 24;
    const fmt = (f: number) => {
      const h = String(Math.floor(f / (3600 * 24))).padStart(2, "0");
      const m = String(Math.floor((f % (3600 * 24)) / (60 * 24))).padStart(2, "0");
      const s = String(Math.floor((f % (60 * 24)) / 24)).padStart(2, "0");
      const fr = String(f % 24).padStart(2, "0");
      return `${h}:${m}:${s}:${fr}`;
    };
    edl37 += `${String(i).padStart(3, "0")}  AX       V     C        00:00:00:00 00:00:02:00 ${fmt(sFrames)} ${fmt(eFrames)}\n* FROM CLIP NAME: SHOT_${i}.mov\n`;
  }
  const edlPath = path.resolve("fixtures/project-37-shots.edl");
  fs.writeFileSync(edlPath, edl37, "utf8");

  // --------------------------------------------------------------------------
  // 1. Load project at 1440x900
  // --------------------------------------------------------------------------
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.locator('button.header-action-btn[aria-label="New project"]').click();
  await page.getByLabel("Project name").fill("37-Shot Studio Simplification");

  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));

  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(edlPath);

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(37);

  // --------------------------------------------------------------------------
  // 2. Acceptance Criteria: Exactly one ruler, one playhead, one interactive shot track,
  //    NO Studio Rhythm Ribbon, NO FILM OVERVIEW (ENTIRE TIMELINE) minimap, NO legend clutter.
  // --------------------------------------------------------------------------
  await expect(page.locator(".workspace")).toHaveClass(/mode-studio/);
  await expect(page.locator(".studio-rhythm-ribbon")).toHaveCount(0);
  await expect(page.locator(".minimap-section")).toHaveCount(0);
  await expect(page.locator(".timeline-footer .legend")).toHaveCount(0);
  await expect(page.locator(".ruler")).toHaveCount(1);
  await expect(page.locator(".playhead")).toHaveCount(1);
  await expect(page.locator(".shot-track")).toHaveCount(1);

  // Rivers are hidden in Studio
  await expect(page.locator(".scenes-river")).toHaveCount(0);
  await expect(page.locator(".pacing-river")).toHaveCount(0);
  await expect(page.locator(".framing-arc-river")).toHaveCount(0);
  await expect(page.locator(".motion-river")).toHaveCount(0);
  await expect(page.locator(".cast-presence-river")).toHaveCount(0);
  await expect(page.locator(".sonic-river")).toHaveCount(0);

  // Tag bar and compact zoom footer are present
  await expect(page.locator(".map-top-bar")).toBeVisible();
  await expect(page.locator(".timeline-footer.timeline-footer-compact")).toBeVisible();
  await expect(page.locator(".timeline-zoom-controls")).toBeVisible();

  // Shot track is visible without scrolling inside map-scroll
  const mapScroll = page.locator(".map-scroll");
  const scrollTop1440 = await mapScroll.evaluate((el: HTMLElement) => el.scrollTop);
  expect(scrollTop1440).toBe(0);
  const shotTrack = page.locator(".shot-track");
  await expect(shotTrack).toBeVisible();

  // Capture screenshot at 1440x900
  await page.screenshot({
    path: path.join(artifactDir, "studio-1440x900.png"),
  });

  // --------------------------------------------------------------------------
  // 3. Acceptance Criteria: 1280x720 viewport test
  // --------------------------------------------------------------------------
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  // Verify shot track is still visible without scrolling
  const scrollTop1280 = await mapScroll.evaluate((el: HTMLElement) => el.scrollTop);
  expect(scrollTop1280).toBe(0);
  await expect(shotTrack).toBeVisible();
  await expect(page.locator(".ruler")).toBeVisible();
  await expect(page.locator(".timeline-zoom-controls")).toBeVisible();

  // Capture screenshot at 1280x720
  await page.screenshot({
    path: path.join(artifactDir, "studio-1280x720.png"),
  });

  // Restore 1440x900 for interaction tests
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);

  // --------------------------------------------------------------------------
  // 4. Test Authoritative Editorial Interactions
  // --------------------------------------------------------------------------
  // A. Select shot
  const shot5 = page.locator('.shot:has-text("005")').first();
  await expect(shot5).toBeVisible();
  await shot5.click();
  await expect(shot5).toHaveClass(/selected/);
  await expect(page.locator(".shot-inspector-panel")).toContainText("Shot 005");

  // B. Tag shot via Studio tag bar
  const cuButton = page.getByRole("button", { name: "4 Close" });
  await expect(cuButton).toBeVisible();
  await cuButton.click();
  await expect(shot5).toHaveAttribute("title", /Close/);
  await expect(page.locator(".shot-inspector-panel")).toContainText("Close");

  // C. Scrub / playhead click
  const ruler = page.locator(".ruler");
  const rulerBox = await ruler.boundingBox();
  expect(rulerBox).not.toBeNull();
  await page.mouse.click(rulerBox!.x + rulerBox!.width * 0.4, rulerBox!.y + 10);
  const timeAfterClick = await page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(timeAfterClick).toBeGreaterThan(5);

  // D. Cut boundary selection and roll dragging
  const cut1 = page.locator(".cut-boundary").first();
  await expect(cut1).toBeVisible();
  await cut1.click();
  await expect(cut1).toHaveClass(/selected/);
  // Cut drawer opens on cut select
  const detailDrawer = page.locator(".studio-detail-drawer");
  await expect(detailDrawer).toBeVisible();
  await expect(detailDrawer).toHaveClass(/drawer-open/);

  // Close detail drawer
  await page.keyboard.press("Escape");
  await expect(detailDrawer).not.toBeVisible();

  // E. Shift-drag range selection
  await page.locator(".map-scroll").evaluate((el) => { el.scrollTop = 0; });
  const canvas = page.locator(".map-canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.keyboard.down("Shift");
  await page.mouse.move(canvasBox!.x + 100, canvasBox!.y + 60);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 350, canvasBox!.y + 60);
  await page.mouse.up();
  await page.keyboard.up("Shift");

  // Range overlay should be visible and drawer opens to sequence/structure
  await expect(page.locator(".map-range")).toBeVisible();
  await expect(page.locator(".sequence-drawer-title")).toHaveCount(0);
  await expect(page.locator(".sr-header-controls")).toBeVisible();

  // Close detail drawer
  await page.keyboard.press("Escape");
  await expect(detailDrawer).not.toBeVisible();

  // F. Zoom controls: zoom in with W, zoom out with Q, Fit with F
  const zoomLabel = page.locator(".timeline-zoom-controls .zoom-label");
  const initialZoomText = await zoomLabel.textContent();
  await page.keyboard.press("KeyW");
  await page.waitForTimeout(100);
  const zoomedInText = await zoomLabel.textContent();
  expect(zoomedInText).not.toBe(initialZoomText);

  await page.keyboard.press("KeyF");
  await page.waitForTimeout(100);
  const fittedText = await zoomLabel.textContent();
  expect(fittedText).toBe("1.0×");

  // G. Squint Mode toggle
  const squintBtn = page.locator(".timeline-squint-btn");
  await expect(squintBtn).toBeVisible();
  await squintBtn.click();
  await expect(squintBtn).toHaveClass(/active/);
  await expect(page.locator(".timeline-squint-slider-wrap")).toBeVisible();
  // Turn squint back off
  await squintBtn.click();
  await expect(squintBtn).not.toHaveClass(/active/);

  // H. Split and Snap
  const splitBtn = page.locator(".split-shot-btn");
  await expect(splitBtn).toBeVisible();
  const snapBtn = page.locator(".snap-toggle-btn");
  await expect(snapBtn).toBeVisible();
  await snapBtn.click();
  await expect(snapBtn).not.toHaveClass(/active/);
  await snapBtn.click();
  await expect(snapBtn).toHaveClass(/active/);

  // --------------------------------------------------------------------------
  // 5. EXPANDED STUDIO MAP: full data-river map and whole-film overview
  // --------------------------------------------------------------------------
  await page.getByRole("button", { name: "Expand map" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/studio-map-expanded/);

  // Expanded map title and controls
  await expect(page.locator(".map .section-head .eyebrow")).toHaveText("FILM MAP");
  await expect(page.locator(".studio-layer-menu")).toBeVisible();

  // Timeline nav bar is hidden when 100% in view, appears when zoomed in
  await expect(page.locator(".studio-top-overview")).not.toBeVisible();
  await page.keyboard.press("KeyW");
  await expect(page.locator(".studio-top-overview")).toBeVisible();
  await page.keyboard.press("KeyF");
  await expect(page.locator(".studio-top-overview")).not.toBeVisible();

  // Restore Studio
  await page.getByRole("button", { name: "Restore Studio" }).click();
  await expect(page.locator(".workspace")).not.toHaveClass(/studio-map-expanded/);

  // --------------------------------------------------------------------------
  // 6. REVIEW MODE
  // --------------------------------------------------------------------------
  await page.getByRole("tab", { name: "Review" }).click();
  await expect(page.getByRole("main", { name: "Screening room" })).toBeVisible();

  // Capture screenshot of Review
  await page.screenshot({
    path: path.join(artifactDir, "review-desk.png"),
  });

  // Switch back to Studio
  await page.getByRole("tab", { name: "Studio" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/mode-studio/);
  await expect(page.locator(".studio-rhythm-ribbon")).toHaveCount(0);
  await expect(page.locator(".minimap-section")).toHaveCount(0);

  // Cleanup generated edl
  if (fs.existsSync(edlPath)) {
    fs.unlinkSync(edlPath);
  }

  expect(errors).toEqual([]);
});
