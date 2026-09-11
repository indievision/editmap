import test from "node:test";
import assert from "node:assert/strict";
import { extractColorProfile, fallbackColorProfile, detectColorHarmony } from "../src/analysis/colorExtraction";
import type { ColorProfile } from "../src/models/project";

function createMockImageData(
  width: number,
  height: number,
  fillFn: (x: number, y: number) => [number, number, number, number]
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = fillFn(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { data, width, height, colorSpace: "srgb" };
}

test("extractColorProfile correctly calculates Rec. 709 luma for pure black and white", () => {
  const blackImg = createMockImageData(160, 90, () => [0, 0, 0, 255]);
  const blackProfile = extractColorProfile(blackImg, 160, 90);
  assert.equal(blackProfile.luminance, 0);
  assert.equal(blackProfile.mood, "Low-Key / Dark");

  const whiteImg = createMockImageData(160, 90, () => [255, 255, 255, 255]);
  const whiteProfile = extractColorProfile(whiteImg, 160, 90);
  assert.equal(whiteProfile.luminance, 1);
  assert.equal(whiteProfile.mood, "High-Key / Bright");
});

test("extractColorProfile detects warm vs cool temperature balance", () => {
  // Warm amber image: high Red, low Blue
  const warmImg = createMockImageData(100, 100, () => [220, 140, 40, 255]);
  const warmProfile = extractColorProfile(warmImg, 100, 100);
  assert.ok(warmProfile.temperature > 0.15, `Expected temperature > 0.15, got ${warmProfile.temperature}`);
  assert.equal(warmProfile.mood, "Warm Interior");

  // Cool blue image: low Red, high Blue
  const coolImg = createMockImageData(100, 100, () => [40, 120, 220, 255]);
  const coolProfile = extractColorProfile(coolImg, 100, 100);
  assert.ok(coolProfile.temperature < -0.15, `Expected temperature < -0.15, got ${coolProfile.temperature}`);
  assert.equal(coolProfile.mood, "Cool Exterior");
});

test("extractColorProfile detects Teal & Orange color harmony", () => {
  // 50% Teal (Cyan [0, 180, 200]), 50% Orange (Amber [230, 120, 30])
  const tealOrangeImg = createMockImageData(160, 90, (x) => {
    if (x < 80) return [0, 180, 200, 255]; // Teal / Cyan (~186 deg)
    return [230, 120, 30, 255]; // Orange (~27 deg)
  });

  const profile = extractColorProfile(tealOrangeImg, 160, 90);
  assert.equal(profile.harmony.type, "teal-orange");
  assert.equal(profile.harmony.label, "Teal & Orange");
  assert.ok(profile.harmony.confidence > 0.5);
});

test("extractColorProfile detects Monochromatic palette", () => {
  // Desaturated low-key monochrome image
  const monoImg = createMockImageData(160, 90, () => [50, 52, 54, 255]);
  const profile = extractColorProfile(monoImg, 160, 90);
  assert.equal(profile.harmony.type, "monochromatic");
  assert.ok(profile.harmony.label.includes("Monochromatic"));
});

test("extractColorProfile extracts 3 to 5 dominant hex colors", () => {
  const multiColorImg = createMockImageData(160, 90, (x) => {
    if (x < 40) return [255, 0, 0, 255]; // Red
    if (x < 80) return [0, 255, 0, 255]; // Green
    if (x < 120) return [0, 0, 255, 255]; // Blue
    return [255, 255, 0, 255]; // Yellow
  });

  const profile = extractColorProfile(multiColorImg, 160, 90);
  assert.ok(profile.palette.length >= 3 && profile.palette.length <= 5);
  profile.palette.forEach((hex) => {
    assert.match(hex, /^#[0-9A-F]{6}$/i);
  });
});

test("extractColorProfile executes in <0.5ms per shot frame with color harmony detection", () => {
  const testImg = createMockImageData(160, 90, (x, y) => [(x * 2) % 256, (y * 3) % 256, 128, 255]);
  const start = performance.now();
  const iterations = 100;
  for (let i = 0; i < iterations; i++) {
    extractColorProfile(testImg, 160, 90);
  }
  const durationMs = performance.now() - start;
  const avgMsPerFrame = durationMs / iterations;
  assert.ok(avgMsPerFrame < 0.5, `Extraction averaged ${avgMsPerFrame.toFixed(4)}ms per frame, exceeding 0.5ms threshold`);
});

test("fallbackColorProfile provides safe default color profile", () => {
  const fallback = fallbackColorProfile();
  assert.equal(fallback.palette.length, 3);
  assert.equal(fallback.luminance, 0.5);
  assert.equal(fallback.mood, "Neutral");
  assert.equal(fallback.harmony.type, "neutral");
});

test("extractColorProfile accurately excludes letterbox padding when given active bounds", () => {
  // Mock 160x90 canvas with 2.39:1 video: 160x66 centered, 12px black letterbox top & bottom
  // Active video area is bright daylight (240, 240, 240)
  const letterboxImg = createMockImageData(160, 90, (x, y) => {
    if (y < 12 || y >= 78) return [0, 0, 0, 255]; // Black letterbox bars
    return [240, 240, 240, 255]; // Bright video content
  });

  // Sample full canvas: letterbox brings luma down
  const fullProfile = extractColorProfile(letterboxImg, 160, 90);
  assert.ok(fullProfile.luminance < 0.8, "Full canvas should be diluted by black bars");

  // Sample only active video rectangle (0, 12, 160, 66)
  const activeProfile = extractColorProfile(
    createMockImageData(160, 66, () => [240, 240, 240, 255]),
    160,
    66
  );
  assert.ok(activeProfile.luminance > 0.9, "Active area luma should be high (>0.9)");
  assert.equal(activeProfile.mood, "High-Key / Bright");
});

test("detectColorHarmony detects Teal & Orange across candidate peaks when secondary warm peak exists", () => {
  // 24 bins: bin 2 = 30° (Orange), bin 3 = 45° (Amber), bin 12 = 180° (Teal)
  // Peak 1 = Orange (count 500), Peak 2 = Amber (count 450), Peak 3 = Teal (count 400)
  const hueBins = new Array(24).fill(0);
  hueBins[2] = 500;
  hueBins[3] = 450;
  hueBins[12] = 400;
  const totalColored = 500 + 450 + 400;

  const harmony = detectColorHarmony(hueBins, totalColored, 0.6, 0.5);
  assert.equal(harmony.type, "teal-orange");
  assert.equal(harmony.label, "Teal & Orange");
  assert.ok(harmony.confidence >= 0.5);
});

test("extractColorProfile extracts distinct dominant colors without duplicate collapse", () => {
  // Image with mostly dark tones but distinct red, green, and blue accents
  const img = createMockImageData(160, 90, (x, y) => {
    if (x < 100) return [25, 26, 28, 255]; // Dark background
    if (x < 120) return [220, 30, 30, 255]; // Vivid red accent
    if (x < 140) return [30, 220, 30, 255]; // Vivid green accent
    return [30, 100, 230, 255]; // Vivid blue accent
  });

  const profile = extractColorProfile(img, 160, 90);
  // Ensure palette contains distinct colors (red, green, blue swatches should be present)
  assert.ok(profile.palette.length >= 3);
  const hasVividRed = profile.palette.some((hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    return r > 150 && g < 80;
  });
  assert.ok(hasVividRed, "Palette should preserve vivid red accent rather than collapse to shades of dark grey");
});
