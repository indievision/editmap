import { test } from "node:test";
import assert from "node:assert/strict";
import { alternations, appearanceGaps, sharedPresence } from "../src/analysis/characterPresence";
import type { CharacterInterval, Shot } from "../src/models/project";

const interval = (memberId: string, startSeconds: number, endSeconds: number): CharacterInterval => ({ memberId, startSeconds, endSeconds, reviewStatus: "Needs review" });
const shot = (id: string, startSeconds: number, endSeconds: number, intervals: CharacterInterval[]): Shot => ({ id, index: Number(id), sourceReel: "AX", sourceIn: "", sourceOut: "", startTimecode: "", endTimecode: "", startSeconds, endSeconds, duration: endSeconds - startSeconds, transition: "C", shotSize: "MS", notes: "", characterAnalysis: { intervals, unresolvedTimes: [], sampleTimes: [], reviewStatus: "Needs review", model: "test", createdAt: "" } });

test("presence readings preserve sampled gaps and paired overlap", () => {
  const anna = [interval("anna", 1, 3), interval("anna", 7, 9)];
  assert.deepEqual(appearanceGaps(anna), [{ start: 3, end: 7 }]);
  assert.deepEqual(sharedPresence(anna, [interval("detective", 2, 8)]), [{ start: 2, end: 3 }, { start: 7, end: 8 }]);
});

test("alternation only reports contiguous separate-character shot changes", () => {
  assert.deepEqual(alternations([
    shot("1", 0, 2, [interval("anna", 0, 2)]),
    shot("2", 2, 4, [interval("detective", 2, 4)]),
    shot("3", 4, 6, [interval("anna", 4, 6)]),
  ], "anna", "detective"), [{ start: 0, end: 6 }]);
  assert.deepEqual(alternations([
    shot("1", 0, 2, [interval("anna", 0, 2)]),
    shot("2", 2, 4, []),
    shot("3", 4, 6, [interval("detective", 4, 6)]),
  ], "anna", "detective"), []);
});
