import { test, expect } from "@playwright/test";
import path from "node:path";
test("local film, EDL, playback, annotation, zoom and persistence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill("Synthetic analysis");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));
  await expect(page.locator(".video-meta")).toContainText("640 × 360");
  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);
  const widths = await page
    .locator(".shot")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  expect(widths[2] / widths[0]).toBeCloseTo(10, 1);
  await page.getByRole("button", { name: "Shot 2", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(1, 2);
  await page.getByLabel("Shot size", { exact: true }).selectOption("MCU");
  await page.getByLabel("Notes").fill("A held reaction.");
  await expect(
    page.getByRole("button", { name: "Shot 2", exact: true }),
  ).toContainText("MCU");
  await page.getByRole("button", { name: "Next frame" }).click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(1 + 1 / 24, 2);
  await page.getByRole("button", { name: "Shot 1", exact: true }).dblclick();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      () => page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
      { timeout: 4000 },
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(1, 2);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(1.1);
  await expect(
    page.getByRole("button", { name: "Shot 2", exact: true }),
  ).toHaveClass(/active/);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.locator(".map .tools")).toContainText("1.5×");
  await page.getByRole("button", { name: "Fit film" }).click();
  await page
    .getByRole("button", { name: "Rhythm shot 3", exact: true })
    .click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(3.5, 2);
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic analysis/ }).click();
  await expect(page.getByText("Video needs relinking")).toBeVisible();
  await page.getByRole("button", { name: "Shot 2", exact: true }).click();
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue(
    "MCU",
  );
  await expect(page.getByLabel("Notes")).toHaveValue("A held reaction.");
  await page.screenshot({
    path: "tests/browser/workspace.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("boundary reading compares the cut and keeps a manual interpretation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.locator("input[type=file]").first().setInputFiles(path.resolve("fixtures/test-film.mp4"));
  await page.locator('input[accept*=".edl"]').setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await page.getByLabel("Shot size", { exact: true }).selectOption("WS");
  await page.getByRole("button", { name: "Shot 2", exact: true }).click();
  await page.getByLabel("Shot size", { exact: true }).selectOption("CU");
  await page.getByRole("button", { name: "Cut between Shot 1 and Shot 2" }).click();
  await expect(page.locator(".cut-reading")).toContainText("Tighter");
  await expect(page.locator(".cut-reading")).toContainText("1.00s → 2.50s");
  await page.getByLabel("Cut interpretation").selectOption("Reaction");
  await page.getByLabel("Cut note").fill("We arrive on the response.");
  await expect(page.getByLabel("Cut note")).toHaveValue("We arrive on the response.");
  await page.getByLabel("Loop across cut").check();
  await page.getByRole("button", { name: "Play cut", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.locator("header").getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: /Untitled film/ }).click();
  await page.getByRole("button", { name: "Cut between Shot 1 and Shot 2" }).click();
  await expect(page.getByLabel("Cut interpretation")).toHaveValue("Reaction");
  await expect(page.getByLabel("Cut note")).toHaveValue("We arrive on the response.");
});

test("sound spans are manual, editable, and persisted with a selected passage", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.locator('input[accept*=".edl"]').setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator(".map-canvas").dispatchEvent("pointerdown", { clientX: 20, button: 0, shiftKey: true, pointerId: 1 });
  await page.locator(".map-canvas").dispatchEvent("pointermove", { clientX: 130, shiftKey: true, pointerId: 1 });
  await page.locator(".map-canvas").dispatchEvent("pointerup", { clientX: 130, shiftKey: true, pointerId: 1 });
  await expect(page.locator(".sound-reading")).toContainText("Play passage");
  await page.getByLabel("Sound category").selectOption("Dialogue");
  await page.getByLabel("Sound observation").fill("One sentence crosses three picture changes.");
  await page.getByRole("button", { name: "Add sound span", exact: true }).click();
  await expect(page.locator(".sound-span.dialogue")).toHaveCount(1);
  await expect(page.locator(".sound-list")).toContainText("One sentence crosses three picture changes.");
  await page.getByLabel("Dialogue out").fill("2.5");
  await page.locator("header").getByRole("button", { name: /^Save/ }).click();
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: /Untitled film/ }).click();
  await expect(page.locator(".sound-span.dialogue")).toHaveCount(1);
  await expect(page.locator(".sound-list")).toContainText("One sentence crosses three picture changes.");
});

test("thumbnails and keyboard tag-and-advance preserve playback and notes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));
  await expect(page.locator(".video-meta")).toContainText("640 × 360");
  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot-thumbnail")).toHaveCount(3);
  expect(
    await page
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBe(0);
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await page.keyboard.press("5");
  await expect(
    page.getByRole("button", { name: "Shot 1", exact: true }),
  ).toContainText("MCU");
  await expect(
    page.getByRole("button", { name: "Shot 2", exact: true }),
  ).toHaveClass(/selected/);
  await page.getByLabel("Notes").fill("123");
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue(
    "Unknown",
  );
  await page.getByLabel("Advance after tagging").uncheck();
  await page.getByRole("button", { name: "Shot 2", exact: true }).click();
  await page.keyboard.press("6");
  await expect(
    page.getByRole("button", { name: "Shot 2", exact: true }),
  ).toHaveClass(/selected/);
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue("CU");
  await page.keyboard.press("8");
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue(
    "Insert",
  );
  await page.keyboard.press("9");
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue(
    "OTS",
  );
  await page.keyboard.press("0");
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue(
    "POV",
  );
  await page.getByLabel("Advance after tagging").check();
  await page.getByRole("button", { name: "Shot 3", exact: true }).click();
  await page.keyboard.press("1");
  await expect(
    page.getByRole("button", { name: "Shot 3", exact: true }),
  ).toHaveClass(/selected/);
  await expect(page.getByRole("status")).toContainText("Last shot tagged");
});

test("rhythm keeps short cuts readable beside a long hold", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const edl =
    "001 AX V C 00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00\n002 AX V C 00:00:00:00 00:00:02:00 00:00:01:00 00:00:03:00\n003 AX V C 00:00:00:00 00:04:00:00 00:00:03:00 00:04:03:00";
  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles({
      name: "outlier.edl",
      mimeType: "text/plain",
      buffer: Buffer.from(edl),
    });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".rhythm .rhythm-summary")).toContainText(
    "Typical shot 2.00s",
  );
  const bar = page.getByRole("button", { name: "Rhythm shot 1", exact: true });
  const compressed = (await bar.boundingBox())!.height;
  expect(compressed).toBeGreaterThan(20);
  await bar.hover();
  await expect(page.locator(".rhythm .rhythm-detail")).toContainText(
    "1.00 sec",
  );
  await bar.click();
  await expect(bar).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue(
    "Unknown",
  );
  await page.getByLabel("Rhythm duration scale").selectOption("linear");
  expect((await bar.boundingBox())!.height).toBeLessThan(compressed);
  await page.getByLabel("Rhythm duration scale").selectOption("compressed");
  await page
    .locator(".rhythm")
    .screenshot({ path: "tests/browser/rhythm.png" });
});

test("local pacing window and seeking", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: "Local pacing", exact: true }).click();
  await expect(page.locator(".pacing")).toContainText("03 / LOCAL PACING");
  await expect(page.getByLabel("Pacing window")).toHaveValue("30");
  await expect(page.locator(".pacing")).toContainText("8.9 cuts/min");
  await page.getByLabel("Pacing window").selectOption("10");
  await expect(page.locator(".pacing")).toContainText("24.0 cuts/min");
  const graph = page.getByRole("slider", { name: "Local pacing seek" });
  await graph.click({ position: { x: 100, y: 70 } });
  expect(Number(await graph.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  await graph.press("Home");
  await expect(graph).toHaveAttribute("aria-valuenow", "0");
  await graph.press("ArrowRight");
  await expect(graph).toHaveAttribute("aria-valuenow", "1");
});

test("separate classification fields persist and text blocks size tagging", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await page
    .getByLabel("People in frame", { exact: true })
    .selectOption("Group");
  await page.getByLabel("Shot size uncertain").check();
  await page
    .getByLabel("Main subject", { exact: true })
    .selectOption("Text / title card");
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue(
    "Not applicable",
  );
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await page.keyboard.press("5");
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue(
    "Not applicable",
  );
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: /Untitled film/ }).click();
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await expect(page.getByLabel("People in frame", { exact: true })).toHaveValue(
    "Group",
  );
  await expect(page.getByLabel("Shot size uncertain")).toBeChecked();
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue(
    "Not applicable",
  );
  await page.getByLabel("Main subject", { exact: true }).selectOption("People");
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue(
    "Unknown",
  );
});

test("clear category labels and expanded subjects survive save and reopen", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  const size = page.getByLabel("Shot size", { exact: true });
  await expect(size.locator("option:checked")).toHaveText("Unknown");
  await expect(page.getByLabel("People in frame").locator("option")).toHaveText(
    ["No people", "One person", "Two people", "Group (3+)", "Unknown"],
  );
  await page
    .getByLabel("People in frame")
    .selectOption({ label: "Two people" });
  await page
    .getByLabel("Main subject")
    .selectOption({ label: "Landscape / nature" });
  await size.selectOption("WS");
  await expect(size).toBeEnabled();
  await expect(size).toHaveAttribute(
    "title",
    "Whole subject with substantial surroundings",
  );
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: /Untitled film/ }).click();
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await expect(page.getByLabel("Main subject")).toHaveValue(
    "Landscape / nature",
  );
  await expect(page.getByLabel("People in frame")).toHaveValue("Two-shot");
  await expect(size).toHaveValue("WS");
  await page
    .locator(".inspector")
    .screenshot({ path: "/tmp/editmap-categories.png" });
});
