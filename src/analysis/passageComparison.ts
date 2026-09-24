import type {
  CastMember,
  DmeWaveforms,
  LoudnessAnalysis,
  SequenceMarker,
  Shot,
  SpeechAnalysis,
} from "../models/project";
import { isSpeechAnalysisValid, normalizeSpeechRegions, overlapDuration } from "./speech";
import { normalizedFramingSize } from "./framing";
import { isLoudnessAnalysisValid, getRangeLoudness } from "./loudness";

export interface PassageShotSegment {
  shot: Shot;
  visibleStart: number;
  visibleEnd: number;
  visibleDuration: number;
  localStart: number;
  localEnd: number;
  isClippedStart: boolean;
  isClippedEnd: boolean;
}

export interface PassageMeasurements {
  duration: number; // in seconds
  shotCount: number;
  medianShotDuration: number | null; // in seconds, clipped to passage boundaries
  speechCoverage: number | null; // percentage (0 - 100), null if unavailable

  // Pacing & Rhythm
  asl: number | null; // Average Shot Length in seconds
  cutRateCPM: number | null; // Cuts per minute
  shortestShotDuration: number | null;
  longestShotDuration: number | null;
  pacingStdDev: number | null; // Standard deviation of shot durations
  pacingStyle: "Metronomic" | "Varied" | "Dynamic" | null;

  // Scale & Framing
  closeShare: number | null; // % of known framing that is Close / Extreme Close
  wideShare: number | null; // % of known framing that is Wide / Extreme Wide
  dominantShotSize: string | null;
  peoplePresence: number | null; // % duration with people visible

  // Camera & Movement
  staticShare: number | null; // % duration with static camera
  movingShare: number | null; // % duration with moving camera
  avgKineticEnergy: number | null; // 0 - 100 flow score

  // Color & Atmosphere
  avgLuminance: number | null; // 0 - 100%
  dominantMood: string | null;
  colorTemperature: "Warm" | "Cool" | "Neutral" | null;

  // Sound & Sonic Landscape
  dominantAudioStem: "Dialogue" | "Music" | "Effects" | "Balanced" | null;
  avgLoudnessLUFS: number | null;
  dynamicRangeLU: number | null;

  // Characters & Cast
  castCount: number | null;
  leadingCharacter: { name: string; screenShare: number } | null;
}

export interface ComputePassageOptions {
  cast?: CastMember[];
  dmeWaveforms?: DmeWaveforms;
  loudnessAnalysis?: LoudnessAnalysis;
}

/**
 * Checks whether a sequence marker is an eligible passage for Compare:
 * - Positive duration (endSeconds > startSeconds)
 * - Excludes kind: "moment"
 * - Supports legacy markers without a kind field (defaults to passage)
 */
export function isEligiblePassage(marker: SequenceMarker): boolean {
  if (typeof marker.startSeconds !== "number" || typeof marker.endSeconds !== "number") {
    return false;
  }
  if (!Number.isFinite(marker.startSeconds) || !Number.isFinite(marker.endSeconds)) {
    return false;
  }
  if (marker.endSeconds <= marker.startSeconds) {
    return false;
  }
  if (marker.kind === "moment") {
    return false;
  }
  return marker.kind === "passage" || marker.kind === undefined;
}

/**
 * Filters all eligible passages from project sequences in author order.
 */
export function getEligiblePassages(sequences?: SequenceMarker[]): SequenceMarker[] {
  if (!sequences || !Array.isArray(sequences)) return [];
  return sequences.filter(isEligiblePassage);
}

/**
 * Retrieves intersecting shots for a passage in original project order,
 * clipping boundaries to the passage's In and Out.
 * Never modifies original shot objects or project shot ordering.
 */
export function getIntersectingPassageShots(
  shots: Shot[],
  passage: SequenceMarker,
): PassageShotSegment[] {
  const pIn = passage.startSeconds;
  const pOut = passage.endSeconds;
  if (pOut <= pIn) return [];

  const segments: PassageShotSegment[] = [];

  for (const shot of shots) {
    // Intersects if shot starts before passage ends and ends after passage starts
    if (shot.startSeconds < pOut && shot.endSeconds > pIn) {
      const visibleStart = Math.max(shot.startSeconds, pIn);
      const visibleEnd = Math.min(shot.endSeconds, pOut);
      const visibleDuration = Math.max(0, visibleEnd - visibleStart);

      if (visibleDuration > 0.0001) {
        segments.push({
          shot,
          visibleStart,
          visibleEnd,
          visibleDuration,
          localStart: visibleStart - pIn,
          localEnd: visibleEnd - pIn,
          isClippedStart: shot.startSeconds < pIn,
          isClippedEnd: shot.endSeconds > pOut,
        });
      }
    }
  }

  return segments;
}

/**
 * Maps local passage time (0 .. duration) to original source time (In .. Out).
 */
export function localTimeToSourceTime(localTime: number, passage: SequenceMarker): number {
  const pIn = passage.startSeconds;
  const pOut = passage.endSeconds;
  const duration = Math.max(0, pOut - pIn);
  const clampedLocal = Math.max(0, Math.min(duration, localTime));
  return pIn + clampedLocal;
}

/**
 * Maps original source time (In .. Out) to local passage time (0 .. duration).
 */
export function sourceTimeToLocalTime(sourceTime: number, passage: SequenceMarker): number {
  const pIn = passage.startSeconds;
  const pOut = passage.endSeconds;
  const duration = Math.max(0, pOut - pIn);
  const clampedSource = Math.max(pIn, Math.min(pOut, sourceTime));
  return Math.max(0, Math.min(duration, clampedSource - pIn));
}

/**
 * Finds the shot segment active at local passage time.
 */
export function findPassageSegmentAtLocalTime(
  segments: PassageShotSegment[],
  localTime: number,
): PassageShotSegment | undefined {
  if (segments.length === 0) return undefined;

  for (const seg of segments) {
    if (localTime >= seg.localStart && localTime < seg.localEnd) {
      return seg;
    }
  }

  // Handle boundary at very end of passage
  const last = segments[segments.length - 1];
  if (localTime >= last.localEnd - 0.001) {
    return last;
  }

  return segments[0];
}

/**
 * Computes median value of an array of numbers.
 * Returns null if array is empty.
 */
export function computeMedian(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Computes passage measurements across all analytical dimensions:
 * - Pacing & Rhythm (duration, shots, ASL, median, cut rate CPM, min/max, pacing style)
 * - Scale & Framing (close share, wide share, dominant size, people presence)
 * - Camera & Movement (static/moving ratio, average kinetic energy)
 * - Color & Atmosphere (perceived brightness, mood, temperature)
 * - Sound & Sonic Landscape (speech coverage, loudness, dynamic range, dominant stem)
 * - Cast & Narrative (cast count, leading character share)
 */
export function computePassageMeasurements(
  passage: SequenceMarker,
  shots: Shot[],
  speechAnalysis?: SpeechAnalysis,
  mediaSignature?: string,
  filmDuration?: number,
  options?: ComputePassageOptions,
): PassageMeasurements {
  const duration = Math.max(0, passage.endSeconds - passage.startSeconds);
  const segments = getIntersectingPassageShots(shots, passage);
  const shotCount = segments.length;
  const segmentDurations = segments.map((s) => s.visibleDuration);
  const medianShotDuration = computeMedian(segmentDurations);

  // 1. Pacing & Rhythm
  const asl = shotCount > 0 ? duration / shotCount : null;
  const cutRateCPM = duration > 0 && shotCount > 0 ? (shotCount / duration) * 60 : null;
  const shortestShotDuration = segmentDurations.length > 0 ? Math.min(...segmentDurations) : null;
  const longestShotDuration = segmentDurations.length > 0 ? Math.max(...segmentDurations) : null;

  let pacingStdDev: number | null = null;
  let pacingStyle: "Metronomic" | "Varied" | "Dynamic" | null = null;
  if (segmentDurations.length > 0 && asl !== null) {
    const variance =
      segmentDurations.reduce((sum, d) => sum + Math.pow(d - asl, 2), 0) /
      segmentDurations.length;
    pacingStdDev = Math.sqrt(variance);
    if (asl > 0) {
      const cv = pacingStdDev / asl;
      if (cv < 0.35) {
        pacingStyle = "Metronomic";
      } else if (cv <= 0.8) {
        pacingStyle = "Varied";
      } else {
        pacingStyle = "Dynamic";
      }
    }
  }

  // 2. Framing & Scale
  let knownFramingSecs = 0;
  let closeSecs = 0;
  let wideSecs = 0;
  const sizeDurations = new Map<string, number>();

  let peopleSecs = 0;
  let peopleEvaluatedSecs = 0;

  for (const seg of segments) {
    const size = normalizedFramingSize(seg.shot);
    if (size) {
      knownFramingSecs += seg.visibleDuration;
      sizeDurations.set(size, (sizeDurations.get(size) ?? 0) + seg.visibleDuration);
      if (size === "Close" || size === "Extreme close") {
        closeSecs += seg.visibleDuration;
      } else if (size === "Wide" || size === "Extreme wide") {
        wideSecs += seg.visibleDuration;
      }
    }

    const comp = seg.shot.composition;
    const content = seg.shot.content;
    if (comp || content) {
      peopleEvaluatedSecs += seg.visibleDuration;
      const hasPeople =
        comp === "Single person" ||
        comp === "Two-shot" ||
        comp === "Group" ||
        content === "People";
      if (hasPeople) {
        peopleSecs += seg.visibleDuration;
      }
    }
  }

  const closeShare = knownFramingSecs > 0 ? (closeSecs / knownFramingSecs) * 100 : null;
  const wideShare = knownFramingSecs > 0 ? (wideSecs / knownFramingSecs) * 100 : null;

  let dominantShotSize: string | null = null;
  let maxDuration = 0;
  for (const [size, secs] of sizeDurations.entries()) {
    if (secs > maxDuration) {
      maxDuration = secs;
      dominantShotSize = size;
    }
  }

  const peoplePresence =
    peopleEvaluatedSecs > 0 ? (peopleSecs / peopleEvaluatedSecs) * 100 : null;

  // 3. Camera & Movement
  let staticSecs = 0;
  let movingSecs = 0;
  let kineticWeightedSum = 0;
  let kineticSecs = 0;

  for (const seg of segments) {
    const cam = seg.shot.cameraMovement ?? seg.shot.motionProfile?.cameraMovement;
    if (cam && cam !== "Unknown") {
      if (cam === "Static") {
        staticSecs += seg.visibleDuration;
      } else {
        movingSecs += seg.visibleDuration;
      }
    }

    const energy = seg.shot.motionProfile?.totalKineticEnergy;
    if (energy !== undefined && energy !== null && Number.isFinite(energy)) {
      kineticWeightedSum += energy * seg.visibleDuration;
      kineticSecs += seg.visibleDuration;
    }
  }

  const movementKnownSecs = staticSecs + movingSecs;
  const staticShare = movementKnownSecs > 0 ? (staticSecs / movementKnownSecs) * 100 : null;
  const movingShare = movementKnownSecs > 0 ? (movingSecs / movementKnownSecs) * 100 : null;
  const avgKineticEnergy = kineticSecs > 0 ? Math.round(kineticWeightedSum / kineticSecs) : null;

  // 4. Color & Atmosphere
  let lumaWeightedSum = 0;
  let tempWeightedSum = 0;
  let colorSecs = 0;
  const moodDurations = new Map<string, number>();

  for (const seg of segments) {
    const color = seg.shot.colorProfile;
    if (color && Number.isFinite(color.luminance)) {
      lumaWeightedSum += color.luminance * seg.visibleDuration;
      if (Number.isFinite(color.temperature)) {
        tempWeightedSum += color.temperature * seg.visibleDuration;
      }
      colorSecs += seg.visibleDuration;
      if (color.mood) {
        moodDurations.set(color.mood, (moodDurations.get(color.mood) ?? 0) + seg.visibleDuration);
      }
    }
  }

  const avgLuminance = colorSecs > 0 ? Math.round((lumaWeightedSum / colorSecs) * 100) : null;
  let colorTemperature: "Warm" | "Cool" | "Neutral" | null = null;
  if (colorSecs > 0) {
    const avgTemp = tempWeightedSum / colorSecs;
    if (avgTemp > 0.08) colorTemperature = "Warm";
    else if (avgTemp < -0.08) colorTemperature = "Cool";
    else colorTemperature = "Neutral";
  }

  let dominantMood: string | null = null;
  let maxMoodSecs = 0;
  for (const [mood, secs] of moodDurations.entries()) {
    if (secs > maxMoodSecs) {
      maxMoodSecs = secs;
      dominantMood = mood;
    }
  }

  // 5. Sound & Sonic Landscape
  let speechCoverage: number | null = null;
  if (isSpeechAnalysisValid(speechAnalysis, mediaSignature) && speechAnalysis) {
    const totalFilmDuration = filmDuration ?? speechAnalysis.duration ?? 0;
    const normalized = normalizeSpeechRegions(speechAnalysis.regions, totalFilmDuration);
    const coveredSecs = overlapDuration(normalized, {
      start: passage.startSeconds,
      end: passage.endSeconds,
    });
    speechCoverage = duration > 0 ? (coveredSecs / duration) * 100 : 0;
  }

  let avgLoudnessLUFS: number | null = null;
  let dynamicRangeLU: number | null = null;
  if (isLoudnessAnalysisValid(options?.loudnessAnalysis, mediaSignature)) {
    const rLoudness = getRangeLoudness(
      { start: passage.startSeconds, end: passage.endSeconds },
      options!.loudnessAnalysis!,
    );
    if (rLoudness.avgMomentary > -70) {
      avgLoudnessLUFS = rLoudness.avgMomentary;
      dynamicRangeLU = rLoudness.shortTermRange;
    }
  }

  let dominantAudioStem: "Dialogue" | "Music" | "Effects" | "Balanced" | null = null;
  const dme = options?.dmeWaveforms;
  if (dme && dme.duration > 0 && dme.binCount > 0) {
    const binDur = dme.duration / dme.binCount;
    const startBin = Math.max(0, Math.min(dme.binCount - 1, Math.floor(passage.startSeconds / binDur)));
    const endBin = Math.max(startBin, Math.min(dme.binCount - 1, Math.ceil(passage.endSeconds / binDur)));

    let sumD = 0;
    let sumM = 0;
    let sumE = 0;
    let count = 0;
    for (let b = startBin; b <= endBin; b++) {
      sumD += dme.dialogue[b] ?? 0;
      sumM += dme.music[b] ?? 0;
      sumE += dme.effects[b] ?? 0;
      count++;
    }
    if (count > 0) {
      const avgD = sumD / count;
      const avgM = sumM / count;
      const avgE = sumE / count;
      const total = avgD + avgM + avgE;
      if (total > 0.05) {
        const max = Math.max(avgD, avgM, avgE);
        if (max === avgD && avgD >= (total - avgD) * 0.7) dominantAudioStem = "Dialogue";
        else if (max === avgM && avgM >= (total - avgM) * 0.7) dominantAudioStem = "Music";
        else if (max === avgE && avgE >= (total - avgE) * 0.7) dominantAudioStem = "Effects";
        else dominantAudioStem = "Balanced";
      }
    }
  }

  // 6. Characters & Cast
  const castMap = new Map<string, string>();
  if (options?.cast) {
    for (const m of options.cast) {
      castMap.set(m.id, m.name);
    }
  }

  const charDurationMap = new Map<string, number>();
  for (const seg of segments) {
    const shot = seg.shot;
    const cAnalysis = shot.characterAnalysis;
    if (!cAnalysis) continue;

    const memberIds = new Set<string>();
    if (cAnalysis.manualReviewStatus === "Confirmed" && cAnalysis.manualMemberIds) {
      for (const id of cAnalysis.manualMemberIds) memberIds.add(id);
    }
    if (cAnalysis.intervals) {
      for (const intv of cAnalysis.intervals) {
        if (intv.endSeconds > passage.startSeconds && intv.startSeconds < passage.endSeconds) {
          memberIds.add(intv.memberId);
        }
      }
    }

    for (const id of memberIds) {
      charDurationMap.set(id, (charDurationMap.get(id) ?? 0) + seg.visibleDuration);
    }
  }

  let castCount: number | null = null;
  let leadingCharacter: { name: string; screenShare: number } | null = null;
  if (charDurationMap.size > 0) {
    castCount = charDurationMap.size;
    let maxSecs = 0;
    let leadId = "";
    for (const [id, secs] of charDurationMap.entries()) {
      if (secs > maxSecs) {
        maxSecs = secs;
        leadId = id;
      }
    }
    if (leadId && duration > 0) {
      const name = castMap.get(leadId) ?? leadId;
      const screenShare = Math.round((maxSecs / duration) * 100);
      leadingCharacter = { name, screenShare };
    }
  }

  return {
    duration,
    shotCount,
    medianShotDuration,
    speechCoverage,

    asl,
    cutRateCPM,
    shortestShotDuration,
    longestShotDuration,
    pacingStdDev,
    pacingStyle,

    closeShare,
    wideShare,
    dominantShotSize,
    peoplePresence,

    staticShare,
    movingShare,
    avgKineticEnergy,

    avgLuminance,
    dominantMood,
    colorTemperature,

    dominantAudioStem,
    avgLoudnessLUFS,
    dynamicRangeLU,

    castCount,
    leadingCharacter,
  };
}

/**
 * Anchors zoom around the visible playhead if inside viewport, otherwise viewport center.
 * Returns the target scrollLeft position for the scrolling container.
 */
export function calculateZoomScrollAnchor(
  oldZoom: number,
  newZoom: number,
  oldScrollLeft: number,
  viewportWidth: number,
  localPlayheadTime: number,
  passageDuration: number,
): number {
  if (viewportWidth <= 0 || passageDuration <= 0) return 0;
  const oldContentWidth = viewportWidth * oldZoom;
  const newContentWidth = viewportWidth * newZoom;

  if (newContentWidth <= viewportWidth) return 0;

  const playheadRatio = Math.max(0, Math.min(1, localPlayheadTime / passageDuration));
  const playheadPixel = playheadRatio * oldContentWidth;

  const isPlayheadVisible =
    playheadPixel >= oldScrollLeft && playheadPixel <= oldScrollLeft + viewportWidth;

  if (isPlayheadVisible) {
    // Anchor to playhead: preserve playhead offset from viewport left edge
    const offsetFromLeft = playheadPixel - oldScrollLeft;
    const newPlayheadPixel = playheadRatio * newContentWidth;
    const targetScrollLeft = newPlayheadPixel - offsetFromLeft;
    return Math.max(0, Math.min(newContentWidth - viewportWidth, targetScrollLeft));
  } else {
    // Anchor to viewport center
    const centerRatio = (oldScrollLeft + viewportWidth / 2) / oldContentWidth;
    const targetScrollLeft = centerRatio * newContentWidth - viewportWidth / 2;
    return Math.max(0, Math.min(newContentWidth - viewportWidth, targetScrollLeft));
  }
}
