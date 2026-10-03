import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

test.describe("DUET Review Screen Mockup Implementation", () => {
  test("Desktop 1600x900 & 1440x900: focal video, Pencil, waveform, cue avatars, distilled cue sheet, transport, and Studio handoff", async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // 1. Start with 1600x900 viewport (mockup native size)
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/");

    const iframe = page.frameLocator("iframe");

    // Choose popcorn avatar 🍿 on first page
    const tokenBtns = iframe.locator(".token-btn");
    await expect(tokenBtns).toHaveCount(20);
    const popcornBtn = tokenBtns.nth(3);
    await popcornBtn.click();
    await expect(popcornBtn).toHaveClass(/selected/);

    // Load test video file
    const fileInput = iframe.locator("input[type=file]#videoFileInput");
    await fileInput.setInputFiles(path.resolve("fixtures/test-film.mp4"));
    await expect(iframe.locator("#fileNameLabel")).toContainText("test-film");

    // Enter screening room
    const enterBtn = iframe.locator("#btnEnterRoom");
    await enterBtn.click();
    await expect(iframe.locator("#onboardingScreen")).toBeHidden();

    // Verify Dark Screening is active initially, drop some reaction markers (1=Red, 2=Yellow, 3=Green)
    await page.waitForTimeout(300);
    await iframe.locator("#darkKeyBox1").click(); // Red cue at 0s
    await page.waitForTimeout(200);

    // Seek to 2.5s and drop yellow cue
    await iframe.locator("#mainVideoPlayer").evaluate((v: HTMLVideoElement) => { v.currentTime = 2.5; });
    await iframe.locator("#darkKeyBox2").click();
    await page.waitForTimeout(200);

    // Seek to 5.0s and drop green cue
    await iframe.locator("#mainVideoPlayer").evaluate((v: HTMLVideoElement) => { v.currentTime = 5.0; });
    await iframe.locator("#darkKeyBox3").click();
    await page.waitForTimeout(200);

    // Switch to Review Mode
    const navBtnReview = page.locator(".mode-tab:has-text('Review')");
    await navBtnReview.click();
    await expect(iframe.locator("#reviewWorkspace")).toBeVisible();

    // ========================================================
    // REQUIREMENT 1: Video focal point & remove HUDs over video
    // ========================================================
    const video = iframe.locator("#mainVideoPlayer");
    await expect(video).toBeVisible();
    await expect(iframe.locator("#activeCueHud")).toHaveCount(0);
    await expect(iframe.locator("#smpteDisplay")).toHaveCount(0);

    // Timecode is beside the timeline
    const curTc = iframe.locator("#currentTimecodeLabel");
    const durTc = iframe.locator("#durationTimecodeLabel");
    await expect(curTc).toBeVisible();
    await expect(durTc).toBeVisible();

    // ========================================================
    // REQUIREMENT 2: Pencil rail under the picture
    // ========================================================
    const pencilToolbar = iframe.locator("#pencilToolbar");
    await expect(pencilToolbar).toBeVisible();

    // The rail sits between the picture and the timeline, never over the video
    const pictureBox = (await iframe.locator("#cinemaViewer").boundingBox())!;
    const railBox = (await pencilToolbar.boundingBox())!;
    const timelineBox = (await iframe.locator("#pulsePanel").boundingBox())!;
    expect(railBox.y).toBeGreaterThanOrEqual(pictureBox.y + pictureBox.height - 1);
    expect(railBox.y + railBox.height).toBeLessThanOrEqual(timelineBox.y + 1);
    expect(await pencilToolbar.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe("none");

    // Pencil is a real mode and starts off
    const pencilBtn = iframe.locator("#btnPencil");
    await expect(pencilBtn).toHaveAttribute("aria-pressed", "false");
    await expect(iframe.locator("#btnUndoDraw")).toBeDisabled();
    await expect(iframe.locator("#btnClearDraw")).toBeDisabled();

    // 4 color swatches, amber selected by default
    const swatches = pencilToolbar.locator(".swatch");
    await expect(swatches).toHaveCount(4);
    const amberSwatch = pencilToolbar.locator(".swatch[data-color='#f3bb40']");
    await expect(amberSwatch).toHaveClass(/sel/);
    const greenSwatch = pencilToolbar.locator(".swatch[data-color='#39c99d']");
    await greenSwatch.click();
    await expect(greenSwatch).toHaveClass(/sel/);
    await expect(amberSwatch).not.toHaveClass(/sel/);
    const roseSwatch = pencilToolbar.locator(".swatch[data-color='#ef5266']");
    await roseSwatch.click();
    await expect(roseSwatch).toHaveClass(/sel/);

    // Drawing: nothing while off, a stroke while on, Undo and Clear follow the strokes
    const drag = async () => {
      const box = (await iframe.locator("#waxCanvas").boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45, { steps: 6 });
      await page.mouse.up();
    };
    const strokeCount = () => iframe.locator("#mainVideoPlayer").evaluate("strokes.length") as Promise<number>;
    await iframe.locator("#mainVideoPlayer").evaluate((v: HTMLVideoElement) => v.pause());
    await drag();
    expect(await strokeCount()).toBe(0);

    await pencilBtn.click();
    await expect(pencilBtn).toHaveAttribute("aria-pressed", "true");
    await drag();
    await expect.poll(strokeCount).toBe(1);
    await expect(iframe.locator("#btnUndoDraw")).toBeEnabled();
    await expect(iframe.locator("#btnClearDraw")).toBeEnabled();
    await iframe.locator("#btnUndoDraw").click();
    await expect.poll(strokeCount).toBe(0);
    await expect(iframe.locator("#btnUndoDraw")).toBeDisabled();

    await drag();
    await expect.poll(strokeCount).toBe(1);
    // Moving a frame ends the discussion: the drawing goes
    await page.keyboard.press("ArrowRight");
    await expect.poll(strokeCount).toBe(0);
    await drag();
    await expect.poll(strokeCount).toBe(1);
    await iframe.locator("#btnClearDraw").click();
    await expect.poll(strokeCount).toBe(0);

    // Keyboard: focus ring is visible and Enter toggles
    await pencilBtn.focus();
    await page.keyboard.press("Enter");
    await expect(pencilBtn).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Tab");
    expect(await iframe.locator("#btnPencil").evaluate(() => document.activeElement?.matches(":focus-visible"))).toBe(true);

    // ========================================================
    // REQUIREMENT 3 & 4: Waveform visible, no toggle button / W
    // ========================================================
    // No "Rhythm & reaction" heading or "Waveform and heatmap visible" text
    await expect(iframe.locator("text=Rhythm & Reaction Timeline")).toHaveCount(0);
    await expect(iframe.locator("text=Waveform and heatmap visible")).toHaveCount(0);

    // Waveform canvas is rendered
    const waveCanvas = iframe.locator("#waveformCanvas");
    await expect(waveCanvas).toBeVisible();

    // "Waveform On" button is removed
    await expect(iframe.locator("#btnWaveformToggle")).toHaveCount(0);

    // Scrubber track & playhead needle exist
    const needle = iframe.locator("#timelineNeedle");
    await expect(needle).toBeVisible();

    // ========================================================
    // REQUIREMENT 5: Cue avatars from saved authorAvatar (🍿)
    // ========================================================
    const avatarTokens = iframe.locator("#avatarTokensLayer .avatar-token");
    const tokenCount = await avatarTokens.count();
    expect(tokenCount).toBeGreaterThanOrEqual(2);

    // Verify avatar emoji matches chosen 🍿 token
    const firstToken = avatarTokens.first();
    await expect(firstToken.locator(".avatar-emoji")).toHaveText("🍿");

    // Click second cue token to select it
    const secondToken = avatarTokens.nth(1);
    await secondToken.click();
    await expect(secondToken).toHaveClass(/scale-115/);

    // ========================================================
    // REQUIREMENT 6: Remove lower Inspect in Studio, keep header
    // ========================================================
    // Transport strip has NO lower inspect in studio button
    await expect(iframe.locator(".transport button:has-text('Inspect in Studio')")).toHaveCount(0);
    await expect(iframe.locator("#reviewWorkspace .transport button:has-text('Studio')")).toHaveCount(0);

    // EDITMAP Header has the working Studio action
    const headerStudioBtn = page.locator(".mode-tab:has-text('Studio')");
    await expect(headerStudioBtn).toBeVisible();

    // ========================================================
    // REQUIREMENT 7: Distilled Editorial Cue Sheet
    // ========================================================
    const cueSheet = iframe.locator("#rightCuePanel");
    await expect(cueSheet).toBeVisible();
    await expect(cueSheet.locator("h2")).toHaveText("Editorial cue sheet");
    await expect(cueSheet.locator("p").first()).toHaveText("Select a cue to jump to its frame.");

    // Cue rows exist with timecode, author avatar, Resolve color
    const cueCards = iframe.locator("#cueCardsFeed .cue-item");
    const cueCount = await cueCards.count();
    expect(cueCount).toBeGreaterThanOrEqual(2);

    const firstCard = cueCards.first();
    await expect(firstCard.locator(".cue-head strong")).toBeVisible();
    await expect(firstCard.locator(".cue-meta .tiny-avatar")).toHaveText("🍿");
    await expect(firstCard.locator(".cue-meta b")).toContainText("Resolve ·");

    // Note editing in existing cue
    const noteArea = firstCard.locator("textarea.cue-note-area");
    await noteArea.fill("Review note: check cut rhythm");
    await noteArea.dispatchEvent("change");

    // Add new note via bottom input
    const discussionInput = iframe.locator("#discussionInput");
    await discussionInput.fill("New beat idea at current frame");
    const addNoteBtn = iframe.locator("button:has-text('Add note')");
    await addNoteBtn.click();

    // Verify cue count increased
    await expect(iframe.locator("#cueCountBadge")).toHaveText(String(cueCount + 1));

    // ========================================================
    // Playback transport: icon-only, no frame buttons, no Audio Scrub
    // ========================================================
    const playBtn = iframe.locator("#btnPlayPause");
    await expect(playBtn).toBeVisible();
    await expect(playBtn).toHaveAttribute("aria-label", "Play");
    await expect(iframe.locator("[aria-label='Previous cue']")).toBeVisible();
    await expect(iframe.locator("[aria-label='Next cue']")).toBeVisible();
    await expect(iframe.locator("button:has-text('+1 Frame')")).toHaveCount(0);
    await expect(iframe.locator("button:has-text('-1 Frame')")).toHaveCount(0);
    await expect(iframe.locator("#btnAudioScrub")).toHaveCount(0);
    await expect(iframe.locator("text=Audio Scrub")).toHaveCount(0);
    await playBtn.click();
    await expect(playBtn).toHaveAttribute("aria-label", "Pause");
    await page.waitForTimeout(400);
    await playBtn.click();
    await expect(playBtn).toHaveAttribute("aria-label", "Play");

    // Left/Right still step a frame from the keyboard
    const timeNow = () => iframe.locator("#mainVideoPlayer").evaluate((v: HTMLVideoElement) => v.currentTime);
    const t0 = await timeNow();
    await page.keyboard.press("ArrowRight");
    await expect.poll(timeNow).toBeGreaterThan(t0);

    // Projector button in EDITMAP header
    const projectorBtn = page.locator(".header-projector-btn");
    await expect(projectorBtn).toBeVisible();

    // Export .EDL button in EDITMAP File menu
    await page.locator(".file-trigger-btn").click();
    const exportEdlBtn = page.locator(".dropdown-menu button:has-text('Export .EDL')");
    await expect(exportEdlBtn).toBeVisible();
    await page.keyboard.press("Escape");

    // Take 1600x900 Screenshot
    const screenshotsDir = path.resolve("tests/browser/screenshots");
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    await page.screenshot({ path: path.join(screenshotsDir, "duet-review-1600x900.png"), fullPage: true });

    // ========================================================
    // Viewport: 1440x900
    // ========================================================
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);
    await expect(iframe.locator("#reviewWorkspace")).toBeVisible();
    await expect(video).toBeVisible();
    await expect(cueSheet).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, "duet-review-1440x900.png"), fullPage: true });

    // ========================================================
    // Viewport: Narrower (1024x768)
    // ========================================================
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(200);
    await expect(iframe.locator("#reviewWorkspace")).toBeVisible();
    await expect(iframe.locator("#pencilToolbar")).toBeVisible();
    await expect(cueSheet).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, "duet-review-narrow.png"), fullPage: true });

    // Return to 1440x900 for Studio handoff test
    await page.setViewportSize({ width: 1440, height: 900 });

    // ========================================================
    // Studio handoff test
    // ========================================================
    await headerStudioBtn.click();
    // Verify EDITMAP transitioned to Studio workspace
    await expect(page.locator(".mode-tab.active")).toHaveText("Studio");
  });
});
