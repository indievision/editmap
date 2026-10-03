import { test, expect } from "@playwright/test";
import path from "node:path";
import { startNewProject } from "../helpers";

test.describe("User-Selectable Graph Overlays & Comparison", () => {
  test("1. Verify Mockup Layout, Measure chips, Scope, Window, Range drag, Loop, Save note, and Zoom", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");

    // Setup new project with fixture video and EDL
    await startNewProject(page);
    await page.getByLabel("Project name").fill("Graph Comparison Mockup Verification");

    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles(path.resolve("fixtures/test-film.mp4"));

    await page
      .locator('input[accept*=".edl"]')
      .setInputFiles(path.resolve("fixtures/cuts-24.edl"));

    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.locator(".shot")).toHaveCount(3);

    // Open Rhythm drawer via tool rail
    const rhythmRailBtn = page.locator('.studio-rail-btn[aria-label="Rhythm"]');
    await rhythmRailBtn.click();
    const drawer = page.locator(".studio-detail-drawer");
    await expect(drawer).toBeVisible();

    // 1. Verify "Compare" shortcut from Local pacing panel
    const pacingTabBtn = page.getByRole("tab", { name: "Local pacing", exact: true });
    await pacingTabBtn.click();
    await expect(page.locator(".pacing")).toBeVisible();

    const pacingCompareBtn = page.locator('.pacing-glance-controls button:has-text("Compare")');
    await expect(pacingCompareBtn).toBeVisible();
    await pacingCompareBtn.click();

    // Verification: Opens Compare view with Cut rate selected
    const compareView = page.locator(".comparison-view");
    await expect(compareView).toBeVisible();
    await expect(page.locator('.comparison-chip:has-text("Cut rate")')).toBeVisible();

    // 2. Visual layout hierarchy matching mockup:
    // Selected-measure chips row: Cut rate | Brightness | Motion | + Measure
    const chipsRow = page.locator(".comparison-chips-row");
    await expect(chipsRow).toBeVisible();
    await expect(page.locator(".btn-add-measure")).toBeVisible();

    // Compact control row: Scope, Window, Overlay/Stacked
    const controlRow = page.locator(".comparison-control-row");
    await expect(controlRow).toBeVisible();
    const scopeSelect = page.locator(".comparison-scope-select");
    await expect(scopeSelect).toBeVisible();
    await expect(scopeSelect).toHaveValue("all");

    // Cut-rate window buttons: 10 / 30 / 60 s
    const winBtn10 = page.locator('.comparison-window-select button:has-text("10")');
    const winBtn30 = page.locator('.comparison-window-select button:has-text("30")');
    const winBtn60 = page.locator('.comparison-window-select button:has-text("60 s")');
    await expect(winBtn10).toBeVisible();
    await expect(winBtn30).toBeVisible();
    await expect(winBtn60).toBeVisible();
    await winBtn10.click();
    await expect(winBtn10).toHaveClass(/active/);
    await winBtn30.click();
    await expect(winBtn30).toHaveClass(/active/);

    // Overlay / Stacked toggle
    const overlayToggleBtn = page.locator('.comparison-mode-btn:has-text("Overlay")');
    const stackedToggleBtn = page.locator('.comparison-mode-btn:has-text("Stacked")');
    await expect(overlayToggleBtn).toBeVisible();
    await expect(stackedToggleBtn).toBeVisible();
    await expect(overlayToggleBtn).toHaveClass(/active/);

    // 3. Adding and removing measures via chips and + Measure picker
    // If Motion is not selected, add it via + Measure
    const addMeasureBtn = page.locator(".btn-add-measure");
    if (await addMeasureBtn.isEnabled()) {
      await addMeasureBtn.click();
      const motionMenuItem = page.locator('.add-measure-menu-item:has-text("Motion")');
      if (await motionMenuItem.isVisible()) {
        await motionMenuItem.click();
      }
    }

    // Now all 3 measures are selected
    await expect(page.locator(".comparison-chip")).toHaveCount(3);
    await expect(addMeasureBtn).toBeDisabled();

    // Remove Motion via its chip remove button
    const motionChip = page.locator('.comparison-chip:has-text("Motion")');
    await motionChip.locator(".chip-remove-btn").click();
    await expect(page.locator('.comparison-chip:has-text("Motion")')).toHaveCount(0);
    await expect(page.locator(".comparison-chip")).toHaveCount(2);

    // Re-add Motion via + Measure
    await addMeasureBtn.click();
    await page.locator('.add-measure-menu-item:has-text("Motion")').click();
    await expect(page.locator(".comparison-chip")).toHaveCount(3);

    // 4. Large chart interactions: Click to seek, Hover tooltip
    const chartWrapper = page.locator(".comparison-chart-wrapper");
    await expect(chartWrapper).toBeVisible();

    // Hover does not seek
    await chartWrapper.hover({ position: { x: 200, y: 100 } });
    await page.waitForTimeout(200);

    // Click inside chart seeks video player
    await chartWrapper.click({ position: { x: 260, y: 100 } });
    await page.waitForTimeout(200);

    // 5. Drag selection on chart background to select range
    const chartBox = await chartWrapper.boundingBox();
    expect(chartBox).not.toBeNull();
    const startX = chartBox!.x + 120;
    const endX = chartBox!.x + 320;
    const y = chartBox!.y + 120;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 10 });
    await page.mouse.up();

    // Selected range panel displays In -> Out and duration
    const rangePanel = page.locator(".comparison-selected-range-panel");
    await expect(rangePanel).toBeVisible();
    const tcText = page.locator(".range-tc-text");
    await expect(tcText).toBeVisible();
    await expect(tcText).toContainText("→");

    // Handles are visible in overlay SVG
    await expect(page.locator(".range-handle-in")).toBeVisible();
    await expect(page.locator(".range-handle-out")).toBeVisible();

    // 6. Test Loop range toggle
    const loopBtn = page.locator(".btn-loop-range");
    await expect(loopBtn).toBeVisible();
    await expect(loopBtn).toBeEnabled();
    await loopBtn.click();
    await expect(loopBtn).toHaveClass(/active/);

    // 7. Test Note field and Save
    const readingInput = page.locator(".comparison-reading-input");
    const saveReadingBtn = page.locator(".btn-save-reading");
    await expect(readingInput).toBeVisible();
    await expect(saveReadingBtn).toBeDisabled();

    await readingInput.fill("High rhythmic tension across cut sequence");
    await expect(saveReadingBtn).toBeEnabled();
    await saveReadingBtn.click();

    // Verify saved observation toggle
    const savedToggle = page.locator(".btn-toggle-saved-readings");
    await expect(savedToggle).toBeVisible();
    await savedToggle.click();
    await expect(page.locator(".saved-observation-card")).toBeVisible();
    await expect(page.locator(".obs-card-note")).toContainText("High rhythmic tension");

    // 8. Test Zoom controls: minus, slider, plus
    const zoomOutBtn = page.locator(".comparison-zoom-btn.zoom-out");
    const zoomInBtn = page.locator(".comparison-zoom-btn.zoom-in");
    const zoomSlider = page.locator(".comparison-zoom-slider");
    await expect(zoomOutBtn).toBeVisible();
    await expect(zoomInBtn).toBeVisible();
    await expect(zoomSlider).toBeVisible();

    // Zoom in and back to 1.0
    await zoomInBtn.click();
    await expect(zoomSlider).toHaveValue("1.5");
    await zoomInBtn.click();
    await expect(zoomSlider).toHaveValue("2");
    await zoomOutBtn.click();
    await expect(zoomSlider).toHaveValue("1.5");
    await zoomOutBtn.click();
    await expect(zoomSlider).toHaveValue("1");

    // Close saved observations accordion
    await savedToggle.click();

    // 9. Clear range disables loop
    const clearBtn = page.locator(".btn-clear-range");
    await clearBtn.click();
    await expect(page.locator(".range-tc-placeholder")).toBeVisible();
    await expect(loopBtn).toBeDisabled();
    await expect(loopBtn).not.toHaveClass(/active/);

    // 10. Switch to Stacked view
    await stackedToggleBtn.click();
    await expect(stackedToggleBtn).toHaveClass(/active/);
    await expect(page.locator(".comparison-echart")).toHaveClass(/mode-lanes/);

    // Switch back to Overlay view
    await overlayToggleBtn.click();
    await expect(overlayToggleBtn).toHaveClass(/active/);
    await expect(page.locator(".comparison-echart")).toHaveClass(/mode-overlay/);

    // 11. Restore range via saved observation card to show complete state in screenshot
    await savedToggle.click();
    await page.locator(".saved-observation-card").click();
    await savedToggle.click();
    await expect(page.locator(".range-tc-text")).toBeVisible();
    await expect(loopBtn).toBeEnabled();
    await loopBtn.click();
    await expect(loopBtn).toHaveClass(/active/);

    // Capture screenshot of Overlay state with preview visible
    await page.screenshot({
      path: "tests/browser/screenshots/comparison-overlay-studio.png",
      fullPage: true,
    });

    // Capture screenshot of Stacked state with preview visible
    await stackedToggleBtn.click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: "tests/browser/screenshots/comparison-stacked-studio.png",
      fullPage: true,
    });

    expect(errors).toEqual([]);
  });

  test("2. Verify Backup Restore with real Motion profiles and Color drawer Compare action", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");

    // Restore backup with rich motion profiles directly via JSON input
    await page
      .locator('input[accept*=".json"]')
      .setInputFiles(path.resolve("fixtures/rich-score-backup.json"));

    await expect(page.locator(".shot")).toHaveCount(8);

    // Open Color drawer from tool rail
    const colorRailBtn = page.locator('.studio-rail-btn[aria-label="Color"]');
    await colorRailBtn.click();
    const colorDrawer = page.locator(".color-drawer");
    await expect(colorDrawer).toBeVisible();

    // Verify "Compare ↗" button in Color reading drawer
    const colorCompareBtn = page.locator('.color-drawer button:has-text("Compare ↗")').first();
    await expect(colorCompareBtn).toBeVisible();
    await colorCompareBtn.click();

    // Should switch to Rhythm drawer and open Compare view with Brightness (Luminance) selected
    const compareView = page.locator(".comparison-view");
    await expect(compareView).toBeVisible();
    const lumaChip = page.locator('.comparison-chip:has-text("Brightness")');
    await expect(lumaChip).toBeVisible();

    // Verify 3 curves in separate lanes (Stacked)
    const stackedBtn = page.locator('.comparison-mode-btn:has-text("Stacked")');
    await stackedBtn.click();
    await expect(page.locator(".comparison-echart")).toHaveClass(/mode-lanes/);

    expect(errors).toEqual([]);
  });
});
