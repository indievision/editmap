import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { startNewProject } from "../helpers";

async function setup(page: Page) {
  await page.goto("/");
  await startNewProject(page);
  await page.locator('input[type=file]').first().setInputFiles(path.resolve("fixtures/test-film.mp4"));
  await page.locator('input[accept*=".edl"]').setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
}

test("header analysis preserves EDL and full workflow retains failed framing for resume", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Cast & AI" })).toHaveAttribute("aria-selected", "true");
  let calls = 0;
  await page.route("**/api/analyze-shot", route => {
    calls++;
    return calls === 1 ? route.fulfill({ json: { shotSize: "WS", composition: "No people", content: "Other", uncertain: true, model: "audit-model" } }) : route.fulfill({ status: 503, json: { detail: "Test engine offline" } });
  });
  await page.getByRole("button", { name: "Analyze Movie", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume scan", exact: true })).toBeVisible();
  await expect(page.locator(".all-shots-analysis")).toContainText("1 of 3 complete");
  await expect(page.getByRole("button", { name: "Shot 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue("WS");
});

test("DME cancellation cancels the server job and does not install unfinished waveforms", async ({ page }) => {
  await setup(page);
  let cancelled = false;
  await page.route("**/api/separate-dme", route => route.fulfill({ status: 202, json: { jobId: "test-job" } }));
  await page.route("**/api/dme-jobs/test-job", route => {
    if (route.request().method() === "DELETE") { cancelled = true; return route.fulfill({ json: { status: "cancelling" } }); }
    return route.fulfill({ json: { status: "running", progress: .2 } });
  });
  const button = page.locator(".btn-dme-test");
  await button.click();
  await expect(button).toContainText("Cancel");
  await button.click();
  await expect.poll(() => cancelled).toBe(true);
  await expect(page.locator(".dme-mode-pills")).toHaveCount(0);
});

test("new-film analysis checkpoints failed framing and reports failure counts", async ({ page }) => {
  await page.goto("/");
  await startNewProject(page);
  await page.locator('input[type=file]').first().setInputFiles(path.resolve("fixtures/test-film.mp4"));
  await page.route("**/api/analyze-shot", route => route.fulfill({ status: 503, json: { detail: "Test framing offline" } }));
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator("footer")).toContainText("framing failures", { timeout: 30000 });
  await expect(page.locator("footer")).toContainText("0 framing readings");
  await expect(page.getByRole("button", { name: /^Failed [1-9]/ })).toBeVisible();
});
