import { test, expect } from "@playwright/test";
import path from "node:path";

test("Studio timeline toolbar simplification across standard and expanded Studio viewports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 1. Standard Studio at 1440x900
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill("Toolbar Simplification Spec");
  await page.locator("input[type=file]").first().setInputFiles(path.resolve("fixtures/test-film.mp4"));
  await page.locator('input[accept*=".edl"]').setInputFiles(path.resolve("fixtures/cuts-24.edl"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".shot")).toHaveCount(3);

  const toolbar = page.locator(".studio-toolbar-row");
  await expect(toolbar).toBeVisible();

  // Main toolbar controls: Split, Merge, In, Out, Clear In/Out, Snap, Mark, Squint, Fit, Zoom out (-), Zoom Slider, Zoom in (+), Fullscreen
  await expect(toolbar.locator("#studio-action-split")).toBeVisible();
  await expect(toolbar.locator("#studio-action-merge")).toBeVisible();
  await expect(toolbar.locator("#studio-action-in")).toBeVisible();
  await expect(toolbar.locator("#studio-action-out")).toBeVisible();
  await expect(toolbar.locator("#studio-action-clear-in-out")).toBeVisible();
  await expect(toolbar.locator("#studio-action-snap")).toBeVisible();
  await expect(toolbar.locator("#studio-action-mark")).toBeVisible();
  await expect(toolbar.locator("#studio-action-squint")).toBeVisible();
  await expect(toolbar.locator("#studio-nav-fit")).toBeVisible();
  await expect(toolbar.locator("#studio-nav-zoom-out")).toBeVisible();
  await expect(toolbar.locator(".studio-zoom-slider")).toBeVisible();
  await expect(toolbar.locator("#studio-nav-zoom-in")).toBeVisible();
  await expect(toolbar.locator("#studio-nav-fullscreen")).toBeVisible();

  // Confirm removed duplicated controls and expanded tools menu do NOT exist on the toolbar
  await expect(toolbar.locator("#studio-tool-rhythm")).toHaveCount(0);
  await expect(toolbar.locator("#studio-tool-sequence")).toHaveCount(0);
  await expect(toolbar.locator("#studio-tool-sound")).toHaveCount(0);
  await expect(toolbar.locator("#studio-tool-cuts")).toHaveCount(0);
  await expect(toolbar.locator("#studio-tool-cast")).toHaveCount(0);
  await expect(toolbar.locator("#studio-tool-color")).toHaveCount(0);
  await expect(toolbar.locator("#studio-tool-palette")).toHaveCount(0);
  await expect(toolbar.locator(".studio-toolbar-divider")).toHaveCount(0);
  await expect(toolbar.locator(".studio-toolbar-overflow-wrap")).toHaveCount(0);
  await expect(toolbar.locator("#studio-tools-menu-btn")).toHaveCount(0);

  // Verify interactive states of retained controls
  const snapBtn = toolbar.locator("#studio-action-snap");
  const wasSnapActive = (await snapBtn.getAttribute("aria-pressed")) === "true";
  await snapBtn.click();
  expect((await snapBtn.getAttribute("aria-pressed")) === "true").toBe(!wasSnapActive);
  await snapBtn.click();

  const squintBtn = toolbar.locator("#studio-action-squint");
  await squintBtn.click();
  expect(await squintBtn.getAttribute("aria-pressed")).toBe("true");
  await squintBtn.click();
  expect(await squintBtn.getAttribute("aria-pressed")).toBe("false");

  // Verify upper-left data-window controls (StudioToolRail) remain accessible
  const toolRail = page.locator(".studio-tool-rail");
  await expect(toolRail).toBeVisible();
  const rhythmTab = toolRail.locator('.studio-tab[aria-label="Rhythm"]');
  const structureTab = toolRail.locator('.studio-tab[aria-label="Structure"]');
  await expect(rhythmTab).toBeVisible();
  await expect(structureTab).toBeVisible();

  await structureTab.click();
  await expect(page.locator(".studio-detail-drawer")).toBeVisible();

  // Verify Palette track collapse/expand control in timeline
  const paletteHeader = page.locator(".palette-header");
  await expect(paletteHeader).toBeVisible();
  const paletteFoldBtn = paletteHeader.locator(".studio-track-fold-btn");
  const paletteLane = page.locator(".studio-palette-lane");
  await paletteFoldBtn.click();
  await expect(paletteLane).toHaveClass(/collapsed/);
  await paletteFoldBtn.click();
  await expect(paletteLane).not.toHaveClass(/collapsed/);

  // 2. Standard Studio at narrow width (720x900)
  await page.setViewportSize({ width: 720, height: 900 });
  await page.waitForTimeout(200);
  await expect(toolbar.locator("#studio-action-split")).toBeVisible();
  await expect(toolbar.locator("#studio-action-merge")).toBeVisible();
  await expect(toolbar.locator("#studio-action-in")).toBeVisible();
  await expect(toolbar.locator("#studio-action-out")).toBeVisible();
  await expect(toolbar.locator("#studio-action-clear-in-out")).toBeVisible();
  await expect(toolbar.locator("#studio-action-snap")).toBeVisible();
  await expect(toolbar.locator("#studio-action-mark")).toBeVisible();
  await expect(toolbar.locator("#studio-action-squint")).toBeVisible();
  await expect(toolbar.locator("#studio-nav-zoom-out")).toBeVisible();
  await expect(toolbar.locator("#studio-nav-fullscreen")).toBeVisible();

  // 3. Expanded Studio at 1440x900
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(page.locator(".workspace")).toHaveClass(/studio-map-expanded/);

  // In expanded Studio, toolbar remains streamlined without tools menu button
  await expect(toolbar.locator("#studio-tools-menu-btn")).toHaveCount(0);
  await expect(toolbar.locator("#studio-action-split")).toBeVisible();
  await expect(toolbar.locator("#studio-nav-fullscreen")).toBeVisible();

  // 4. Expanded Studio at narrow width (720x900)
  await page.setViewportSize({ width: 720, height: 900 });
  await page.waitForTimeout(200);
  await expect(toolbar.locator("#studio-action-split")).toBeVisible();
  await expect(toolbar.locator("#studio-nav-fullscreen")).toBeVisible();

  expect(errors).toEqual([]);
});
