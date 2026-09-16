import { expect, test } from "@playwright/test";
import path from "node:path";

test("Cinematic Atlas charts render in Studio, Map Focus, and Review Desk", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.locator('input[accept*=".edl"]').setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);

  await page.getByRole("button", { name: "Local pacing", exact: true }).click();
  const pacingChart = page.locator(".pacing-echart");
  await expect(pacingChart.locator("canvas")).toBeVisible();
  await pacingChart.click({ position: { x: 220, y: 80 } });
  await expect(pacingChart).not.toHaveAttribute("aria-valuenow", "0");

  await page.getByRole("tab", { name: "Map Focus", exact: true }).click();
  await expect(page.locator(".map-rhythm-echart canvas")).toBeVisible();

  await page.getByRole("tab", { name: "Review Desk", exact: true }).click();
  await expect(page.locator(".review-evidence-echart canvas")).toBeVisible();
});
