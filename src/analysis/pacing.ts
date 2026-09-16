import type { Shot } from "../models/project";
import { framingRank } from "./framing";
import { calculateCutVisualDelta } from "./cuts";

export function isHardCut(transition?: string): boolean {
  if (!transition) return true;
  const t = transition.trim().toUpperCase();
  return (
    t === "C" ||
    t === "CUT" ||
    (t !== "D" && t !== "DISSOLVE" && t !== "W" && t !== "WIPE" && t !== "SOFT" && t !== "FADE")
  );
}

export function cutTimes(shots: Shot[]) {
  // Only contiguous hard-cut boundaries; gaps and dissolves are not cuts.
  return shots
    .slice(1)
    .filter(
      (s, i) =>
        isHardCut(s.transition) &&
        Math.abs(s.startSeconds - shots[i].endSeconds) < 0.00001,
    )
    .map((s) => s.startSeconds);
}
function lowerBound(values: number[], target: number) {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export function pacingAt(
  cuts: number[],
  duration: number,
  window: number,
  time: number,
) {
  const start = Math.max(0, time - window / 2),
    end = Math.min(duration, time + window / 2);
  const count = lowerBound(cuts, end) - lowerBound(cuts, start);
  return {
    time,
    start,
    end,
    count,
    rate: end > start ? (count * 60) / (end - start) : 0,
  };
}
export function pacingCurve(cuts: number[], duration: number, window: number) {
  if (duration <= 0) return [];
  return Array.from({ length: 601 }, (_, i) =>
    pacingAt(cuts, duration, window, (i * duration) / 600),
  );
}

export interface CutShockData {
  time: number;
  shockScore: number;
  deltaV: number;
}

/**
 * Precomputes visual contrast and sensory shock scores for all contiguous cut boundaries once.
 */
export function computeCutShockData(shots: Shot[]): CutShockData[] {
  const result: CutShockData[] = [];
  for (let i = 1; i < shots.length; i++) {
    const outgoing = shots[i - 1];
    const incoming = shots[i];
    if (
      isHardCut(incoming.transition) &&
      Math.abs(outgoing.endSeconds - incoming.startSeconds) < 0.00001
    ) {
      const delta = calculateCutVisualDelta(outgoing, incoming);
      result.push({
        time: incoming.startSeconds,
        shockScore: delta.shockScore,
        deltaV: delta.deltaV,
      });
    }
  }
  return result;
}

export interface SensoryShockAtResult {
  time: number;
  start: number;
  end: number;
  shockScore: number;
  avgDeltaV: number;
  cutCount: number;
}

/**
 * Calculates moving average Sensory Shock Index across a window on the timeline.
 * Accepts either Shot[] or precomputed CutShockData[] for maximum performance.
 */
export function sensoryShockAt(
  shotsOrCutData: Shot[] | CutShockData[],
  duration: number,
  window: number,
  time: number,
): SensoryShockAtResult {
  const start = Math.max(0, time - window / 2);
  const end = Math.min(duration, time + window / 2);

  if (!shotsOrCutData.length || duration <= 0) {
    return { time, start, end, shockScore: 0, avgDeltaV: 0, cutCount: 0 };
  }

  const isCutData = typeof (shotsOrCutData[0] as CutShockData).shockScore === "number";
  const cutData: CutShockData[] = isCutData
    ? (shotsOrCutData as CutShockData[])
    : computeCutShockData(shotsOrCutData as Shot[]);

  if (!cutData.length) {
    return { time, start, end, shockScore: 0, avgDeltaV: 0, cutCount: 0 };
  }

  let totalShock = 0;
  let totalDeltaV = 0;
  let cutCount = 0;

  // Binary search for first cut >= start
  let lo = 0;
  let hi = cutData.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cutData[mid].time < start) lo = mid + 1;
    else hi = mid;
  }

  for (let i = lo; i < cutData.length; i++) {
    const cut = cutData[i];
    if (cut.time > end) break;
    totalShock += cut.shockScore;
    totalDeltaV += cut.deltaV;
    cutCount++;
  }

  return {
    time,
    start,
    end,
    shockScore: cutCount > 0 ? Math.round(totalShock / cutCount) : 0,
    avgDeltaV: cutCount > 0 ? Number((totalDeltaV / cutCount).toFixed(3)) : 0,
    cutCount,
  };
}

export function sensoryShockCurve(
  shotsOrCutData: Shot[] | CutShockData[],
  duration: number,
  window: number,
): SensoryShockAtResult[] {
  if (duration <= 0 || !shotsOrCutData.length) return [];

  const isCutData = typeof (shotsOrCutData[0] as CutShockData).shockScore === "number";
  const cutData: CutShockData[] = isCutData
    ? (shotsOrCutData as CutShockData[])
    : computeCutShockData(shotsOrCutData as Shot[]);

  return Array.from({ length: 601 }, (_, i) =>
    sensoryShockAt(cutData, duration, window, (i * duration) / 600),
  );
}

export type SequenceReading = {
  shots: Shot[];
  duration: number;
  cuts: number;
  average: number;
  median: number;
  variation: number;
  acceleratingRuns: number;
  framingChanges: { tighter: number; wider: number; unchanged: number; unknown: number };
};

export function sequenceReading(shots: Shot[], start: number, end: number): SequenceReading {
  const selected = shots.filter((shot) => shot.endSeconds > start && shot.startSeconds < end);
  const durations = selected.map((shot) => shot.duration).sort((a, b) => a - b);
  const average = durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length);
  const median = durations.length
    ? (durations[Math.floor((durations.length - 1) / 2)] + durations[Math.floor(durations.length / 2)]) / 2
    : 0;
  const variation = durations.length
    ? Math.sqrt(durations.reduce((sum, value) => sum + (value - average) ** 2, 0) / durations.length)
    : 0;
  const framingChanges = { tighter: 0, wider: 0, unchanged: 0, unknown: 0 };
  for (let index = 1; index < selected.length; index++) {
    const previous = framingRank(selected[index - 1]);
    const next = framingRank(selected[index]);
    if (previous === null || next === null) framingChanges.unknown++;
    else if (next > previous) framingChanges.tighter++;
    else if (next < previous) framingChanges.wider++;
    else framingChanges.unchanged++;
  }
  let acceleratingRuns = 0;
  for (let index = 2; index < selected.length; index++)
    if (selected[index - 2].duration > selected[index - 1].duration && selected[index - 1].duration > selected[index].duration)
      acceleratingRuns++;
  return {
    shots: selected,
    duration: Math.max(0, end - start),
    cuts: cutTimes(selected).filter((time) => time > start && time < end).length,
    average, median, variation, acceleratingRuns, framingChanges,
  };
}

export function calculatePearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n <= 1) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i]!;
    const yi = y[i]!;
    sumX += xi;
    sumY += yi;
    sumXY += xi * yi;
    sumX2 += xi * xi;
    sumY2 += yi * yi;
  }
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denominator === 0) return 0;
  return Math.max(-1, Math.min(1, numerator / denominator));
}

export type DynamicClassification = "Sync / Harmony" | "Neutral / Ambient" | "Counterpoint / Tension";

export function getDynamicClassification(r: number): DynamicClassification {
  if (r >= 0.35) return "Sync / Harmony";
  if (r <= -0.35) return "Counterpoint / Tension";
  return "Neutral / Ambient";
}

export type ImpactCut = {
  time: number;
  dbJump: number;
  peakDb: number;
};

export function detectImpactCuts(
  cuts: number[],
  waveform: number[],
  duration: number,
): ImpactCut[] {
  if (!waveform.length || duration <= 0) return [];
  const binDuration = duration / waveform.length;
  const results: ImpactCut[] = [];

  const amplitudeToDbLocal = (amp: number) => {
    if (amp <= 0.0001) return -48;
    return Math.max(-48, Math.min(0, 20 * Math.log10(amp)));
  };

  for (const cutTime of cuts) {
    const preBinStart = Math.max(0, Math.floor((cutTime - 0.4) / binDuration));
    const preBinEnd = Math.max(0, Math.floor((cutTime - 0.05) / binDuration));

    const cutBinStart = Math.max(0, Math.floor((cutTime - 0.05) / binDuration));
    const cutBinEnd = Math.min(waveform.length - 1, Math.ceil((cutTime + 0.2) / binDuration));

    let preMaxAmp = 0;
    for (let b = preBinStart; b <= preBinEnd; b++) {
      if (waveform[b]! > preMaxAmp) preMaxAmp = waveform[b]!;
    }

    let cutMaxAmp = 0;
    for (let b = cutBinStart; b <= cutBinEnd; b++) {
      if (waveform[b]! > cutMaxAmp) cutMaxAmp = waveform[b]!;
    }

    const preDb = amplitudeToDbLocal(preMaxAmp);
    const cutDb = amplitudeToDbLocal(cutMaxAmp);
    const dbJump = cutDb - preDb;

    if (dbJump >= 8 && cutDb > -40) {
      results.push({
        time: cutTime,
        dbJump: Math.round(dbJump * 10) / 10,
        peakDb: Math.round(cutDb * 10) / 10,
      });
    }
  }

  return results;
}
