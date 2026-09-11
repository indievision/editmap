import test from "node:test";
import assert from "node:assert/strict";
import { matchesReviewFilter, reviewFilterCounts, reviewReasons } from "../src/analysis/review";
import type { Shot } from "../src/models/project";

const shot = (patch: Partial<Shot> = {}): Shot => ({
  id: crypto.randomUUID(), index: 1, sourceReel: "AX", sourceIn: "00:00:00:00", sourceOut: "00:00:01:00",
  startTimecode: "00:00:00:00", endTimecode: "00:00:01:00", startSeconds: 0, endSeconds: 1, duration: 1,
  transition: "C", shotSize: "Unknown", notes: "", ...patch,
});

test("review filters use retained current evidence and distinguish unresolved from failure", () => {
  const confirmedWithOldSuggestion = shot({ reviewStatus: "Confirmed", suggestion: { shotSize: "CU", uncertain: true, model: "old", createdAt: "now" } });
  const unresolved = shot({ reviewStatus: "Confirmed", characterAnalysis: { intervals: [], unresolvedTimes: [0.5], sampleTimes: [0.5], reviewStatus: "Needs review", model: "local", createdAt: "now" } });
  const failed = shot({ reviewStatus: "Confirmed", analysisFailures: { framing: { message: "timeout", createdAt: "now" } }, characterAnalysis: { intervals: [], unresolvedTimes: [], failedTimes: [0.5], sampleTimes: [0.5], reviewStatus: "Confirmed", model: "local", createdAt: "now" } });
  assert.equal(matchesReviewFilter(confirmedWithOldSuggestion, "uncertain"), false);
  assert.deepEqual(reviewReasons(unresolved), ["character review", "unresolved character"]);
  assert.equal(matchesReviewFilter(unresolved, "failed"), false);
  assert.equal(matchesReviewFilter(failed, "failed"), true);
  assert.deepEqual(reviewFilterCounts({ shots: [confirmedWithOldSuggestion, unresolved, failed] }), { all: 3, unreviewed: 1, uncertain: 1, failed: 1 });
});
