import type {
  SequenceMarker,
  Shot,
  SpeechAnalysis,
} from "../models/project";
import {
  getIntersectingPassageShots,
  type PassageShotSegment,
} from "./passageComparison";
import { normalizedFramingSize, type FramingSize, framingSizes } from "./framing";
import { isSpeechAnalysisValid, normalizeSpeechRegions } from "./speech";
import { sizeColors } from "./colors";

export interface PacingHistogramBin {
  label: string;
  rangeLabel: string;
  min: number;
  max: number;
}

export const PACING_HISTOGRAM_BINS: readonly PacingHistogramBin[] = [
  { label: "< 2 s", rangeLabel: "[0, 2) s", min: 0, max: 2 },
  { label: "2 – 4 s", rangeLabel: "[2, 4) s", min: 2, max: 4 },
  { label: "4 – 8 s", rangeLabel: "[4, 8) s", min: 4, max: 8 },
  { label: "8 – 16 s", rangeLabel: "[8, 16) s", min: 8, max: 16 },
  { label: "16+ s", rangeLabel: "[16, ∞) s", min: 16, max: Infinity },
] as const;

export interface PacingHistogramBinResult {
  bin: PacingHistogramBin;
  count: number;
  percentage: number;
}

export interface PacingHistogramResult {
  bins: PacingHistogramBinResult[];
  totalSegments: number;
}

/**
 * Computes histogram distribution of shot segment durations using shared bins:
 * [0,2), [2,4), [4,8), [8,16), [16,infinity)
 */
export function computePacingHistogram(
  segments: PassageShotSegment[],
): PacingHistogramResult {
  const total = segments.length;
  const counts = new Array(PACING_HISTOGRAM_BINS.length).fill(0);

  for (const seg of segments) {
    const dur = seg.visibleDuration;
    for (let i = 0; i < PACING_HISTOGRAM_BINS.length; i++) {
      const b = PACING_HISTOGRAM_BINS[i];
      if (dur >= b.min && dur < b.max) {
        counts[i]++;
        break;
      }
    }
  }

  const bins: PacingHistogramBinResult[] = PACING_HISTOGRAM_BINS.map((bin, i) => ({
    bin,
    count: counts[i],
    percentage: total > 0 ? (counts[i] / total) * 100 : 0,
  }));

  return {
    bins,
    totalSegments: total,
  };
}

/**
 * Computes mean segment duration of the intersecting segments.
 * Distinguishes mean segment duration from overall ASL (passageDuration / shotCount).
 */
export function computeMeanSegmentDuration(segments: PassageShotSegment[]): number | null {
  if (segments.length === 0) return null;
  const sum = segments.reduce((acc, s) => acc + s.visibleDuration, 0);
  return sum / segments.length;
}

export type FramingBreakdownCategory = FramingSize | "Not applicable" | "Unknown";

export interface FramingBreakdownItem {
  category: FramingBreakdownCategory;
  color: string;
  seconds: number;
  count: number;
  percentage: number; // percentage of denominator (total passage duration or total shot count)
}

export interface FramingBreakdownResult {
  mode: "time" | "shots";
  items: FramingBreakdownItem[];
  knownPercent: number;
  knownSeconds: number;
  knownCount: number;
  totalDuration: number;
  totalCount: number;
  gapSeconds: number;
}

/**
 * Computes framing breakdown for 100% stacked bar chart.
 * Mode "time" uses visible duration; mode "shots" counts each intersecting shot once.
 * Preserves all 8 normalized framing categories + Not applicable + Unknown.
 */
export function computeFramingBreakdown(
  passage: SequenceMarker,
  segments: PassageShotSegment[],
  mode: "time" | "shots",
): FramingBreakdownResult {
  const totalDuration = Math.max(0, passage.endSeconds - passage.startSeconds);
  const totalCount = segments.length;

  const secondsMap = new Map<FramingBreakdownCategory, number>();
  const countMap = new Map<FramingBreakdownCategory, number>();

  let evaluatedSeconds = 0;
  let knownSeconds = 0;
  let knownCount = 0;

  for (const seg of segments) {
    evaluatedSeconds += seg.visibleDuration;
    const shot = seg.shot;
    let cat: FramingBreakdownCategory;

    if (shot.content === "Text / title card" || shot.shotSize === "Not applicable") {
      cat = "Not applicable";
    } else {
      const normalized = normalizedFramingSize(shot);
      if (normalized) {
        cat = normalized;
        knownSeconds += seg.visibleDuration;
        knownCount++;
      } else {
        cat = "Unknown";
      }
    }

    secondsMap.set(cat, (secondsMap.get(cat) ?? 0) + seg.visibleDuration);
    countMap.set(cat, (countMap.get(cat) ?? 0) + 1);
  }

  const gapSeconds = Math.max(0, totalDuration - evaluatedSeconds);

  // Preserve standard category order: 8 framing sizes, then Not applicable, then Unknown
  const orderedCategories: FramingBreakdownCategory[] = [
    ...framingSizes,
    "Not applicable",
    "Unknown",
  ];

  const items: FramingBreakdownItem[] = [];

  for (const cat of orderedCategories) {
    const secs = secondsMap.get(cat) ?? 0;
    const cnt = countMap.get(cat) ?? 0;

    if (secs > 0 || cnt > 0) {
      const percentage =
        mode === "time"
          ? totalDuration > 0
            ? (secs / totalDuration) * 100
            : 0
          : totalCount > 0
          ? (cnt / totalCount) * 100
          : 0;

      items.push({
        category: cat,
        color: sizeColors[cat] ?? "#626970",
        seconds: secs,
        count: cnt,
        percentage,
      });
    }
  }

  const knownPercent =
    mode === "time"
      ? totalDuration > 0
        ? (knownSeconds / totalDuration) * 100
        : 0
      : totalCount > 0
      ? (knownCount / totalCount) * 100
      : 0;

  return {
    mode,
    items,
    knownPercent,
    knownSeconds,
    knownCount,
    totalDuration,
    totalCount,
    gapSeconds,
  };
}

export interface TemporalFramingBlock {
  shotId: string;
  shotIndex: number;
  localStart: number;
  localEnd: number;
  visibleStart: number;
  visibleEnd: number;
  visibleDuration: number;
  category: FramingBreakdownCategory;
  color: string;
  isUncertain: boolean;
  reviewStatus?: string;
  isClippedStart: boolean;
  isClippedEnd: boolean;
}

/**
 * Extracts temporal framing blocks for framing timeline strips.
 */
export function getTemporalFramingBlocks(
  segments: PassageShotSegment[],
): TemporalFramingBlock[] {
  return segments.map((seg) => {
    const shot = seg.shot;
    let cat: FramingBreakdownCategory;
    if (shot.content === "Text / title card" || shot.shotSize === "Not applicable") {
      cat = "Not applicable";
    } else {
      cat = normalizedFramingSize(shot) ?? "Unknown";
    }

    return {
      shotId: shot.id,
      shotIndex: shot.index,
      localStart: seg.localStart,
      localEnd: seg.localEnd,
      visibleStart: seg.visibleStart,
      visibleEnd: seg.visibleEnd,
      visibleDuration: seg.visibleDuration,
      category: cat,
      color: sizeColors[cat] ?? "#626970",
      isUncertain: Boolean(shot.uncertain || shot.reviewStatus === "Needs review"),
      reviewStatus: shot.reviewStatus,
      isClippedStart: seg.isClippedStart,
      isClippedEnd: seg.isClippedEnd,
    };
  });
}

export interface NumericStepSegment {
  shotId: string;
  shotIndex: number;
  localStart: number;
  localEnd: number;
  visibleStart: number;
  visibleEnd: number;
  visibleDuration: number;
  value: number | null; // 0 - 100 scale, null if unavailable
  isUnavailable: boolean;
}

/**
 * Extracts motion energy step segments for "Over time" view.
 * Values are on 0 - 100 scale. Missing measurements are marked unavailable.
 */
export function getMotionEnergySteps(
  segments: PassageShotSegment[],
): NumericStepSegment[] {
  return segments.map((seg) => {
    const energy = seg.shot.motionProfile?.totalKineticEnergy;
    const hasValue = energy !== undefined && energy !== null && Number.isFinite(energy);
    return {
      shotId: seg.shot.id,
      shotIndex: seg.shot.index,
      localStart: seg.localStart,
      localEnd: seg.localEnd,
      visibleStart: seg.visibleStart,
      visibleEnd: seg.visibleEnd,
      visibleDuration: seg.visibleDuration,
      value: hasValue ? Math.max(0, Math.min(100, Math.round(energy!))) : null,
      isUnavailable: !hasValue,
    };
  });
}

/**
 * Extracts luminance step segments for "Over time" view.
 * Values are scaled from 0-1 to 0 - 100 scale. Missing measurements are marked unavailable.
 */
export function getLuminanceSteps(
  segments: PassageShotSegment[],
): NumericStepSegment[] {
  return segments.map((seg) => {
    const luma = seg.shot.colorProfile?.luminance;
    const hasValue = luma !== undefined && luma !== null && Number.isFinite(luma);
    return {
      shotId: seg.shot.id,
      shotIndex: seg.shot.index,
      localStart: seg.localStart,
      localEnd: seg.localEnd,
      visibleStart: seg.visibleStart,
      visibleEnd: seg.visibleEnd,
      visibleDuration: seg.visibleDuration,
      value: hasValue ? Math.max(0, Math.min(100, Math.round(luma! * 100))) : null,
      isUnavailable: !hasValue,
    };
  });
}

export interface SpeechStepRegion {
  localStart: number;
  localEnd: number;
  isSpeech: boolean;
}

export interface SpeechOverTimeResult {
  isValid: boolean;
  isEmpty: boolean; // Valid analysis but 0 detected speech regions
  regions: SpeechStepRegion[];
}

/**
 * Extracts speech regions clipped to passage local time.
 */
export function getSpeechOverTimeSeries(
  passage: SequenceMarker,
  speechAnalysis?: SpeechAnalysis,
  mediaSignature?: string,
  filmDuration?: number,
): SpeechOverTimeResult {
  if (!isSpeechAnalysisValid(speechAnalysis, mediaSignature) || !speechAnalysis) {
    return {
      isValid: false,
      isEmpty: false,
      regions: [],
    };
  }

  const duration = Math.max(0, passage.endSeconds - passage.startSeconds);
  const totalFilmDuration = filmDuration ?? speechAnalysis.duration ?? 0;
  const normalized = normalizeSpeechRegions(speechAnalysis.regions, totalFilmDuration);

  // Filter and clip regions that overlap with passage [startSeconds, endSeconds]
  const clipped: SpeechStepRegion[] = [];
  const pIn = passage.startSeconds;
  const pOut = passage.endSeconds;

  for (const reg of normalized) {
    if (reg.endSeconds > pIn && reg.startSeconds < pOut) {
      const vStart = Math.max(reg.startSeconds, pIn);
      const vEnd = Math.min(reg.endSeconds, pOut);
      if (vEnd > vStart) {
        clipped.push({
          localStart: vStart - pIn,
          localEnd: vEnd - pIn,
          isSpeech: true,
        });
      }
    }
  }

  return {
    isValid: true,
    isEmpty: clipped.length === 0,
    regions: clipped,
  };
}

/**
 * Converts relative progress [0, 1] to local passage time [0, duration].
 */
export function relativeProgressToLocalTime(
  progress: number,
  passageDuration: number,
): number {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  return clampedProgress * Math.max(0, passageDuration);
}

/**
 * Converts local passage time to relative progress [0, 1].
 */
export function localTimeToRelativeProgress(
  localTime: number,
  passageDuration: number,
): number {
  if (passageDuration <= 0) return 0;
  return Math.max(0, Math.min(1, localTime / passageDuration));
}
