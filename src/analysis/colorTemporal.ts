import type { ColorProfile } from "../models/project";

export type ColorSample = { time: number; profile: ColorProfile };

type BoundarySamples = { start: ColorSample; end: ColorSample };

function evidenceSample({ time, profile }: ColorSample) {
  return { time, luminance: profile.luminance, temperature: profile.temperature, saturation: profile.saturation, palette: profile.palette };
}

function paletteDistance(first: string[] = [], second: string[] = []) {
  if (!first.length || !second.length) return 0;
  const rgb = (hex: string) => [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
  const [r1, g1, b1] = rgb(first[0]);
  const [r2, g2, b2] = rgb(second[0]);
  return Math.min(1, Math.hypot(r1 - r2, g1 - g2, b1 - b2) / Math.sqrt(3));
}

/** Keeps the midpoint as the colour-script swatch and records measured interior change. */
export function temporalColorProfile(samples: ColorSample[], boundary?: BoundarySamples): ColorProfile {
  const ordered = [...samples].sort((left, right) => left.time - right.time);
  const representative = ordered[Math.floor(ordered.length / 2)]?.profile;
  if (!representative || ordered.length < 2) return representative ?? {
    palette: ["#808080", "#808080", "#808080"], luminance: .5, temperature: 0,
    saturation: 0, mood: "Neutral", harmony: { type: "neutral", label: "Neutral", confidence: 0, dominantHue: 0 },
  };
  // A return to the opening look can still contain a major change in the
  // middle of a shot, so evaluate every pair rather than only first/last.
  const differences = ordered.flatMap((first, index) => ordered.slice(index + 1).map((last) => ({
    luminance: Math.abs(last.profile.luminance - first.profile.luminance),
    temperature: Math.abs(last.profile.temperature - first.profile.temperature),
    saturation: Math.abs(last.profile.saturation - first.profile.saturation),
    palette: paletteDistance(first.profile.palette, last.profile.palette),
  })));
  const deltaLuminance = Math.max(...differences.map((item) => item.luminance));
  const deltaTemperature = Math.max(...differences.map((item) => item.temperature));
  const deltaSaturation = Math.max(...differences.map((item) => item.saturation));
  const deltaPalette = Math.max(...differences.map((item) => item.palette));
  const changeScore = Math.max(...differences.map((item) => Math.min(1,
    .35 * item.luminance + .2 * (item.temperature / 2) + .2 * item.saturation + .25 * item.palette,
  )));
  return {
    ...representative,
    temporal: {
      samples: ordered.map(evidenceSample),
      deltaLuminance: Number(deltaLuminance.toFixed(3)),
      deltaTemperature: Number(deltaTemperature.toFixed(3)),
      deltaSaturation: Number(deltaSaturation.toFixed(3)),
      deltaPalette: Number(deltaPalette.toFixed(3)),
      changeScore: Number(changeScore.toFixed(3)),
      changed: changeScore >= .18,
      ...(boundary ? { boundary: { start: evidenceSample(boundary.start), end: evidenceSample(boundary.end) } } : {}),
    },
  };
}
