import { test, expect, type Page, type Route } from "@playwright/test";
import path from "node:path";
import { startNewProject } from "./helpers";

const sizes = ["Close", "Wide", "Extreme close"];
const analyzeShotEndpoint = /\/api\/analyze-shot/;

async function importCuts(page: Page) {
  await startNewProject(page);
  await page.locator('input[accept*=".edl"]').setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);
}

/** Opens Analyze and leaves only the framing scan switched on. */
async function openFramingOnlyScan(page: Page) {
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  for (const name of ["Cast", "Dialogue", "Loudness", "Motion", "Stems"]) {
    const toggle = page.getByRole("checkbox", { name: new RegExp(`^${name}\\b`) });
    if (await toggle.isChecked()) await toggle.uncheck();
  }
  await expect(page.getByRole("checkbox", { name: /^Framing\b/ })).toBeChecked();
}

test("analysis scan tags every shot from the local CV service", async ({ page }) => {
  let requests = 0;
  await page.route(analyzeShotEndpoint, (route: Route) => {
    const size = sizes[requests++ % sizes.length];
    return route.fulfill({
      json: { shotSize: size, composition: "Single person", content: "People", uncertain: false, model: "mock" },
    });
  });
  await page.goto("/");
  await importCuts(page);
  await openFramingOnlyScan(page);
  await page.getByRole("button", { name: /Analyze Existing Shots/ }).click();

  for (const [index, size] of sizes.entries()) {
    await expect(page.getByRole("button", { name: `Shot ${index + 1}`, exact: true })).toHaveAttribute("title", new RegExp(size), {
      timeout: 20_000,
    });
  }
  expect(requests).toBeGreaterThanOrEqual(3);
});

test("a failing CV service leaves shots untagged and the app usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(analyzeShotEndpoint, (route) =>
    route.fulfill({ status: 503, json: { detail: "Primary framing model is unavailable.", code: "model_unavailable" } }),
  );
  await page.goto("/");
  await importCuts(page);
  await openFramingOnlyScan(page);
  await page.getByRole("button", { name: /Analyze Existing Shots/ }).click();

  // The failure is reported, nothing is invented, and the editor still works.
  await expect(page.getByText(/Framing failed for 3 of 3 shots/)).toBeVisible({ timeout: 20_000 });
  for (const index of [1, 2, 3]) {
    await expect(page.getByRole("button", { name: `Shot ${index}`, exact: true })).not.toHaveAttribute("title", /Close|Wide/);
  }
  await page.getByRole("button", { name: "Shot 2", exact: true }).click();
  await expect(page.getByRole("button", { name: "Shot 2", exact: true })).toHaveClass(/active/);
  expect(errors).toEqual([]);
});
