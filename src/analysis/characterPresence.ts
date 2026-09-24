import type { CharacterInterval, Shot } from "../models/project";

export type PresenceRange = { start: number; end: number };

const overlaps = (a: PresenceRange, b: PresenceRange) => a.end > b.start && b.end > a.start;

export function clipIntervals(intervals: CharacterInterval[], range?: PresenceRange) {
  return intervals.flatMap((interval) => {
    const start = Math.max(interval.startSeconds, range?.start ?? -Infinity);
    const end = Math.min(interval.endSeconds, range?.end ?? Infinity);
    return end > start ? [{ ...interval, startSeconds: start, endSeconds: end }] : [];
  });
}

/** Evidence only: gaps are between sampled appearances, not proof a character left the scene. */
export function appearanceGaps(intervals: CharacterInterval[], range?: PresenceRange): PresenceRange[] {
  const clipped = clipIntervals(intervals, range).sort((a, b) => a.startSeconds - b.startSeconds);
  return clipped.slice(1).flatMap((interval, index) => {
    const previous = clipped[index];
    return interval.startSeconds > previous.endSeconds ? [{ start: previous.endSeconds, end: interval.startSeconds }] : [];
  });
}

export function sharedPresence(left: CharacterInterval[], right: CharacterInterval[], range?: PresenceRange): PresenceRange[] {
  const shared: PresenceRange[] = [];
  for (const a of clipIntervals(left, range)) for (const b of clipIntervals(right, range)) {
    if (a.endSeconds > b.startSeconds && b.endSeconds > a.startSeconds) shared.push({ start: Math.max(a.startSeconds, b.startSeconds), end: Math.min(a.endSeconds, b.endSeconds) });
  }
  return mergeRanges(shared);
}

/** Consecutive shot changes where the two sampled characters trade separate visibility. */
export function alternations(shots: Shot[], leftId: string, rightId: string, range?: PresenceRange): PresenceRange[] {
  const readings = shots.map((shot) => {
    const manualIds =
      shot.characterAnalysis?.manualReviewStatus === "Confirmed" && shot.characterAnalysis.manualMemberIds
        ? shot.characterAnalysis.manualMemberIds.filter(() => !range || overlaps({ start: shot.startSeconds, end: shot.endSeconds }, range))
        : [];
    const intervalIds = (shot.characterAnalysis?.intervals ?? [])
      .filter((interval) => !range || overlaps({ start: interval.startSeconds, end: interval.endSeconds }, range))
      .map((interval) => interval.memberId);
    const ids = new Set([...intervalIds, ...manualIds]);
    return { shot, side: ids.has(leftId) && !ids.has(rightId) ? "left" : ids.has(rightId) && !ids.has(leftId) ? "right" : undefined };
  });
  const ranges: PresenceRange[] = [];
  for (let index = 1; index < readings.length; index++) {
    const previous = readings[index - 1], current = readings[index];
    if (previous.side && current.side && previous.side !== current.side && current.shot.startSeconds >= previous.shot.endSeconds) ranges.push({ start: previous.shot.startSeconds, end: current.shot.endSeconds });
  }
  return mergeRanges(ranges);
}

export function mergeRanges(ranges: PresenceRange[]) {
  return [...ranges].sort((a, b) => a.start - b.start).reduce<PresenceRange[]>((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
    return merged;
  }, []);
}
