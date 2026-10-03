import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { newProject } from "../../src/models/project";

const output = path.resolve("docs/review-module");
test("screening marks, perception controls, context replay, evidence, persistence and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const p = {
    ...newProject(),
    name: "Review verification",
    duration: 8,
    shots: [0, 2, 4].map((start, i) => ({
      id: `s${i}`,
      index: i + 1,
      sourceReel: "AX",
      sourceIn: "00:00:00:00",
      sourceOut: "00:00:02:00",
      startTimecode: `00:00:0${start}:00`,
      endTimecode: `00:00:0${start + 2}:00`,
      startSeconds: start,
      endSeconds: start + 2,
      duration: 2,
      transition: "C",
      shotSize: "Wide" as const,
      notes: "",
      motionProfile: {
        cameraMovement: "Static" as const,
        cameraEnergy: 5,
        subjectEnergy: 12,
        totalKineticEnergy: i === 0 ? 74 : 9,
        confidence: 0.8,
      },
    })),
  };
  await page.goto("/");
  await page.evaluate(async (project) => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("editmap", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("projects", { keyPath: "id" });
      r.onsuccess = () => {
        const tx = r.result.transaction("projects", "readwrite");
        tx.objectStore("projects").put(project);
        tx.oncomplete = () => {
          r.result.close();
          resolve();
        };
      };
      r.onerror = () => reject(r.error);
    });
  }, p);
  await page.reload();
  await page
    .frameLocator(".duet-console-iframe")
    .locator("button.recent-item")
    .filter({ hasText: /review verification/i })
    .click();
  await page.getByRole("tab", { name: /Screening Room|Review/ }).click();
  await expect(
    page.getByRole("heading", { name: "Watch. Feel. Mark." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Drop mark/ })).toBeDisabled();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));
  await expect(
    page.getByRole("button", { name: "Play review", exact: true }),
  ).toBeEnabled();
  const video = page.locator(".sr-cinema video");
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 2.25;
  });
  await page.getByRole("button", { name: "Play review", exact: true }).click();
  await page.keyboard.press("m");
  await expect(
    page.getByRole("status").filter({ hasText: "Mark 1 saved" }),
  ).toBeVisible();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page.getByRole("button", { name: "Pause review", exact: true }).click();
  await page.getByRole("button", { name: "Mirror screen" }).click();
  await expect(video).toHaveCSS("transform", "matrix(-1, 0, 0, 1, 0, 0)");
  await page.getByRole("button", { name: "Darken screen" }).click();
  await expect(video).toHaveCSS("opacity", "0");
  await page.getByRole("button", { name: "Mute audio" }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
  await page.getByRole("button", { name: "Darken screen" }).click();

  const seekBar = page.locator(".sr-viewing .sr-seek-bar");
  await expect(seekBar).toBeVisible();
  await expect(seekBar.locator(".sr-seek-pip")).toHaveCount(1);
  const seekBounding = await seekBar.boundingBox();
  if (seekBounding) {
    await page.mouse.click(
      seekBounding.x + seekBounding.width * 0.5,
      seekBounding.y + seekBounding.height * 0.5,
    );
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(3.5);
  }

  // Verify dragging over transport/buttons does not select text like a word processor
  const transportBox = await page.locator(".sr-transport").boundingBox();
  if (transportBox) {
    await page.mouse.move(transportBox.x + 10, transportBox.y + transportBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(transportBox.x + transportBox.width - 10, transportBox.y + transportBox.height * 0.5);
    await page.mouse.up();
    const selection = await page.evaluate(() => window.getSelection()?.toString().trim() ?? "");
    expect(selection).toBe("");
  }
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({
    path: path.join(output, "screening-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Finish pass" }).click();
  await expect(page.locator(".sr-mark")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Shot 1 → 2", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("74 → 9", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Speech evidence unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "Shot 1 tail" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Shot 2 head" })).toBeVisible();
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 3.2;
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeLessThan(2);
  await page.getByRole("button", { name: "Pause review", exact: true }).click();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    const room = page.locator(".screening-review");
    expect(
      await room.evaluate((e) => ({
        height: e.scrollHeight - e.clientHeight,
        width: e.scrollWidth - e.clientWidth,
      })),
    ).toEqual({ height: 0, width: 0 });
    for (const selector of [
      ".sr-cinema",
      ".sr-bridge",
      ".sr-context-curves",
      ".sr-evidence-grid",
      ".sr-review-footer",
    ]) {
      const box = await page.locator(selector).boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.y + box!.height, selector).toBeLessThanOrEqual(
        viewport.height,
      );
      expect(box!.height, selector).toBeGreaterThan(20);
    }
    const bars = await page.locator(".sr-duration-bars").boundingBox();
    const caption = await page.locator(".sr-evidence-block").first().locator("small").boundingBox();
    const firstBar = await page.locator(".sr-duration-bars button").first().boundingBox();
    expect(firstBar!.y).toBeGreaterThanOrEqual(caption!.y + caption!.height);
    expect(firstBar!.height).toBeLessThanOrEqual(bars!.height);
    await page.screenshot({
      path: path.join(
        output,
        `evidence-${viewport.width}x${viewport.height}.png`,
      ),
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByLabel("Your reading", { exact: true })
    .fill("Keep the hesitation; try a shorter tail.");
  await page.keyboard.press("m"); // Typing must not create a screening mark.
  await expect(page.locator(".sr-mark")).toHaveCount(1);
  await page
    .getByRole("button", { name: "NLE experiment / Export", exact: true })
    .click();
  await page.getByLabel("Trim outgoing tail (frames)").fill("24");
  await page.getByLabel("J-cut lead (frames)").fill("16");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export NLE note" }).click();
  const downloaded = await download;
  // Verify fullscreen button is visible on transport bar
  await expect(page.locator(".sr-fullscreen-btn")).toBeVisible();

  const edlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export EDL markers (.edl)" }).click();
  const edlDownloaded = await edlDownload;
  const edlContents = fs.readFileSync((await edlDownloaded.path())!, "utf8");
  expect(edlContents).toContain("TITLE:");
  expect(edlContents).toContain("MARKER NAME: Shot 1 -> 2");

  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV markers (.csv)" }).click();
  const csvDownloaded = await csvDownload;
  const csvContents = fs.readFileSync((await csvDownloaded.path())!, "utf8");
  expect(csvContents).toContain("Timecode In");
  expect(csvContents).toContain("Shot 1 -> 2");

  await page.screenshot({
    path: path.join(output, "evidence-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close NLE experiment" }).click();
  await page.getByRole("button", { name: "Open in Studio" }).click();
  await expect(page.locator(".workspace.mode-studio")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".monitor video")
        .evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(2, 1);
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(page.locator(".workspace.studio-map-expanded")).toBeVisible();
  await page.getByRole("tab", { name: /Screening Room|Review/ }).click();
  await page.getByRole("button", { name: "02 Evidence" }).click();
  await expect(page.locator(".sr-mark")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("img", { name: "Shot 1 tail" })).toBeVisible();
  await page.screenshot({
    path: path.join(output, "evidence-mobile.png"),
    fullPage: true,
  });
  expect(
    await page
      .locator(".screening-review")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBe(true);
  await page.getByRole("button", { name: "Pause review", exact: true }).click();
  // Explicit save and reopen verify persistent project marks.
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          new Promise<number>((resolve) => {
            const r = indexedDB.open("editmap", 1);
            r.onsuccess = () => {
              const get = r.result
                .transaction("projects")
                .objectStore("projects")
                .get(id);
              get.onsuccess = () => {
                resolve(get.result.screeningMarks?.length ?? 0);
                r.result.close();
              };
            };
          }),
        p.id,
      ),
    )
    .toBe(1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByRole("region", { name: "Context rhythm and motion curves" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New pass", exact: true }).click();
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.15;
  });
  await page.getByRole("button", { name: "Play review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Return to the feeling." }),
  ).toBeVisible();
  await page.reload();
  await page
    .frameLocator(".duet-console-iframe")
    .locator("button.recent-item")
    .filter({ hasText: /review verification/i })
    .click();
  await page.getByRole("tab", { name: /Screening Room|Review/ }).click();
  await page.getByRole("button", { name: "02 Evidence" }).click();
  await expect(page.locator(".sr-mark")).toHaveCount(1);
  await expect(page.getByLabel("Your reading", { exact: true })).toHaveValue(
    /Keep the hesitation/,
  );
  await expect(
    page.getByRole("button", { name: "Play review", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
