import { test, expect } from "@playwright/test";
import path from "node:path";
import { startNewProject } from "./helpers";

test.fixme("Local Pacing redesign: PACING AT A GLANCE, lanes, window buttons, seeking, and responsive states", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 1. Create or reset project with cuts-24.edl
  await startNewProject(page);

  await page.getByLabel("Project name").fill("Pacing Redesign Verification");
  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);

  // 2. Open Local pacing subview under Rhythm
  const pacingTabBtn = page.getByRole("tab", { name: "Local pacing", exact: true });
  if (await pacingTabBtn.isVisible()) {
    await pacingTabBtn.click();
  } else {
    // Check if in deck or drawer
    const rhythmBtn = page.locator('.studio-rail-btn[aria-label="Rhythm"]');
    if (await rhythmBtn.isVisible()) {
      await rhythmBtn.click();
    }
    await page.getByRole("tab", { name: "Local pacing", exact: true }).click();
  }

  // 3. Verify PACING AT A GLANCE Header & Subtitle
  await expect(page.locator(".pacing-glance-title")).toHaveText("PACING AT A GLANCE");
  await expect(page.locator(".pacing-glance-subtitle")).toHaveText("Three measures, one moment in the film.");

  // 4. Verify compact 10s / 30s / 60s controls with gold highlight
  const btn10s = page.locator(".pacing-window-btn", { hasText: "10s" });
  const btn30s = page.locator(".pacing-window-btn", { hasText: "30s" });
  const btn60s = page.locator(".pacing-window-btn", { hasText: "60s" });

  await expect(btn10s).toBeVisible();
  await expect(btn30s).toBeVisible();
  await expect(btn60s).toBeVisible();

  // Initial window is 30s
  await expect(btn30s).toHaveClass(/active/);
  await expect(btn10s).not.toHaveClass(/active/);
  await expect(btn60s).not.toHaveClass(/active/);

  // 5. Verify current window strip
  const strip = page.locator(".pacing-current-window-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Current window");
  await expect(strip).toContainText("cuts");

  const initialRangeText = await page.locator(".pacing-strip-range").innerText();
  expect(initialRangeText).toContain("–");

  // 6. Switch to 10s window and verify highlight updates
  await btn10s.click();
  await expect(btn10s).toHaveClass(/active/);
  await expect(btn30s).not.toHaveClass(/active/);
  const range10s = await page.locator(".pacing-strip-range").innerText();
  expect(range10s).not.toEqual(initialRangeText);

  // Switch to 60s window
  await btn60s.click();
  await expect(btn60s).toHaveClass(/active/);
  const range60s = await page.locator(".pacing-strip-range").innerText();
  expect(range60s).not.toEqual(range10s);

  // Switch back to 30s
  await btn30s.click();
  await expect(btn30s).toHaveClass(/active/);

  // 7. Verify the 3 synchronized lane labels
  await expect(page.locator(".pacing-lanes-labels .lane-cut-rate")).toContainText("CUT RATE");
  await expect(page.locator(".pacing-lanes-labels .lane-cut-rate")).toContainText("cuts / min");

  await expect(page.locator(".pacing-lanes-labels .lane-close-framing")).toContainText("CLOSE FRAMING");
  await expect(page.locator(".pacing-lanes-labels .lane-close-framing")).toContainText("% of known framing");

  await expect(page.locator(".pacing-lanes-labels .lane-visual-change")).toContainText("VISUAL CHANGE");
  await expect(page.locator(".pacing-lanes-labels .lane-visual-change")).toContainText("avg ΔV");

  // 8. Verify the 3 lane readouts on the right
  const readoutCut = page.locator(".pacing-lanes-readouts .lane-cut-rate");
  const readoutClose = page.locator(".pacing-lanes-readouts .lane-close-framing");
  const readoutShock = page.locator(".pacing-lanes-readouts .lane-visual-change");

  await expect(readoutCut).toBeVisible();
  await expect(readoutClose).toBeVisible();
  await expect(readoutShock).toBeVisible();

  await expect(readoutCut.locator(".val-cut-rate")).toBeVisible();
  await expect(readoutShock.locator(".val-visual-change")).toBeVisible();

  // 9. Verify bottom explanation notes
  const footer = page.locator(".pacing-glance-footer");
  await expect(footer).toBeVisible();
  await expect(footer).toContainText("Hard-cut boundaries in a centered window · Click to seek.");
  await expect(footer).toContainText("Cut rate measures edit frequency, not dramatic intensity.");

  // 10. Verify ECharts canvas is visible and clicking seeks the timeline
  const pacingChart = page.locator(".pacing-echart");
  await expect(pacingChart.locator("canvas")).toBeVisible();

  // Click on Lane 1 (Cut rate)
  await pacingChart.click({ position: { x: 180, y: 50 } });
  await expect(pacingChart).not.toHaveAttribute("aria-valuenow", "0");

  // Click on Lane 3 (Visual change)
  await pacingChart.click({ position: { x: 120, y: 200 } });

  // 11. Verify Studio workspace modes switch cleanly
  await page.getByRole("tab", { name: "Map", exact: false }).click();
  await expect(page.locator(".workspace")).toHaveClass(/mode-map/);

  await page.getByRole("tab", { name: "Review", exact: false }).click();
  await expect(page.locator(".workspace")).toHaveClass(/mode-review/);

  await page.getByRole("tab", { name: "Studio", exact: false }).click();
  await expect(page.locator(".workspace")).toHaveClass(/mode-studio/);

  // Take screenshot of the redesigned chart
  await page.screenshot({
    path: "/Users/indievision/.gemini/antigravity/brain/d654b8ac-a961-4f1c-b33d-b37e63aa60bd/pacing-redesign-screenshot.png",
  });

  expect(errors).toEqual([]);
});

test("Local Pacing chart with active framing data renders teal stepped line and close-framing readout", async ({
  page,
}) => {
  await page.goto("/");

  // 1. Create new project with cuts-24.edl
  await startNewProject(page);
  await page.getByLabel("Project name").fill("Pacing With Framing");
  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);

  // 2. Tag shot 1 as CU
  await page.locator(".shot").first().click();
  const cuBtn = page.locator("button.size-grid-btn", { hasText: "CU" });
  if (await cuBtn.isVisible()) {
    await cuBtn.click();
  } else {
    await page.keyboard.press("4");
  }

  // 3. Navigate to Local pacing
  const rhythmBtn = page.locator('.studio-rail-btn[aria-label="Rhythm"]');
  if (await rhythmBtn.isVisible()) {
    await rhythmBtn.click();
  }
  await page.getByRole("tab", { name: "Local pacing", exact: true }).click();

  // 4. Verify Close framing readout is now numeric percentage instead of unavailable
  const readoutClose = page.locator(".pacing-lanes-readouts .lane-close-framing .val-close-framing");
  await expect(readoutClose).toBeVisible();
  const text = await readoutClose.innerText();
  expect(text).toContain("%");

  // Take screenshot with active framing data
  await page.screenshot({
    path: "/Users/indievision/.gemini/antigravity/brain/d654b8ac-a961-4f1c-b33d-b37e63aa60bd/pacing-with-framing-screenshot.png",
  });
});
