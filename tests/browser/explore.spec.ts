import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { openRecentProjectInStudio } from "./helpers";

test("Explore module: sequence builder, playlist playback, time mapping, Studio location, and saved sequences", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Load rich project fixture
  const backupRaw = fs.readFileSync(path.resolve("fixtures/rich-score-backup.json"), "utf8");
  const backup = JSON.parse(backupRaw);
  const project = backup.project;

  // Ensure shots have colorProfiles with varying luminance so we can test darkest-first sorting
  project.shots[0].colorProfile = {
    palette: ["#111111", "#222222", "#333333"],
    luminance: 0.82,
    temperature: 0.2,
    saturation: 0.5,
    mood: "Bright",
    harmony: { type: "neutral", label: "Neutral", confidence: 1, dominantHue: 0 },
  };
  project.shots[1].colorProfile = {
    palette: ["#050505", "#0a0a0a", "#101010"],
    luminance: 0.12,
    temperature: -0.1,
    saturation: 0.3,
    mood: "Dark",
    harmony: { type: "neutral", label: "Neutral", confidence: 1, dominantHue: 0 },
  };
  if (project.shots[2]) {
    project.shots[2].colorProfile = {
      palette: ["#0f0f0f", "#1a1a1a", "#252525"],
      luminance: 0.45,
      temperature: 0.0,
      saturation: 0.4,
      mood: "Mid",
      harmony: { type: "neutral", label: "Neutral", confidence: 1, dominantHue: 0 },
    };
  }

  await page.goto("/");

  // Seed IndexedDB with our test project
  await page.evaluate(async (p) => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("editmap", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("projects", { keyPath: "id" });
      r.onsuccess = () => {
        const tx = r.result.transaction("projects", "readwrite");
        tx.objectStore("projects").put(p);
        tx.oncomplete = () => {
          r.result.close();
          resolve();
        };
      };
      r.onerror = () => reject(r.error);
    });
  }, project);

  await page.reload();

  // Open the project
  await openRecentProjectInStudio(page, /cinematic score test/i);

  const originalFirstShotText = await page.locator(".shot").first().innerText();


  // Verify header has Studio and Explore tabs
  const studioTab = page.getByRole("tab", { name: "Studio" });
  const exploreTab = page.getByRole("tab", { name: "Explore" });
  await expect(studioTab).toBeVisible();
  await expect(exploreTab).toBeVisible();

  // --------------------------------------------------------------------------
  // 1. SWITCH TO EXPLORE WORKSPACE
  // --------------------------------------------------------------------------
  await exploreTab.click();
  await expect(page.locator(".explore-workspace")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build a viewing sequence" })).toBeVisible();

  // --------------------------------------------------------------------------
  // 2. BUILD A DARKEST-FIRST SEQUENCE
  // --------------------------------------------------------------------------
  await page.locator("#arrange-measure").selectOption("brightness");
  // Select Darkest first
  await page.getByLabel("Darkest first").check();
  // Click Build sequence
  await page.getByRole("button", { name: "Build sequence" }).click();

  // Shot 2 (luminance 0.12) must now be the FIRST card in the Explore sequence,
  // before Shot 1 (luminance 0.82)
  const firstExploreCard = page.locator(".explore-shot-card").first();
  await expect(firstExploreCard).toContainText("Shot 002");
  await expect(firstExploreCard).toContainText("Luma 12%");

  // --------------------------------------------------------------------------
  // 3. COMBINE CHARACTER AND DURATION FILTERS
  // --------------------------------------------------------------------------
  // Select character "Elena"
  await page.locator("#filter-character").selectOption({ label: "Elena" });
  // Duration under 5 s
  await page.locator("#filter-duration").selectOption("under-5");
  // Build sequence
  await page.getByRole("button", { name: "Build sequence" }).click();

  // Resulting count must update
  await expect(page.locator(".builder-summary-line")).toContainText("matching shot");

  // --------------------------------------------------------------------------
  // 4. PLAY THROUGH NONADJACENT SHOTS & BACKWARD JUMP
  // --------------------------------------------------------------------------
  // Reset filters to include all shots and arrange by Brightness (Shot 2 -> Shot 1, a backward source jump from 3.5s to 0s!)
  await page.getByRole("button", { name: "Reset" }).click();
  await page.locator("#arrange-measure").selectOption("brightness");
  await page.getByLabel("Darkest first").check();
  await page.getByRole("button", { name: "Build sequence" }).click();

  // First card is Shot 2 (source start 3.5s), second card is Shot 1 (source start 0s)
  const video = page.locator(".explore-video-element");
  await expect(video).toBeVisible();

  // Capture screenshot with video connected & ready
  fs.mkdirSync("output/verification", { recursive: true });
  await page.screenshot({
    path: "output/verification/explore-active-playback.png",
    fullPage: true,
  });

  // Start playback
  await page.locator(".transport-btn.play-btn").click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);

  // Wait briefly while playing
  await page.waitForTimeout(600);

  // Pause playback
  await page.locator(".transport-btn.play-btn").click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

  // Test missing analysis state: arrange by Loudness (no loudness scan in project)
  await page.locator("#arrange-measure").selectOption("loudness");
  await page.getByRole("button", { name: "Build sequence" }).click();
  await expect(page.locator(".builder-missing-notice")).toContainText(/Loudness analysis is not available/i);
  await expect(page.locator(".explore-empty-timeline")).toBeVisible();

  // Restore brightness darkest-first sequence
  await page.locator("#arrange-measure").selectOption("brightness");
  await page.getByLabel("Darkest first").check();
  await page.getByRole("button", { name: "Build sequence" }).click();

  // --------------------------------------------------------------------------
  // 5. SCRUB AND USE PREVIOUS / NEXT BUTTONS
  // --------------------------------------------------------------------------
  // Next shot
  await page.getByRole("button", { name: "Next shot" }).click();
  const activeCardAfterNext = page.locator(".explore-shot-card.active");
  await expect(activeCardAfterNext).toBeVisible();

  // Prev shot
  await page.getByRole("button", { name: "Previous shot" }).click();
  await expect(page.locator(".explore-shot-card").first()).toHaveClass(/active/);

  // Scrub on timeline: click mid-way on the track
  const track = page.locator(".explore-shot-track");
  const box = await track.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
    // Sequence time readout should update
    await expect(page.locator(".sequence-time-display .current-seq-time")).not.toHaveText("00:00");
  }

  // --------------------------------------------------------------------------
  // 6. LOCATE IN STUDIO
  // --------------------------------------------------------------------------
  await page.getByRole("button", { name: "Locate in Studio" }).click();

  // Must transition immediately to Studio workspace
  await expect(page.locator(".workspace")).toHaveClass(/mode-studio/);
  // Original film shots in Studio must remain in their original chronological order!
  await expect(page.locator(".shot").first()).toHaveAttribute("aria-label", "Shot 1");

  // Return to Explore
  await exploreTab.click();
  await expect(page.locator(".explore-workspace")).toBeVisible();

  // --------------------------------------------------------------------------
  // 7. SAVE, RELOAD, AND REOPEN SEQUENCE
  // --------------------------------------------------------------------------
  const cardBeforeSave = await page.locator(".explore-shot-card").first().innerText();

  await page.getByRole("button", { name: "Save sequence" }).click();
  await expect(page.locator(".explore-save-modal")).toBeVisible();
  await page.locator("#seq-name-input").fill("Explore Saved Order Test");
  await page.locator(".explore-save-modal button[type='submit']").click();

  // Status banner shows saved notice
  await expect(page.locator(".explore-status-banner")).toContainText('Saved sequence "Explore Saved Order Test"');

  // Save project to IndexedDB before reloading
  await page.getByRole("button", { name: /^Save project/ }).click();
  await expect(page.getByRole("button", { name: "Project saved" })).toBeVisible();

  // Reload page to test full IndexedDB persistence
  await page.reload();
  await openRecentProjectInStudio(page, /cinematic score test/i);
  await exploreTab.click();

  // Open Saved Sequences modal
  await page.getByRole("button", { name: "Save sequence" }).click();
  await page.getByRole("tab", { name: /Saved sequences/ }).click();
  await expect(page.locator(".saved-sequence-card")).toContainText("Explore Saved Order Test");

  // Reopen it
  await page.locator(".saved-sequence-card").getByRole("button", { name: "Open" }).click();
  await expect(page.locator(".explore-status-banner")).toContainText('Opened saved sequence "Explore Saved Order Test"');

  // Verify first shot in the reopened sequence strictly preserves the saved order!
  const cardAfterReopen = await page.locator(".explore-shot-card").first().innerText();
  expect(cardAfterReopen).toBe(cardBeforeSave);

  // --------------------------------------------------------------------------
  // 8. CAPTURE FINAL VERIFICATION SCREENSHOT
  // --------------------------------------------------------------------------
  fs.mkdirSync("output/verification", { recursive: true });
  await page.screenshot({
    path: "output/verification/explore-workspace.png",
    fullPage: true,
  });

  // Check no browser errors were thrown
  expect(errors).toEqual([]);
});
