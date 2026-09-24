import type {
  CastMember,
  ColorProfile,
  LoudnessAnalysis,
  Shot,
  ShotSize,
} from "../models/project";
import { isLoudnessAnalysisValid } from "./loudness";
import type {
  ExploreArrangeConfig,
  ExploreFilters,
  ExploreSequence,
  ExploreSequenceEntry,
  ExploreShotMetric,
} from "../models/explore";

/**
 * Derives a defensible per-shot loudness summary from EBU R128 momentary bins.
 *
 * NOTE ON MEASUREMENT INTEGRITY:
 * FFmpeg ebur128 provides binned 400ms un-gated momentary loudness (M) values.
 * This function calculates the energy-averaged mean power of overlapping momentary
 * bins across the shot duration:
 *   mean_power = (1 / N) * sum(10^(M_i / 10))
 *   summary_LUFS = 10 * log10(mean_power)
 *
 * This is an energy-averaged mean momentary loudness summary, NOT a newly measured
 * gated integrated LUFS measurement for an isolated shot. Decibel values are NEVER
 * averaged linearly. Missing or stale data produces null and is never coerced to zero.
 */
export function getShotLoudnessSummary(
  shot: Shot,
  loudnessAnalysis?: LoudnessAnalysis,
  mediaSignature?: string,
): ExploreShotMetric | null {
  if (!isLoudnessAnalysisValid(loudnessAnalysis, mediaSignature)) {
    return null;
  }

  const analysis = loudnessAnalysis!;
  const duration = analysis.duration || 1;
  const binCount = analysis.binCount || analysis.momentary?.length || 0;
  if (binCount === 0 || !Array.isArray(analysis.momentary)) {
    return null;
  }

  const binDuration = duration / binCount;
  const startBin = Math.max(
    0,
    Math.min(binCount - 1, Math.floor(shot.startSeconds / binDuration)),
  );
  const endBin = Math.max(
    startBin,
    Math.min(binCount - 1, Math.ceil(shot.endSeconds / binDuration) - 1),
  );

  const mSlice = analysis.momentary.slice(startBin, endBin + 1);
  const validM = mSlice.filter((v) => typeof v === "number" && Number.isFinite(v) && v > -120);

  if (validM.length === 0) {
    return null;
  }

  // Energy average: convert dB to linear power, average, convert back
  const totalPower = validM.reduce((sum, val) => sum + Math.pow(10, val / 10), 0);
  const meanPower = totalPower / validM.length;
  if (meanPower <= 0) return null;

  const lufs = Math.round(10 * Math.log10(meanPower) * 10) / 10;

  return {
    label: "Mean momentary loudness",
    value: lufs,
    formatted: `${lufs > 0 ? "+" : ""}${lufs.toFixed(1)} LUFS`,
  };
}

export function getShotBrightnessSummary(
  shot: Shot,
  extraProfiles?: Record<string, ColorProfile>,
): ExploreShotMetric | null {
  const luma = shot.colorProfile?.luminance ?? extraProfiles?.[shot.id]?.luminance;
  if (luma === undefined || luma === null || !Number.isFinite(luma)) {
    return null;
  }
  const clamped = Math.max(0, Math.min(1, luma));
  const pct = Math.round(clamped * 100);
  return {
    label: "Luminance",
    value: clamped,
    formatted: `Luma ${pct}%`,
  };
}

export function getShotMotionSummary(shot: Shot): ExploreShotMetric | null {
  const motion = shot.motionProfile?.totalKineticEnergy;
  if (motion === undefined || motion === null || !Number.isFinite(motion)) {
    return null;
  }
  const clamped = Math.max(0, Math.min(100, motion));
  const rounded = Math.round(clamped);
  return {
    label: "Motion energy",
    value: clamped,
    formatted: `Motion ${rounded}%`,
  };
}

export function getShotDurationSummary(shot: Shot): ExploreShotMetric {
  const duration = Math.max(0, shot.duration || shot.endSeconds - shot.startSeconds);
  const formatted =
    duration >= 60
      ? `${Math.floor(duration / 60)}:${Math.floor(duration % 60)
          .toString()
          .padStart(2, "0")}`
      : `${duration.toFixed(1)}s`;
  return {
    label: "Shot duration",
    value: duration,
    formatted,
  };
}

export function getShotMetric(
  shot: Shot,
  arrange: ExploreArrangeConfig,
  context: {
    loudnessAnalysis?: LoudnessAnalysis;
    mediaSignature?: string;
    colorProfiles?: Record<string, ColorProfile>;
  } = {},
): ExploreShotMetric | null {
  switch (arrange.measure) {
    case "brightness":
      return getShotBrightnessSummary(shot, context.colorProfiles);
    case "motion":
      return getShotMotionSummary(shot);
    case "loudness":
      return getShotLoudnessSummary(shot, context.loudnessAnalysis, context.mediaSignature);
    case "duration":
      return getShotDurationSummary(shot);
    case "original":
      return {
        label: "Original order",
        value: shot.index,
        formatted: `#${shot.index}`,
      };
    default:
      return null;
  }
}

/**
 * Checks if a shot contains the specified character, reusing existing
 * manual-override and interval evidence semantics.
 */
export function shotContainsCharacter(shot: Shot, characterId: string): boolean {
  if (
    shot.characterAnalysis?.manualReviewStatus === "Confirmed" &&
    Array.isArray(shot.characterAnalysis.manualMemberIds)
  ) {
    return shot.characterAnalysis.manualMemberIds.includes(characterId);
  }

  const intervals = shot.characterAnalysis?.intervals ?? [];
  return intervals.some(
    (interval) =>
      interval.memberId === characterId &&
      interval.endSeconds > shot.startSeconds &&
      interval.startSeconds < shot.endSeconds,
  );
}

/**
 * Checks if a shot includes ONLY this character.
 * Requires:
 * 1. Character is present.
 * 2. No other cast members are identified.
 * 3. Composition does not contradict a single person (e.g. not "Two-shot" or "Group").
 */
export function shotContainsOnlyCharacter(shot: Shot, characterId: string): boolean {
  if (!shotContainsCharacter(shot, characterId)) {
    return false;
  }

  // If editorial composition tagged 2 or 3+ people, it's not alone
  if (shot.composition === "Two-shot" || shot.composition === "Group") {
    return false;
  }

  // Check if any other character is present
  if (
    shot.characterAnalysis?.manualReviewStatus === "Confirmed" &&
    Array.isArray(shot.characterAnalysis.manualMemberIds)
  ) {
    return shot.characterAnalysis.manualMemberIds.every((id) => id === characterId);
  }

  const intervals = shot.characterAnalysis?.intervals ?? [];
  const otherIdentities = intervals.filter(
    (interval) =>
      interval.memberId !== characterId &&
      interval.endSeconds > shot.startSeconds &&
      interval.startSeconds < shot.endSeconds,
  );
  if (otherIdentities.length > 0) {
    return false;
  }

  return true;
}

export function shotMatchesFilters(
  shot: Shot,
  filters: ExploreFilters,
  _cast?: CastMember[],
): boolean {
  // Character filter
  if (filters.characterId) {
    if (filters.onlyThisCharacter) {
      if (!shotContainsOnlyCharacter(shot, filters.characterId)) return false;
    } else {
      if (!shotContainsCharacter(shot, filters.characterId)) return false;
    }
  }

  // People count / composition filter
  if (filters.composition && shot.composition !== filters.composition) {
    return false;
  }

  // Shot size filter
  if (filters.shotSize && shot.shotSize !== filters.shotSize) {
    return false;
  }

  // Duration filters
  const duration = shot.duration || shot.endSeconds - shot.startSeconds;
  if (filters.minDuration !== undefined && duration < filters.minDuration) {
    return false;
  }
  if (filters.maxDuration !== undefined && duration > filters.maxDuration) {
    return false;
  }

  return true;
}

export function buildExploreSequence(
  shots: Shot[],
  filters: ExploreFilters,
  arrange: ExploreArrangeConfig,
  context: {
    loudnessAnalysis?: LoudnessAnalysis;
    mediaSignature?: string;
    cast?: CastMember[];
    colorProfiles?: Record<string, ColorProfile>;
  } = {},
): ExploreSequence {
  // 1. Filter shots (AND combination)
  const candidateShots = shots.filter((shot) =>
    shotMatchesFilters(shot, filters, context.cast),
  );

  // 2. Check if the selected measure is unavailable for candidate shots
  let missingMeasureReason: string | undefined;
  if (arrange.measure === "loudness") {
    if (!isLoudnessAnalysisValid(context.loudnessAnalysis, context.mediaSignature)) {
      missingMeasureReason =
        "Loudness analysis is not available or outdated for the linked media. Run Loudness scan in Studio to arrange by loudness.";
    }
  } else if (arrange.measure === "brightness") {
    const hasAnyLuma = candidateShots.some((s) => {
      const luma = s.colorProfile?.luminance ?? context.colorProfiles?.[s.id]?.luminance;
      return luma !== undefined && luma !== null && Number.isFinite(luma);
    });
    if (!hasAnyLuma && candidateShots.length > 0) {
      missingMeasureReason =
        "Color / brightness data is not available for these shots. Connect source video or run Color scan in Studio to arrange by brightness.";
    }
  } else if (arrange.measure === "motion") {
    const hasAnyMotion = candidateShots.some((s) => {
      const motion = s.motionProfile?.totalKineticEnergy;
      return motion !== undefined && motion !== null && Number.isFinite(motion);
    });
    if (!hasAnyMotion && candidateShots.length > 0) {
      missingMeasureReason =
        "Motion energy data is not available for these shots. Run Motion scan in Studio to arrange by motion.";
    }
  }

  // 3. Extract metrics and filter out shots with missing measurements for the chosen sort
  let excludedCount = 0;
  interface ScoredShot {
    shot: Shot;
    metric: ExploreShotMetric;
  }

  const scoredShots: ScoredShot[] = [];

  for (const shot of candidateShots) {
    const metric = getShotMetric(shot, arrange, context);
    if (!metric || metric.value === null) {
      excludedCount++;
      continue;
    }
    scoredShots.push({ shot, metric });
  }

  // 4. Stable sort
  scoredShots.sort((a, b) => {
    if (arrange.measure === "original") {
      return arrange.direction === "desc"
        ? b.shot.index - a.shot.index
        : a.shot.index - b.shot.index;
    }

    const valA = a.metric.value ?? 0;
    const valB = b.metric.value ?? 0;
    const diff = valA - valB;

    if (Math.abs(diff) > 1e-7) {
      return arrange.direction === "desc" ? -diff : diff;
    }

    // Stable tie-breaker: original chronological index
    return a.shot.index - b.shot.index;
  });

  // 5. Construct sequence entries with cumulative sequence time offsets
  let cumulativeSequenceTime = 0;
  const entries: ExploreSequenceEntry[] = scoredShots.map((scored, index) => {
    const shot = scored.shot;
    const duration = shot.duration || shot.endSeconds - shot.startSeconds;
    const sequenceStart = cumulativeSequenceTime;
    const sequenceEnd = sequenceStart + duration;
    cumulativeSequenceTime = sequenceEnd;

    return {
      sequenceIndex: index,
      shotId: shot.id,
      originalIndex: shot.index,
      sourceStart: shot.startSeconds,
      sourceEnd: shot.endSeconds,
      duration,
      sequenceStart,
      sequenceEnd,
      metric: scored.metric,
    };
  });

  return {
    id: crypto.randomUUID(),
    name: generateSequenceName(filters, arrange, context.cast),
    filters: { ...filters },
    arrange: { ...arrange },
    entries,
    totalDuration: cumulativeSequenceTime,
    excludedCount,
    missingMeasureReason,
    createdAt: new Date().toISOString(),
  };
}

export function reconstructExploreSequence(
  savedShotIds: string[],
  shots: Shot[],
  filters: ExploreFilters,
  arrange: ExploreArrangeConfig,
  context: {
    loudnessAnalysis?: LoudnessAnalysis;
    mediaSignature?: string;
    cast?: CastMember[];
    colorProfiles?: Record<string, ColorProfile>;
  } = {},
): { sequence: ExploreSequence; missingShotIds: string[] } {
  const shotMap = new Map(shots.map((s) => [s.id, s]));
  const missingShotIds: string[] = [];
  const foundShots: Shot[] = [];

  for (const id of savedShotIds) {
    const shot = shotMap.get(id);
    if (shot) {
      foundShots.push(shot);
    } else {
      missingShotIds.push(id);
    }
  }

  let cumulativeSequenceTime = 0;
  const entries: ExploreSequenceEntry[] = foundShots.map((shot, index) => {
    const duration = shot.duration || shot.endSeconds - shot.startSeconds;
    const sequenceStart = cumulativeSequenceTime;
    const sequenceEnd = sequenceStart + duration;
    cumulativeSequenceTime = sequenceEnd;

    const metric = getShotMetric(shot, arrange, context) ?? {
      label: "Metric",
      value: null,
      formatted: "—",
    };

    return {
      sequenceIndex: index,
      shotId: shot.id,
      originalIndex: shot.index,
      sourceStart: shot.startSeconds,
      sourceEnd: shot.endSeconds,
      duration,
      sequenceStart,
      sequenceEnd,
      metric,
    };
  });

  const sequence: ExploreSequence = {
    id: crypto.randomUUID(),
    name: generateSequenceName(filters, arrange, context.cast),
    filters: { ...filters },
    arrange: { ...arrange },
    entries,
    totalDuration: cumulativeSequenceTime,
    excludedCount: 0,
    createdAt: new Date().toISOString(),
  };

  return { sequence, missingShotIds };
}

export function generateSequenceName(
  filters: ExploreFilters,
  arrange: ExploreArrangeConfig,
  cast?: CastMember[],
): string {
  const parts: string[] = [];

  if (filters.characterId) {
    const member = cast?.find((c) => c.id === filters.characterId);
    const name = member?.name || "Character";
    parts.push(filters.onlyThisCharacter ? `${name} alone` : name);
  }

  if (filters.composition) {
    parts.push(filters.composition);
  }

  if (filters.shotSize) {
    parts.push(filters.shotSize);
  }

  if (filters.maxDuration !== undefined) {
    parts.push(`Under ${filters.maxDuration} s`);
  } else if (filters.minDuration !== undefined) {
    parts.push(`Over ${filters.minDuration} s`);
  }

  // Arrange part
  const arrangeLabel = getArrangeDescription(arrange);
  parts.push(arrangeLabel);

  return parts.length > 0 ? parts.join(" · ") : "Viewing sequence";
}

export function getArrangeDescription(arrange: ExploreArrangeConfig): string {
  switch (arrange.measure) {
    case "brightness":
      return arrange.direction === "asc" ? "Darkest first" : "Brightest first";
    case "duration":
      return arrange.direction === "asc" ? "Shortest first" : "Longest first";
    case "loudness":
      return arrange.direction === "desc" ? "Loudest first" : "Quietest first";
    case "motion":
      return arrange.direction === "desc" ? "Highest motion first" : "Lowest motion first";
    case "original":
      return "Original film order";
  }
}
