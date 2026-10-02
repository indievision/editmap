import { test, expect } from "@playwright/test";
import path from "node:path";

test("Studio Framing navigation: dedicated tab, default Distribution, Progression arc, seeking, and reduced Rhythm", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 1. Setup new project with test video and EDL
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill("Framing Navigation Spec");

  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));

  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);

  // 2. Verify Main tabs appear in the exact requested order:
  // Rhythm · Framing · Structure · Sound · Cuts · Cast · Color
  const toolRail = page.locator(".studio-tool-rail");
  await expect(toolRail).toBeVisible();

  const tabs = toolRail.locator(".studio-tab");
  await expect(tabs).toHaveCount(7);
  await expect(tabs.nth(0)).toHaveText("Rhythm");
  await expect(tabs.nth(1)).toHaveText("Framing");
  await expect(tabs.nth(2)).toHaveText("Structure");
  await expect(tabs.nth(3)).toHaveText("Sound");
  await expect(tabs.nth(4)).toHaveText("Cuts");
  await expect(tabs.nth(5)).toHaveText("Cast");
  await expect(tabs.nth(6)).toHaveText("Color");

  // 3. Open Rhythm drawer and verify it has exactly the five retained subsections
  const rhythmTab = toolRail.locator('.studio-tab[aria-label="Rhythm"]');
  await rhythmTab.click();
  const rhythmDrawer = page.locator(".editing-rhythm-drawer");
  await expect(rhythmDrawer).toBeVisible();

  const rhythmSubtabs = rhythmDrawer.locator(".rhythm-subtab-btn");
  await expect(rhythmSubtabs).toHaveCount(5);
  await expect(rhythmSubtabs.nth(0)).toHaveText("Shot duration");
  await expect(rhythmSubtabs.nth(1)).toHaveText("Local pacing");
  await expect(rhythmSubtabs.nth(2)).toHaveText("Compare");
  await expect(rhythmSubtabs.nth(3)).toHaveText("Audiovisual");
  await expect(rhythmSubtabs.nth(4)).toHaveText("Motion energy");

  // Verify framing views are NOT in Rhythm
  await expect(rhythmDrawer.getByRole("tab", { name: "Framing summary" })).toHaveCount(0);
  await expect(rhythmDrawer.getByRole("tab", { name: "Framing arc" })).toHaveCount(0);
  await expect(rhythmDrawer.locator(".framing-summary")).toHaveCount(0);
  await expect(rhythmDrawer.locator(".framing-arc")).toHaveCount(0);

  // Take screenshot of the reduced Rhythm subsection row
  await page.screenshot({
    path: "/Users/indievision/.gemini/antigravity/brain/15c7ac55-cac0-4201-af54-5cf31f415dfe/reduced-rhythm-subsections.png",
    fullPage: false,
  });

  // 4. Test Comparison shortcut inside Rhythm: Local pacing -> Compare
  await rhythmSubtabs.nth(1).click(); // Local pacing
  await expect(page.locator(".pacing")).toBeVisible();
  const compareCutRateBtn = page.locator(".pacing").getByRole("button", { name: "Compare" });
  await expect(compareCutRateBtn).toBeVisible();
  await compareCutRateBtn.click();
  await expect(page.locator(".comparison-view")).toBeVisible();
  await expect(rhythmDrawer.getByRole("tab", { name: "Compare" })).toHaveClass(/active/);

  // 5. Open Framing tab
  const framingTab = toolRail.locator('.studio-tab[aria-label="Framing"]');
  await framingTab.click();

  const framingDrawer = page.locator(".framing-drawer");
  await expect(framingDrawer).toBeVisible();
  await expect(framingDrawer.locator(".framing-drawer-title")).toHaveCount(0);

  // Verify Framing has two subsections: Distribution and Progression
  const framingSubtabs = framingDrawer.locator(".rhythm-subtab-btn");
  await expect(framingSubtabs).toHaveCount(2);
  await expect(framingSubtabs.nth(0)).toHaveText("Distribution");
  await expect(framingSubtabs.nth(1)).toHaveText("Progression");

  // Verify Distribution is selected by default
  await expect(framingSubtabs.nth(0)).toHaveClass(/active/);
  await expect(framingDrawer.locator(".framing-summary")).toBeVisible();

  // Take screenshot of Framing -> Distribution
  await page.screenshot({
    path: "/Users/indievision/.gemini/antigravity/brain/15c7ac55-cac0-4201-af54-5cf31f415dfe/studio-framing-distribution.png",
    fullPage: false,
  });

  // 6. Switch to Progression
  await framingSubtabs.nth(1).click();
  await expect(framingSubtabs.nth(1)).toHaveClass(/active/);
  await expect(framingDrawer.locator(".framing-arc")).toBeVisible();

  // Take screenshot of Framing -> Progression
  await page.screenshot({
    path: "/Users/indievision/.gemini/antigravity/brain/15c7ac55-cac0-4201-af54-5cf31f415dfe/studio-framing-progression.png",
    fullPage: false,
  });

  // 7. Test framing arc shot selection and click-to-seek
  const shot2Segment = framingDrawer.locator('button.framing-segment[aria-label="Framing shot 2"]');
  await expect(shot2Segment).toBeVisible();
  await shot2Segment.click();
  await expect(shot2Segment).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator(".monitor video").evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1, 1);

  // 8. Test state survival across tab switches
  // Switch back to Rhythm
  await rhythmTab.click();
  await expect(rhythmDrawer).toBeVisible();
  // Video time preserved
  await expect.poll(() => page.locator(".monitor video").evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1, 1);

  // Switch back to Framing: Progression subsection was preserved
  await framingTab.click();
  await expect(framingDrawer.locator(".framing-arc")).toBeVisible();
  await expect(framingSubtabs.nth(1)).toHaveClass(/active/);

  // 9. Keyboard navigation on subtabs
  await framingSubtabs.nth(1).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(framingSubtabs.nth(0)).toHaveClass(/active/);
  await expect(framingDrawer.locator(".framing-summary")).toBeVisible();

  // 10. Close behavior via X button and Esc
  const closeBtn = framingDrawer.locator(".framing-drawer-close-btn");
  await closeBtn.click();
  await expect(page.locator(".studio-detail-drawer")).not.toBeVisible();

  // Re-open panel via collapse button on resize handle and test Escape key
  await page.locator(".resize-handle-left .resize-collapse-btn").click();
  await expect(page.locator(".studio-detail-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".studio-detail-drawer")).not.toBeVisible();

  // Re-open for remaining tests
  await page.locator(".resize-handle-left .resize-collapse-btn").click();
  await expect(page.locator(".studio-detail-drawer")).toBeVisible();

  // 11. Expanded map mode
  await page.locator(".studio-expand-map-toggle-btn").click();
  await expect(page.locator(".workspace")).toHaveClass(/studio-map-expanded/);
  const toolsMenuBtn = page.locator("#studio-tools-menu-btn");
  await expect(toolsMenuBtn).toBeVisible();
  await toolsMenuBtn.click();
  const toolsPopover = page.locator(".studio-toolbar-tools-popover");
  await expect(toolsPopover).toBeVisible();
  const toolsMenuItems = toolsPopover.locator(".studio-tools-menu-item");
  await expect(toolsMenuItems).toHaveCount(7);
  await expect(toolsMenuItems.nth(1)).toContainText("Framing");
  // Click Framing in expanded tools menu
  await toolsMenuItems.nth(1).click();
  await expect(page.locator(".studio-detail-drawer")).toBeVisible();
  await expect(page.locator(".framing-drawer")).toBeVisible();
  await page.locator(".studio-expand-map-toggle-btn").click();

  // 12. Verify Explore remains untouched
  await page.getByRole("tab", { name: "Explore" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/mode-explore/);
  await expect(page.locator(".explore-workspace")).toBeVisible();

  expect(errors).toEqual([]);
});
