import type {
  Project,
  ScreeningMark,
  Shot,
  SpeechAnalysis,
} from "../models/project";
import { cutPairAt } from "./cuts";
import { isHardCut } from "./pacing";
import { pauseRegions } from "./speech";

export const CUT_MAGNET_SECONDS = 1.5;

export function screeningAnchor(shots: Shot[], time: number, magnet = true) {
  const incoming = shots.find(
    (s) => s.startSeconds <= time && s.endSeconds > time,
  );
  const pair = cutPairAt(shots, incoming?.id);
  if (
    magnet &&
    pair &&
    isHardCut(pair.transition) &&
    time - pair.time <= CUT_MAGNET_SECONDS
  ) {
    return {
      anchorTime: pair.time,
      incomingId: pair.incoming.id,
      outgoingId: pair.outgoing.id,
    };
  }
  return { anchorTime: time };
}

export function screeningEvidence(
  project: Project,
  mark: ScreeningMark,
  speech?: SpeechAnalysis,
) {
  const anchored = mark.incomingId
    ? cutPairAt(project.shots, mark.incomingId)
    : undefined;
  // Changed EDL/cut boundaries must never silently reattach an old reaction.
  const stale =
    !!mark.incomingId &&
    (!anchored ||
      !isHardCut(anchored.transition) ||
      anchored.outgoing.id !== mark.outgoingId ||
      Math.abs(anchored.time - mark.anchorTime) > 1 / project.frameRate);
  const current = project.shots.find(
    (s) => s.startSeconds <= mark.time && s.endSeconds > mark.time,
  );
  const pair = stale
    ? undefined
    : (anchored ?? cutPairAt(project.shots, current?.id));
  const target = pair?.outgoing ?? current;
  const sequence =
    target &&
    project.sequences
      ?.filter(
        (s) =>
          s.kind !== "moment" &&
          s.startSeconds <= target.startSeconds &&
          s.endSeconds >= target.endSeconds,
      )
      .sort(
        (a, b) =>
          a.endSeconds - a.startSeconds - (b.endSeconds - b.startSeconds),
      )[0];
  const nearby = target
    ? project.shots.filter((s) =>
        sequence
          ? s.startSeconds >= sequence.startSeconds &&
            s.endSeconds <= sequence.endSeconds
          : s.endSeconds > target.startSeconds - 15 &&
            s.startSeconds < target.endSeconds + 15,
      )
    : [];
  const average =
    nearby.length > 1
      ? nearby.reduce((sum, s) => sum + s.duration, 0) / nearby.length
      : null;
  const deviation =
    target && average ? (target.duration / average - 1) * 100 : null;
  const before = pair?.outgoing.motionProfile;
  const after = pair?.incoming.motionProfile;
  const kinetic =
    before && after && before.confidence > 0 && after.confidence > 0
      ? {
          before,
          after,
          delta: after.totalKineticEnergy - before.totalKineticEnergy,
        }
      : null;
  const seam = pair?.time ?? mark.time;
  const pause =
    speech &&
    pauseRegions(speech.regions).find(
      (p) => p.startSeconds <= seam && p.endSeconds >= seam,
    );
  return {
    pair,
    target,
    stale,
    sequence,
    nearby,
    average,
    deviation,
    kinetic,
    pause,
    speech,
    speechAcross: !!speech?.regions.some(
      (r) => r.startSeconds < seam && r.endSeconds > seam,
    ),
  };
}

export function screeningLoop(
  project: Project,
  mark: ScreeningMark,
  preRoll = 7,
) {
  const { pair } = screeningEvidence(project, mark);
  const seam = pair?.time ?? mark.time;
  const start = Math.max(0, seam - preRoll);
  // At least one second after the seam makes an exactly-on-cut mark audible/visible.
  const end = Math.min(
    project.duration,
    Math.max(mark.time + 1 / project.frameRate, seam + 1),
  );
  return { start, end: Math.max(start, end) };
}
