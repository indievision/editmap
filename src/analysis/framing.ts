import type { Shot, ShotSize } from "../models/project";

export const framingSizes = [
  "EWS",
  "WS",
  "FS",
  "MWS",
  "AS",
  "MS",
  "MCU",
  "CU",
  "ECU",
] as const;
export function framingRank(shot: Shot): number | null {
  if (shot.content === "Text / title card") return null;
  const rank = framingSizes.indexOf(
    shot.shotSize as (typeof framingSizes)[number],
  );
  return rank < 0 ? null : rank;
}

// All percentages use actual intersecting shot time, never a shot-count average.
export function framingSummary(shots: Shot[], start = 0, end = Infinity) {
  const bins = new Map<
    ShotSize,
    { size: ShotSize; count: number; seconds: number }
  >(framingSizes.map((size) => [size, { size, count: 0, seconds: 0 }]));
  let total = 0,
    known = 0,
    close = 0,
    confirmed = 0,
    uncertain = 0;
  for (const shot of shots) {
    const seconds = Math.max(
      0,
      Math.min(end, shot.endSeconds) - Math.max(start, shot.startSeconds),
    );
    if (!seconds) continue;
    total += seconds;
    const size =
      shot.content === "Text / title card" ? "Not applicable" : shot.shotSize;
    const bin = bins.get(size) ?? { size, count: 0, seconds: 0 };
    bin.count++;
    bin.seconds += seconds;
    bins.set(size, bin);
    if (framingRank(shot) !== null) {
      known += seconds;
      if (size === "CU" || size === "ECU") close += seconds;
      if (shot.reviewStatus === "Confirmed") confirmed += seconds;
      if (shot.uncertain) uncertain += seconds;
    }
  }
  return {
    bins: [...bins.values()],
    total,
    known,
    confirmed,
    uncertain,
    closeShare: known ? close / known : null,
  };
}

export function framingAt(
  shots: Shot[],
  duration: number,
  window: number,
  time: number,
) {
  return framingSummary(
    shots,
    Math.max(0, time - window / 2),
    Math.min(duration, time + window / 2),
  );
}
