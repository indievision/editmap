import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBackup, parseBackup } from "../src/storage/backup";
import { newProject } from "../src/models/project";

function project() {
  const p = newProject();
  p.name = "Backup fixture";
  p.shots = [{ id: "s1", index: 1, sourceReel: "AX", sourceIn: "00:00:00:00", sourceOut: "00:00:01:00", startTimecode: "01:00:00:00", endTimecode: "01:00:01:00", startSeconds: 0, endSeconds: 1, duration: 1, transition: "C", shotSize: "CU", notes: "A note", reviewStatus: "Confirmed" }];
  p.cast = [{ id: "anna", name: "Anna", references: [{ id: "ref", image: "aGVsbG8=", shotId: "s1", time: .5 }] }];
  p.shots[0].characterAnalysis = { intervals: [{ memberId: "anna", startSeconds: .5, endSeconds: .5, reviewStatus: "Needs review" }], unresolvedTimes: [], sampleTimes: [.5], reviewStatus: "Needs review", model: "local", createdAt: p.createdAt, mode: "fast" };
  p.cutAnnotations = [];
  p.soundSpans = [{ id: "sound", kind: "Dialogue", startSeconds: 0, endSeconds: 1, notes: "Line" }];
  return p;
}

test("portable backup round trips annotations and is restored separately", () => {
  const source = project();
  const restored = parseBackup(JSON.stringify(makeBackup(source)));
  assert.equal(restored.id, source.id);
  assert.equal(restored.shots[0].notes, "A note");
  assert.equal(restored.shots[0].reviewStatus, "Confirmed");
  assert.equal(restored.cast?.[0].references[0].image, "aGVsbG8=");
  assert.equal(restored.shots[0].characterAnalysis?.intervals[0].memberId, "anna");
  assert.equal(restored.soundSpans?.[0].notes, "Line");
});

test("rejects unsupported, malformed, colliding and dangling backups", () => {
  const valid = makeBackup(project());
  assert.throws(() => parseBackup(JSON.stringify({ ...valid, version: 99 })), /not supported/);
  assert.throws(() => parseBackup("{"), /valid JSON/);
  const duplicate = structuredClone(valid); duplicate.project.shots.push(structuredClone(duplicate.project.shots[0]));
  assert.throws(() => parseBackup(JSON.stringify(duplicate)), /duplicates an identifier/);
  const dangling = structuredClone(valid); dangling.project.cast![0].references[0].shotId = "missing";
  assert.throws(() => parseBackup(JSON.stringify(dangling)), /missing shot/);
});
