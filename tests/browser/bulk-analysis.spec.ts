import { test, expect, type Page, type Route } from "@playwright/test";
import path from "node:path";

const endpoint = /.*(\/local-model\/api\/chat|\/api\/analyze-shot).*/;
const predictions = [
  {
    shotSize: "CU",
    composition: "Single person",
    content: "People",
    uncertain: false,
  },
  {
    shotSize: "WS",
    composition: "Two-shot",
    content: "Landscape / nature",
    uncertain: true,
  },
  {
    shotSize: "ECU",
    composition: "No people",
    content: "Object / detail",
    uncertain: false,
  },
];
const respond = (route: Route, index: number) =>
  route.fulfill({
    json: { message: { content: JSON.stringify(predictions[index]) } },
  });

test("scan follows each sampled frame, then scrubbing restores the live monitor", async ({
  page,
}) => {
  await setup(page);
  const pending: Route[] = [];
  await page.route(endpoint, (route) => {
    pending.push(route);
  });
  await page
    .getByRole("button", { name: "1. Scan framing & people", exact: true })
    .click();
  const times = [0.5, 2.25, 8.5];
  for (let i = 0; i < times.length; i++) {
    await expect.poll(() => pending.length).toBe(i + 1);
    await expect(
      page.getByRole("button", { name: `Shot ${i + 1}`, exact: true }),
    ).toHaveClass(/selected/);
    await expect(
      page.getByRole("slider", { name: "Timeline playhead" }),
    ).toHaveAttribute("aria-valuenow", String(times[i]));
    const payload = pending[i].request().postDataJSON();
    const frameImg = payload.image ?? payload.messages?.at(-1)?.images?.[0];
    await expect(page.locator(".analysis-preview img")).toHaveAttribute(
      "src",
      `data:image/jpeg;base64,${frameImg}`,
    );
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeCloseTo(times[i], 3);
    await respond(pending[i], i);
  }
  await expect(page.locator(".all-shots-analysis")).toContainText(
    "Framing scan complete",
  );
  await expect(page.locator(".analysis-preview")).toHaveCount(0);
  await expect.poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  const playhead = page.getByRole("slider", { name: "Timeline playhead" });
  const head = (await playhead.boundingBox())!;
  const canvas = (await page.locator(".map-canvas").boundingBox())!;
  await page.mouse.move(head.x + head.width / 2, head.y + 8);
  await page.mouse.down();
  await page.mouse.move(canvas.x + (canvas.width * 2) / 13.5, head.y + 8, {
    steps: 12,
  });
  await page.mouse.up();
  await page.getByRole("button", { name: "Shot 2", exact: true }).click();
  await expect(page.locator(".analysis-preview")).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(1, 1);
  await expect(
    page.getByRole("button", { name: "Shot 2", exact: true }),
  ).toHaveClass(/selected/);
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((v: HTMLVideoElement) => v.paused && !v.seeking),
    )
    .toBe(true);
  await playhead.press("Home");
  await expect(playhead).toHaveAttribute("aria-valuenow", "0");
  await playhead.press("ArrowRight");
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(1 / 24, 3);
  await page.screenshot({
    path: "test-results/scrub-preview.png",
    fullPage: true,
  });
});

async function importShots(page: Page) {
  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
}

async function setup(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const castTab = page.getByRole("tab", { name: "Cast & AI" });
  if (await castTab.isVisible()) {
    await castTab.click();
  }
  await expect(
    page.getByRole("button", { name: "1. Scan framing & people", exact: true }),
  ).toBeDisabled();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));
  await expect(page.locator(".video-meta")).toContainText("640 × 360");
  await importShots(page);
}

test("scans every shot, protects confirmed edits, and saves direct readings", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await page.getByLabel("Shot size", { exact: true }).selectOption("MS");
  await page.getByRole("button", { name: "Confirm current tags" }).click();
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Keep this manual note");
  let requests = 0;
  let pending: Route;
  await page.route(endpoint, async (route) => {
    const index = requests++;
    if (index === 0) pending = route;
    else await respond(route, index);
  });
  await page
    .getByRole("button", { name: "1. Scan framing & people", exact: true })
    .click();
  await expect.poll(() => requests).toBe(1);
  await expect(
    page.getByRole("button", { name: /Analyze selected shot|Reanalyze shot/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Shot 3", exact: true }).click();
  await respond(pending!, 0);
  await expect(page.locator(".all-shots-analysis")).toContainText(
    "Framing scan complete · 2 of 2",
  );
  expect(requests).toBe(2);
  await expect(
    page.getByRole("button", { name: "Shot 3", exact: true }),
  ).toHaveClass(/selected/);
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue("MS");
  await expect(
    page.getByRole("textbox", { name: "Notes", exact: true }),
  ).toHaveValue("Keep this manual note");
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.locator("footer [role=status]")).toContainText("saved");
  await page.screenshot({ path: "test-results/bulk-scan.png", fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: /Untitled film/ }).click();
  const castTabAfterReload = page.getByRole("tab", { name: "Cast & AI" });
  if (await castTabAfterReload.isVisible()) {
    await castTabAfterReload.click();
  }
  await expect(
    page.getByRole("button", { name: "1. Scan framing & people", exact: true }),
  ).toBeDisabled();
  for (let i = 0; i < predictions.length; i++) {
    await page
      .getByRole("button", { name: `Shot ${i + 1}`, exact: true })
      .click();
    await expect(page.locator(".shot-analysis")).toContainText(i === 0 ? "Confirmed" : "Needs review");
    await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue(
      i === 0 ? "MS" : predictions[i - 1].shotSize,
    );
    await expect(
      page.getByLabel("People in frame", { exact: true }),
    ).toHaveValue(i === 0 ? "Unknown" : predictions[i - 1].composition);
    await expect(page.getByLabel("Main subject", { exact: true })).toHaveValue(
      i === 0 ? "Unknown" : predictions[i - 1].content,
    );
  }
});

test("single-shot analysis blocks bulk scanning until cancelled", async ({
  page,
}) => {
  await setup(page);
  let requests = 0;
  await page.route(endpoint, () => {
    requests++;
  });
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await page
    .getByRole("button", { name: /Analyze selected shot|Reanalyze shot/ })
    .click();
  await expect.poll(() => requests).toBe(1);
  await expect(
    page.getByRole("button", { name: "1. Scan framing & people", exact: true }),
  ).toBeDisabled();
  await page
    .locator(".shot-analysis")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "1. Scan framing & people", exact: true }),
  ).toBeEnabled();
});

test("cancels an active scan and resumes from the unfinished shot", async ({
  page,
}) => {
  await setup(page);
  let requests = 0;
  let pending: Route;
  await page.route(endpoint, async (route) => {
    requests++;
    if (requests === 2) pending = route;
    else await respond(route, requests === 1 ? 0 : requests === 4 ? 1 : 2);
  });
  await page
    .getByRole("button", { name: "1. Scan framing & people", exact: true })
    .click();
  await expect.poll(() => requests).toBe(2);
  await page.getByRole("button", { name: "Cancel scan", exact: true }).click();
  await expect(page.locator(".all-shots-analysis")).toContainText(
    "Framing scan stopped · 1 of 3",
  );
  await respond(pending!, 1);
  await page.getByRole("button", { name: "Shot 2", exact: true }).click();
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue("Unknown");
  await page.getByRole("button", { name: "Resume scan", exact: true }).click();
  await expect(page.locator(".all-shots-analysis")).toContainText(
    "Framing scan complete · 3 of 3",
  );
  expect(requests).toBe(4);
});

test("stops on model failure, preserves completed results and retries without rescanning them", async ({
  page,
}) => {
  await setup(page);
  let requests = 0;
  await page.route(endpoint, async (route) => {
    requests++;
    if (requests === 2 || requests === 3)
      await route.fulfill({ status: 503, json: { error: "Unavailable" } });
    else await respond(route, requests === 1 ? 0 : requests === 4 ? 1 : 2);
  });
  await page
    .getByRole("button", { name: "1. Scan framing & people", exact: true })
    .click();
  await expect(page.locator(".all-shots-analysis [role=alert]")).toContainText(
    "Shot 2: Local analysis failed (HTTP 503): Unavailable",
  );
  expect(requests).toBe(3);
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue("CU");
  await page.getByRole("button", { name: "Resume scan", exact: true }).click();
  await expect(page.locator(".all-shots-analysis")).toContainText(
    "Framing scan complete · 3 of 3",
  );
  await expect(page.locator(".all-shots-analysis [role=alert]")).toHaveCount(0);
  expect(requests).toBe(5);
});

for (const change of ["EDL", "video", "project"] as const) {
  test(`changing ${change} aborts the scan and ignores late results`, async ({
    page,
  }) => {
    await setup(page);
    let requests = 0;
    let pending: Route;
    await page.route(endpoint, (route) => {
      requests++;
      pending = route;
    });
    await page
      .getByRole("button", { name: "1. Scan framing & people", exact: true })
      .click();
    await expect.poll(() => requests).toBe(1);
    if (change === "EDL") {
      // Replacing an existing timeline is intentionally confirmed; accepting
      // it must abort the in-flight sampler before the new timeline mounts.
      page.once("dialog", (dialog) => dialog.accept());
      await importShots(page);
    }
    if (change === "video") {
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles(path.resolve("fixtures/test-film.mp4"));
    }
    if (change === "project") {
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "New", exact: true }).click();
      await importShots(page);
    }
    await expect(
      page.getByRole("button", { name: "Cancel scan", exact: true }),
    ).toHaveCount(0);
    await respond(pending!, 0);
    await page.getByRole("button", { name: "Shot 1", exact: true }).click();
    await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue("Unknown");
    await expect(
      page.getByRole("button", { name: "Resume scan", exact: true }),
    ).toHaveCount(0);
    expect(requests).toBe(1);
  });
}
