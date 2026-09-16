import { test, expect } from "@playwright/test";
import path from "node:path";

test("Studio Cast drawer design, interactions, cards, presence arc, and appearances", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 1. Setup new project with fixture video and EDL
  await page.locator('button.header-action-btn[aria-label="New project"]').click();
  await page.getByLabel("Project name").fill("Studio Cast Drawer Verification");

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

  // 3. Open Cast drawer via Cast rail button
  const castRailBtn = page.locator('.studio-rail-btn[aria-label="Cast"]');
  await expect(castRailBtn).toBeVisible();
  await castRailBtn.click();

  const drawer = page.locator(".studio-detail-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveClass(/drawer-open/);

  // Drawer overlays left edge: width between 460-520px
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(drawerBox!.width).toBeGreaterThanOrEqual(460);
  expect(drawerBox!.width).toBeLessThanOrEqual(520);
  const railBox = await toolRail.boundingBox();
  expect(drawerBox!.x).toBeCloseTo(railBox!.x + railBox!.width, 1);

  // Monitor has not shrunk or permanently reflowed
  const monitorBoxWhileOpen = await monitor.boundingBox();
  expect(monitorBoxWhileOpen!.width).toBeCloseTo(monitorInitialBox!.width, 5);

  // 4. Verify Drawer Header
  const drawerTitle = page.locator(".cast-drawer-title");
  await expect(drawerTitle).toBeVisible();
  await expect(drawerTitle).toHaveText("CAST GALLERY");

  const drawerSubtitle = page.locator(".cast-drawer-subtitle");
  await expect(drawerSubtitle).toBeVisible();
  await expect(drawerSubtitle).toHaveText("0 cast · 0 reference views");

  // 5. Test close via 'X' button
  const closeBtn = page.locator(".cast-drawer-close-btn");
  await closeBtn.click();
  await expect(drawer).not.toBeVisible();

  // 6. Re-open via Cast rail button, test close via Escape key
  await castRailBtn.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();

  // 7. Re-open via Cast button, test close via clicking Cast button again
  await castRailBtn.click();
  await expect(drawer).toBeVisible();
  await castRailBtn.click();
  await expect(drawer).not.toBeVisible();

  // Re-open drawer for functional verification
  await castRailBtn.click();
  await expect(drawer).toBeVisible();

  // 8. Add characters: Nora, Elias, Jonas, Mara
  const addInput = page.locator(".cast-add-input");
  await expect(addInput).toBeVisible();

  await addInput.fill("Nora");
  await addInput.press("Enter");

  await addInput.fill("Elias");
  await addInput.press("Enter");

  await addInput.fill("Jonas");
  await addInput.press("Enter");

  await addInput.fill("Mara");
  await addInput.press("Enter");

  // Verify cards exist
  const cards = page.locator(".cast-card");
  await expect(cards).toHaveCount(4);
  await expect(drawerSubtitle).toHaveText("4 cast · 0 reference views");

  // Verify first card is Nora and select it
  const firstCard = cards.first();
  await expect(firstCard.locator(".cast-card-name-input")).toHaveValue("Nora");
  await firstCard.click();
  await expect(firstCard).toHaveClass(/selected/);

  // 9. Add reference view from current selected shot
  const addViewBtn = page.locator(".cast-action-btn", { hasText: "+ Add view" });
  await expect(addViewBtn).toBeVisible();
  await addViewBtn.click();

  // Reference view added, subtitle updates
  await expect(drawerSubtitle).toHaveText("4 cast · 1 reference view");

  // 10. Verify Presence Arc section
  const presenceCard = page.locator(".presence-arc-card");
  await expect(presenceCard).toBeVisible();

  // Notice text
  const noticeText = page.locator(".cast-notice-text");
  await expect(noticeText).toBeVisible();
  await expect(noticeText).toContainText("Sampled intervals are estimates");

  // Time ruler
  const ruler = page.locator(".presence-ruler");
  await expect(ruler).toBeVisible();
  await expect(ruler.locator(".presence-ruler-tick")).toHaveCount(6);

  // Golden playhead needle
  const playheadLine = page.locator(".presence-playhead-line");
  await expect(playheadLine).toBeVisible();

  // Lanes
  const lanes = page.locator(".presence-arc-lane");
  await expect(lanes).toHaveCount(4);

  // Legend
  const legend = page.locator(".presence-arc-legend");
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("Sampled interval");
  await expect(legend).toContainText("Confirmed interval");
  await expect(legend).toContainText("Manual assignment");
  await expect(legend).toContainText("Unresolved sample point");

  // 11. Verify Appearances section
  const appearancesTitle = page.locator(".appearances-section-title");
  await expect(appearancesTitle).toBeVisible();
  await expect(appearancesTitle).toContainText("NORA — APPEARANCES");

  // Comparison dropdown
  const compareSelect = page.locator('.cast-compare-select[aria-label="Compare character presence"]');
  await expect(compareSelect).toBeVisible();

  // 12. Test character appearance via Inspector manual assignment
  const detailedToggle = page.locator(".studio-details-toggle-btn");
  await detailedToggle.click();

  const noraPill = page.locator(".character-tag-pill", { hasText: "Nora" });
  await expect(noraPill).toBeVisible();
  await noraPill.click();

  // Amber diamond appears in presence arc
  await expect(page.locator(".presence-lane-manual")).toHaveCount(1);

  // Appearance row appears in Cast drawer
  const appRow = page.locator(".appearance-row");
  await expect(appRow).toHaveCount(1);
  await expect(appRow).toContainText("manual assignment");
  await expect(appRow).toContainText("Shot 001");

  // Take screenshot with 4 characters, presence arc, and appearance row populated
  await page.screenshot({
    path: "/Users/indievision/.gemini/antigravity/brain/4c6df2a4-56cd-418c-a1af-1c4e1ccc8883/studio-cast-drawer.png",
  });

  // Scroll drawer content down to capture appearances list
  await page.locator(".cast-drawer-content").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.screenshot({
    path: "/Users/indievision/.gemini/antigravity/brain/4c6df2a4-56cd-418c-a1af-1c4e1ccc8883/studio-cast-drawer-scrolled.png",
  });

  // Inspect button seeks to shot
  await appRow.locator(".appearance-action-btn.inspect").click();

  // Remove mistaken match (✕)
  await appRow.locator(".appearance-action-btn.remove").click();
  await expect(page.locator(".appearance-row")).toHaveCount(0);

  // 13. Test inline rename: Nora -> Eleanor
  const nameInput = firstCard.locator(".cast-card-name-input");
  await nameInput.fill("Eleanor");
  await nameInput.press("Enter");
  await expect(appearancesTitle).toContainText("ELEANOR — APPEARANCES");

  // 14. Test Merge: Merge Eleanor into Elias
  const mergeSelect = page.locator('.cast-action-select[aria-label*="Merge"]');
  await mergeSelect.selectOption({ label: "Merge into Elias" });
  await expect(page.locator(".cast-card")).toHaveCount(3);

  // 15. Test Remove character: Remove Mara
  await page.locator('.cast-card-remove-btn[aria-label="Remove Mara"]').click();
  await expect(page.locator(".cast-card")).toHaveCount(2);

  // 16. Take final verified screenshot
  await page.screenshot({
    path: "/Users/indievision/.gemini/antigravity/brain/4c6df2a4-56cd-418c-a1af-1c4e1ccc8883/studio-cast-drawer-final.png",
  });

  // Verify no unhandled exceptions
  expect(errors).toEqual([]);
});
