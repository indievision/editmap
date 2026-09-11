import type { Project, Shot } from "../models/project";

export const reviewFilters = ["all", "unreviewed", "uncertain", "failed"] as const;
export type ReviewFilter = (typeof reviewFilters)[number];

export type ReviewReason = "framing review" | "character review" | "uncertain framing" | "unresolved character" | "failed framing" | "failed character";

/**
 * These predicates only inspect the current, retained shot evidence. In
 * particular, a stale suggestion never makes a shot uncertain, and an
 * unresolved identity is never treated as a transport failure.
 */
export function reviewReasons(shot: Shot): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  const character = shot.characterAnalysis;
  if (shot.reviewStatus !== "Confirmed") reasons.push("framing review");
  if (character && character.reviewStatus !== "Confirmed" && character.manualReviewStatus !== "Confirmed") {
    reasons.push("character review");
  }
  if (shot.uncertain) reasons.push("uncertain framing");
  if (character && character.manualReviewStatus !== "Confirmed" && character.unresolvedTimes.length) {
    reasons.push("unresolved character");
  }
  if (shot.analysisFailures?.framing) reasons.push("failed framing");
  if (character?.failedTimes?.length) reasons.push("failed character");
  return reasons;
}

export function matchesReviewFilter(shot: Shot, filter: ReviewFilter) {
  const reasons = reviewReasons(shot);
  switch (filter) {
    case "all": return true;
    case "unreviewed": return reasons.includes("framing review") || reasons.includes("character review");
    case "uncertain": return reasons.includes("uncertain framing") || reasons.includes("unresolved character");
    case "failed": return reasons.includes("failed framing") || reasons.includes("failed character");
  }
}

export function reviewFilterCounts(project: Pick<Project, "shots">) {
  return Object.fromEntries(reviewFilters.map((filter) => [filter, project.shots.filter((shot) => matchesReviewFilter(shot, filter)).length])) as Record<ReviewFilter, number>;
}

export function reviewReasonLabel(reasons: ReviewReason[]) {
  return reasons.join(" · ") || "No outstanding review state";
}
