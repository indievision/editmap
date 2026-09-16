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

test("fully populated analysis survives portable backup restoration", () => {
  const p = project();
  const shot = p.shots[0];
  shot.cameraMovement = "Pan";
  shot.protectedFields = ["cameraMovement", "shotSize"];
  shot.colorProfile = { palette: ["#112233"], luminance: .3, temperature: -.4, saturation: .5, mood: "Cool", harmony: { type: "neutral", label: "Neutral", confidence: .5, dominantHue: 120 } };
  shot.motionProfile = { cameraMovement: "Pan", cameraEnergy: 5, subjectEnergy: 3, totalKineticEnergy: 8, confidence: .7 };
  shot.suggestion = { shotSize: "MS", composition: "Single person", content: "People", uncertain: true, cameraMovement: "Static", model: "yolo:geometry-v2", createdAt: p.createdAt };
  shot.analysisFailures = { framing: { message: "Offline", createdAt: p.createdAt } };
  p.dmeWaveforms = { dialogue: [.1], music: [.2], effects: [.3], binCount: 1, duration: 1, separatedAt: p.createdAt };
  p.shots.push({ ...shot, id: "s2", index: 2, startSeconds: 1, endSeconds: 2 });
  p.cutAnnotations = [{ outgoingId: "s1", incomingId: "s2", interpretation: "Unmarked", notes: "", eyeTrace: { outgoingFocalPoint: { x: .2, y: .3, type: "saliency", confidence: .5 }, incomingFocalPoint: { x: .2, y: .3, type: "eyes", confidence: .8 }, jumpDistance: 0, jumpDistancePercent: 0, rating: "smooth", screenDirection: "neutral" } }];
  assert.deepEqual(parseBackup(JSON.stringify(makeBackup(p))), JSON.parse(JSON.stringify(p)));
  const bad = makeBackup(p); bad.project.dmeWaveforms!.dialogue = [];
  assert.throws(() => parseBackup(JSON.stringify(bad)), /length/);
  const invalid = makeBackup(p); invalid.project.shots[0].motionProfile!.confidence = 9;
  assert.throws(() => parseBackup(JSON.stringify(invalid)), /range/);
});
