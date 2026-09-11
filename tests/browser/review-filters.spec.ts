import { test, expect } from "@playwright/test";
import path from "node:path";

async function projectWithTimeline(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.locator('input[accept*=".edl"]').setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
}

test("map and tag strip precede setup and review filters preserve the duration-scaled map", async ({ page }) => {
  await projectWithTimeline(page);
  const monitor = await page.locator(".monitor").boundingBox();
  const map = await page.locator(".map").boundingBox();
  const tags = await page.locator(".tag-toolbar").boundingBox();
  const setup = await page.locator(".all-shots-analysis").boundingBox();
  expect(map!.y).toBeGreaterThan(monitor!.y);
  expect(tags!.y).toBeGreaterThan(map!.y);
  expect(setup!.y).toBeGreaterThan(tags!.y);
  const before = await page.locator(".shot").evaluateAll((items) => items.map((item) => ({ left: item.getBoundingClientRect().left, width: item.getBoundingClientRect().width })));
  await page.getByRole("button", { name: /Unreviewed 3/ }).click();
  await expect(page.locator(".review-filters")).toContainText("3 matching shots");
  const after = await page.locator(".shot").evaluateAll((items) => items.map((item) => ({ left: item.getBoundingClientRect().left, width: item.getBoundingClientRect().width })));
  expect(after).toEqual(before);
  await page.getByRole("button", { name: "Shot 2", exact: true }).click();
  await page.getByRole("button", { name: "Next matching shot" }).click();
  await expect(page.getByRole("button", { name: "Shot 3", exact: true })).toHaveClass(/selected/);
  await page.getByRole("button", { name: "Previous matching shot" }).click();
  await expect(page.getByRole("button", { name: "Shot 2", exact: true })).toHaveClass(/selected/);
  await page.screenshot({ path: "tests/browser/review-layout.png", fullPage: true });
});

test("filters update after confirmation and setup disclosures remain keyboard accessible", async ({ page }) => {
  await projectWithTimeline(page);
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();
  await page.getByLabel("Shot size uncertain").check();
  await page.getByRole("button", { name: "Confirm current tags" }).click();
  await page.getByRole("button", { name: /Uncertain 1/ }).click();
  await expect(page.locator(".shot.review-dimmed")).toHaveCount(2);
  await page.getByRole("button", { name: /Unreviewed 2/ }).click();
  await expect(page.locator(".review-filters")).toContainText("2 matching shots");
  const scanToggle = page.getByRole("button", { name: "Collapse setup" });
  await scanToggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Show setup" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Show setup" }).click();
  await expect(page.getByRole("button", { name: "Collapse setup" })).toHaveAttribute("aria-expanded", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "tests/browser/review-narrow.png", fullPage: true });
});
