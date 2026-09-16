import type { Project, SpeechAnalysis, SpeechRegion } from "../models/project";

export type TimeRange = { start: number; end: number };
export type SpeechCutKind = "during speech" | "during a pause" | "other non-speech region";

const EPSILON = 0.0001;
export function normalizeSpeechRegions(regions: SpeechRegion[], duration: number): SpeechRegion[] {
  const bounded = regions
    .filter((r) => Number.isFinite(r.startSeconds) && Number.isFinite(r.endSeconds))
    .map((r) => ({ startSeconds: Math.max(0, r.startSeconds), endSeconds: Math.min(duration, r.endSeconds) }))
    .filter((r) => r.endSeconds > r.startSeconds + EPSILON)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  return bounded.reduce<SpeechRegion[]>((all, next) => {
    const previous = all.at(-1);
    if (previous && next.startSeconds <= previous.endSeconds + EPSILON) previous.endSeconds = Math.max(previous.endSeconds, next.endSeconds);
    else all.push(next);
    return all;
  }, []);
}

export function pauseRegions(regions: SpeechRegion[]): SpeechRegion[] {
  const pauses: SpeechRegion[] = [];
  for (let i = 1; i < regions.length; i++) {
    const startSeconds = regions[i - 1]!.endSeconds, endSeconds = regions[i]!.startSeconds;
    if (endSeconds > startSeconds + EPSILON) pauses.push({ startSeconds, endSeconds });
  }
  return pauses;
}

export function overlapDuration(regions: SpeechRegion[], range: TimeRange): number {
  const start = Math.min(range.start, range.end), end = Math.max(range.start, range.end);
  return regions.reduce((sum, region) => sum + Math.max(0, Math.min(end, region.endSeconds) - Math.max(start, region.startSeconds)), 0);
}

export function speechSummary(regions: SpeechRegion[], range: TimeRange) {
  const start = Math.min(range.start, range.end), end = Math.max(range.start, range.end), duration = Math.max(0, end - start);
  const speechDuration = overlapDuration(regions, { start, end });
  const pauses = pauseRegions(regions).filter((pause) => pause.endSeconds > start && pause.startSeconds < end);
  const pauseDuration = overlapDuration(pauses, { start, end });
  return { speechDuration, speechPercent: duration ? speechDuration / duration * 100 : 0, pauseCount: pauses.length, pauseDuration };
}

export function classifyCut(time: number, regions: SpeechRegion[]): SpeechCutKind {
  if (regions.some((region) => time >= region.startSeconds - EPSILON && time <= region.endSeconds + EPSILON)) return "during speech";
  if (pauseRegions(regions).some((pause) => time > pause.startSeconds + EPSILON && time < pause.endSeconds - EPSILON)) return "during a pause";
  return "other non-speech region";
}

export function isSpeechAnalysisValid(analysis: SpeechAnalysis | undefined, mediaSignature: string | undefined) {
  return Boolean(analysis && mediaSignature && analysis.mediaSignature === mediaSignature && analysis.model === "silero-vad" && analysis.modelVersion === "6.2.0" && analysis.settingsVersion === "vad-1");
}

/** Bounded edge sampling avoids copying a feature-length File into browser memory. */
export async function mediaSignature(file: File): Promise<string> {
  const edge = 1024 * 1024;
  const first = await file.slice(0, edge).arrayBuffer();
  const last = await file.slice(Math.max(0, file.size - edge), file.size).arrayBuffer();
  const metadata = new TextEncoder().encode(`${file.size}:${file.lastModified}:`);
  const source = new Uint8Array(metadata.length + first.byteLength + last.byteLength);
  source.set(metadata); source.set(new Uint8Array(first), metadata.length); source.set(new Uint8Array(last), metadata.length + first.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function projectSelectionRange(project: Project, selected?: TimeRange): TimeRange {
  return selected ?? { start: 0, end: project.duration };
}
