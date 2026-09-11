import { test } from "node:test";
import assert from "node:assert/strict";
import {
  framingAt,
  framingRank,
  framingSummary,
} from "../src/analysis/framing";
import type { Shot } from "../src/models/project";
const shot = (
  start: number,
  end: number,
  size: Shot["shotSize"],
  patch: Partial<Shot> = {},
): Shot => ({
  id: String(start),
  index: start + 1,
  sourceReel: "AX",
  sourceIn: "",
  sourceOut: "",
  startTimecode: "",
  endTimecode: "",
  startSeconds: start,
  endSeconds: end,
  duration: end - start,
  transition: "C",
  shotSize: size,
  notes: "",
  ...patch,
});
test("framing weights overlap time and excludes unknowns and gaps from close share", () => {
  const shots = [
    shot(0, 2, "CU", { reviewStatus: "Confirmed" }),
    shot(2, 10, "WS"),
    shot(12, 15, "Unknown"),
  ];
  const result = framingSummary(shots);
  assert.equal(result.closeShare, 0.2);
  assert.equal(result.total, 13);
  assert.equal(result.known, 10);
  assert.equal(result.confirmed, 2);
  assert.equal(framingAt(shots, 15, 4, 2).closeShare, 0.5);
  assert.equal(framingAt(shots, 15, 4, 0).closeShare, 1);
  assert.equal(framingAt(shots, 15, 2, 11).closeShare, null);
});
test("text and legacy tags do not acquire an ordinal size; suggestions are ignored", () => {
  const shots = [
    shot(0, 1, "CU", { content: "Text / title card" }),
    shot(1, 2, "OTS"),
    shot(2, 3, "Unknown", {
      suggestion: { shotSize: "ECU", model: "test", createdAt: "" },
    }),
  ];
  assert.deepEqual(shots.map(framingRank), [null, null, null]);
  assert.equal(framingSummary(shots).closeShare, null);
  assert.equal(
    framingSummary(shots).bins.find((b) => b.size === "Not applicable")?.count,
    1,
  );
  assert.equal(framingSummary([]).total, 0);
});
test("full shots participate in the same duration denominator as close-ups", () => {
  const result = framingSummary([shot(0, 10, "FS"), shot(10, 20, "CU")]);
  assert.equal(result.known, 20);
  assert.equal(result.closeShare, 0.5);
});
