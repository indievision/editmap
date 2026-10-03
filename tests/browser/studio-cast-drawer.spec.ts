import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { startNewProject } from "./helpers";

async function storedCast(page: Page, projectName: string) {
  return page.evaluate(
    (name) =>
      new Promise<{ name: string }[] | undefined>((resolve, reject) => {
        const open = indexedDB.open("editmap", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction("projects").objectStore("projects").getAll();
          all.onsuccess = () => resolve(all.result.find((p: any) => p.name === name)?.cast);
        };
      }),
    projectName,
  );
}

test("Cast drawer: add characters, assign to a shot, rename, merge, and persist", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await startNewProject(page);
  await page.getByLabel("Project name").fill("Cast verification");
  await page.locator('input[accept*=".edl"]').setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);
  await page.getByRole("button", { name: "Shot 1", exact: true }).click();

  // The Cast drawer opens from the tool rail and fits the left panel.
  const castTab = page.locator('.studio-rail-btn[aria-label="Cast"]');
  await castTab.click();
  const drawer = page.locator(".studio-detail-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveClass(/drawer-open/);
  const width = (await drawer.boundingBox())!.width;
  expect(width).toBeGreaterThanOrEqual(460);
  expect(width).toBeLessThanOrEqual(520);
  await expect(page.getByLabel("Cast Gallery")).toBeVisible();

  // Add three characters from the roster.
  const roster = page.getByRole("radiogroup", { name: "Characters" });
  for (const name of ["Nora", "Elias", "Mara"]) {
    await page.getByRole("button", { name: /^\+?\s*Add$/ }).click();
    await page.getByPlaceholder("Name...").fill(name);
    await page.getByPlaceholder("Name...").press("Enter");
  }
  await expect(roster.getByRole("radio")).toHaveCount(3);

  // Select Nora and assign her to the current shot; her details update.
  await roster.getByRole("radio", { name: /Nora/ }).click();
  await expect(page.locator(".cast-member-name")).toHaveText("Nora");
  await expect(page.locator(".cast-shots-count")).toHaveText("0 shots");
  await page.getByRole("button", { name: "+ Add to Shot 1" }).click();
  await expect(page.getByRole("button", { name: "In Shot 1 ✓" })).toBeVisible();
  await expect(page.locator(".cast-shots-count")).toHaveText("1 shots");

  // Rename Nora to Eleanor.
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const rename = page.locator(".cast-rename-input");
  await rename.fill("Eleanor");
  await rename.press("Enter");
  await expect(page.locator(".cast-member-name")).toHaveText("Eleanor");

  // Merge Eleanor into Elias: two characters remain.
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await page.locator(".merge-target-btn", { hasText: "Elias" }).click();
  await expect(roster.getByRole("radio")).toHaveCount(2);
  await expect(roster.getByRole("radio", { name: /Eleanor/ })).toHaveCount(0);

  // Everything is saved to browser storage.
  await expect
    .poll(async () => ((await storedCast(page, "Cast verification")) ?? []).map((c) => c.name).sort(), { timeout: 10_000 })
    .toEqual(["Elias", "Mara"]);
  expect(errors).toEqual([]);
});
