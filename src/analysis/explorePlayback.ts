import type { ExploreSequenceEntry } from "../models/explore";

export interface MappedPlaybackPosition {
  entry: ExploreSequenceEntry;
  entryIndex: number;
  sourceTime: number;
  sequenceTime: number;
}

export function clampSequenceTime(time: number, totalDuration: number): number {
  if (!Number.isFinite(time) || time < 0) return 0;
  return Math.min(time, Math.max(0, totalDuration));
}

export function findEntryIndexAtSequenceTime(
  sequenceTime: number,
  entries: ExploreSequenceEntry[],
): number {
  if (entries.length === 0) return -1;
  const clamped = clampSequenceTime(
    sequenceTime,
    entries[entries.length - 1].sequenceEnd,
  );

  let lo = 0;
  let hi = entries.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = entries[mid];
    if (clamped < entry.sequenceStart) {
      hi = mid - 1;
    } else if (clamped >= entry.sequenceEnd && mid < entries.length - 1) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }

  return Math.max(0, Math.min(entries.length - 1, lo));
}

/**
 * Maps a position in sequence time to its corresponding source film time
 * and specific shot entry.
 */
export function sequenceTimeToSourceTime(
  sequenceTime: number,
  entries: ExploreSequenceEntry[],
): MappedPlaybackPosition | null {
  if (entries.length === 0) return null;

  const entryIndex = findEntryIndexAtSequenceTime(sequenceTime, entries);
  if (entryIndex === -1) return null;

  const entry = entries[entryIndex];
  const offset = Math.max(
    0,
    Math.min(entry.duration, sequenceTime - entry.sequenceStart),
  );
  const sourceTime = Math.max(
    entry.sourceStart,
    Math.min(entry.sourceEnd, entry.sourceStart + offset),
  );

  return {
    entry,
    entryIndex,
    sourceTime,
    sequenceTime: entry.sequenceStart + offset,
  };
}

/**
 * Maps a source time within an active shot entry back to sequence time.
 */
export function sourceTimeToSequenceTime(
  sourceTime: number,
  entry: ExploreSequenceEntry,
): number {
  const offset = Math.max(
    0,
    Math.min(entry.duration, sourceTime - entry.sourceStart),
  );
  return entry.sequenceStart + offset;
}

export function findEntryIndexByShotId(
  shotId: string,
  entries: ExploreSequenceEntry[],
): number {
  return entries.findIndex((e) => e.shotId === shotId);
}
