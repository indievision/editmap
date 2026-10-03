import { test, expect } from "@playwright/test";
import path from "node:path";
import { startNewProject } from "../helpers";

test("Timeline story track: moment drag, passage extend in/out, keyboard delete, and clean playhead aesthetics", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 1. Setup new project with fixture video and EDL
  await startNewProject(page);
  await page.getByLabel("Project name").fill("Timeline Interactions Test");

  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));

  await page
    .locator("input[accept*=\".edl\"]")
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);

  // 2. Verify clean playhead aesthetics (no snap guide line, no cut lines, no aiding lines)
  const snapLine = page.locator(".snap-guide-line");
  await expect(snapLine).toHaveCount(0);

  const cutLines = page.locator(".studio-cut-line");
  await expect(cutLines).toHaveCount(0);

  const cutIndicatorLines = page.locator(".cut-indicator-line");
  await expect(cutIndicatorLines).toHaveCount(0);

  // Verify playhead has no blue focus ring outline / guides when focused
  const playhead = page.locator(".playhead");
  await playhead.focus();
  await expect(playhead).toHaveCSS("outline-style", "none");

  // 3. Open Sequence Reading drawer
  const structureRailBtn = page.locator(".studio-rail-btn[aria-label=\"Structure\"]");
  await structureRailBtn.click();
  const drawer = page.locator(".studio-detail-drawer");
  await expect(drawer).toBeVisible();

  // Click Passage mode button
  const passageBtn = page.locator("button[data-mode=\"passage\"]");
  await passageBtn.click();

  // Create a Passage: In=00:00:01:00, Out=00:00:03:00
  const inInput = page.locator("input#sr-in-tc");
  const outInput = page.locator("input#sr-out-tc");
  await inInput.fill("00:00:01:00");
  await inInput.dispatchEvent("change");
  await outInput.fill("00:00:03:00");
  await outInput.dispatchEvent("change");

  const nameInput = page.locator("input#sr-name");
  await nameInput.fill("Test Passage");

  const saveBtn = page.locator("button#sr-save");
  await saveBtn.click();

  // Create a Moment: At=00:00:05:00
  const newEntryBtn = page.locator("button#sr-new");
  await newEntryBtn.click();
  const momentBtn = page.locator("button[data-mode=\"moment\"]");
  await momentBtn.click();

  const atInput = page.locator("input#sr-at-tc");
  await atInput.fill("00:00:05:00");
  await atInput.dispatchEvent("change");
  await nameInput.fill("Test Moment");
  await saveBtn.click();

  const storyLane = page.locator(".studio-story-lane");
  const timelineMoment = storyLane.locator(".story-lane-moment");
  const timelinePassage = storyLane.locator(".story-lane-passage");

  await expect(timelineMoment).toHaveCount(1);
  await expect(timelinePassage).toHaveCount(1);

  // 4. Test Moment dragging
  const initialMomentBox = await timelineMoment.boundingBox();
  expect(initialMomentBox).not.toBeNull();

  // Drag moment 60px to the right
  await page.mouse.move(initialMomentBox!.x + initialMomentBox!.width / 2, initialMomentBox!.y + initialMomentBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(initialMomentBox!.x + initialMomentBox!.width / 2 + 60, initialMomentBox!.y + initialMomentBox!.height / 2, { steps: 5 });
  await page.mouse.up();

  // The drawer should reflect the updated moment time
  await expect(timelineMoment).toHaveClass(/selected/);
  const newAtValue = await atInput.inputValue();
  expect(newAtValue).not.toBe("00:00:05:00");

  // 5. Test Passage handle dragging (Out handle)
  const handleOut = timelinePassage.locator(".story-passage-handle.handle-out");
  await expect(handleOut).toBeVisible();
  const outBox = await handleOut.boundingBox();
  expect(outBox).not.toBeNull();

  // Drag handle-out 50px to the right
  await page.mouse.move(outBox!.x + outBox!.width / 2, outBox!.y + outBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(outBox!.x + outBox!.width / 2 + 50, outBox!.y + outBox!.height / 2, { steps: 5 });
  await page.mouse.up();

  // The drawer should reflect the extended passage Out time
  await timelinePassage.click();
  await expect(saveBtn).toHaveText("Save changes");
  const newOutValue = await outInput.inputValue();
  expect(newOutValue).not.toBe("00:00:03:00");

  // 6. Test Backspace / Delete keyboard shortcut on selected moment
  await timelineMoment.click();
  await expect(timelineMoment).toHaveClass(/selected/);
  await page.keyboard.press("Backspace");
  await expect(timelineMoment).toHaveCount(0);

  // 7. Test Delete keyboard shortcut on selected passage
  await timelinePassage.click();
  await expect(timelinePassage).toHaveClass(/selected/);
  await page.keyboard.press("Delete");
  await expect(timelinePassage).toHaveCount(0);

  expect(errors).toEqual([]);
});
