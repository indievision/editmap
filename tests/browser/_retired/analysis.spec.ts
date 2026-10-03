import { test, expect } from "@playwright/test";
import path from "node:path";
import { startNewProject } from "../helpers";
test("local analysis fills inspector fields and persists after confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await startNewProject(page);
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(path.resolve("fixtures/test-film.mp4"));
  await expect(page.locator(".video-meta")).toContainText("640 × 360");
  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await page.route(/.*(\/local-model\/api\/chat|\/api\/analyze-shot).*/, (route) =>
    route.fulfill({
      json: {
        message: {
          content: JSON.stringify({
            shotSize: "Close",
            composition: "Single person",
            content: "People",
            uncertain: true,
          }),
        },
      },
    }),
  );
  await page
    .getByRole("button", { name: /Analyze frame|Reanalyze frame/ })
    .click();
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue("Close");
  await expect(page.getByLabel("People in frame", { exact: true })).toHaveValue("Single person");
  await expect(page.getByLabel("Main subject", { exact: true })).toHaveValue("People");
  await expect(page.getByLabel("Shot size uncertain", { exact: true })).toBeChecked();
  await expect(page.locator(".shot-analysis")).toContainText("Needs review");
  await page.getByRole("button", { name: "Confirm current tags" }).click();
  await page.getByRole("button", { name: "Save", exact: false }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.reload();
  await page.getByRole("button", { name: "Open project", exact: true }).click();
  await page.getByRole("button", { name: /Untitled film/ }).click();
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await expect(page.locator(".shot-analysis")).toContainText("Confirmed");
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue("Close");
  await page.getByRole("button", { name: /Unreviewed 2/ }).click();
  await page.getByRole("button", { name: "Next matching shot" }).click();
  await expect(
    page.getByRole("button", { name: "Shot 2", exact: true }),
  ).toHaveClass(/selected/);
});

test("a delayed selected-shot result preserves concurrent notes and manual tags", async ({ page }) => {
  await page.goto("/");
  await startNewProject(page);
  await page.locator("input[type=file]").first().setInputFiles(path.resolve("fixtures/test-film.mp4"));
  await page.locator('input[accept*=".edl"]').setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  let release: (() => void) | undefined;
  await page.route(/.*(\/local-model\/api\/chat|\/api\/analyze-shot).*/, async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { message: { content: JSON.stringify({ shotSize: "Close", composition: "Single person", content: "People", uncertain: false }) } } });
  });
  await page.getByRole("button", { name: /Analyze frame|Reanalyze frame/ }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByLabel("Shot size", { exact: true }).selectOption("Medium");
  await page.getByRole("textbox", { name: "Notes", exact: true }).fill("human note while inference runs");
  release?.();
  await expect(page.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue("human note while inference runs");
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue("Medium");
  await expect(page.getByLabel("People in frame", { exact: true })).toHaveValue("Single person");
});
