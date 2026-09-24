import { test, expect } from "@playwright/test";
import path from "node:path";

test("Studio timeline matches approved design, category order, typography, and vertical resizing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill("Studio Timeline Design Verification");
  await page.locator("input[type=file]").first().setInputFiles(path.resolve("fixtures/test-film.mp4"));
  await page.locator('input[accept*=".edl"]').setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();

  // Ensure shots are loaded
  await expect(page.locator(".shot")).toHaveCount(3);

  // 1. Verify exact 8 category titles in exact top-to-bottom order
  const expectedTracks = [
    "Story",
    "Shots",
    "Pacing",
    "Cut density",
    "Framing",
    "Motion",
    "Palette",
    "Cast",
    "Sound"
  ];

  const headerTitles = page.locator(".studio-track-headers .studio-track-title");
  await expect(headerTitles).toHaveCount(9);
  for (let i = 0; i < expectedTracks.length; i++) {
    await expect(headerTitles.nth(i)).toHaveText(expectedTracks[i]);
  }

  // 2. Verify exact typography across all category labels
  for (let i = 0; i < expectedTracks.length; i++) {
    const title = headerTitles.nth(i);
    const styles = await title.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        color: cs.color,
        textTransform: cs.textTransform,
      };
    });
    expect(styles.fontSize).toBe("11px");
    expect(styles.fontWeight).toBe("500");
    expect(styles.color).toBe("rgb(226, 222, 215)"); // #e2ded7
    expect(styles.textTransform).toBe("none");
  }

  // 3. Verify exact 9 lanes in exact top-to-bottom order matching headers
  const expectedLaneClasses = [
    "studio-story-lane",
    "studio-shots-lane",
    "studio-pacing-lane",
    "studio-cut-density-lane",
    "studio-framing-lane",
    "studio-motion-lane",
    "studio-palette-lane",
    "studio-cast-lane",
    "studio-sound-lane"
  ];

  for (let i = 0; i < expectedLaneClasses.length; i++) {
    const lane = page.locator(`.studio-tracks-stack .studio-lane`).nth(i);
    await expect(lane).toHaveClass(new RegExp(expectedLaneClasses[i]));
  }

  // 4. Verify vertical alignment between headers and lanes
  const headerClassNames = [
    "story-header",
    "shots-header",
    "pacing-header",
    "cut-density-header",
    "framing-header",
    "motion-header",
    "palette-header",
    "cast-header",
    "sound-header"
  ];

  for (let i = 0; i < 9; i++) {
    const hBox = await page.locator(`.${headerClassNames[i]}`).boundingBox();
    const lBox = await page.locator(`.${expectedLaneClasses[i]}`).boundingBox();
    expect(hBox).not.toBeNull();
    expect(lBox).not.toBeNull();
    expect(Math.abs(hBox!.y - lBox!.y)).toBeLessThan(2);
    expect(Math.abs(hBox!.height - lBox!.height)).toBeLessThan(2);
  }

  // 5. Verify Resizing functionality
  // A. Drag Resizing on Pacing lane
  const pacingLane = page.locator(".studio-pacing-lane");
  const pacingResizer = pacingLane.locator(".studio-lane-resizer");
  await expect(pacingResizer).toBeVisible();

  const initialPacingBox = await pacingLane.boundingBox();
  expect(initialPacingBox).not.toBeNull();
  const initialHeight = initialPacingBox!.height;

  const resizerBox = await pacingResizer.boundingBox();
  expect(resizerBox).not.toBeNull();

  // Drag down by 30px
  await page.mouse.move(resizerBox!.x + 100, resizerBox!.y + resizerBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizerBox!.x + 100, resizerBox!.y + resizerBox!.height / 2 + 30);
  await page.mouse.up();

  const expandedPacingBox = await pacingLane.boundingBox();
  expect(expandedPacingBox!.height).toBeGreaterThan(initialHeight + 20);

  // Header height should match lane height after drag
  const pacingHeaderBox = await page.locator(".pacing-header").boundingBox();
  expect(Math.abs(pacingHeaderBox!.height - expandedPacingBox!.height)).toBeLessThan(2);

  // B. Double Click reset
  const expandedResizerBox = await pacingResizer.boundingBox();
  await page.mouse.dblclick(expandedResizerBox!.x + 100, expandedResizerBox!.y + expandedResizerBox!.height / 2);

  const resetPacingBox = await pacingLane.boundingBox();
  expect(Math.abs(resetPacingBox!.height - initialHeight)).toBeLessThan(3);

  // C. Keyboard Resizing (ArrowDown / ArrowUp)
  await pacingResizer.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const keyExpandedBox = await pacingLane.boundingBox();
  expect(keyExpandedBox!.height).toBeGreaterThan(initialHeight);

  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  const keyResetBox = await pacingLane.boundingBox();
  expect(Math.abs(keyResetBox!.height - initialHeight)).toBeLessThan(2);

  // 6. Verify Selected Shot Gold Outline
  await page.locator(".studio-filmstrip-shot").first().click();
  const selectedShot = page.locator(".studio-filmstrip-shot.selected");
  await expect(selectedShot).toBeVisible();
  const shotOutline = await selectedShot.evaluate((el) => window.getComputedStyle(el).outlineColor);
  expect(shotOutline).toBe("rgb(212, 163, 75)"); // #d4a34b

  // 7. Add overlapping story passages (like ORDINARY WORLD and ASDASDASD)
  const structureRailBtn = page.locator('.studio-rail-btn[aria-label="Structure"]');
  await structureRailBtn.click();
  const structureDrawer = page.locator(".studio-detail-drawer");
  await expect(structureDrawer).toBeVisible();

  const canvas = page.locator(".map-canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  // Create Passage 1 via Shift-drag range
  await page.keyboard.down("Shift");
  await page.mouse.move(canvasBox!.x + 20, canvasBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 200, canvasBox!.y + 20);
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await page.locator("input#sr-name").fill("ORDINARY WORLD");
  await page.locator("button#sr-save").click();

  // Create Passage 2 overlapping in time via Shift-drag
  await page.locator("button#sr-new").click();
  await page.locator('button[data-mode="passage"]').click();

  await page.keyboard.down("Shift");
  await page.mouse.move(canvasBox!.x + 80, canvasBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 280, canvasBox!.y + 20);
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await page.locator("input#sr-name").fill("ASDASDASD");
  await page.locator("button#sr-save").click();

  await page.keyboard.press("Escape");
  await expect(structureDrawer).toBeHidden();

  // Verify Story lane and header heights automatically accommodated both subrows
  const storyHeaderBox = await page.locator(".story-header").boundingBox();
  const storyLaneBox = await page.locator(".studio-story-lane").boundingBox();
  const shotsLaneBox = await page.locator(".studio-shots-lane").boundingBox();
  expect(storyHeaderBox).not.toBeNull();
  expect(storyLaneBox).not.toBeNull();
  expect(shotsLaneBox).not.toBeNull();

  // Story header and lane must be identical in height and aligned
  expect(Math.abs(storyHeaderBox!.height - storyLaneBox!.height)).toBeLessThan(2);
  expect(Math.abs(storyHeaderBox!.y - storyLaneBox!.y)).toBeLessThan(2);

  // Shots lane must start strictly at or below the bottom of the Story lane (NO OVERLAP)
  expect(shotsLaneBox!.y).toBeGreaterThanOrEqual(storyLaneBox!.y + storyLaneBox!.height - 1);

  // Verify all story passages are strictly contained within Story lane bounds
  const passages = page.locator(".studio-story-lane .story-lane-passage");
  const pCount = await passages.count();
  expect(pCount).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < pCount; i++) {
    const pBox = await passages.nth(i).boundingBox();
    expect(pBox).not.toBeNull();
    expect(pBox!.y).toBeGreaterThanOrEqual(storyLaneBox!.y);
    expect(pBox!.y + pBox!.height).toBeLessThanOrEqual(storyLaneBox!.y + storyLaneBox!.height + 2);
  }

  // 8. Add cast members (Anna, Paul, Mara) to test cast swimlanes and header brackets
  const expandPanelBtn = page.getByRole("button", { name: "Expand panel" });
  if (await expandPanelBtn.isVisible()) {
    await expandPanelBtn.click();
  }
  const castRailBtn = page.locator('.studio-rail-btn[aria-label="Cast"]');
  await castRailBtn.click();
  const drawer = page.locator(".studio-detail-drawer");
  await expect(drawer).toBeVisible();

  const addBtn = page.locator('.cast-roster-footer .roster-add-btn');
  if (await addBtn.isVisible()) {
    await addBtn.click();
    await page.locator('.roster-add-input').fill("Anna");
    await page.locator('.roster-add-input').press("Enter");

    await page.waitForTimeout(300);
    const addBtn2 = page.locator('.cast-roster-footer .roster-add-btn');
    if (await addBtn2.isVisible()) {
      await addBtn2.click();
      await page.locator('.roster-add-input').fill("Paul");
      await page.locator('.roster-add-input').press("Enter");
    }

    await page.waitForTimeout(300);
    const addBtn3 = page.locator('.cast-roster-footer .roster-add-btn');
    if (await addBtn3.isVisible()) {
      await addBtn3.click();
      await page.locator('.roster-add-input').fill("Mara");
      await page.locator('.roster-add-input').press("Enter");
    }
  }

  const cards = page.locator(".cast-roster-card");
  await expect(cards).toHaveCount(3);

  // Close drawer
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // Verify Cast header now has subrow bracket with Anna, Paul, Mara
  const castHeader = page.locator(".cast-header");
  const castSubrows = castHeader.locator(".studio-subrow-label");
  await expect(castSubrows).toHaveCount(3);
  await expect(castSubrows.nth(0)).toHaveText("Anna");
  await expect(castSubrows.nth(1)).toHaveText("Paul");
  await expect(castSubrows.nth(2)).toHaveText("Mara");

  // 9. Capture Full Timeline Screenshot in Studio Mode
  await page.locator(".studio-timeline-workbench").screenshot({
    path: "tests/browser/screenshots/studio-workbench-default.png",
  });

  // Expand map to see the entire workstation with all 8 lanes visible
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(page.locator(".workspace")).toHaveClass(/studio-map-expanded/);

  await page.locator(".studio-timeline-workbench").screenshot({
    path: "tests/browser/screenshots/studio-workbench-expanded.png",
  });

  await page.screenshot({
    path: "tests/browser/screenshots/studio-munari-applied-timeline.png",
    fullPage: true,
  });

  expect(errors).toEqual([]);
});
