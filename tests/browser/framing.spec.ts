import { test, expect } from "@playwright/test";
import path from "node:path";

test("framing summary, arc selection and local share follow current tags", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).first().click();
  await page
    .locator('input[accept*=".edl"]')
    .setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  for (const [index, size] of [
    [1, "Wide"],
    [2, "Close"],
    [3, "Extreme close"],
  ] as const) {
    await page
      .getByRole("button", { name: `Shot ${index}`, exact: true })
      .click();
    await page.getByLabel("Shot size", { exact: true }).selectOption(size);
  }
  await page
    .getByRole("button", { name: "Framing summary", exact: true })
    .click();
  await expect(page.locator(".framing-summary")).toContainText("100.0%");
  await expect(
    page
      .locator(".framing-bin")
      .filter({ has: page.getByText("Extreme close", { exact: true }) }),
  ).toContainText("74.1%");
  await page.getByRole("button", { name: "Framing arc", exact: true }).click();
  await page
    .getByRole("button", { name: "Framing shot 2", exact: true })
    .click();
  await expect(page.getByLabel("Shot size", { exact: true })).toHaveValue("Close");
  await expect(
    page.getByRole("button", { name: "Framing shot 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Local pacing", exact: true }).click();
  await expect(page.locator(".pacing .rhythm-summary")).toContainText("92.6%");
  await page.getByLabel("Pacing window").selectOption("10");
  await expect(page.locator(".pacing .rhythm-summary")).toContainText("83.3%");
  await page.screenshot({ path: "/tmp/editmap-framing.png", fullPage: true });
});
