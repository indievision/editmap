import { test, expect } from "@playwright/test";
import path from "node:path";

test("three workspace modes: studio, map focus, and review desk", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 1. Setup new project with fixture video and EDL
  await page.locator('button.header-action-btn[aria-label="New project"]').click();
  await page.getByLabel("Project name").fill("Workspace Modes Test");

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
  // 2. STUDIO WORKSPACE (Default)
  // --------------------------------------------------------------------------
  const studioTab = page.getByRole("tab", { name: "Studio" });
  await expect(studioTab).toHaveClass(/active/);
  await expect(page.locator(".workspace")).toHaveClass(/mode-studio/);

  // Studio Mode has slim tool rail and single authoritative timeline (EditingMap)
  await expect(page.locator(".studio-tool-rail")).toBeVisible();
  await expect(page.locator(".studio-rhythm-ribbon")).toHaveCount(0);
  await expect(page.locator(".minimap-section")).toHaveCount(0);
  await expect(page.locator(".ruler")).toBeVisible();
  await expect(page.locator(".shot-track")).toBeVisible();

  // Open contextual detail drawer via tool rail tab
  await page.locator('.studio-rail-btn[aria-label="Rhythm"]').click();
  await expect(page.locator(".studio-detail-drawer")).toBeVisible();
  await expect(page.locator(".rhythm-drawer-title")).toHaveText("Editing rhythm");
  await expect(page.getByRole("tab", { name: "Shot duration" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Local pacing" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Audiovisual" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Motion energy" })).toBeVisible();

  // Monitor visible in center
  await expect(page.locator(".monitor")).toBeVisible();

  // Select Shot 2 on timeline
  await page.getByRole("button", { name: "Shot 2", exact: true }).click();

  // Shot inspector visible on right alongside deck & monitor without replacing deck!
  const inspector = page.locator(".shot-inspector-panel");
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText("Shot 002");
  await expect(page.locator(".analytical-deck")).toBeVisible(); // Deck is still visible!

  // Edit tag in Studio
  await page.locator("#shot-size-select").selectOption("MCU");
  await expect(page.getByRole("button", { name: "Shot 2", exact: true })).toContainText("MCU");

  // Capture screenshot of Studio Mode
  await page.screenshot({ path: "tests/browser/mode-studio.png", fullPage: true });

  // --------------------------------------------------------------------------
  // 3. MAP FOCUS WORKSPACE
  // --------------------------------------------------------------------------
  await page.getByRole("tab", { name: "Map Focus" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/mode-map/);

  // Verify state preserved: Shot 2 is still selected!
  await expect(page.getByRole("button", { name: "Shot 2", exact: true })).toHaveClass(/selected/);

  // Top stage has compact monitor, Sequence Overview, and Map Shot Summary
  await expect(page.locator(".monitor")).toHaveClass(/compact-monitor/);
  await expect(page.locator(".map-sequence-overview")).toBeVisible();
  await expect(page.locator(".map-shot-summary-panel")).toBeVisible();
  await expect(page.locator(".map-shot-summary-panel")).toContainText("SHOT 002");
  await expect(page.locator(".map-shot-summary-panel")).toContainText("MCU");

  // Map layer controls are visible
  await expect(page.locator(".map-layers-group")).toBeVisible();
  await expect(page.getByLabel("Timeline Layer Visibility")).toContainText("Framing");
  await expect(page.getByLabel("Timeline Layer Visibility")).toContainText("Characters");
  await expect(page.getByLabel("Timeline Layer Visibility")).toContainText("Audio");
  await expect(page.getByLabel("Timeline Layer Visibility")).toContainText("Scenes");

  // Minimap is visible
  await expect(page.locator(".minimap-section")).toBeVisible();

  // Open full inspector drawer from summary card
  await page.getByRole("button", { name: "Open Full Inspector" }).click();
  await expect(page.locator(".inspector-drawer-backdrop.open")).toBeVisible();
  // Close drawer
  await page.locator(".drawer-close-btn").click();
  await expect(page.locator(".inspector-drawer-backdrop.open")).toHaveCount(0);

  // Capture screenshot of Map Focus Mode
  await page.screenshot({ path: "tests/browser/mode-map-focus.png", fullPage: true });

  // --------------------------------------------------------------------------
  // 4. REVIEW DESK WORKSPACE
  // --------------------------------------------------------------------------
  await page.getByRole("tab", { name: "Review Desk" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/mode-review/);

  // Verify state preserved: Shot 2 is still selected!
  await expect(page.getByRole("button", { name: "Shot 2", exact: true })).toHaveClass(/selected/);

  // Review Queue on left
  await expect(page.locator(".review-queue-panel")).toBeVisible();
  await expect(page.locator(".queue-item-card")).toHaveCount(3);

  // 3-Shot Context Filmstrip below monitor
  await expect(page.locator(".review-filmstrip-container")).toBeVisible();
  await expect(page.locator(".filmstrip-card.current-card")).toContainText("Shot 002");
  await expect(page.locator(".filmstrip-card.prev-card")).toContainText("Shot 001");
  await expect(page.locator(".filmstrip-card.next-card")).toContainText("Shot 003");

  // 1-Click Shot Size Grid in Review Inspector
  await expect(page.locator(".shot-size-grid")).toBeVisible();
  const cuButton = page.locator(".size-grid-btn").filter({ hasText: "CU" }).first();
  await expect(cuButton).toBeVisible();
  await cuButton.click();
  await expect(page.getByRole("button", { name: "Shot 2", exact: true })).toContainText("CU");

  // Confirm & Next action
  await page.locator(".primary-confirm-btn").click();

  // Should advance to Shot 3!
  await expect(page.locator(".filmstrip-card.current-card")).toContainText("Shot 003");

  // Capture screenshot of Review Desk Mode
  await page.screenshot({ path: "tests/browser/mode-review-desk.png", fullPage: true });

  // --------------------------------------------------------------------------
  // 5. VERIFY VIDEO ELEMENT CONTINUITY ACROSS MODE SWITCHING
  // --------------------------------------------------------------------------
  // Start playback
  await page.locator("video").evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);

  // Switch to Studio while playing
  await page.getByRole("tab", { name: "Studio" }).click();
  // Video must still be playing without interruption!
  await expect.poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);

  // Switch to Map Focus while playing
  await page.getByRole("tab", { name: "Map Focus" }).click();
  // Video must still be playing without interruption!
  await expect.poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);

  // Pause playback
  await page.locator("video").evaluate((v: HTMLVideoElement) => v.pause());

  // --------------------------------------------------------------------------
  // 6. REGRESSION: P1-B Analytical deck persists during mode switch
  // --------------------------------------------------------------------------
  await page.getByRole("tab", { name: "Studio" }).click();
  await expect(page.locator(".analytical-deck")).toBeVisible();
  await page.getByRole("tab", { name: "Map Focus" }).click();
  // In Map Focus, deck is hidden via CSS/attribute but remains mounted
  await expect(page.locator(".analytical-deck")).toBeHidden();
  await page.getByRole("tab", { name: "Studio" }).click();
  await expect(page.locator(".analytical-deck")).toBeVisible();

  // --------------------------------------------------------------------------
  // 7. REGRESSION: P2-H Active Review Filter badge in Map Focus
  // --------------------------------------------------------------------------
  await page.getByRole("tab", { name: "Review Desk" }).click();
  // Filter by Unreviewed
  await page.getByRole("button", { name: /Unreviewed/ }).first().click();
  // Switch to Map Focus
  await page.getByRole("tab", { name: "Map Focus" }).click();
  // Active filter badge must be visible with Clear button
  await expect(page.locator(".map-active-filter-badge")).toBeVisible();
  await page.locator(".clear-filter-btn").click();
  await expect(page.locator(".map-active-filter-badge")).toHaveCount(0);

  // --------------------------------------------------------------------------
  // 8. REGRESSION: P2-I Review Desk full shot size taxonomy
  // --------------------------------------------------------------------------
  await page.getByRole("tab", { name: "Review Desk" }).click();
  await expect(page.locator(".size-grid-btn").filter({ hasText: "FS" })).toBeVisible();
  await expect(page.locator(".size-grid-btn").filter({ hasText: "AS" })).toBeVisible();
  await expect(page.locator(".size-grid-btn").filter({ hasText: "Unknown" })).toBeVisible();

  // Check no browser runtime errors were thrown
  expect(errors).toEqual([]);
});
