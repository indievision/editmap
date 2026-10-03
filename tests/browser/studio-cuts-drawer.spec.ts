import { test, expect } from "@playwright/test";
import path from "node:path";
import { startNewProject } from "./helpers";

test("Studio Cuts drawer design, interactions, boundary frames, evidence rows, playback, and ribbon highlight", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 1. Setup new project (the helper links the fixture film) and import the EDL
  await startNewProject(page);
  await page.getByLabel("Project name").fill("Studio Cuts Drawer Verification");

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

  // 3. Open Cuts drawer via Cuts rail button
  const cutsRailBtn = page.locator('.studio-rail-btn[aria-label="Cuts"]');
  await cutsRailBtn.click();

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

  // 4. Verify Drawer Header and Empty State (with redundant title omitted)
  await expect(page.locator(".cut-drawer-title")).toHaveCount(0);

  const drawerSubtitle = page.locator(".cut-drawer-subtitle");
  await expect(drawerSubtitle).toBeVisible();
  await expect(drawerSubtitle).toHaveText("Study what changes at an edit.");

  const emptyMsg = page.locator(".cut-empty-msg");
  await expect(emptyMsg).toBeVisible();
  await expect(emptyMsg).toContainText("Click a boundary between two contiguous shots");

  // 5. Test close via 'X' button
  const closeBtn = page.locator(".cut-drawer-close-btn");
  await closeBtn.click();
  await expect(drawer).not.toBeVisible();

  // 8. Select a cut by clicking the boundary on the Editing Map
  await page.locator(".shot-track").scrollIntoViewIfNeeded();
  const cutBoundary = page.locator(".cut-boundary").first();
  await expect(cutBoundary).toBeVisible();
  await cutBoundary.click();

  // Drawer should automatically open (the tool rail lives inside it, so a closed
  // drawer is reopened by selecting a cut or from the Studio toolbar).
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveClass(/drawer-open/);

  // Escape closes it, and selecting a cut brings it back. (The playhead is parked
  // on the cut just selected, so reopen with the other cut, then return to the first.)
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await page.locator(".cut-boundary").nth(1).click();
  await expect(drawer).toBeVisible();
  await expect(page.locator(".cut-drawer-subtitle")).toHaveText("Shot 002 → 003");
  await cutBoundary.click();

  // Header should now show cut pair: Shot 001 → 002
  await expect(page.locator(".cut-drawer-subtitle")).toHaveText("Shot 001 → 002");

  // 9. Verify selected cut boundary on authoritative timeline
  const selectedCutMarker = page.locator(".cut-boundary.selected");
  await expect(selectedCutMarker).toBeVisible();
  await expect(page.locator(".ribbon-selected-cut-marker")).toHaveCount(0);

  // 10. Verify 6-item Action Toolbar
  const toolbar = page.locator(".cut-drawer-toolbar");
  await expect(toolbar).toBeVisible();
  const toolbarButtons = toolbar.locator(".cut-toolbar-btn");
  await expect(toolbarButtons).toHaveCount(6);

  // Eye-Trace button
  const eyeTraceBtn = toolbarButtons.filter({ hasText: "Eye-Trace" });
  await expect(eyeTraceBtn).toBeVisible();
  await expect(eyeTraceBtn).toHaveClass(/active/);
  await eyeTraceBtn.click();
  await expect(eyeTraceBtn).not.toHaveClass(/active/);
  await eyeTraceBtn.click();
  await expect(eyeTraceBtn).toHaveClass(/active/);

  // Squint Cut button
  const squintBtn = toolbarButtons.filter({ hasText: "Squint Cut" });
  await expect(squintBtn).toBeVisible();
  await expect(squintBtn).not.toHaveClass(/active/);
  await squintBtn.click();
  await expect(squintBtn).toHaveClass(/active/);
  await squintBtn.click();
  await expect(squintBtn).not.toHaveClass(/active/);
  // Go to cut button
  const goToCutBtn = toolbarButtons.filter({ hasText: "Go to cut" });
  await expect(goToCutBtn).toBeVisible();
  await goToCutBtn.click();

  // -1f and +1f nudge buttons
  const nudgeMinusBtn = toolbarButtons.filter({ hasText: "-1f" });
  await expect(nudgeMinusBtn).toBeVisible();
  await nudgeMinusBtn.click();

  const nudgePlusBtn = toolbarButtons.filter({ hasText: "+1f" });
  await expect(nudgePlusBtn).toBeVisible();
  await nudgePlusBtn.click();

  // Merge shots button
  const mergeBtn = toolbarButtons.filter({ hasText: "Merge shots" });
  await expect(mergeBtn).toBeVisible();

  // 11. Verify 2 Boundary Frame Cards: OUT and INCOMING
  const frameCards = page.locator(".cut-frame-card");
  await expect(frameCards).toHaveCount(2);

  const outCard = frameCards.first();
  await expect(outCard.locator(".cut-frame-card-head")).toContainText("OUT");
  await expect(outCard.locator(".cut-bracket-marker")).toContainText("OUT");

  const inCard = frameCards.last();
  await expect(inCard.locator(".cut-frame-card-head")).toContainText("INCOMING");
  await expect(inCard.locator(".cut-bracket-marker")).toContainText("IN");

  // 12. Verify Evidence Rows
  const evidenceRows = page.locator(".cut-evidence-row");
  await expect(evidenceRows).toHaveCount(6);

  await expect(evidenceRows.nth(0).locator(".cut-evidence-label")).toContainText("Eye-Trace jump");
  await expect(evidenceRows.nth(1).locator(".cut-evidence-label")).toContainText("Colour match");
  await expect(evidenceRows.nth(2).locator(".cut-evidence-label")).toContainText("Framing change");
  await expect(evidenceRows.nth(3).locator(".cut-evidence-label")).toContainText("Duration change");
  await expect(evidenceRows.nth(4).locator(".cut-evidence-label")).toContainText("Visual change");
  await expect(evidenceRows.nth(5).locator(".cut-evidence-label")).toContainText("Transition");
  await expect(evidenceRows.nth(5).locator(".cut-evidence-value")).toHaveText("Hard cut");

  const footnote = page.locator(".cut-evidence-footnote");
  await expect(footnote).toContainText("Boundary samples are one frame either side");

  // 13. Verify Play across the cut
  const playbackSection = page.locator(".cut-drawer-section").filter({ hasText: "PLAY ACROSS THE CUT" });
  await expect(playbackSection).toBeVisible();
  await expect(playbackSection.locator(".cut-param-pill")).toHaveCount(2);
  await expect(playbackSection.locator(".cut-loop-toggle")).toBeVisible();

  const playCutBtn = page.locator(".cut-play-cut-btn");
  await expect(playCutBtn).toBeVisible();
  await expect(playCutBtn).toHaveText("▶ Play cut");

  // 14. Verify Your Interpretation
  const interpretationSection = page.locator(".cut-drawer-section").filter({ hasText: "YOUR INTERPRETATION" });
  await expect(interpretationSection).toBeVisible();

  const interpSelect = page.locator(".cut-interpretation-select");
  await expect(interpSelect).toBeVisible();
  await interpSelect.selectOption("Reaction");
  await expect(interpSelect).toHaveValue("Reaction");

  const noteTextarea = page.locator(".cut-interpretation-notes");
  await expect(noteTextarea).toBeVisible();
  await noteTextarea.fill("Cutting on head turn to maintain viewer focus.");
  await expect(noteTextarea).toHaveValue("Cutting on head turn to maintain viewer focus.");

  expect(errors).toEqual([]);
});
