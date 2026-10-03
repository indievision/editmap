import { expect, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Starts a fresh project and lands in Studio.
 *
 * The app opens on the Screening hub. "New Project" is in the header File menu,
 * and Studio only unlocks once a film is linked, so: create the project, link
 * the film through the first (video) picker, then switch to the Studio tab.
 * The project name field and the EDL picker live in Studio.
 */
export async function startNewProject(page: Page, video = "fixtures/test-film.mp4") {
  const item = page.getByRole("menuitem", { name: "New project" });
  if (!(await item.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /^File\b/ }).click();
  }
  await item.click();
  // The Screening hub runs in an iframe that resets the mode when it finishes
  // loading, so let it settle before linking the film and leaving.
  const hub = page.frameLocator(".duet-console-iframe");
  await hub.getByRole("heading", { name: "Screen a cut together." }).waitFor();
  await page.locator("input[type=file]").first().setInputFiles(path.resolve(video));
  await hub.getByText("Video loaded").waitFor();
  // Studio unlocks asynchronously once the film is linked, so retry the switch.
  const studio = page.getByRole("tab", { name: /^Studio/ });
  await expect(async () => {
    await studio.click();
    await expect(studio).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.getByLabel("Project name").waitFor();
}
