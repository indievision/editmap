import type { Shot } from "../models/project";
import { formatTimecode } from "../utils/timecode";

export interface SceneDetectionOptions {
  /**
   * Multiplier above rolling average delta to trigger a cut.
   * Higher = fewer cuts (less sensitive to action/pans).
   * Lower = more cuts (more sensitive).
   * PySceneDetect default is 3.0.
   */
  adaptiveThreshold?: number;
  /**
   * Minimum absolute HSV difference (0-255 scale) required to consider a cut.
   * Prevents false cuts during very static/subtle scenes. Default is 15.0.
   */
  minContentVal?: number;
  /**
   * Minimum duration for a shot in seconds. Cuts closer than this are ignored.
   * Default is 0.4s (approx 10 frames at 24fps).
   */
  minShotDurationSeconds?: number;
  /**
   * Number of recent frame deltas to include in rolling average.
   * Default is 8.
   */
  windowWidth?: number;
}

export interface FrameSample {
  timestamp: number; // in seconds
  score: number; // delta compared to previous frame
  isCut: boolean;
}

/**
 * Fast RGB to HSV delta computation for two downscaled RGBA frames.
 * Returns the average delta across Hue, Saturation, and Value components (0-255).
 */
export function computeFrameDelta(
  currentRgba: Uint8ClampedArray | Uint8Array,
  previousRgba: Uint8ClampedArray | Uint8Array,
): number {
  const len = currentRgba.length;
  if (len !== previousRgba.length || len === 0) return 0;

  let totalDeltaH = 0;
  let totalDeltaS = 0;
  let totalDeltaV = 0;
  const numPixels = len >>> 2; // len / 4

  for (let i = 0; i < len; i += 4) {
    const r1 = currentRgba[i];
    const g1 = currentRgba[i + 1];
    const b1 = currentRgba[i + 2];

    const r2 = previousRgba[i];
    const g2 = previousRgba[i + 1];
    const b2 = previousRgba[i + 2];

    if (r1 === r2 && g1 === g2 && b1 === b2) continue;

    // Compute V1, V2
    const max1 = r1 > g1 ? (r1 > b1 ? r1 : b1) : g1 > b1 ? g1 : b1;
    const min1 = r1 < g1 ? (r1 < b1 ? r1 : b1) : g1 < b1 ? g1 : b1;
    const c1 = max1 - min1;
    const s1 = max1 === 0 ? 0 : (255 * c1) / max1;

    let h1 = 0;
    if (c1 !== 0) {
      if (max1 === r1) {
        h1 = (43 * (g1 - b1)) / c1;
      } else if (max1 === g1) {
        h1 = 85 + (43 * (b1 - r1)) / c1;
      } else {
        h1 = 171 + (43 * (r1 - g1)) / c1;
      }
      if (h1 < 0) h1 += 256;
    }

    const max2 = r2 > g2 ? (r2 > b2 ? r2 : b2) : g2 > b2 ? g2 : b2;
    const min2 = r2 < g2 ? (r2 < b2 ? r2 : b2) : g2 < b2 ? g2 : b2;
    const c2 = max2 - min2;
    const s2 = max2 === 0 ? 0 : (255 * c2) / max2;

    let h2 = 0;
    if (c2 !== 0) {
      if (max2 === r2) {
        h2 = (43 * (g2 - b2)) / c2;
      } else if (max2 === g2) {
        h2 = 85 + (43 * (b2 - r2)) / c2;
      } else {
        h2 = 171 + (43 * (r2 - g2)) / c2;
      }
      if (h2 < 0) h2 += 256;
    }

    // Circular Hue distance
    const rawDiffH = Math.abs(h1 - h2);
    const diffH = (rawDiffH > 128 ? 256 - rawDiffH : rawDiffH) * 2;
    const diffS = Math.abs(s1 - s2);
    const diffV = Math.abs(max1 - max2);

    totalDeltaH += diffH;
    totalDeltaS += diffS;
    totalDeltaV += diffV;
  }

  return (totalDeltaH + totalDeltaS + totalDeltaV) / (3 * numPixels);
}

/**
 * Streaming Adaptive Cut Detector (PySceneDetect algorithm).
 * Maintains rolling window state and identifies cut boundaries.
 */
export class AdaptiveCutDetector {
  private adaptiveThreshold: number;
  private minContentVal: number;
  private minShotDurationSeconds: number;
  private windowWidth: number;

  private previousRgba: Uint8ClampedArray | null = null;
  private deltaHistory: number[] = [];
  private lastCutTimestamp: number = 0;
  private detectedCuts: number[] = [];

  constructor(options: SceneDetectionOptions = {}) {
    this.adaptiveThreshold = options.adaptiveThreshold ?? 3.0;
    this.minContentVal = options.minContentVal ?? 15.0;
    this.minShotDurationSeconds = options.minShotDurationSeconds ?? 0.4;
    this.windowWidth = options.windowWidth ?? 8;
  }

  /**
   * Process a frame at the given timestamp.
   * Returns whether a cut was detected at this timestamp.
   */
  public processFrame(
    rgba: Uint8ClampedArray | Uint8Array,
    timestamp: number,
  ): { isCut: boolean; score: number; rollingAverage: number } {
    if (!this.previousRgba) {
      this.previousRgba = new Uint8ClampedArray(rgba);
      this.lastCutTimestamp = timestamp;
      return { isCut: false, score: 0, rollingAverage: 0 };
    }

    const delta = computeFrameDelta(rgba, this.previousRgba);
    this.previousRgba.set(rgba);

    // Calculate rolling average of recent deltas
    const historyLen = this.deltaHistory.length;
    const rollingAverage =
      historyLen > 0
        ? this.deltaHistory.reduce((a, b) => a + b, 0) / historyLen
        : delta;

    // Check cut condition
    const exceedsRatio =
      rollingAverage > 0
        ? delta >= this.adaptiveThreshold * rollingAverage
        : delta >= this.minContentVal;

    const exceedsMinVal = delta >= this.minContentVal;
    const timeSinceLastCut = timestamp - this.lastCutTimestamp;
    const satisfiesMinDuration = timeSinceLastCut >= this.minShotDurationSeconds;

    const isCut = exceedsRatio && exceedsMinVal && satisfiesMinDuration;

    if (isCut) {
      this.detectedCuts.push(timestamp);
      this.lastCutTimestamp = timestamp;
    }

    // Keep sliding window of deltas
    this.deltaHistory.push(delta);
    if (this.deltaHistory.length > this.windowWidth) {
      this.deltaHistory.shift();
    }

    return { isCut, score: delta, rollingAverage };
  }

  public getCuts(): number[] {
    return [...this.detectedCuts];
  }

  /**
   * Current rolling average of deltas in the sliding window.
   */
  public getRollingAverage(): number {
    const historyLen = this.deltaHistory.length;
    return historyLen > 0
      ? this.deltaHistory.reduce((a, b) => a + b, 0) / historyLen
      : 0;
  }

  /**
   * Fast pre-check to verify if a delta at timestamp satisfies cut criteria.
   * Avoids running sub-frame searches on camera pans or sub-threshold motion.
   */
  public isCutCandidate(delta: number, timestamp: number): boolean {
    if (delta < this.minContentVal) return false;
    if (timestamp - this.lastCutTimestamp < this.minShotDurationSeconds) return false;
    const avg = this.getRollingAverage();
    if (avg > 0 && delta < this.adaptiveThreshold * avg) return false;
    return true;
  }

  public reset(): void {
    this.previousRgba = null;
    this.deltaHistory = [];
    this.lastCutTimestamp = 0;
    this.detectedCuts = [];
  }
}

/**
 * Builds standard EDITMAP Shot objects from detected cut timestamps and video duration.
 */
export function buildShotsFromCuts(
  cuts: number[],
  duration: number,
  fps: number,
  dropFrame = false,
  minShotDuration = 0.25,
): Shot[] {
  if (duration <= 0) return [];

  // Filter, sort and deduplicate cut timestamps
  const validCuts = cuts
    .filter((t) => t > 0.05 && t < duration - 0.05)
    .sort((a, b) => a - b);

  // Group timestamps that form distinct boundaries
  const boundaries: number[] = [0];
  for (const cut of validCuts) {
    const last = boundaries[boundaries.length - 1];
    if (cut - last >= minShotDuration) {
      boundaries.push(cut);
    }
  }
  if (duration - boundaries[boundaries.length - 1] >= minShotDuration) {
    boundaries.push(duration);
  } else {
    // Merge final micro-slice into the last shot
    boundaries[boundaries.length - 1] = duration;
  }

  const shots: Shot[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startSeconds = boundaries[i];
    const endSeconds = boundaries[i + 1];
    const shotDuration = endSeconds - startSeconds;
    const index = i + 1;

    shots.push({
      id: `cut-${index}-${Math.round(startSeconds * 1000)}`,
      index,
      sourceReel: "AUTO",
      sourceIn: formatTimecode(startSeconds, fps, dropFrame),
      sourceOut: formatTimecode(endSeconds, fps, dropFrame),
      startTimecode: formatTimecode(startSeconds, fps, dropFrame),
      endTimecode: formatTimecode(endSeconds, fps, dropFrame),
      startSeconds,
      endSeconds,
      duration: shotDuration,
      transition: "CUT",
      shotSize: "Unknown",
      notes: "",
      reviewStatus: "Needs review",
    });
  }

  return shots;
}
