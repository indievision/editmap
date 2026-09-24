import type { LoudnessAnalysis, LoudnessTransition, Shot } from "../models/project";

export function isLoudnessAnalysisValid(
  analysis: LoudnessAnalysis | undefined,
  mediaSignature: string | undefined,
): boolean {
  return Boolean(
    analysis &&
      mediaSignature &&
      analysis.mediaSignature === mediaSignature &&
      analysis.model === "ffmpeg-ebur128" &&
      analysis.modelVersion === "EBU-R128-BS.1770-4" &&
      Array.isArray(analysis.momentary) &&
      Array.isArray(analysis.shortTerm) &&
      analysis.momentary.length > 0 &&
      Number.isFinite(analysis.integratedLoudness) &&
      Number.isFinite(analysis.loudnessRange),
  );
}

export interface DynamicClassification {
  level: "Wide" | "Moderate" | "Controlled";
  description: string;
  badgeClass: "high" | "moderate" | "low";
}

/**
 * Classifies dynamic contrast based on EBU R128 Loudness Range (LRA in LU).
 * High LRA = dramatic dynamic contrast between quiet whisper and loud explosion.
 * Low LRA = compressed / uniform commercial level.
 */
export function classifyDynamicContrast(lra: number): DynamicClassification {
  if (lra >= 15) {
    return {
      level: "Wide",
      description: "Wide dynamic range (cinema mix: deep contrast between quiet passages and intense peaks)",
      badgeClass: "high",
    };
  }
  if (lra >= 8) {
    return {
      level: "Moderate",
      description: "Moderate dynamic range (broadcast / episodic: balanced speech and dynamic cues)",
      badgeClass: "moderate",
    };
  }
  return {
    level: "Controlled",
    description: "Controlled / uniform loudness (compressed range: sustained energy without wide dips)",
    badgeClass: "low",
  };
}

export interface ShotLoudnessMetrics {
  avgMomentary: number;
  maxShortTerm: number;
  peakTruePeak: number;
  entranceDelta?: number;
  isQuietToLoudTransition: boolean;
}

/**
 * Computes per-shot loudness metrics from binned EBU R128 analysis.
 */
export function getShotLoudness(
  shot: { startSeconds: number; endSeconds: number },
  analysis: LoudnessAnalysis,
  previousShot?: { startSeconds: number; endSeconds: number },
): ShotLoudnessMetrics {
  const duration = analysis.duration || 1;
  const binCount = analysis.binCount || analysis.momentary.length;
  const binDuration = duration / binCount;

  const startBin = Math.max(0, Math.min(binCount - 1, Math.floor(shot.startSeconds / binDuration)));
  const endBin = Math.max(startBin, Math.min(binCount - 1, Math.ceil(shot.endSeconds / binDuration)));

  const mSlice = analysis.momentary.slice(startBin, endBin + 1);
  const sSlice = analysis.shortTerm.slice(startBin, endBin + 1);
  const tpSlice = analysis.truePeaks.slice(startBin, endBin + 1);

  const avgM = mSlice.length
    ? mSlice.reduce((sum, v) => sum + v, 0) / mSlice.length
    : -70;

  const maxS = sSlice.length ? Math.max(...sSlice) : -70;
  const peakTP = tpSlice.length ? Math.max(...tpSlice) : -70;

  let entranceDelta: number | undefined;
  let isQuietToLoudTransition = false;

  if (previousShot && startBin > 0) {
    const prevBin = Math.max(0, startBin - 1);
    const prevM = analysis.momentary[prevBin] ?? -70;
    const currM = analysis.momentary[startBin] ?? -70;
    entranceDelta = Math.round((currM - prevM) * 10) / 10;
    if (entranceDelta >= 6.0) {
      isQuietToLoudTransition = true;
    }
  }

  return {
    avgMomentary: Math.round(avgM * 10) / 10,
    maxShortTerm: Math.round(maxS * 10) / 10,
    peakTruePeak: Math.round(peakTP * 10) / 10,
    entranceDelta,
    isQuietToLoudTransition,
  };
}

/**
 * Normalizes LUFS (-70 to 0) to 0.0 .. 1.0 for rendering.
 */
export function lufsToNormalized(lufs: number, minLufs = -60, maxLufs = 0): number {
  if (lufs <= minLufs) return 0;
  if (lufs >= maxLufs) return 1;
  return (lufs - minLufs) / (maxLufs - minLufs);
}

export interface RangeLoudnessMetrics {
  avgMomentary: number;
  maxShortTerm: number;
  minShortTerm: number;
  shortTermRange: number;
  peakTruePeak: number;
}

/**
 * Computes loudness metrics for an arbitrary selected time range.
 */
export function getRangeLoudness(
  range: { start: number; end: number },
  analysis: LoudnessAnalysis,
): RangeLoudnessMetrics {
  const duration = analysis.duration || 1;
  const binCount = analysis.binCount || analysis.momentary?.length || 0;
  if (!binCount || !Array.isArray(analysis.momentary) || analysis.momentary.length === 0) {
    return {
      avgMomentary: -70,
      maxShortTerm: -70,
      minShortTerm: -70,
      shortTermRange: 0,
      peakTruePeak: -70,
    };
  }
  const binDuration = duration / binCount;
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.min(duration, Math.max(range.start, range.end));
  const startBin = Math.max(0, Math.min(binCount - 1, Math.floor(start / binDuration)));
  const endBin = Math.max(startBin, Math.min(binCount - 1, Math.ceil(end / binDuration)));

  const mSlice = analysis.momentary.slice(startBin, endBin + 1);
  const sSlice = analysis.shortTerm ? analysis.shortTerm.slice(startBin, endBin + 1) : [];
  const tpSlice = analysis.truePeaks ? analysis.truePeaks.slice(startBin, endBin + 1) : [];

  const validM = mSlice.filter((v) => Number.isFinite(v));
  const avgM = validM.length
    ? validM.reduce((sum, v) => sum + v, 0) / validM.length
    : -70;

  const validS = sSlice.filter((v) => Number.isFinite(v));
  const maxS = validS.length ? Math.max(...validS) : -70;
  const minS = validS.length ? Math.min(...validS) : -70;
  const sRange = validS.length ? Math.max(0, maxS - minS) : 0;

  const validTP = tpSlice.filter((v) => Number.isFinite(v));
  const peakTP = validTP.length ? Math.max(...validTP) : -70;

  return {
    avgMomentary: Math.round(avgM * 10) / 10,
    maxShortTerm: Math.round(maxS * 10) / 10,
    minShortTerm: Math.round(minS * 10) / 10,
    shortTermRange: Math.round(sRange * 10) / 10,
    peakTruePeak: Math.round(peakTP * 10) / 10,
  };
}
