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
