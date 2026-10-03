import { test, expect } from '@playwright/test';
import path from 'node:path';
import { startNewProject } from "../helpers";

test('expanded Studio preserves the live video, timeline state and tools', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await startNewProject(page);
  await page.getByLabel('Project name').fill('Expanded Studio verification');
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('fixtures/test-film.mp4'));
  await page.locator('input[accept*=".edl"]').setInputFiles(path.resolve('fixtures/cuts-24.edl'));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('.shot')).toHaveCount(3);
  await expect(page.getByRole('tab', { name: 'Map Focus', exact: true })).toHaveCount(0);
  const video = await page.locator("#studioVideoPlayer").elementHandle();
  const canvas = await page.locator('.map-canvas').elementHandle();
  await page.locator('.shot').nth(1).click();
  const selected = await page.locator('.shot.selected').getAttribute('aria-label');
  await page.getByLabel('Timeline zoom slider').fill('2');
  const zoom = await page.getByLabel('Timeline zoom slider').inputValue();
  await page.getByRole('tab', { name: 'Rhythm', exact: true }).click();
  await expect(page.locator('.studio-detail-drawer')).toBeVisible();
  await page.getByRole('button', { name: 'Expand map', exact: true }).click();
  await expect(page.locator('.studio-detail-drawer')).toBeHidden();
  await expect(page.locator('.workspace')).toHaveClass(/studio-map-expanded/);
  await expect(page.locator('.studio-top-overview')).toBeVisible();
  await expect(page.locator('.expanded-map-context')).toBeVisible();
  expect(await video!.evaluate(el => el === document.querySelector('video'))).toBe(true);
  expect(await canvas!.evaluate(el => el === document.querySelector('.map-canvas'))).toBe(true);
  await expect(page.getByLabel('Timeline zoom slider')).toHaveValue(zoom);
  await expect(page.locator('.shot.selected')).toHaveAttribute('aria-label', selected!);
  await page.locator('.studio-layer-menu summary').click();
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await expect(page.locator('.studio-motion-lane')).toHaveClass(/collapsed/);
  await page.locator('.studio-layer-menu summary').click();
  await page.getByRole('tab', { name: 'Structure', exact: true }).click();
  await expect(page.locator('.studio-detail-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.studio-detail-drawer')).toBeHidden();
  for (const [header, lane] of [['story', 'story'], ['cut-density', 'cut-density'], ['framing', 'framing'], ['motion', 'motion'], ['sound', 'sound'], ['cast', 'cast']]) {
    const a = await page.locator(`.${header}-header`).boundingBox();
    const b = await page.locator(`.studio-${lane}-lane`).boundingBox();
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  }
  await page.screenshot({ path: 'tests/browser/screenshots/studio-expanded-map-desktop.png' });
  await page.locator("#studioVideoPlayer").evaluate((el: HTMLVideoElement) => { el.currentTime = 0; return el.play(); });
  await page.getByRole('button', { name: 'Restore Studio', exact: true }).click();
  await expect(page.locator('.studio-detail-drawer')).toBeVisible();
  expect(await video!.evaluate((el: HTMLVideoElement) => !el.paused)).toBe(true);
  await page.getByRole('button', { name: 'Expand map', exact: true }).click();
  expect(await video!.evaluate((el: HTMLVideoElement) => !el.paused)).toBe(true);
  await page.locator("#studioVideoPlayer").evaluate((el: HTMLVideoElement) => el.pause());
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: 'Restore Studio', exact: true })).toBeVisible();
    await expect(page.locator('.monitor')).toBeVisible();
    const monitorBox = await page.locator('.monitor').boundingBox();
    expect(monitorBox!.width).toBeGreaterThan(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `tests/browser/screenshots/studio-expanded-map-${width}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});
