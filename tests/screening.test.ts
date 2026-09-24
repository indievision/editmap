import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  type Shot,
  type ScreeningMark,
} from "../src/models/project";
import {
  screeningAnchor,
  screeningEvidence,
  screeningLoop,
} from "../src/analysis/screening";
import { makeBackup, parseBackup } from "../src/storage/backup";

const shot = (
  id: string,
  start: number,
  end: number,
  transition = "C",
): Shot => ({
  id,
  index: Number(id),
  startSeconds: start,
  endSeconds: end,
  duration: end - start,
  transition,
  sourceReel: "AX",
  sourceIn: "00:00:00:00",
  sourceOut: "00:00:01:00",
  startTimecode: "00:00:00:00",
  endTimecode: "00:00:01:00",
  shotSize: "Unknown",
  notes: "",
});
const project = () => ({
  ...newProject(),
  duration: 20,
  shots: [shot("1", 0, 8), shot("2", 8, 10), shot("3", 10, 20)],
});
const mark = (time = 8.5): ScreeningMark => ({
  id: "m",
  passId: "pass",
  time,
  ...screeningAnchor(project().shots, time),
  createdAt: new Date().toISOString(),
  mirror: false,
  darken: false,
  muted: false,
  notes: "",
  resolved: false,
});

test("magnet preserves raw reaction, selects only preceding contiguous hard cut within 1.5s", () => {
  const p = project();
  assert.deepEqual(screeningAnchor(p.shots, 8.5), {
    anchorTime: 8,
    incomingId: "2",
    outgoingId: "1",
  });
  assert.equal(mark().time, 8.5);
  assert.equal(screeningAnchor(p.shots, 7.9).anchorTime, 7.9);
  assert.equal(screeningAnchor(p.shots, 9.51).anchorTime, 9.51);
  assert.equal(screeningAnchor(p.shots, 8.5, false).anchorTime, 8.5);
  p.shots[1].transition = "D";
  assert.equal(screeningAnchor(p.shots, 8.5).anchorTime, 8.5);
  p.shots[1].transition = "C";
  p.shots[0].endSeconds = 7;
  assert.equal(screeningAnchor(p.shots, 8.5).anchorTime, 8.5);
});
test("context loop restores momentum, crosses seam and clamps to film boundaries", () => {
  const p = project();
  assert.deepEqual(screeningLoop(p, mark()), { start: 1, end: 9 });
  assert.deepEqual(screeningLoop(p, mark(0)), { start: 0, end: 1 });
  assert.equal(screeningLoop(p, mark(20)).end, 20);
  p.frameRate = 30;
  assert.equal(screeningAnchor(p.shots, 9.5).anchorTime, 8);
});
test("evidence distinguishes named sequence from local neighborhood and absent motion", () => {
  const p = project();
  const result = screeningEvidence(p, mark());
  assert.equal(result.average, 20 / 3);
  assert.equal(result.kinetic, null);
  assert.equal(result.speech, undefined);
  assert.equal(result.sequence, undefined);
  p.sequences = [
    { id: "s", name: "Conversation", startSeconds: 0, endSeconds: 10 },
  ];
  assert.equal(screeningEvidence(p, mark()).average, 5);
});
test("edited cut invalidates anchor without deleting reaction", () => {
  const p = project();
  p.shots[0].endSeconds = 8.2;
  p.shots[1].startSeconds = 8.2;
  const e = screeningEvidence(p, mark());
  assert.equal(e.stale, true);
  assert.equal(e.pair, undefined);
});
test("screening marks survive backup with intent and viewing conditions; malformed records rejected", () => {
  const p = project();
  p.screeningMarks = [
    {
      ...mark(),
      notes: "Keep the hesitation",
      trimFrames: 24,
      audioLeadFrames: 16,
      darken: true,
    },
  ];
  assert.deepEqual(
    parseBackup(JSON.stringify(makeBackup(p))).screeningMarks,
    p.screeningMarks,
  );
  p.screeningMarks[0].anchorTime = 12;
  assert.throws(
    () => parseBackup(JSON.stringify(makeBackup(p))),
    /Anchor time/,
  );
});
