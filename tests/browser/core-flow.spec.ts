import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { startNewProject } from "./helpers";

const video = (page: Page) => page.locator("#studioVideoPlayer");
const currentTime = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.currentTime);

async function importCuts(page: Page, name: string) {
  await startNewProject(page);
  await page.getByLabel("Project name").fill(name);
  await page.locator('input[accept*=".edl"]').setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);
}

async function storedProject(page: Page, name: string) {
  return page.evaluate(
    (projectName) =>
      new Promise<any>((resolve, reject) => {
        const open = indexedDB.open("editmap", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction("projects").objectStore("projects").getAll();
          all.onsuccess = () => resolve(all.result.find((p: any) => p.name === projectName));
        };
      }),
    name,
  );
}

test("link film, import EDL, navigate shots, annotate, and persist", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await importCuts(page, "Core flow");

  // Proportional widths: in the cuts-24 fixture shot 3 is ten times as long as shot 1.
  const widths = await page.locator(".shot").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  expect(widths[2] / widths[0]).toBeCloseTo(10, 1);

  // Selecting a shot seeks the video to its start.
  await page.getByRole("button", { name: "Shot 2", exact: true }).click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(1, 2);

  // Manual tags and notes are kept on the shot.
  await page.getByRole("group", { name: "Shot Size Quick Tags" }).getByRole("button", { name: /^MCU/ }).click();
  await page.getByLabel("Notes").fill("A held reaction.");
  await expect(page.getByRole("button", { name: "Shot 2", exact: true })).toHaveAttribute("title", /Medium close-up/);

  // The rhythm chart seeks to a shot.
  await page.getByRole("button", { name: "Rhythm shot 3", exact: true }).click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(3.5, 2);

  // Saving writes the annotations to browser storage.
  await page.getByRole("button", { name: /^Save project/ }).click();
  await expect.poll(async () => (await storedProject(page, "Core flow"))?.shots?.length ?? 0).toBe(3);
  const saved = await storedProject(page, "Core flow");
  expect(saved.shots[1].shotSize).toBe("Medium close-up");
  expect(saved.shots[1].notes).toBe("A held reaction.");
  expect(errors).toEqual([]);
});

test("play advances the clock and pause holds it", async ({ page }) => {
  await page.goto("/");
  await importCuts(page, "Playback");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => currentTime(page), { timeout: 5000 }).toBeGreaterThan(0.3);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const held = await currentTime(page);
  await page.waitForTimeout(400);
  expect(await currentTime(page)).toBeCloseTo(held, 1);
});

test("playback crosses a cut and the active shot follows", async ({ page }) => {
  await page.goto("/");
  await importCuts(page, "Cut crossing");
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Shot 2", exact: true })).toHaveClass(/active/, { timeout: 6000 });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
});

test("a drawer opened after playback moved shows the current time, not a stale one", async ({ page }) => {
  await page.goto("/");
  await importCuts(page, "Hidden drawer");

  // Move the clock while the Framing drawer is hidden behind the Rhythm tab.
  await page.getByRole("button", { name: "Rhythm shot 3", exact: true }).click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(3.5, 2);

  await page.getByRole("tab", { name: "Framing", exact: true }).click();
  await page.getByRole("tab", { name: /Progression/ }).click();
  await expect(page.getByTitle(/^Playhead: 00:00:03:12/)).toBeVisible();

  // And it keeps following while visible.
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await expect(page.getByTitle(/^Playhead: 00:00:00:00/)).toBeVisible();
});
