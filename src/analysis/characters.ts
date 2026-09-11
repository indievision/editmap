import type { CastMember, CharacterAnalysis, CharacterInterval, Shot } from "../models/project";
import { MODEL, BACKEND_URL, fetchLocalModel, type FrameSampler, type Tags } from "./localModel";

type CharacterReading = { appearances: string[]; unresolved: boolean; failure?: string };
export type CharacterScanMode = "fast" | "detailed";
const CHARACTER_SAMPLE_TIMEOUT_MS = 20_000;

/**
 * Do not use the editorial people classifier as an identity gate: it is
 * deliberately conservative and misses profile, background, and wide shots.
 * Only explicit full-frame graphics are known not to contain cast evidence.
 */
export function shouldScanCharacters(tags: Tags) {
  return tags.content !== "Text / title card";
}

/**
 * In the two-step workflow, Step 2 character scanning operates on shots
 * where Step 1 (or manual editorial review) established that people are present.
 */
export function isEligibleForCharacterScan(shot: Pick<Shot, "composition" | "content">) {
  return (
    shot.composition !== undefined &&
    shot.composition !== "No people" &&
    shot.content !== "Text / title card"
  );
}

/** Five evenly distributed samples avoid assigning a whole shot from its midpoint. */
export function characterSampleTimes(shot: Shot) {
  const span = Math.max(0, shot.endSeconds - shot.startSeconds);
  return [0.1, 0.3, 0.5, 0.7, 0.9].map((fraction) =>
    shot.startSeconds + span * fraction,
  );
}

function parseJsonFromText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function analyzeCharacterFrame(
  image: string,
  cast: CastMember[],
  signal: AbortSignal,
): Promise<CharacterReading> {
  const slots = cast.map((_, index) => String(index + 1));
  const slotsToIds = new Map(slots.map((slot, index) => [slot, cast[index].id]));
  const ids = cast.map((member) => member.id);

  const request = {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image,
      cast,
    }),
  } satisfies RequestInit;

  const response = await fetchLocalModel("/api/analyze-characters", request);
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const errMessage =
      typeof detail?.detail === "string"
        ? detail.detail
        : typeof detail?.error === "string"
        ? detail.error
        : null;

    throw new Error(
      errMessage
        ? `Character analysis failed (HTTP ${response.status}): ${errMessage}`
        : `Character analysis failed (HTTP ${response.status}). Check that the local CV engine is running on ${BACKEND_URL}.`,
    );
  }

  const out = await response.json();
  if (out.error) throw new Error(String(out.error));

  // Direct response from FastAPI microservice: { appearances: [...], unresolved: boolean }
  if (
    out &&
    typeof out === "object" &&
    Array.isArray(out.appearances) &&
    typeof out.unresolved === "boolean"
  ) {
    const appearances = out.appearances.map(
      (val: string) => slotsToIds.get(val) ?? (ids.includes(val) ? val : undefined),
    );
    if (appearances.every((id: unknown): id is string => Boolean(id))) {
      return {
        appearances: [...new Set(appearances as string[])],
        unresolved: out.unresolved,
      };
    }
  }

  // Fallback for nested legacy message format (e.g. Ollama/Qwen mocks in tests)
  const candidates = [out.message?.content, out.message?.thinking].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

  for (const candidate of candidates) {
    try {
      const value = parseJsonFromText(candidate) as CharacterReading | null;
      if (
        value &&
        typeof value === "object" &&
        Array.isArray(value.appearances) &&
        typeof value.unresolved === "boolean"
      ) {
        const appearances = value.appearances.map(
          (val) => slotsToIds.get(val) ?? (ids.includes(val) ? val : undefined),
        );
        if (appearances.every((id): id is string => Boolean(id))) {
          return { appearances: [...new Set(appearances)], unresolved: value.unresolved };
        }
      }
    } catch {
      // The caller records this sample as unresolved and keeps scanning.
    }
  }

  throw new Error("Character analysis returned incomplete JSON.");
}

export async function scanCharactersInShot(
  shot: Shot,
  sampler: FrameSampler,
  cast: CastMember[],
  signal: AbortSignal,
  onFrame?: (time: number, image: string) => void,
  options: {
    mode?: CharacterScanMode;
    midpoint?: { time: number; image: string };
    existing?: CharacterAnalysis;
    onProgress?: (analysis: CharacterAnalysis) => void;
    onSampleTiming?: (ms: number) => void;
  } = {},
): Promise<CharacterAnalysis> {
  const mode = options.mode ?? "fast";
  const sampleTimes =
    mode === "fast"
      ? [options.midpoint?.time ?? (shot.startSeconds + shot.endSeconds) / 2]
      : characterSampleTimes(shot);

  const existing =
    options.existing?.mode === mode &&
    options.existing.referenceSignature === characterReferenceSignature(cast)
      ? options.existing
      : undefined;

  const readings: CharacterReading[] = sampleTimes
    .slice(0, existing?.sampleTimes.length ?? 0)
    .map((time) => ({
      appearances: [
        ...new Set(
          (existing?.intervals ?? [])
            .filter((interval) => interval.startSeconds <= time && interval.endSeconds >= time)
            .map((interval) => interval.memberId),
        ),
      ],
      unresolved: existing?.unresolvedTimes.includes(time) ?? false,
      failure: existing?.failedTimes?.includes(time)
        ? existing.lastError ?? "Character request failed."
        : undefined,
    }));

  const build = (partial: boolean): CharacterAnalysis => {
    const intervals: CharacterInterval[] = [];
    for (const member of cast) {
      for (let index = 0; index < readings.length; index++) {
        if (!readings[index].appearances.includes(member.id)) continue;
        // A fast midpoint result is a marker, not a guessed entrance/exit range.
        const previous =
          mode === "fast" ? sampleTimes[index] : (sampleTimes[index - 1] ?? shot.startSeconds);
        const next =
          mode === "fast" ? sampleTimes[index] : (sampleTimes[index + 1] ?? shot.endSeconds);
        intervals.push({
          memberId: member.id,
          startSeconds: (previous + sampleTimes[index]) / 2,
          endSeconds: (sampleTimes[index] + next) / 2,
          reviewStatus: "Needs review",
        });
      }
    }

    return {
      intervals: mergeIntervals(intervals),
      unresolvedTimes: sampleTimes
        .slice(0, readings.length)
        .filter((_, index) => readings[index].unresolved),
      failedTimes: sampleTimes
        .slice(0, readings.length)
        .filter((_, index) => Boolean(readings[index].failure)),
      lastError: [...readings].reverse().find((reading) => reading.failure)?.failure,
      sampleTimes: sampleTimes.slice(0, readings.length),
      reviewStatus: "Needs review",
      model: MODEL,
      createdAt: new Date().toISOString(),
      mode,
      partial,
      referenceSignature: characterReferenceSignature(cast),
    };
  };

  // Failed samples are deliberately retried; completed successes and unresolved
  // readings remain retained evidence on resume.
  for (let index = 0; index < sampleTimes.length; index++) {
    if (readings[index] && !readings[index].failure) continue;
    const time = sampleTimes[index];
    const samplingStartedAt = performance.now();
    const image =
      mode === "fast" && options.midpoint?.time === time
        ? options.midpoint.image
        : await sampler.sample(time);
    options.onSampleTiming?.(performance.now() - samplingStartedAt);
    onFrame?.(time, image);
    const sampleController = new AbortController();
    const abort = () => sampleController.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, CHARACTER_SAMPLE_TIMEOUT_MS);
    try {
      readings[index] = await analyzeCharacterFrame(image, cast, sampleController.signal);
    } catch (error) {
      if (signal.aborted) throw error;
      // An uncertain identity, malformed reply, or a slow sample is evidence
      // of uncertainty—not a reason to discard the completed shot scan.
      readings[index] = {
        appearances: [],
        unresolved: true,
        failure: error instanceof Error ? error.message : "Character request failed.",
      };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
    options.onProgress?.(build(index < sampleTimes.length - 1));
  }

  signal.throwIfAborted();
  return build(false);
}

export function characterReferenceSignature(cast: CastMember[]) {
  // Bump this when the model-facing matching contract changes so old failed
  // scans are eligible for an intentional retry.
  return `slots-v3|${cast
    .map(
      (member) =>
        `${member.id}:${member.references.map((reference) => reference.id).join(",")}`,
    )
    .sort()
    .join("|")}`;
}

function mergeIntervals(intervals: CharacterInterval[]) {
  return intervals
    .sort(
      (a, b) =>
        a.memberId.localeCompare(b.memberId) || a.startSeconds - b.startSeconds,
    )
    .reduce<CharacterInterval[]>((merged, interval) => {
      const previous = merged.at(-1);
      if (
        previous &&
        previous.memberId === interval.memberId &&
        previous.endSeconds >= interval.startSeconds
      ) {
        previous.endSeconds = Math.max(previous.endSeconds, interval.endSeconds);
      } else {
        merged.push({ ...interval });
      }
      return merged;
    }, []);
}

export interface DiscoveredFaceSample {
  shotId: string;
  time: number;
  embedding: number[];
  crop: string;
  score: number;
  area: number;
}

export interface AutoDiscoverProgress {
  completedShots: number;
  totalShots: number;
  facesFound: number;
  stage: "sampling" | "clustering";
}

export interface AutoDiscoverResult {
  cast: CastMember[];
  shotAnalyses: Map<string, CharacterAnalysis>;
  totalFaces: number;
}

export async function discoverCharactersAcrossShots(
  shots: Shot[],
  sampler: FrameSampler,
  signal: AbortSignal,
  options: {
    similarityThreshold?: number;
    minAppearances?: number;
    onProgress?: (progress: AutoDiscoverProgress) => void;
    onFrame?: (shot: Shot, time: number, image: string) => void;
  } = {},
): Promise<AutoDiscoverResult> {
  const eligibleShots = shots.filter(isEligibleForCharacterScan);
  if (!eligibleShots.length) {
    return { cast: [], shotAnalyses: new Map(), totalFaces: 0 };
  }

  const allFaces: DiscoveredFaceSample[] = [];
  let completedShots = 0;

  options.onProgress?.({
    completedShots: 0,
    totalShots: eligibleShots.length,
    facesFound: 0,
    stage: "sampling",
  });

  for (const shot of eligibleShots) {
    if (signal.aborted) break;

    const time = (shot.startSeconds + shot.endSeconds) / 2;
    try {
      const image = await sampler.sample(time);
      options.onFrame?.(shot, time, image);

      const resp = await fetchLocalModel("/api/detect-shot-faces", {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, shotId: shot.id, time }),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.faces)) {
          for (const f of data.faces) {
            allFaces.push({
              shotId: shot.id,
              time,
              embedding: f.embedding,
              crop: f.crop,
              score: f.score ?? 1.0,
              area: f.area ?? 100,
            });
          }
        }
      }
    } catch (e) {
      if (signal.aborted) throw e;
      console.warn(`Face detection failed for shot ${shot.index}:`, e);
    }

    completedShots++;
    options.onProgress?.({
      completedShots,
      totalShots: eligibleShots.length,
      facesFound: allFaces.length,
      stage: "sampling",
    });
  }

  signal.throwIfAborted();

  if (!allFaces.length) {
    return { cast: [], shotAnalyses: new Map(), totalFaces: 0 };
  }

  options.onProgress?.({
    completedShots: eligibleShots.length,
    totalShots: eligibleShots.length,
    facesFound: allFaces.length,
    stage: "clustering",
  });

  const clusterResp = await fetchLocalModel("/api/cluster-faces", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      faces: allFaces,
      similarityThreshold: options.similarityThreshold ?? 0.50,
      minAppearances: options.minAppearances ?? 1,
    }),
  });

  if (!clusterResp.ok) {
    throw new Error(`Face clustering failed with status ${clusterResp.status}`);
  }

  const clusterData = await clusterResp.json();
  const rawCharacters = Array.isArray(clusterData.characters) ? clusterData.characters : [];

  const cast: CastMember[] = rawCharacters.map((c: any) => ({
    id: c.id,
    name: c.name,
    references: [
      {
        id: `ref-${c.id}`,
        image: c.avatar,
        shotId: c.shotId,
        time: c.time,
      },
    ],
  }));

  const signature = characterReferenceSignature(cast);
  const shotAnalyses = new Map<string, CharacterAnalysis>();

  // Map shot appearances for each shot
  for (const shot of eligibleShots) {
    const presentMemberIds: string[] = [];
    for (const c of rawCharacters) {
      if (Array.isArray(c.appearances) && c.appearances.some((a: any) => a.shotId === shot.id)) {
        presentMemberIds.push(c.id);
      }
    }

    const intervals: CharacterInterval[] = presentMemberIds.map((memberId) => ({
      memberId,
      startSeconds: shot.startSeconds,
      endSeconds: shot.endSeconds,
      reviewStatus: "Needs review",
    }));

    shotAnalyses.set(shot.id, {
      intervals,
      unresolvedTimes: [],
      sampleTimes: [(shot.startSeconds + shot.endSeconds) / 2],
      reviewStatus: "Needs review",
      model: "auto-cluster",
      createdAt: new Date().toISOString(),
      mode: "fast",
      referenceSignature: signature,
    });
  }

  return {
    cast,
    shotAnalyses,
    totalFaces: allFaces.length,
  };
}
