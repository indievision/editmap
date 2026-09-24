import type { Shot, ShotSize } from "../models/project";

export const framingSizes = [
  "Extreme wide",
  "Wide",
  "Full",
  "American",
  "Medium",
  "Medium close-up",
  "Close",
  "Extreme close",
] as const;

export type FramingSize = (typeof framingSizes)[number];

/** Maps pre-v3 projects into the active coarse scale without rewriting them. */
export function normalizedFramingSize(shot: Pick<Shot, "shotSize" | "content">): FramingSize | null {
  if (shot.content === "Text / title card") return null;
  switch (shot.shotSize) {
    case "Extreme wide": case "EWS": return "Extreme wide";
    case "Wide": case "WS": return "Wide";
    case "Full": case "FS": return "Full";
    case "American": case "MWS": case "AS": return "American";
    case "Medium": case "MS": return "Medium";
    case "Medium close-up": case "MCU": return "Medium close-up";
    case "Close": case "CU": return "Close";
    case "Extreme close": case "ECU": return "Extreme close";
    default: return null;
  }
}

export function framingRank(shot: Shot): number | null {
  const size = normalizedFramingSize(shot);
  const rank = size === null ? -1 : framingSizes.indexOf(size);
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
    const size = normalizedFramingSize(shot) ??
      (shot.content === "Text / title card" ? "Not applicable" : shot.shotSize);
    const bin = bins.get(size) ?? { size, count: 0, seconds: 0 };
    bin.count++;
    bin.seconds += seconds;
    bins.set(size, bin);
    if (framingRank(shot) !== null) {
      known += seconds;
      if (size === "Close" || size === "Extreme close") close += seconds;
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
