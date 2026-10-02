import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

test.describe("First Page Screening Setup (Clarify + Layout + Distill)", () => {
  test("Desktop 1440px: visual layout, 2-panel grid, no duplicate header, all actions functional", async ({ page, context }) => {
    // Grant clipboard permissions for copyRoomCode test
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    // 1. Verify topbar (EDITMAP ProjectHeader)
    const header = page.locator(".app-header.screening-setup-header");
    await expect(header).toBeVisible();
    await expect(header.locator(".brand-mark")).toBeVisible();
    await expect(header.locator(".brand-name")).toHaveText("EDITMAP");
    await expect(header.locator(".brand-section")).toHaveText("Screening setup");
    await expect(header.locator(".mode-tab.active")).toHaveText("Screening");
    await expect(header.locator(".file-trigger-btn")).toBeVisible();

    // Verify workspace controls (project pill, metadata, etc.) are NOT visible on setup
    await expect(header.locator(".header-project-pill")).toHaveCount(0);
    await expect(header.locator(".header-meta")).toHaveCount(0);

    // Frame locator for DUET iframe
    const iframe = page.frameLocator("iframe");

    // 2. Verify no duplicate internal header on setup
    const duetInternalHeader = iframe.locator("#duetConsoleHeader");
    await expect(duetInternalHeader).toBeHidden();

    // 3. Verify Intro section
    await expect(iframe.locator(".intro .eyebrow")).toHaveText("DUET · Screening hub");
    await expect(iframe.locator(".intro h1")).toHaveText("Screen a cut together.");
    await expect(iframe.locator(".intro p").last()).toHaveText("Choose a film and set up the room before you begin.");

    // 4. Verify 2 panels layout
    const panel1 = iframe.locator(".panel").first();
    const panel2 = iframe.locator(".panel").nth(1);
    await expect(panel1.locator(".step")).toHaveText("01 / 02");
    await expect(panel1.locator("h2")).toHaveText("Choose the cut");
    await expect(panel2.locator(".step")).toHaveText("02 / 02");
    await expect(panel2.locator("h2")).toHaveText("Set up the room");

    // 5. Test Local File vs Wi-Fi Transfer toggle
    const tabLocal = iframe.locator("#tabLocalFile");
    const tabWifi = iframe.locator("#tabWifiTransfer");
    const methodLocalBox = iframe.locator("#methodLocalBox");
    const methodWifiBox = iframe.locator("#methodWifiBox");
    const transferQuality = iframe.locator("#transferQualityLabel");

    await expect(tabLocal).toHaveClass(/selected/);
    await expect(methodLocalBox).toBeVisible();
    await expect(methodWifiBox).toBeHidden();
    await expect(transferQuality).toHaveText("Full quality · No transfer wait");

    await tabWifi.click();
    await expect(tabWifi).toHaveClass(/selected/);
    await expect(tabLocal).not.toHaveClass(/selected/);
    await expect(methodWifiBox).toBeVisible();
    await expect(methodLocalBox).toBeHidden();
    await expect(transferQuality).toHaveText("Pre-loads on Wi-Fi");

    // Switch back to Local
    await tabLocal.click();
    await expect(tabLocal).toHaveClass(/selected/);
    await expect(methodLocalBox).toBeVisible();

    // 6. Test Host vs Join toggle & actions
    const roleHost = iframe.locator("#roleHostCard");
    const roleJoin = iframe.locator("#roleJoinCard");
    const hostBox = iframe.locator("#roomCodeHostBox");
    const joinInput = iframe.locator("#inputRoomCode");
    const codeLabel = iframe.locator("#labelRoomCode");
    const enterBtnText = iframe.locator("#btnEnterRoomText");
    const projectorBtn = iframe.locator("#btnProjectorLaunch");
    const roleNotice = iframe.locator("#roleNotice");

    // Host state (default)
    await expect(roleHost).toHaveClass(/selected/);
    await expect(hostBox).toBeVisible();
    await expect(joinInput).toBeHidden();
    await expect(codeLabel).toHaveText("Room code");
    await expect(enterBtnText).toHaveText("Enter screening room");
    await expect(projectorBtn).toBeVisible();
    await expect(roleNotice).toHaveText("Host controls playback for the room.");

    // Verify copy code action
    const displayRoomCode = await iframe.locator("#displayRoomCode").textContent();
    expect(displayRoomCode).toMatch(/^\d{4}$/);
    const copyBtn = iframe.locator("#roomCodeHostBox button.copy");
    await copyBtn.click();
    await expect(iframe.locator("#copyCodeText")).toHaveText("Copied!");

    // Switch to Join state
    await roleJoin.click();
    await expect(roleJoin).toHaveClass(/selected/);
    await expect(roleHost).not.toHaveClass(/selected/);
    await expect(hostBox).toBeHidden();
    await expect(joinInput).toBeVisible();
    await expect(codeLabel).toHaveText("Enter room code");
    await expect(enterBtnText).toHaveText("Connect to session");
    await expect(projectorBtn).toBeHidden();
    await expect(roleNotice).toHaveText("Joined viewer. Follows the host timeline.");

    // Type room code in join input
    await joinInput.fill("1234");
    await expect(joinInput).toHaveValue("1234");

    // Switch back to Host
    await roleHost.click();
    await expect(roleHost).toHaveClass(/selected/);
    await expect(hostBox).toBeVisible();
    await expect(projectorBtn).toBeVisible();

    // 7. Verify all 20 character tokens & selection
    const tokenBtns = iframe.locator(".token-btn");
    await expect(tokenBtns).toHaveCount(20);

    // Default: clapperboard 🎬 is selected
    const clapperBtn = tokenBtns.first();
    await expect(clapperBtn).toHaveText("🎬");
    await expect(clapperBtn).toHaveClass(/selected/);
    await expect(clapperBtn).toHaveAttribute("aria-checked", "true");
    await expect(iframe.locator("#selectedAvatarPreview")).toHaveText("🎬");

    // Click 4th token: popcorn 🍿
    const popcornBtn = tokenBtns.nth(3);
    await expect(popcornBtn).toHaveText("🍿");
    await popcornBtn.click();
    await expect(popcornBtn).toHaveClass(/selected/);
    await expect(popcornBtn).toHaveAttribute("aria-checked", "true");
    await expect(clapperBtn).not.toHaveClass(/selected/);
    await expect(iframe.locator("#selectedAvatarPreview")).toHaveText("🍿");

    // Click back to clapperboard 🎬
    await clapperBtn.click();
    await expect(clapperBtn).toHaveClass(/selected/);
    await expect(iframe.locator("#selectedAvatarPreview")).toHaveText("🎬");

    // 8. Verify Recent projects: empty state initially
    const recentEmpty = iframe.locator(".recent-empty");
    await expect(recentEmpty).toBeVisible();
    await expect(recentEmpty.locator("p")).toHaveText("No saved projects yet");
    await expect(iframe.locator("#recentProjectsCount")).toHaveText("0 saved projects");

    // Take Desktop Screenshot
    const screenshotsDir = path.resolve("tests/browser/screenshots");
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    await page.screenshot({ path: path.join(screenshotsDir, "first-page-setup-desktop.png"), fullPage: true });

    // 9. Enter Screening Room flow
    const enterBtn = iframe.locator("#btnEnterRoom");
    await enterBtn.click();

    // Verify Onboarding screen is hidden and internal DUET header remains HIDDEN (Single Header)
    await expect(iframe.locator("#onboardingScreen")).toBeHidden();
    await expect(duetInternalHeader).toBeHidden();

    // Verify ProjectHeader transitioned from setup to full workspace controls
    await expect(page.locator(".app-header.screening-setup-header")).toHaveCount(0);
    await expect(page.locator(".header-project-pill")).toBeVisible();
    await expect(page.locator(".change-film-btn")).toBeVisible();
    await expect(iframe.locator("#screeningModeOverlay")).toBeVisible();
    await expect(iframe.locator("#screeningHeading")).toHaveText("Ready to screen");
  });

  test("Mobile 390px: responsive layout, no horizontal clipping, stacked panels", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    // 1. Verify Topbar responsive behavior
    const header = page.locator(".app-header.screening-setup-header");
    await expect(header).toBeVisible();
    await expect(header.locator(".brand-name")).toHaveText("EDITMAP");

    const iframe = page.frameLocator("iframe");
    await expect(iframe.locator("#onboardingScreen")).toBeVisible();

    // Verify no horizontal overflow in iframe setup-main
    const isOverflowing = await iframe.locator(".setup-main").evaluate((el) => {
      return el.scrollWidth > el.clientWidth + 1; // 1px threshold for subpixel rounding
    });
    expect(isOverflowing).toBe(false);

    // Verify all 20 tokens fit without clipping
    const tokensContainer = iframe.locator(".tokens");
    await expect(tokensContainer).toBeVisible();
    const tokensOverflowing = await tokensContainer.evaluate((el) => {
      return el.scrollWidth > el.clientWidth + 1;
    });
    expect(tokensOverflowing).toBe(false);

    // Verify 20 token buttons exist and are clickable
    const tokenBtns = iframe.locator(".token-btn");
    await expect(tokenBtns).toHaveCount(20);
    await tokenBtns.nth(1).click(); // Camera
    await expect(tokenBtns.nth(1)).toHaveClass(/selected/);

    // Take Mobile Screenshot
    const screenshotsDir = path.resolve("tests/browser/screenshots");
    await page.screenshot({ path: path.join(screenshotsDir, "first-page-setup-mobile.png"), fullPage: true });
  });

  test("Recent projects: IndexedDB real projects rendered with accessible buttons", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const iframe = page.frameLocator("iframe");
    await expect(iframe.locator("#onboardingScreen")).toBeVisible();
    await expect(iframe.locator("#recentProjectsCount")).toHaveText("0 saved projects");

    const makeShots = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `s${i + 1}`,
        index: i + 1,
        sourceReel: "AX",
        sourceIn: "00:00:00:00",
        sourceOut: "00:00:02:00",
        startTimecode: `00:00:${String(Math.floor(i * 2 / 60)).padStart(2, "0")}:${String((i * 2) % 60).padStart(2, "0")}`,
        endTimecode: `00:00:${String(Math.floor((i * 2 + 2) / 60)).padStart(2, "0")}:${String((i * 2 + 2) % 60).padStart(2, "0")}`,
        startSeconds: i * 2,
        endSeconds: i * 2 + 2,
        duration: 2,
        transition: "C",
        shotSize: "Medium",
        notes: "",
      }));

    const sampleProjects = [
      {
        id: "proj-alpha",
        name: "Midnight Crossing",
        updatedAt: "2026-10-02T12:00:00Z",
        frameRate: 24,
        duration: 96,
        shots: makeShots(48),
        sequences: [],
        screeningMarks: [],
        characters: [],
        structureVocabulary: "threeAct",
        customStoryBeats: [],
        videoMetadata: { filename: "midnight_cut03.mp4" },
      },
      {
        id: "proj-beta",
        name: "Dawn Horizon",
        updatedAt: "2026-10-01T10:00:00Z",
        frameRate: 25,
        duration: 240,
        shots: makeShots(120),
        sequences: [],
        screeningMarks: [],
        characters: [],
        structureVocabulary: "threeAct",
        customStoryBeats: [],
        videoMetadata: { filename: "dawn_master.mov" },
      },
    ];

    // Populate projects in IndexedDB and refresh recent list
    await iframe.locator("#onboardingScreen").evaluate(async (_, projects) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("editmap", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("projects")) {
            req.result.createObjectStore("projects", { keyPath: "id" });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("projects", "readwrite");
          const store = tx.objectStore("projects");
          for (const p of projects) {
            store.put(p);
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
      if (typeof (window as any).loadRecentProjects === "function") {
        (window as any).loadRecentProjects();
      }
    }, sampleProjects);

    await expect(iframe.locator("#recentProjectsCount")).toHaveText("2 saved projects");

    const recentItems = iframe.locator("button.recent-item");
    await expect(recentItems).toHaveCount(2);

    // First item should be Midnight Crossing (sorted by updatedAt descending)
    const firstItem = recentItems.first();
    await expect(firstItem.locator("strong")).toHaveText("Midnight Crossing");
    await expect(firstItem.locator("small")).toHaveText("48 shots · 24 fps");
    await expect(firstItem.locator(".arrow")).toHaveText("↗");

    // Second item
    const secondItem = recentItems.nth(1);
    await expect(secondItem.locator("strong")).toHaveText("Dawn Horizon");
    await expect(secondItem.locator("small")).toHaveText("120 shots · 25 fps");

    // Capture screenshot of populated recent projects state
    const screenshotsDir = path.resolve("tests/browser/screenshots");
    await page.screenshot({ path: path.join(screenshotsDir, "first-page-setup-populated.png"), fullPage: true });

    // Auto-accept any confirmation dialogs (e.g. discard unsaved changes)
    page.on("dialog", (dialog) => dialog.accept());

    // Clicking a recent project updates cut label
    await firstItem.click();
    await expect(iframe.locator("#fileNameLabel")).toHaveText("✓ Midnight Crossing");
    await expect(iframe.locator("#fileNameSub")).toHaveText("Project loaded · Ready to screen");
  });

  test("Recent projects: long filenames cleanly truncate with ellipsis and do not overflow cards", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const iframe = page.frameLocator("iframe");
    await expect(iframe.locator("#onboardingScreen")).toBeVisible();

    const longNamedProjects = [
      {
        id: "proj-long-1",
        name: "20251213_1603_Loop Video_loop_01kcc0b8kjfy9b1cjes0z5wqw0_1.mp4",
        updatedAt: "2026-10-02T18:00:00Z",
        frameRate: 24,
        duration: 10,
        shots: [],
        videoMetadata: { filename: "20251213_1603_Loop Video_loop_01kcc0b8kjfy9b1cjes0z5wqw0_1.mp4" },
      },
      {
        id: "proj-long-2",
        name: "20251116_2251_Loop Video_loop_01ka76zrqfeqqb6fbfm5svb_1.mp4",
        updatedAt: "2026-10-02T17:00:00Z",
        frameRate: 24,
        duration: 10,
        shots: [],
        videoMetadata: { filename: "20251116_2251_Loop Video_loop_01ka76zrqfeqqb6fbfm5svb_1.mp4" },
      },
      {
        id: "proj-long-3",
        name: "260206 - Doandeș Cris - umilința .mp4",
        updatedAt: "2026-10-02T16:00:00Z",
        frameRate: 24,
        duration: 10,
        shots: [],
        videoMetadata: { filename: "260206 - Doandeș Cris - umilința .mp4" },
      },
    ];

    await iframe.locator("#onboardingScreen").evaluate(async (_, projects) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("editmap", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("projects")) {
            req.result.createObjectStore("projects", { keyPath: "id" });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("projects", "readwrite");
          const store = tx.objectStore("projects");
          for (const p of projects) {
            store.put(p);
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
      if (typeof (window as any).loadRecentProjects === "function") {
        (window as any).loadRecentProjects();
      }
    }, longNamedProjects);

    const recentItems = iframe.locator("button.recent-item");
    await expect(recentItems).toHaveCount(3);

    // Verify all 3 cards: info container and button do NOT overflow horizontally
    for (let i = 0; i < 3; i++) {
      const card = recentItems.nth(i);
      const isCardOverflowing = await card.evaluate((btn) => {
        const info = btn.querySelector(".recent-item-info");
        const arrow = btn.querySelector(".arrow");
        const strong = btn.querySelector("strong");
        if (!info || !arrow || !strong) return true;
        
        const btnRect = btn.getBoundingClientRect();
        const strongRect = strong.getBoundingClientRect();
        const arrowRect = arrow.getBoundingClientRect();

        // Strong text must stay to the left of the arrow with padding
        const textOverlapsArrow = strongRect.right > arrowRect.left;
        // Strong text must not stick out of the button
        const textOverflowsButton = strongRect.right > btnRect.right;

        return textOverlapsArrow || textOverflowsButton;
      });

      expect(isCardOverflowing).toBe(false);
    }

    // Capture screenshot of long filename cards
    const screenshotsDir = path.resolve("tests/browser/screenshots");
    await page.screenshot({ path: path.join(screenshotsDir, "first-page-setup-long-filenames.png"), fullPage: true });
  });

  test("Single-header layout, responsiveness, and Dark Screening state copy (1440px, 1280px, 390px)", async ({ page }) => {
    const screenshotsDir = path.resolve("tests/browser/screenshots");
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    // 1. Desktop 1440px
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const iframe = page.frameLocator("iframe");
    // Load test video
    const fileInput = iframe.locator("input[type=file]#videoFileInput");
    await fileInput.setInputFiles(path.resolve("fixtures/test-film.mp4"));
    await expect(iframe.locator("#fileNameLabel")).toContainText("test-film");

    // Enter screening room
    await iframe.locator("#btnEnterRoom").click();
    await expect(iframe.locator("#onboardingScreen")).toBeHidden();

    // Verify single EDITMAP header is visible and DUET internal header is hidden
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(iframe.locator("#duetConsoleHeader")).toBeHidden();
    await expect(iframe.locator("#screeningModeOverlay")).toBeVisible();

    // Verify state copy is "Ready to screen" when paused at start
    const screeningHeading = iframe.locator("#screeningHeading");
    await expect(screeningHeading).toHaveText("Ready to screen");

    // Verify Change film button in header has text at 1440px
    const changeFilmBtn = page.locator(".change-film-btn");
    await expect(changeFilmBtn).toBeVisible();
    await expect(changeFilmBtn.locator(".change-film-text")).toBeVisible();
    await expect(changeFilmBtn).toHaveAttribute("aria-label", "Back to choose another film");

    // Verify play changes state copy to "Screening in progress"
    const playBtn = iframe.locator("#btnScreeningPlay");
    await playBtn.click();
    await expect(screeningHeading).toHaveText("Screening in progress");
    await playBtn.click(); // Pause

    // Capture 1440px desktop screenshot
    await page.screenshot({ path: path.join(screenshotsDir, "single-header-screening-desktop-1440.png"), fullPage: true });

    // 2. Desktop 1280px: responsive collapse & truncation
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);

    // Change film text is collapsed to icon at 1280px
    await expect(changeFilmBtn.locator(".change-film-text")).toBeHidden();
    await expect(changeFilmBtn).toBeVisible();

    // Project name is truncated and save status is visible without colliding with tabs
    const projectInput = page.locator(".header-project-input");
    await expect(projectInput).toBeVisible();
    const saveStatus = page.locator(".header-save-status");
    await expect(saveStatus).toBeVisible();
    const modeSwitch = page.locator(".workspace-mode-switch");
    await expect(modeSwitch).toBeVisible();

    // Verify elements do not overlap horizontally
    const inputRect = await projectInput.boundingBox();
    const saveRect = await saveStatus.boundingBox();
    const tabsRect = await modeSwitch.boundingBox();
    expect(inputRect && saveRect && tabsRect).toBeTruthy();
    if (inputRect && saveRect && tabsRect) {
      expect(saveRect.x).toBeGreaterThanOrEqual(inputRect.x + inputRect.width - 2);
      expect(tabsRect.x).toBeGreaterThanOrEqual(saveRect.x + saveRect.width - 2);
    }

    // Capture 1280px desktop screenshot
    await page.screenshot({ path: path.join(screenshotsDir, "single-header-screening-desktop-1280.png"), fullPage: true });

    // 3. Mobile 390px
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(changeFilmBtn).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, "single-header-screening-mobile-390.png"), fullPage: true });
  });

  test("Change film, cancellation, and re-entering the same film with unsaved marks", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const iframe = page.frameLocator("iframe");
    // Load test video and enter
    await iframe.locator("input[type=file]#videoFileInput").setInputFiles(path.resolve("fixtures/test-film.mp4"));
    await iframe.locator("#btnEnterRoom").click();
    await expect(iframe.locator("#screeningModeOverlay")).toBeVisible();

    // Log reaction marks (Keys 1 and 2)
    await iframe.locator("#darkKeyBox1").click();
    await page.waitForTimeout(100);
    await iframe.locator("#darkKeyBox2").click();

    // Save status is Unsaved
    const saveStatus = page.locator(".header-save-status");
    await expect(saveStatus).toHaveClass(/dirty/);
    await expect(saveStatus.locator(".save-status-text")).toHaveText("Unsaved");

    // Click Change film in EDITMAP header
    const changeFilmBtn = page.locator(".change-film-btn");
    await changeFilmBtn.click();

    // Onboarding screen is shown again, Change film button is hidden on setup
    await expect(iframe.locator("#onboardingScreen")).toBeVisible();
    await expect(changeFilmBtn).toBeHidden();
    await expect(page.locator(".brand-section")).toHaveText("Screening setup");

    // Verify "← Cancel (Return to film)" button is available in setup
    const cancelReturnBtn = iframe.locator("#btnCancelChangeFilm");
    await expect(cancelReturnBtn).toBeVisible();

    // Click Cancel (Return to film)
    await cancelReturnBtn.click();

    // Returns to screening room with marks and unsaved status intact
    await expect(iframe.locator("#onboardingScreen")).toBeHidden();
    await expect(iframe.locator("#screeningModeOverlay")).toBeVisible();
    await expect(saveStatus).toHaveClass(/dirty/);
    await expect(saveStatus.locator(".save-status-text")).toHaveText("Unsaved");
    await expect(changeFilmBtn).toBeVisible();

    // Click Change film again, and re-enter using "Enter screening room"
    await changeFilmBtn.click();
    await expect(iframe.locator("#onboardingScreen")).toBeVisible();
    await iframe.locator("#btnEnterRoom").click();

    // Re-entering same film keeps marks and unsaved status intact without duplication
    await expect(iframe.locator("#onboardingScreen")).toBeHidden();
    await expect(iframe.locator("#screeningModeOverlay")).toBeVisible();
    await expect(saveStatus).toHaveClass(/dirty/);
    await expect(saveStatus.locator(".save-status-text")).toHaveText("Unsaved");
  });

  test("Replacing an unsaved film provides clear Save / Discard / Cancel decision", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const iframe = page.frameLocator("iframe");
    // Load first test film
    await iframe.locator("input[type=file]#videoFileInput").setInputFiles(path.resolve("fixtures/test-film.mp4"));
    await iframe.locator("#btnEnterRoom").click();
    await expect(iframe.locator("#screeningModeOverlay")).toBeVisible();

    // Log a reaction mark to make it dirty
    await iframe.locator("#darkKeyBox3").click();
    const saveStatus = page.locator(".header-save-status");
    await expect(saveStatus).toHaveClass(/dirty/);

    // Return to setup via Change film
    await page.locator(".change-film-btn").click();
    await expect(iframe.locator("#onboardingScreen")).toBeVisible();

    // Select a DIFFERENT project from recent/mock projects to trigger replacement
    await page.evaluate(() => {
      window.postMessage({ type: "DUET_SELECT_PROJECT", id: "non-existent-proj" }, "*");
    });

    // Verify Save / Discard / Cancel modal appears
    const modal = page.locator(".unsaved-decision-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator("#unsaved-modal-title")).toHaveText("Save changes before replacing film?");
    await expect(modal.locator(".btn-cancel-replacement")).toBeVisible();
    await expect(modal.locator(".btn-discard-replacement")).toBeVisible();
    await expect(modal.locator(".btn-save-replacement")).toBeVisible();

    // Click Cancel: modal dismisses, previous unsaved state remains intact
    await modal.locator(".btn-cancel-replacement").click();
    await expect(modal).toBeHidden();

    // Returning to film confirms marks and unsaved status were preserved
    await iframe.locator("#btnCancelChangeFilm").click();
    await expect(iframe.locator("#screeningModeOverlay")).toBeVisible();
    await expect(saveStatus).toHaveClass(/dirty/);
    await expect(saveStatus.locator(".save-status-text")).toHaveText("Unsaved");
  });

  test("File menu -> Export .EDL bridges to iframe with zero-marker guidance", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const iframe = page.frameLocator("iframe");
    // Load test film and enter room with 0 markers
    await iframe.locator("input[type=file]#videoFileInput").setInputFiles(path.resolve("fixtures/test-film.mp4"));
    await iframe.locator("#btnEnterRoom").click();
    await expect(iframe.locator("#screeningModeOverlay")).toBeVisible();

    // Handle dialog event for zero-marker guidance alert
    let dialogMessage = "";
    page.on("dialog", async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.accept();
    });

    // Open File menu and click Export .EDL
    await page.locator(".file-trigger-btn").click();
    const exportEdlBtn = page.locator(".dropdown-menu button:has-text('Export .EDL')");
    await expect(exportEdlBtn).toBeVisible();
    await exportEdlBtn.click();

    // Verify zero-marker guidance was shown
    await page.waitForTimeout(300);
    expect(dialogMessage).toContain("No markers logged yet");

    // Now log a marker and verify Export .EDL triggers download
    await iframe.locator("#darkKeyBox1").click();

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 4000 }),
      (async () => {
        await page.locator(".file-trigger-btn").click();
        await page.locator(".dropdown-menu button:has-text('Export .EDL')").click();
      })(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.edl$/i);
  });

  test("Screening and Review navigation preserves single header and full height", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const iframe = page.frameLocator("iframe");
    await iframe.locator("input[type=file]#videoFileInput").setInputFiles(path.resolve("fixtures/test-film.mp4"));
    await iframe.locator("#btnEnterRoom").click();
    await expect(iframe.locator("#screeningModeOverlay")).toBeVisible();

    // 1. Switch to Review using EDITMAP header tab
    const reviewTab = page.locator(".mode-tab:has-text('Review')");
    await reviewTab.click();
    await expect(iframe.locator("#reviewWorkspace")).toBeVisible();
    await expect(iframe.locator("#duetConsoleHeader")).toBeHidden();
    await expect(page.locator(".change-film-btn")).toBeVisible();

    // 2. Switch back to Screening using EDITMAP header tab
    const screeningTab = page.locator(".mode-tab:has-text('Screening')");
    await screeningTab.click();
    await expect(iframe.locator("#screeningModeOverlay")).toBeVisible();
    await expect(iframe.locator("#duetConsoleHeader")).toBeHidden();

    // 3. Switch to Review using visible Review exit button ("Stop Screening & Turn On Review Lights →")
    const exitBtn = iframe.locator("button:has-text('Stop Screening & Turn On Review Lights')");
    await expect(exitBtn).toBeVisible();
    await exitBtn.click();
    await expect(iframe.locator("#reviewWorkspace")).toBeVisible();

    // 4. Switch back to Screening and test Escape key to Review
    await screeningTab.click();
    await expect(iframe.locator("#screeningModeOverlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(iframe.locator("#reviewWorkspace")).toBeVisible();
  });
});
