import type { Project, Shot } from "../models/project";
import { cutTimes, pacingCurve, pacingAt } from "./pacing";
import { activeShot } from "./playback";

export type MeasureId = "cutRate" | "luminance" | "motion";

export interface MeasureMeta {
  id: MeasureId;
  name: string;
  unit: string;
  color: string;
  areaColor: string;
  description: string;
  temporalResolution: "windowed" | "shot";
  /** Documented stable full-film reference range */
  referenceRangeLabel: string;
}

export const MEASURE_METAS: Record<MeasureId, MeasureMeta> = {
  cutRate: {
    id: "cutRate",
    name: "Cut rate",
    unit: "cuts/min",
    color: "#4bc2e8",
    areaColor: "rgba(75, 194, 232, 0.16)",
    description: "Frequency of hard-cut transitions within a centered moving window.",
    temporalResolution: "windowed",
    referenceRangeLabel: "0 to film maximum cut rate",
  },
  luminance: {
    id: "luminance",
    name: "Brightness",
    unit: "%",
    color: "#ece8db",
    areaColor: "rgba(236, 232, 219, 0.14)",
    description: "Photometric perceived brightness per shot.",
    temporalResolution: "shot",
    referenceRangeLabel: "0% to 100% (photometric range 0.0–1.0)",
  },
  motion: {
    id: "motion",
    name: "Motion",
    unit: "% flow",
    color: "#f2a33c",
    areaColor: "rgba(242, 163, 60, 0.14)",
    description: "Estimated camera and subject kinetic movement energy per shot.",
    temporalResolution: "shot",
    referenceRangeLabel: "0% to 100% total kinetic flow",
  },
};

export const ALL_MEASURE_IDS: MeasureId[] = ["cutRate", "luminance", "motion"];

/**
 * Normalizes a value safely against a full-film reference range.
 * If range is constant (min === max), returns 0.5 (or 0 if value is 0),
 * avoiding division by zero or fabricated variation.
 */
export function normalizeValue(
  value: number | null | undefined,
  min: number,
  max: number,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  if (max <= min) {
    // Constant value across the full film
    return min === 0 && value === 0 ? 0 : 0.5;
  }
  const ratio = (value - min) / (max - min);
  return Math.max(0, Math.min(1, ratio));
}

export interface MeasureSeriesData {
  id: MeasureId;
  rawPoints: Array<[number, number | null]>;
  normalizedPoints: Array<[number, number | null]>;
  refMin: number;
  refMax: number;
  hasData: boolean;
  scannedShotsCount?: number;
  totalShotsCount?: number;
}

export interface ComparisonSeriesCollection {
  cutRate: MeasureSeriesData;
  luminance: MeasureSeriesData;
  motion: MeasureSeriesData;
  duration: number;
}

/**
 * Generates continuous and shot-level series for all measures aligned by timestamp.
 * Shot-level measures emit step segments [start, val] to [end, val], and insert
 * explicit nulls across unscanned shots to produce authentic gaps.
 */
export function buildComparisonSeries(
  project: Project,
  options: { pacingWindow?: number } = {},
): ComparisonSeriesCollection {
  const duration = Math.max(project.duration || 0, 1);
  const shots = project.shots || [];
  const pacingWindow = options.pacingWindow ?? 30;

  // 1. Cut rate series
  const cuts = cutTimes(shots);
  const pacingPoints = pacingCurve(cuts, duration, pacingWindow);
  const maxCutRate = pacingPoints.reduce((max, pt) => Math.max(max, pt.rate), 0);
  const cutRateRefMin = 0;
  const cutRateRefMax = Math.max(1, maxCutRate);

  const cutRateRawPoints: Array<[number, number | null]> = pacingPoints.map((pt) => [
    pt.time,
    pt.rate,
  ]);
  const cutRateNormPoints: Array<[number, number | null]> = pacingPoints.map((pt) => [
    pt.time,
    normalizeValue(pt.rate, cutRateRefMin, cutRateRefMax),
  ]);

  // 2. Luminance series (shot-level)
  const lumaRawPoints: Array<[number, number | null]> = [];
  const lumaNormPoints: Array<[number, number | null]> = [];
  let lumaScannedCount = 0;

  // 3. Motion energy series (shot-level)
  const motionRawPoints: Array<[number, number | null]> = [];
  const motionNormPoints: Array<[number, number | null]> = [];
  let motionScannedCount = 0;

  // Standard documented full-film reference ranges
  const lumaRefMin = 0;
  const lumaRefMax = 1; // 0 to 1.0 (0% to 100%)
  const motionRefMin = 0;
  const motionRefMax = 100; // 0 to 100% flow

  shots.forEach((s, idx) => {
    const prevShot = idx > 0 ? shots[idx - 1] : null;
    const hasGapBefore = prevShot !== null && s.startSeconds > prevShot.endSeconds + 0.0001;

    // Luminance
    const lumaVal = s.colorProfile?.luminance;
    const hasLuma = lumaVal !== undefined && lumaVal !== null && Number.isFinite(lumaVal);
    if (hasLuma) lumaScannedCount++;

    const prevHadLuma = prevShot?.colorProfile?.luminance !== undefined && prevShot?.colorProfile?.luminance !== null;

    // If there is a timeline gap or previous shot was unscanned, break line with null
    if ((hasGapBefore || !prevHadLuma) && lumaRawPoints.length > 0 && hasLuma) {
      lumaRawPoints.push([s.startSeconds, null]);
      lumaNormPoints.push([s.startSeconds, null]);
    }

    if (hasLuma) {
      const lumaPct = Math.round(lumaVal! * 100);
      const lumaNorm = normalizeValue(lumaVal, lumaRefMin, lumaRefMax);
      // Shot-level duration segment: flat horizontal bar
      lumaRawPoints.push([s.startSeconds, lumaPct]);
      lumaRawPoints.push([s.endSeconds, lumaPct]);
      lumaNormPoints.push([s.startSeconds, lumaNorm]);
      lumaNormPoints.push([s.endSeconds, lumaNorm]);
    } else {
      // Unscanned: ensure gap marker
      if (lumaRawPoints.length > 0 && lumaRawPoints[lumaRawPoints.length - 1][1] !== null) {
        lumaRawPoints.push([s.startSeconds, null]);
        lumaNormPoints.push([s.startSeconds, null]);
      }
    }

    // Motion energy
    const motionVal = s.motionProfile?.totalKineticEnergy;
    const hasMotion = motionVal !== undefined && motionVal !== null && Number.isFinite(motionVal);
    if (hasMotion) motionScannedCount++;

    const prevHadMotion = prevShot?.motionProfile?.totalKineticEnergy !== undefined && prevShot?.motionProfile?.totalKineticEnergy !== null;

    if ((hasGapBefore || !prevHadMotion) && motionRawPoints.length > 0 && hasMotion) {
      motionRawPoints.push([s.startSeconds, null]);
      motionNormPoints.push([s.startSeconds, null]);
    }

    if (hasMotion) {
      const motionNorm = normalizeValue(motionVal, motionRefMin, motionRefMax);
      // Shot-level duration segment: flat horizontal bar
      motionRawPoints.push([s.startSeconds, motionVal!]);
      motionRawPoints.push([s.endSeconds, motionVal!]);
      motionNormPoints.push([s.startSeconds, motionNorm]);
      motionNormPoints.push([s.endSeconds, motionNorm]);
    } else {
      if (motionRawPoints.length > 0 && motionRawPoints[motionRawPoints.length - 1][1] !== null) {
        motionRawPoints.push([s.startSeconds, null]);
        motionNormPoints.push([s.startSeconds, null]);
      }
    }
  });

  return {
    duration,
    cutRate: {
      id: "cutRate",
      rawPoints: cutRateRawPoints,
      normalizedPoints: cutRateNormPoints,
      refMin: cutRateRefMin,
      refMax: cutRateRefMax,
      hasData: shots.length > 0,
      scannedShotsCount: shots.length,
      totalShotsCount: shots.length,
    },
    luminance: {
      id: "luminance",
      rawPoints: lumaRawPoints,
      normalizedPoints: lumaNormPoints,
      refMin: lumaRefMin * 100,
      refMax: lumaRefMax * 100,
      hasData: lumaScannedCount > 0,
      scannedShotsCount: lumaScannedCount,
      totalShotsCount: shots.length,
    },
    motion: {
      id: "motion",
      rawPoints: motionRawPoints,
      normalizedPoints: motionNormPoints,
      refMin: motionRefMin,
      refMax: motionRefMax,
      hasData: motionScannedCount > 0,
      scannedShotsCount: motionScannedCount,
      totalShotsCount: shots.length,
    },
  };
}

export interface ValueAtTime {
  id: MeasureId;
  available: boolean;
  rawValue: number | null;
  formattedValue: string;
  unit: string;
  normalized: number | null;
  normalizedPercentStr: string;
}

/**
 * Retrieves exact analytical values at timestamp `time`, aligning
 * windowed pacing and discrete shot-level attributes by time.
 */
export function getComparisonValuesAt(
  project: Project,
  time: number,
  pacingWindow = 30,
): Record<MeasureId, ValueAtTime> {
  const duration = Math.max(project.duration || 0, 1);
  const clampedTime = Math.max(0, Math.min(duration, time));
  const shots = project.shots || [];
  const cuts = cutTimes(shots);

  // 1. Cut rate
  const inspectedPacing = pacingAt(cuts, duration, pacingWindow, clampedTime);
  const pacingPoints = pacingCurve(cuts, duration, pacingWindow);
  const maxCutRate = pacingPoints.reduce((max, pt) => Math.max(max, pt.rate), 0);
  const cutRateRefMax = Math.max(1, maxCutRate);
  const cutRateNorm = normalizeValue(inspectedPacing.rate, 0, cutRateRefMax);

  // 2. Active shot for luminance & motion
  const currentShot: Shot | undefined = activeShot(shots, clampedTime);

  // Luminance
  const luma = currentShot?.colorProfile?.luminance;
  const hasLuma = luma !== undefined && luma !== null && Number.isFinite(luma);
  const lumaPct = hasLuma ? Math.round(luma! * 100) : null;
  const lumaNorm = hasLuma ? normalizeValue(luma, 0, 1) : null;

  // Motion energy
  const motion = currentShot?.motionProfile?.totalKineticEnergy;
  const hasMotion = motion !== undefined && motion !== null && Number.isFinite(motion);
  const motionNorm = hasMotion ? normalizeValue(motion, 0, 100) : null;

  return {
    cutRate: {
      id: "cutRate",
      available: shots.length > 0,
      rawValue: inspectedPacing.rate,
      formattedValue: `${inspectedPacing.rate.toFixed(1)} cuts/min`,
      unit: "cuts/min",
      normalized: cutRateNorm,
      normalizedPercentStr: cutRateNorm !== null ? `${Math.round(cutRateNorm * 100)}%` : "—",
    },
    luminance: {
      id: "luminance",
      available: hasLuma,
      rawValue: lumaPct,
      formattedValue: hasLuma ? `${lumaPct}%` : "Unavailable",
      unit: "%",
      normalized: lumaNorm,
      normalizedPercentStr: lumaNorm !== null ? `${Math.round(lumaNorm * 100)}%` : "—",
    },
    motion: {
      id: "motion",
      available: hasMotion,
      rawValue: hasMotion ? motion! : null,
      formattedValue: hasMotion ? `${motion}% flow` : "Unavailable",
      unit: "% flow",
      normalized: motionNorm,
      normalizedPercentStr: motionNorm !== null ? `${Math.round(motionNorm * 100)}%` : "—",
    },
  };
}

/**
 * Formats time in seconds to clean MM:SS or HH:MM:SS for display.
 */
export function formatDisplayTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Calculates visible [start, end] interval given scope boundaries, zoom level,
 * and anchors to the visible playhead or viewport center.
 */
export function calculateVisibleInterval(
  scopeStart: number,
  scopeEnd: number,
  zoomLevel: number,
  currentTime: number,
  currentVisibleStart: number,
  currentVisibleEnd: number,
): [number, number] {
  const scopeDuration = Math.max(0.1, scopeEnd - scopeStart);
  if (zoomLevel <= 1) {
    return [scopeStart, scopeEnd];
  }
  const visibleDuration = Math.max(0.5, scopeDuration / zoomLevel);
  const currentDuration = Math.max(0.1, currentVisibleEnd - currentVisibleStart);

  let center: number;
  const isPlayheadVisible =
    currentTime >= currentVisibleStart && currentTime <= currentVisibleEnd;

  if (isPlayheadVisible) {
    const playheadRatio = Math.max(0, Math.min(1, (currentTime - currentVisibleStart) / currentDuration));
    center = currentTime - (playheadRatio - 0.5) * visibleDuration;
  } else {
    center = (currentVisibleStart + currentVisibleEnd) / 2;
  }

  let start = center - visibleDuration / 2;
  let end = center + visibleDuration / 2;

  if (start < scopeStart) {
    start = scopeStart;
    end = Math.min(scopeEnd, start + visibleDuration);
  }
  if (end > scopeEnd) {
    end = scopeEnd;
    start = Math.max(scopeStart, end - visibleDuration);
  }

  return [start, end];
}

