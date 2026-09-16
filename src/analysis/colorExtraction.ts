import type { ColorProfile } from "../models/project";

/**
 * Extracts chromatic and lighting data directly from Canvas 2D Context or ImageData.
 * Operates in <0.5ms per frame using pixel step sampling.
 */
export function extractColorProfile(
  source: CanvasRenderingContext2D | ImageData,
  sxOrWidth?: number,
  syOrHeight?: number,
  sw?: number,
  sh?: number,
  step = 6,
): ColorProfile {
  let imageData: ImageData;
  if ("getImageData" in source) {
    let sx = 0;
    let sy = 0;
    let w = 0;
    let h = 0;

    if (sw !== undefined && sh !== undefined) {
      sx = Math.max(0, sxOrWidth ?? 0);
      sy = Math.max(0, syOrHeight ?? 0);
      w = sw;
      h = sh;
    } else {
      w = sxOrWidth ?? source.canvas.width;
      h = syOrHeight ?? source.canvas.height;
    }

    if (w <= 0 || h <= 0) {
      return fallbackColorProfile();
    }
    imageData = source.getImageData(sx, sy, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  } else {
    imageData = source;
  }

  const data = imageData.data;
  const len = data.length;
  if (!len) return fallbackColorProfile();

  let totalLuma = 0;
  let totalTemp = 0;
  let totalSat = 0;
  let sampleCount = 0;

  // 24-bin radial hue histogram (15° bins) for color wheel geometry
  const hueBins = new Array(24).fill(0);
  let coloredPixelCount = 0;

  // Binning map for palette quantization: numeric key -> { count, rSum, gSum, bSum }
  const bins = new Map<number, { count: number; rSum: number; gSum: number; bSum: number }>();

  // Process pixels with step (stepping RGBA 4 bytes * step)
  const byteStep = Math.max(1, step) * 4;
  for (let i = 0; i < len; i += byteStep) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    // Ignore transparent pixels if any
    if (a < 128) continue;

    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    // Rec. 709 luma: Y = 0.2126 R + 0.7152 G + 0.0722 B (normalized 0..1)
    const luma = 0.2126 * rNorm + 0.7152 * gNorm + 0.0722 * bNorm;

    // HSV saturation: (max - min) / max, Value: max
    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const delta = max - min;
    const sat = max === 0 ? 0 : delta / max;
    const val = max;

    // Color Temperature: (R - B) / 255 -> range [-1, 1]
    const temp = (r - b) / 255;

    totalLuma += luma;
    totalSat += sat;
    totalTemp += temp;
    sampleCount++;

    // Filter out near-black (V < 0.15) and neutral/grey pixels (S < 0.15) to isolate meaningful hues
    if (val >= 0.15 && sat >= 0.15) {
      let hue = 0;
      if (delta > 0) {
        if (max === rNorm) {
          hue = 60 * (((gNorm - bNorm) / delta) % 6);
        } else if (max === gNorm) {
          hue = 60 * ((bNorm - rNorm) / delta + 2);
        } else {
          hue = 60 * ((rNorm - gNorm) / delta + 4);
        }
        if (hue < 0) hue += 360;
      }
      const binIdx = Math.floor(hue / 15) % 24;
      hueBins[binIdx]++;
      coloredPixelCount++;
    }

    // Quantize into 32-level bins (8 levels per channel: 0..7) using fast integer bitmask
    const qR = r >> 5;
    const qG = g >> 5;
    const qB = b >> 5;
    const key = (qR << 6) | (qG << 3) | qB;

    const existing = bins.get(key as any);
    if (existing) {
      existing.count++;
      existing.rSum += r;
      existing.gSum += g;
      existing.bSum += b;
    } else {
      bins.set(key as any, { count: 1, rSum: r, gSum: g, bSum: b });
    }
  }

  if (sampleCount === 0) return fallbackColorProfile();

  const avgLuminance = Math.min(1, Math.max(0, totalLuma / sampleCount));
  const avgSaturation = Math.min(1, Math.max(0, totalSat / sampleCount));
  const avgTemperature = Math.min(1, Math.max(-1, totalTemp / sampleCount));

  // Determine top 3-5 representative palette colors
  const sortedBins = Array.from(bins.values()).sort((a, b) => b.count - a.count);
  const palette: string[] = [];

  // Pass 1: Select visually distinct dominant colors
  for (const bin of sortedBins) {
    if (palette.length >= 5) break;

    const avgR = Math.round(bin.rSum / bin.count);
    const avgG = Math.round(bin.gSum / bin.count);
    const avgB = Math.round(bin.bSum / bin.count);

    // Filter out colors that are visually identical to an already selected color
    const isTooClose = palette.some((existingHex) => {
      const exR = parseInt(existingHex.slice(1, 3), 16);
      const exG = parseInt(existingHex.slice(3, 5), 16);
      const exB = parseInt(existingHex.slice(5, 7), 16);
      const dist = Math.sqrt((avgR - exR) ** 2 + (avgG - exG) ** 2 + (avgB - exB) ** 2);
      return dist < 32;
    });

    if (!isTooClose) {
      palette.push(toHex(avgR, avgG, avgB));
    }
  }

  // Pass 2: If we couldn't find enough distinct colors (e.g. monochromatic or low-contrast frames),
  // fill up to at least 3 swatches from remaining high-frequency bins
  if (palette.length < 3) {
    for (const bin of sortedBins) {
      if (palette.length >= 3) break;
      const hex = toHex(
        Math.round(bin.rSum / bin.count),
        Math.round(bin.gSum / bin.count),
        Math.round(bin.bSum / bin.count),
      );
      if (!palette.includes(hex)) {
        palette.push(hex);
      }
    }
  }

  // Ensure palette has at least 3 swatches
  while (palette.length < 3) {
    palette.push(palette[0] || "#808080");
  }

  const mood = classifyMood(avgLuminance, avgTemperature, avgSaturation);
  const harmony = detectColorHarmony(hueBins, coloredPixelCount, avgSaturation, avgLuminance);

  return {
    palette,
    luminance: Number(avgLuminance.toFixed(3)),
    temperature: Number(avgTemperature.toFixed(3)),
    saturation: Number(avgSaturation.toFixed(3)),
    mood,
    harmony,
  };
}

/**
 * Classifies color wheel geometry from radial 24-bin hue histogram
 */
export function detectColorHarmony(
  hueBins: number[],
  coloredPixelCount: number,
  avgSat: number,
  avgLuma: number,
): ColorProfile["harmony"] {
  if (coloredPixelCount === 0 || avgSat < 0.15) {
    return {
      type: "monochromatic",
      label: avgLuma < 0.25 ? "Monochromatic Low-Key" : "Monochromatic Muted",
      confidence: 0.95,
      dominantHue: 0,
    };
  }

  const HUE_BINS = 24;
  // Circular smoothing kernel [0.25, 0.5, 0.25]
  const smoothed = new Array(HUE_BINS).fill(0);
  for (let i = 0; i < HUE_BINS; i++) {
    const prev = hueBins[(i - 1 + HUE_BINS) % HUE_BINS];
    const curr = hueBins[i];
    const next = hueBins[(i + 1) % HUE_BINS];
    smoothed[i] = prev * 0.25 + curr * 0.5 + next * 0.25;
  }

  // Local peaks
  const peaks: { binIndex: number; hue: number; count: number }[] = [];
  for (let i = 0; i < HUE_BINS; i++) {
    const prev = smoothed[(i - 1 + HUE_BINS) % HUE_BINS];
    const curr = smoothed[i];
    const next = smoothed[(i + 1) % HUE_BINS];
    if (curr >= prev && curr >= next && curr > coloredPixelCount * 0.04) {
      peaks.push({ binIndex: i, hue: (i + 0.5) * 15, count: curr });
    }
  }

  peaks.sort((a, b) => b.count - a.count);
  const dominantHue = peaks.length > 0 ? Math.round(peaks[0].hue) : 0;

  const peakPixelCount = (binIdx: number) => {
    return (
      hueBins[binIdx] +
      hueBins[(binIdx - 1 + HUE_BINS) % HUE_BINS] +
      hueBins[(binIdx + 1) % HUE_BINS]
    );
  };

  // Monochromatic check (concentrated in 2 adjacent bins or low saturation)
  let maxTwoBins = 0;
  for (let i = 0; i < HUE_BINS; i++) {
    const sum = hueBins[i] + hueBins[(i + 1) % HUE_BINS];
    if (sum > maxTwoBins) maxTwoBins = sum;
  }
  if (avgSat < 0.20 || maxTwoBins / coloredPixelCount > 0.85) {
    const concentration = coloredPixelCount > 0 ? maxTwoBins / coloredPixelCount : 1;
    const satConf = avgSat < 0.20 ? Math.max(0.6, 1 - avgSat / 0.20) : 0;
    const conf = Math.min(1, Math.max(concentration, satConf));
    return {
      type: "monochromatic",
      label: avgLuma < 0.25 ? "Monochromatic Low-Key" : "Monochromatic",
      confidence: Number(conf.toFixed(2)),
      dominantHue,
    };
  }

  const angularDist = (h1: number, h2: number) => {
    const diff = Math.abs(h1 - h2) % 360;
    return diff > 180 ? 360 - diff : diff;
  };

  // Complementary / Teal & Orange check across candidate peak pairs
  if (peaks.length >= 2) {
    const candidatePeaks = peaks.slice(0, 4);
    let bestTealOrange: { conf: number } | null = null;
    let bestComplementary: { conf: number } | null = null;

    for (let i = 0; i < candidatePeaks.length; i++) {
      for (let j = i + 1; j < candidatePeaks.length; j++) {
        const p1 = candidatePeaks[i];
        const p2 = candidatePeaks[j];
        const dist = angularDist(p1.hue, p2.hue);

        if (dist >= 140 && dist <= 220) {
          const isP1Teal = p1.hue >= 160 && p1.hue <= 220;
          const isP2Teal = p2.hue >= 160 && p2.hue <= 220;
          const isP1Orange = p1.hue <= 55 || p1.hue >= 345;
          const isP2Orange = p2.hue <= 55 || p2.hue >= 345;

          const isTealOrange = (isP1Teal && isP2Orange) || (isP2Teal && isP1Orange);
          const combinedPixels = Math.min(
            coloredPixelCount,
            peakPixelCount(p1.binIndex) + peakPixelCount(p2.binIndex),
          );
          const conf = Math.min(1, Number((combinedPixels / coloredPixelCount).toFixed(2)));

          if (isTealOrange) {
            if (!bestTealOrange || conf > bestTealOrange.conf) {
              bestTealOrange = { conf };
            }
          } else {
            if (!bestComplementary || conf > bestComplementary.conf) {
              bestComplementary = { conf };
            }
          }
        }
      }
    }

    if (bestTealOrange) {
      return {
        type: "teal-orange",
        label: "Teal & Orange",
        confidence: Math.max(0.6, bestTealOrange.conf),
        dominantHue,
      };
    }
    if (bestComplementary) {
      return {
        type: "complementary",
        label: "Complementary",
        confidence: Math.max(0.6, bestComplementary.conf),
        dominantHue,
      };
    }
  }

  // Analogous check (hues within 45-degree arc / 3 adjacent bins)
  let maxThreeBins = 0;
  for (let i = 0; i < HUE_BINS; i++) {
    const sum = hueBins[i] + hueBins[(i + 1) % HUE_BINS] + hueBins[(i + 2) % HUE_BINS];
    if (sum > maxThreeBins) maxThreeBins = sum;
  }
  if (maxThreeBins / coloredPixelCount >= 0.65) {
    const conf = Number((maxThreeBins / coloredPixelCount).toFixed(2));
    const label =
      dominantHue >= 15 && dominantHue <= 60
        ? "Analogous Warm"
        : dominantHue >= 170 && dominantHue <= 250
        ? "Analogous Cool"
        : "Analogous";
    return {
      type: "analogous",
      label,
      confidence: conf,
      dominantHue,
    };
  }

  // Triadic check
  if (peaks.length >= 3) {
    const p1 = peaks[0], p2 = peaks[1], p3 = peaks[2];
    const d12 = angularDist(p1.hue, p2.hue);
    const d23 = angularDist(p2.hue, p3.hue);
    const d31 = angularDist(p3.hue, p1.hue);
    if (d12 >= 80 && d12 <= 150 && d23 >= 80 && d23 <= 150 && d31 >= 80 && d31 <= 150) {
      const combinedPixels = Math.min(
        coloredPixelCount,
        peakPixelCount(p1.binIndex) + peakPixelCount(p2.binIndex) + peakPixelCount(p3.binIndex),
      );
      return {
        type: "triadic",
        label: "Triadic / Pop Palette",
        confidence: Number((combinedPixels / coloredPixelCount).toFixed(2)),
        dominantHue,
      };
    }
  }

  return {
    type: "neutral",
    label: "Neutral / Balanced",
    confidence: 0.6,
    dominantHue,
  };
}

function toHex(r: number, g: number, b: number): string {
  const hexR = r.toString(16).padStart(2, "0");
  const hexG = g.toString(16).padStart(2, "0");
  const hexB = b.toString(16).padStart(2, "0");
  return `#${hexR}${hexG}${hexB}`.toUpperCase();
}

function classifyMood(luma: number, temp: number, sat: number): string {
  if (luma < 0.25) return "Low-Key / Dark";
  if (luma > 0.70) return "High-Key / Bright";
  if (sat < 0.12) return "Monochrome / Muted";
  if (temp > 0.15) return "Warm Interior";
  if (temp < -0.15) return "Cool Exterior";
  return "Neutral";
}

export function fallbackColorProfile(): ColorProfile {
  return {
    palette: ["#4A7CC2", "#777B85", "#333333"],
    luminance: 0.5,
    temperature: 0,
    saturation: 0,
    mood: "Neutral",
    harmony: {
      type: "neutral",
      label: "Neutral / Balanced",
      confidence: 0.5,
      dominantHue: 210,
    },
  };
}
