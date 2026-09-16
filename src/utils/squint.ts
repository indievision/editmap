/**
 * Composite Multi-Effect Squint Engine
 *
 * Recreates biological and optical squinting:
 * 1. Diffraction Blur: Pinhole / eyelash diffraction eliminating high-frequency surface details.
 * 2. Rod Desaturation: Progressively cuts chromatic distraction to evaluate pure luminance.
 * 3. Chiaroscuro / Notan Tonal Massing: Uses dual-contrast expansion to re-group blurred light
 *    into discrete value families (Dark, Mid, Light) instead of a muddy gradient.
 * 4. Highlight Bloom: Allows practicals, windows, and bright light sources to bleed slightly into shadows.
 * 5. Shadow Floor Protection: Prevents near-blacks from completely clipping into 0.
 */

export function getSquintFilter(level: number): string {
  // Level ranges from 1 (subtle) to 10 (deep Notan/Chiaroscuro)
  const lvl = Math.max(1, Math.min(10, Math.round(level)));
  const norm = lvl / 10;

  // 1. Diffraction Blur (1.2px to 8.0px)
  const blurPx = (1.0 + norm * 7.0).toFixed(1);

  // 2. Rod Desaturation (50% at level 1 to 100% full monochrome at level 10)
  const gray = Math.min(100, Math.round(48 + norm * 52));

  // 3. Primary Value Separation (Contrast 1: expands tonal dynamic range)
  const contrast1 = Math.round(116 + norm * 54);

  // 4. Shadow Floor Protection (preserves dark silhouettes from complete crush)
  const brightness = Math.round(102 - norm * 4);

  // 5. Secondary Notan Tonal Massing (re-tightens blurred gradients into distinct value shapes)
  const contrast2 = (1.1 + norm * 0.45).toFixed(2);

  return `grayscale(${gray}%) contrast(${contrast1}%) brightness(${brightness}%) blur(${blurPx}px) contrast(${contrast2})`;
}
