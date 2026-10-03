import { test, expect } from "@playwright/test";
import path from "node:path";
import { startNewProject } from "./helpers";

test.fixme("Studio Sequence Reading drawer: story beats, moments, passages, rhythm evidence, and persistence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 1. Setup new project with fixture video and EDL
  await startNewProject(page);
  await page.getByLabel("Project name").fill("Sequence Reading Verification");

  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));

  await page
    .locator("input[accept*=\".edl\"]")
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);

  // 2. Open Sequence Reading drawer via Structure rail button
  const structureRailBtn = page.locator(".studio-rail-btn[aria-label=\"Structure\"]");
  await structureRailBtn.click();

  const drawer = page.locator(".studio-detail-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveClass(/drawer-open/);

  // 3. Verify Header hierarchy & typography
  const kicker = page.locator(".sr-kicker");
  await expect(kicker).toHaveCount(0);

  const title = page.locator(".sr-title");
  await expect(title).toBeVisible();
  await expect(title).toHaveText("Sequence reading");

  const subtitle = page.locator(".sr-muted");
  await expect(subtitle).toBeVisible();
  await expect(subtitle).toHaveText("Your interpretation, anchored in time.");

  // 4. Test close via "X" button and keyboard Escape
  const closeBtn = page.locator(".sequence-drawer-close-btn");
  await closeBtn.click();
  await expect(drawer).not.toBeVisible();

  const restorePanelBtn = page.locator(".resize-handle-left .resize-collapse-btn");
  await restorePanelBtn.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();

  // Re-open drawer
  await restorePanelBtn.click();
  await expect(drawer).toBeVisible();

  // 5. Moment creation WITHOUT a selected range
  const momentBtn = page.locator("button[data-mode=\"moment\"]");
  const passageBtn = page.locator("button[data-mode=\"passage\"]");
  await expect(momentBtn).toHaveAttribute("aria-pressed", "true");

  // In Moment mode, verify rhythm evidence is hidden
  await expect(page.locator("details#sr-details")).toHaveCount(0);

  // Verify structure vocabulary selector and switch to Syd Field
  const vocabSelect = page.locator("select#sr-vocab");
  await expect(vocabSelect).toBeVisible();
  await expect(vocabSelect).toHaveValue("freeform");
  await vocabSelect.selectOption("syd-field");
  await page.locator(".sr-vocab-info-btn").click();
  await expect(page.locator(".sr-vocab-desc")).toContainText("three-act paradigm");
  await page.locator(".sr-vocab-info-btn").click();

  // Verify playhead anchor time is visible in editable AT timecode input
  const atInput = page.locator("input#sr-at-tc");
  await expect(atInput).toBeVisible();
  const initialTimeText = await atInput.inputValue();
  expect(initialTimeText).toBeTruthy();

  // Story beat select options
  const beatSelect = page.locator("select#sr-type");
  await expect(beatSelect).toBeVisible();
  await beatSelect.selectOption("Plot point 1");

  // Name field
  const nameInput = page.locator("input#sr-name");
  await expect(nameInput).toBeVisible();
  await nameInput.fill("The call that changes everything");

  // Notes textarea
  const notesTextarea = page.locator("textarea#sr-note");
  await expect(notesTextarea).toBeVisible();
  await notesTextarea.fill("She chooses to go, despite the warning.");

  // Save moment
  const saveBtn = page.locator("button#sr-save");
  await expect(saveBtn).toHaveText("Save moment");
  await saveBtn.click();

  // 6. Verify entry in "Your story map" list
  const listItems = page.locator(".sr-item-row");
  await expect(listItems).toHaveCount(1);
  const firstItem = listItems.first();
  await expect(firstItem.locator(".sr-mark")).toHaveText("◇");
  await expect(firstItem.locator(".sr-item-type")).toHaveText("Plot point 1");
  await expect(firstItem.locator(".sr-item-name")).toHaveText("The call that changes everything");

  // Also verify moment diamond appears on the Studio timeline Story lane
  const storyLane = page.locator(".studio-story-lane");
  await expect(storyLane).toBeVisible();
  const timelineMoment = storyLane.locator(".story-lane-moment");
  await expect(timelineMoment).toHaveCount(1);
  await expect(timelineMoment.locator(".story-moment-diamond")).toBeVisible();

  // 7. Passage creation mode with explicit In / Out & I/O keyboard shortcuts
  const newEntryBtn = page.locator("button#sr-new");
  await newEntryBtn.click();
  await passageBtn.click();
  await expect(passageBtn).toHaveAttribute("aria-pressed", "true");

  const inInput = page.locator("input#sr-in-tc");
  const outInput = page.locator("input#sr-out-tc");
  await expect(inInput).toBeVisible();
  await expect(outInput).toBeVisible();

  // Close drawer to test I and O keyboard shortcuts in Studio mode
  await closeBtn.click();
  await expect(drawer).not.toBeVisible();

  // Seek to 1s and press 'I' to mark In
  await page.keyboard.press("i");
  // Pressing 'I' marks In and opens Sequence Reading drawer
  await expect(drawer).toBeVisible();
  await expect(inInput).toHaveValue(/00:00:0/);

  // Close drawer again, seek forward, and press 'O' to mark Out
  await closeBtn.click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("o");
  await expect(drawer).toBeVisible();
  await expect(outInput).toHaveValue(/00:00:0/);

  // 8. Select passage on the editing map via Shift-Drag
  const canvas = page.locator(".map-canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  await page.keyboard.down("Shift");
  await page.mouse.move(canvasBox!.x + 100, canvasBox!.y + 60);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 350, canvasBox!.y + 60);
  await page.mouse.up();
  await page.keyboard.up("Shift");

  // Anchor inputs update with range and duration, save button enabled
  await expect(saveBtn).not.toBeDisabled();
  await expect(saveBtn).toHaveText("Save passage");

  // 9. Inspect Rhythm Evidence Disclosure
  const details = page.locator("details#sr-details");
  await expect(details).toBeVisible();
  await details.locator("summary").click(); // open disclosure
  const evidence = page.locator(".sr-evidence");
  await expect(evidence).toBeVisible();
  await expect(evidence).toContainText("shots");
  await expect(evidence).toContainText("hard cuts");
  await expect(evidence).toContainText("Across cuts");
  await page.locator(".sr-content").evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: "tests/browser/studio-structure-drawer-passage.png", fullPage: true });

  // 10. Custom Story Beat label
  await beatSelect.selectOption("Custom…");
  const customInput = page.locator("input#sr-custom");
  await expect(customInput).toBeVisible();
  await customInput.fill("A quiet departure");

  await nameInput.fill("Leaving home");
  await notesTextarea.fill("The journey begins.");
  await saveBtn.click();

  // Now "Your story map" has 2 entries
  await expect(listItems).toHaveCount(2);

  // Verify passage bracket appears in the timeline Story lane
  const timelinePassage = storyLane.locator(".story-lane-passage");
  await expect(timelinePassage).toHaveCount(1);
  await expect(timelinePassage.locator(".story-passage-body")).toBeVisible();

  // 11. Reopen and edit saved moment
  await listItems.first().locator(".sr-item").click();
  await expect(saveBtn).toHaveText("Save changes");
  await expect(nameInput).toHaveValue("The call that changes everything");
  await expect(beatSelect).toHaveValue("Plot point 1");

  await nameInput.fill("The fateful call");
  await saveBtn.click();

  await expect(listItems.first().locator(".sr-item-name")).toHaveText("The fateful call");

  // 12. Reopen and edit saved passage
  await listItems.nth(1).locator(".sr-item").click();
  await expect(saveBtn).toHaveText("Save changes");
  await expect(nameInput).toHaveValue("Leaving home");
  await expect(beatSelect).toHaveValue("A quiet departure");

  // 13. Test Playback does not move anchor
  const capturedAnchorText = await inInput.inputValue();
  await page.keyboard.press("Space"); // Start playing
  await page.waitForTimeout(400);
  await page.keyboard.press("Space"); // Pause
  const afterPlayAnchorText = await inInput.inputValue();
  expect(afterPlayAnchorText).toBe(capturedAnchorText);

  // 14. Delete saved entry via delete button
  const deleteBtn = listItems.nth(1).locator(".sr-item-delete-btn");
  page.once("dialog", (dialog) => dialog.accept());
  await deleteBtn.click();
  await expect(listItems).toHaveCount(1);

  // 15. Reload page and verify persistence in IndexedDB
  await page.locator(".primary-save").click();
  await expect(page.getByText("Project saved on this browser.")).toBeVisible();
  await page.reload();
  await page.locator(".recent-item").filter({ hasText: /Sequence Reading Verification/i }).click();
  await expect(page.locator(".shot")).toHaveCount(3);
  await page.locator('.studio-rail-btn[aria-label="Structure"]').click();
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".sr-item-row")).toHaveCount(1);
  await expect(drawer.locator(".sr-item-name")).toHaveText("The fateful call");

  // Click on the item to load into form and take screenshot
  await drawer.locator(".sr-item").first().click();
  await page.screenshot({ path: "tests/browser/studio-structure-drawer.png", fullPage: true });

  expect(errors).toEqual([]);
});

test("Studio Story lane and Custom Labels manager: vocabulary switching, custom label reorder/delete, timeline drag and selection", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // Setup project
  await startNewProject(page);
  await page.getByLabel("Project name").fill("Story Lane & Custom Labels Test");

  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));

  await page
    .locator("input[accept*=\".edl\"]")
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);

  const structureRailBtn = page.locator(".studio-rail-btn[aria-label=\"Structure\"]");
  await structureRailBtn.click();
  const drawer = page.locator(".studio-detail-drawer");
  await expect(drawer).toBeVisible();

  // 1. Test Custom Labels Manager
  const manageLabelsBtn = page.locator(".sr-manage-labels-toggle");
  await expect(manageLabelsBtn).toBeVisible();
  await manageLabelsBtn.click();

  const customManager = page.locator(".sr-custom-manager");
  await expect(customManager).toBeVisible();

  // Add custom label "Inciting Flash"
  const addInput = page.locator(".sr-manager-add-input");
  const addBtn = page.locator(".sr-manager-add-btn");
  await addInput.fill("Inciting Flash");
  await addBtn.click();

  // Add custom label "False Resolution"
  await addInput.fill("False Resolution");
  await addBtn.click();

  const managerItems = page.locator(".sr-manager-item");
  await expect(managerItems).toHaveCount(2);
  await expect(managerItems.first()).toContainText("Inciting Flash");
  await expect(managerItems.nth(1)).toContainText("False Resolution");

  // Verify dropdown contains both custom labels
  const beatSelect = page.locator("select#sr-type");
  const options = await beatSelect.locator("option").allTextContents();
  expect(options).toContain("Inciting Flash");
  expect(options).toContain("False Resolution");

  // 2. Test Partial In / Out marking and clearing
  const passageBtn = page.locator("button[data-mode=\"passage\"]");
  await passageBtn.click();

  const inInput = page.locator("input#sr-in-tc");
  const outInput = page.locator("input#sr-out-tc");
  const clearBtn = page.locator(".sr-clear-io-btn");

  // Click Clear In / Out
  await clearBtn.click();
  await expect(inInput).toHaveValue("");
  await expect(outInput).toHaveValue("");

  // Test set In at playhead
  const setInBtn = page.locator("button:has-text(\"Set In\")");
  await setInBtn.click();
  await expect(inInput).not.toHaveValue("");
  await expect(outInput).toHaveValue("");

  // Check timeline Story lane shows In flag
  const storyLane = page.locator(".studio-story-lane");
  await expect(storyLane).toBeVisible();
  await expect(storyLane.locator(".story-in-flag")).toBeVisible();

  // Now set Out at playhead after seeking
  const setOutBtn = page.locator("button:has-text(\"Set Out\")");
  await outInput.fill("00:00:03:00");
  await outInput.dispatchEvent("change");

  // Name and save passage
  const nameInput = page.locator("input#sr-name");
  await nameInput.fill("Opening Movement");
  await beatSelect.selectOption("Inciting Flash");

  const saveBtn = page.locator("button#sr-save");
  await saveBtn.click();

  // 3. Save a Moment
  const newEntryBtn = page.locator("button#sr-new");
  await newEntryBtn.click();

  const momentBtn = page.locator("button[data-mode=\"moment\"]");
  await momentBtn.click();

  const atInput = page.locator("input#sr-at-tc");
  await atInput.fill("00:00:01:12");
  await atInput.dispatchEvent("change");
  await nameInput.fill("Key Revelation");
  await beatSelect.selectOption("False Resolution");
  await saveBtn.click();

  // 4. Verify Timeline Story Lane Elements
  const timelineMoment = storyLane.locator(".story-lane-moment");
  const timelinePassage = storyLane.locator(".story-lane-passage");

  await expect(timelineMoment).toHaveCount(1);
  await expect(timelinePassage).toHaveCount(1);

  // Covered shots have highlight accent
  const coveredShots = page.locator(".studio-filmstrip-shot.shot-in-story-range");
  expect(await coveredShots.count()).toBeGreaterThanOrEqual(1);

  // 5. Click on timeline moment selects it and updates drawer
  await timelineMoment.click();
  await expect(timelineMoment).toHaveClass(/selected/);
  await expect(saveBtn).toHaveText("Save changes");
  await expect(nameInput).toHaveValue("Key Revelation");
  await expect(beatSelect).toHaveValue("False Resolution");

  // Click on timeline passage selects it and updates drawer
  await timelinePassage.click();
  await expect(timelinePassage).toHaveClass(/selected/);
  await expect(saveBtn).toHaveText("Save changes");
  await expect(nameInput).toHaveValue("Opening Movement");
  await expect(beatSelect).toHaveValue("Inciting Flash");

  expect(errors).toEqual([]);
});

