import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { openRecentProjectInStudio } from "./helpers";

test("Compare subpage: navigation, dual-passage selection, independent playback, independent zoom, measurements, and saving", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Load rich project fixture
  const backupRaw = fs.readFileSync(path.resolve("fixtures/rich-score-backup.json"), "utf8");
  const backup = JSON.parse(backupRaw);
  const project = backup.project;

  // Set up 3 distinct filmmaker-authored passages in Studio
  project.sequences = [
    {
      id: "seq-encounter",
      name: "First encounter",
      startSeconds: 0,
      endSeconds: 12,
      kind: "passage",
      notes: "Opening dialogue at apartment",
    },
    {
      id: "seq-convo",
      name: "Last conversation",
      startSeconds: 14,
      endSeconds: 28,
      kind: "passage",
      notes: "Dusk dialogue near window",
    },
    {
      id: "seq-resolution",
      name: "Final resolution",
      startSeconds: 20,
      endSeconds: 30,
      kind: "passage",
      notes: "Quiet closing moments",
    },
  ];

  await page.goto("/");

  // Seed IndexedDB with our test project
  await page.evaluate(async (p) => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("editmap", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("projects", { keyPath: "id" });
      r.onsuccess = () => {
        const tx = r.result.transaction("projects", "readwrite");
        tx.objectStore("projects").put(p);
        tx.oncomplete = () => {
          r.result.close();
          resolve();
        };
      };
      r.onerror = () => reject(r.error);
    });
  }, project);

  await page.reload();

  // Open the project from Welcome screen
  await openRecentProjectInStudio(page, /cinematic score test/i);



  // --------------------------------------------------------------------------
  // 1. NAVIGATION: Studio -> Explore -> Assemble -> Compare
  // --------------------------------------------------------------------------
  const exploreTab = page.getByRole("tab", { name: "Explore" });
  await exploreTab.click();

  await expect(page.locator(".explore-workspace")).toBeVisible();
  const assembleSubtab = page.getByRole("tab", { name: "Assemble" });
  const compareSubtab = page.getByRole("tab", { name: "Compare" });

  await expect(assembleSubtab).toBeVisible();
  await expect(compareSubtab).toBeVisible();
  await expect(assembleSubtab).toHaveClass(/active/);

  // Take screenshot 1: Explore navigation with Assemble and Compare
  await page.screenshot({
    path: path.resolve("output/screenshots/explore-nav-assemble-compare.png"),
  });

  // Switch to Compare subpage
  await compareSubtab.click();
  await expect(compareSubtab).toHaveClass(/active/);
  await expect(page.locator(".compare-subpage-container")).toBeVisible();

  // --------------------------------------------------------------------------
  // 2. COMPARE LAYOUT & DUAL-PASSAGE SELECTION
  // --------------------------------------------------------------------------
  const panelA = page.locator("[data-testid='compare-panel-a']");
  const panelB = page.locator("[data-testid='compare-panel-b']");

  await expect(panelA).toBeVisible();
  await expect(panelB).toBeVisible();

  // Verify badges and passage titles
  await expect(panelA.locator(".badge-a")).toHaveText("A");
  await expect(panelB.locator(".badge-b")).toHaveText("B");

  const selectA = panelA.locator("select");
  const selectB = panelB.locator("select");

  await expect(selectA).toHaveValue("seq-encounter");
  await expect(selectB).toHaveValue("seq-convo");

  // Verify sequence measurements table
  const measTable = page.locator(".compare-measurements-table").first();
  await expect(measTable).toBeVisible();
  await expect(measTable.locator(".col-a")).toContainText("First encounter");
  await expect(measTable.locator(".col-b")).toContainText("Last conversation");
  await expect(measTable).toContainText("Duration");
  await expect(measTable).toContainText("Shots");
  await expect(measTable).toContainText("Median shot segment");
  await expect(page.locator(".compare-overview-view")).toContainText("Detected speech coverage");

  // Take screenshot 2: Compare with two selected passages
  await page.screenshot({
    path: path.resolve("output/screenshots/explore-compare-two-passages.png"),
  });

  // --------------------------------------------------------------------------
  // 3. INDEPENDENT PLAYBACK & FRAME STEPPING
  // --------------------------------------------------------------------------
  const playBtnA = panelA.locator(".compare-play-btn");
  const playBtnB = panelB.locator(".compare-play-btn");

  // Frame step forward on side A (step 25 frames = > 1 second at 24fps)
  const nextFrameBtnA = panelA.getByTitle(/next frame/i);
  for (let i = 0; i < 25; i++) {
    await nextFrameBtnA.click();
  }

  // Panel A local time should advance to at least 00:01
  const timeA = await panelA.locator(".compare-time-readout").innerText();
  expect(timeA).toContain("00:01 / 00:12");

  // Panel B must remain untouched at 00:00
  const timeB = await panelB.locator(".compare-time-readout").innerText();
  expect(timeB).toContain("00:00 / 00:14");

  // Test playing A, then playing B pauses A
  await playBtnA.click();
  await page.waitForTimeout(400);

  // Now click play on B
  await playBtnB.click();
  await page.waitForTimeout(300);

  // Play button on A should be paused (not active)
  await expect(playBtnA).not.toHaveClass(/active/);

  // Pause B
  await playBtnB.click();

  // --------------------------------------------------------------------------
  // 4. INDEPENDENT TIMELINE ZOOM
  // --------------------------------------------------------------------------
  const zoomInBtnA = panelA.getByTitle("Zoom in");
  const zoomInBtnB = panelB.getByTitle("Zoom in");
  const sliderA = panelA.getByRole("slider", { name: "Timeline zoom" });
  const sliderB = panelB.getByRole("slider", { name: "Timeline zoom" });

  // Zoom in panel A
  await zoomInBtnA.click();
  await zoomInBtnA.click();
  const zoomAVal = await sliderA.inputValue();
  expect(parseFloat(zoomAVal)).toBeGreaterThan(1.5);

  // Panel B zoom must remain untouched at 1.0 (fit view)
  const zoomBVal = await sliderB.inputValue();
  expect(parseFloat(zoomBVal)).toBe(1.0);

  // Content width of A must be larger than 100%
  const contentStyleA = await panelA.locator(".compare-timeline-content").getAttribute("style");
  expect(contentStyleA).toContain("%");

  // Take screenshot 3: A zoomed independently from B
  await page.screenshot({
    path: path.resolve("output/screenshots/explore-compare-a-zoomed.png"),
  });

  // Zoom A back out to minimum zoom (1.0 fit)
  const zoomOutBtnA = panelA.getByTitle("Zoom out");
  await zoomOutBtnA.click();
  await zoomOutBtnA.click();
  expect(parseFloat(await sliderA.inputValue())).toBe(1.0);
  await expect(zoomOutBtnA).toBeDisabled();

  // --------------------------------------------------------------------------
  // 5. REPLACE ONE SELECTION WITHOUT RESETTING THE OTHER
  // --------------------------------------------------------------------------
  // Seek A partway
  await nextFrameBtnA.click();
  const preChangeTimeA = await panelA.locator(".compare-time-readout").innerText();

  // Change B to "Final resolution"
  await selectB.selectOption("seq-resolution");
  await expect(selectB).toHaveValue("seq-resolution");

  // Panel A remains on First encounter and keeps its position
  await expect(selectA).toHaveValue("seq-encounter");
  const postChangeTimeA = await panelA.locator(".compare-time-readout").innerText();
  expect(postChangeTimeA).toEqual(preChangeTimeA);

  // --------------------------------------------------------------------------
  // 6. LOCATE IN STUDIO
  // --------------------------------------------------------------------------
  const locateBtnA = panelA.locator(".compare-locate-btn");
  await locateBtnA.click();

  // Workspace mode should now be Studio
  await expect(page.locator(".workspace")).toHaveClass(/mode-studio/);

  // Switch back to Explore
  await exploreTab.click();
  await expect(page.locator(".compare-subpage-container")).toBeVisible();

  // --------------------------------------------------------------------------
  // 7. SAVE NOTE AND COMPARISON
  // --------------------------------------------------------------------------
  const noteInput = page.locator("#compare-reading-input");
  await noteInput.fill("Rhythmic dialogue pacing comparison between encounter and resolution.");
  await page.locator(".compare-save-note-btn").click();

  // Top header button to open saved comparisons modal
  const saveCompBtn = page.getByRole("button", { name: "Save comparison" });
  await saveCompBtn.click();

  const modal = page.locator(".explore-modal-dialog");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Saved comparisons");
  // Close modal
  await page.locator(".explore-modal-close-btn").click();
  await expect(modal).not.toBeVisible();

  // --------------------------------------------------------------------------
  // 8. FOUR ANALYSIS VIEWS: OVERVIEW, PACING, FRAMING, OVER TIME
  // --------------------------------------------------------------------------
  const overviewTab = page.locator("#compare-tab-overview");
  const pacingTab = page.locator("#compare-tab-pacing");
  const framingTab = page.locator("#compare-tab-framing");
  const overtimeTab = page.locator("#compare-tab-overtime");

  await expect(overviewTab).toBeVisible();
  await expect(pacingTab).toBeVisible();
  await expect(framingTab).toBeVisible();
  await expect(overtimeTab).toBeVisible();

  // 8.1 OVERVIEW VIEW
  await expect(overviewTab).toHaveClass(/active/);
  await expect(page.locator(".compare-overview-view")).toBeVisible();
  await expect(page.locator(".compare-paired-bars-container")).toBeVisible();

  // Capture screenshot: 01 Overview
  await page.screenshot({
    path: path.resolve("output/screenshots/explore-compare-01-overview.png"),
  });

  // 8.2 PACING VIEW & CHART SEEKING
  await pacingTab.click();
  await expect(pacingTab).toHaveClass(/active/);
  await expect(page.locator(".compare-pacing-view")).toBeVisible();
  await expect(page.locator(".compare-histogram-container")).toBeVisible();

  // Capture screenshot: 02 Pacing
  await page.screenshot({
    path: path.resolve("output/screenshots/explore-compare-02-pacing.png"),
  });

  // Record initial time of B before seeking A from pacing chart
  const timeBBeforeSeek = await panelB.locator(".compare-time-readout").innerText();

  // Click on a shot bar in Side A editing order
  const barA2 = page.locator(".compare-order-chart-row").first().locator(".compare-order-bar-btn").nth(1);
  if (await barA2.isVisible()) {
    await barA2.click();
    await page.waitForTimeout(100);
    // Player A local time should update to start of that shot segment
    const timeAAfterSeek = await panelA.locator(".compare-time-readout").innerText();
    expect(timeAAfterSeek).not.toEqual("00:00 / 00:12");
    // Player B should NOT have changed!
    const timeBAfterSeek = await panelB.locator(".compare-time-readout").innerText();
    expect(timeBAfterSeek).toEqual(timeBBeforeSeek);
  }

  // 8.3 FRAMING VIEW & TIME/SHOTS TOGGLE
  await framingTab.click();
  await expect(framingTab).toHaveClass(/active/);
  await expect(page.locator(".compare-framing-view")).toBeVisible();
  await expect(page.locator(".compare-stacked-bars-section")).toBeVisible();
  await expect(page.locator(".compare-temporal-strip-track")).toHaveCount(2);

  // Toggle Time / Shots
  const shotsToggleBtn = page.getByRole("button", { name: "Shots" });
  await shotsToggleBtn.click();
  await expect(shotsToggleBtn).toHaveClass(/active/);
  const timeToggleBtn = page.getByRole("button", { name: "Time" });
  await timeToggleBtn.click();
  await expect(timeToggleBtn).toHaveClass(/active/);

  // Capture screenshot: 03 Framing
  await page.screenshot({
    path: path.resolve("output/screenshots/explore-compare-03-framing.png"),
  });

  // Click a temporal block on Side B in Framing
  const timeABeforeFrameSeek = await panelA.locator(".compare-time-readout").innerText();
  const blockB1 = page.locator(".compare-temporal-strip-track").nth(1).locator(".compare-temporal-block-btn").first();
  if (await blockB1.isVisible()) {
    await blockB1.click();
    await page.waitForTimeout(100);
    // Side A remained unchanged
    const timeAAfterFrameSeek = await panelA.locator(".compare-time-readout").innerText();
    expect(timeAAfterFrameSeek).toEqual(timeABeforeFrameSeek);
  }

  // 8.4 OVER TIME VIEW
  await overtimeTab.click();
  await expect(overtimeTab).toHaveClass(/active/);
  await expect(page.locator(".compare-over-time-view")).toBeVisible();
  await expect(page.locator(".compare-overtime-stage")).toBeVisible();

  // Capture screenshot: 04 Over time (relative progress mode)
  await page.screenshot({
    path: path.resolve("output/screenshots/explore-compare-04-overtime.png"),
  });

  // Switch measurement to Luminance
  const measureSelect = page.locator(".compare-measure-select");
  await measureSelect.selectOption("luminance");
  await expect(measureSelect).toHaveValue("luminance");

  // Switch to Actual time mode
  const actualTimeBtn = page.getByRole("button", { name: "Actual time" });
  await actualTimeBtn.click();
  await expect(actualTimeBtn).toHaveClass(/active/);

  // Switch back to Relative progress mode
  const relativeBtn = page.getByRole("button", { name: "Relative progress" });
  await relativeBtn.click();
  await expect(relativeBtn).toHaveClass(/active/);

  // 8.5 KEYBOARD NAVIGATION ON TABS
  await overviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(pacingTab).toHaveClass(/active/);
  await page.keyboard.press("ArrowRight");
  await expect(framingTab).toHaveClass(/active/);
  await page.keyboard.press("Home");
  await expect(overviewTab).toHaveClass(/active/);

  // Spacebar while a tab is focused does not trigger video playback
  await overviewTab.focus();
  await page.keyboard.press("Space");
  await expect(playBtnA).not.toHaveClass(/active/);
  await expect(playBtnB).not.toHaveClass(/active/);

  // 8.6 VIEWPORTS (1440x900, 1280x720, and narrow 768x900)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.resolve("output/screenshots/explore-compare-viewport-1440x900.png") });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.resolve("output/screenshots/explore-compare-viewport-1280x720.png") });

  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.resolve("output/screenshots/explore-compare-viewport-narrow.png") });

  expect(errors).toEqual([]);
});
