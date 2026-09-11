import type { Project, Shot } from "../models/project";
import { actualRate, formatTimecode } from "../utils/timecode";

export interface SplitResult {
  updatedProject: Project;
  newCutId: string;
  splitShot: Shot;
}

export interface MergeResult {
  updatedProject: Project;
  mergedShotId: string;
}

export interface RollResult {
  updatedProject: Project;
  rolledTime: number;
}

/**
 * Quantizes a seconds value to the nearest exact frame boundary.
 */
export function quantizeToFrame(seconds: number, fps: number): number {
  const rate = actualRate(fps);
  return Math.round(seconds * rate) / rate;
}

/**
 * Splits a shot at the given timestamp into two contiguous shots.
 * Returns null if the timestamp is out of bounds or too close to a boundary.
 */
export function splitShotAtTime(
  project: Project,
  splitTime: number,
  minDurationSeconds = 0.08,
): SplitResult | null {
  const fps = project.frameRate || 24;
  const dropFrame = project.dropFrame ?? false;
  const rate = actualRate(fps);
  const quantizedTime = Math.max(0, Math.min(project.duration, quantizeToFrame(splitTime, fps)));

  // Find the shot that contains this timestamp
  const shotIdx = project.shots.findIndex(
    (s) => s.startSeconds + minDurationSeconds <= quantizedTime &&
           quantizedTime <= s.endSeconds - minDurationSeconds,
  );

  if (shotIdx === -1) {
    return null;
  }

  const orig = project.shots[shotIdx];
  const durA = quantizedTime - orig.startSeconds;
  const durB = orig.endSeconds - quantizedTime;

  if (durA < 1 / rate || durB < 1 / rate) {
    return null;
  }

  const shotA: Shot = {
    ...orig,
    endSeconds: quantizedTime,
    duration: Number(durA.toFixed(4)),
    sourceOut: formatTimecode(quantizedTime, fps, dropFrame),
    endTimecode: formatTimecode(quantizedTime, fps, dropFrame),
  };

  const newShotId = `cut-${orig.index + 1}-${Math.round(quantizedTime * 1000)}`;
  const shotB: Shot = {
    id: newShotId,
    index: orig.index + 1,
    sourceReel: orig.sourceReel || "AUTO",
    sourceIn: formatTimecode(quantizedTime, fps, dropFrame),
    sourceOut: orig.sourceOut,
    startTimecode: formatTimecode(quantizedTime, fps, dropFrame),
    endTimecode: orig.endTimecode,
    startSeconds: quantizedTime,
    endSeconds: orig.endSeconds,
    duration: Number(durB.toFixed(4)),
    transition: "CUT",
    shotSize: "Unknown",
    notes: "",
    reviewStatus: "Needs review",
  };

  // Re-index all shots sequentially
  const nextShots: Shot[] = [
    ...project.shots.slice(0, shotIdx),
    shotA,
    shotB,
    ...project.shots.slice(shotIdx + 1),
  ].map((s, idx) => ({ ...s, index: idx + 1 }));

  const updatedProject: Project = {
    ...project,
    shots: nextShots,
    updatedAt: new Date().toISOString(),
  };

  return {
    updatedProject,
    newCutId: shotB.id,
    splitShot: shotB,
  };
}

/**
 * Merges two adjacent shots across a cut boundary by removing the cut.
 * The outgoing shot expands to encompass the incoming shot.
 */
export function mergeShotsAtCut(
  project: Project,
  incomingId: string,
): MergeResult | null {
  const incomingIdx = project.shots.findIndex((s) => s.id === incomingId);
  if (incomingIdx <= 0) return null;

  const outgoing = project.shots[incomingIdx - 1];
  const incoming = project.shots[incomingIdx];

  // Verify shots are contiguous
  if (Math.abs(outgoing.endSeconds - incoming.startSeconds) > 0.001) {
    return null;
  }

  const mergedDur = incoming.endSeconds - outgoing.startSeconds;
  const mergedShot: Shot = {
    ...outgoing,
    endSeconds: incoming.endSeconds,
    duration: Number(mergedDur.toFixed(4)),
    endTimecode: incoming.endTimecode,
    sourceOut: incoming.sourceOut,
  };

  // Filter out any cut annotations associated with this specific boundary
  const nextCutAnnotations = project.cutAnnotations?.filter(
    (ann) => !(ann.outgoingId === outgoing.id && ann.incomingId === incoming.id),
  );

  const nextShots: Shot[] = [
    ...project.shots.slice(0, incomingIdx - 1),
    mergedShot,
    ...project.shots.slice(incomingIdx + 1),
  ].map((s, idx) => ({ ...s, index: idx + 1 }));

  const updatedProject: Project = {
    ...project,
    shots: nextShots,
    cutAnnotations: nextCutAnnotations,
    updatedAt: new Date().toISOString(),
  };

  return {
    updatedProject,
    mergedShotId: mergedShot.id,
  };
}

/**
 * Performs a rolling edit on a cut boundary:
 * Shifts the boundary between two adjacent shots left or right.
 * The total film duration and surrounding shots remain completely unchanged.
 */
export function rollCutBoundary(
  project: Project,
  incomingId: string,
  newTime: number,
  minDurationSeconds = 0.08,
): RollResult | null {
  const incomingIdx = project.shots.findIndex((s) => s.id === incomingId);
  if (incomingIdx <= 0) return null;

  const outgoing = project.shots[incomingIdx - 1];
  const incoming = project.shots[incomingIdx];

  const fps = project.frameRate || 24;
  const dropFrame = project.dropFrame ?? false;
  const rate = actualRate(fps);
  const minDur = Math.max(1 / rate, minDurationSeconds);

  // Clamp boundary so neither shot becomes smaller than minDuration
  const minAllowed = outgoing.startSeconds + minDur;
  const maxAllowed = incoming.endSeconds - minDur;

  if (minAllowed >= maxAllowed) return null;

  const clampedTime = Math.max(minAllowed, Math.min(maxAllowed, quantizeToFrame(newTime, fps)));

  const durA = clampedTime - outgoing.startSeconds;
  const durB = incoming.endSeconds - clampedTime;

  const updatedOutgoing: Shot = {
    ...outgoing,
    endSeconds: clampedTime,
    duration: Number(durA.toFixed(4)),
    endTimecode: formatTimecode(clampedTime, fps, dropFrame),
    sourceOut: formatTimecode(clampedTime, fps, dropFrame),
  };

  const updatedIncoming: Shot = {
    ...incoming,
    startSeconds: clampedTime,
    duration: Number(durB.toFixed(4)),
    startTimecode: formatTimecode(clampedTime, fps, dropFrame),
    sourceIn: formatTimecode(clampedTime, fps, dropFrame),
  };

  const nextShots = [...project.shots];
  nextShots[incomingIdx - 1] = updatedOutgoing;
  nextShots[incomingIdx] = updatedIncoming;

  const updatedProject: Project = {
    ...project,
    shots: nextShots,
    updatedAt: new Date().toISOString(),
  };

  return {
    updatedProject,
    rolledTime: clampedTime,
  };
}

/**
 * Nudges a cut boundary by N frames (positive = right, negative = left).
 */
export function nudgeCutBoundary(
  project: Project,
  incomingId: string,
  frameDelta: number,
): RollResult | null {
  const incoming = project.shots.find((s) => s.id === incomingId);
  if (!incoming) return null;

  const fps = project.frameRate || 24;
  const rate = actualRate(fps);
  const deltaSeconds = frameDelta / rate;
  const targetTime = incoming.startSeconds + deltaSeconds;

  return rollCutBoundary(project, incomingId, targetTime);
}

/**
 * Evaluates whether a given time snaps to any nearby snap point within a threshold.
 */
export function getSnapTime(
  time: number,
  snapPoints: number[],
  thresholdSeconds: number,
): { snappedTime: number; isSnapped: boolean; snapTarget?: number } {
  let closestDist = Infinity;
  let closestPoint = time;

  for (const point of snapPoints) {
    const dist = Math.abs(time - point);
    if (dist < closestDist) {
      closestDist = dist;
      closestPoint = point;
    }
  }

  if (closestDist <= thresholdSeconds) {
    return { snappedTime: closestPoint, isSnapped: true, snapTarget: closestPoint };
  }

  return { snappedTime: time, isSnapped: false };
}
