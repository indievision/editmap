import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCut, isSpeechAnalysisValid, normalizeSpeechRegions, pauseRegions, speechSummary } from "../src/analysis/speech";
import { makeBackup, parseBackup } from "../src/storage/backup";
import { newProject, type SpeechAnalysis } from "../src/models/project";

const analysis: SpeechAnalysis = { regions: [{ startSeconds: 1, endSeconds: 3 }, { startSeconds: 4, endSeconds: 8 }], mediaSignature: "media-a", model: "silero-vad", modelVersion: "6.2.0", settingsVersion: "vad-1", threshold: .5, minSpeechMs: 250, minSilenceMs: 100, duration: 10, scannedAt: "2026-01-01T00:00:00.000Z", processingSeconds: 1 };

test("speech regions remain ordered across chunk joins and pauses derive only between them", () => {
  assert.deepEqual(normalizeSpeechRegions([{ startSeconds: 4, endSeconds: 5 }, { startSeconds: 1, endSeconds: 2.99999 }, { startSeconds: 3, endSeconds: 4.2 }], 10), [{ startSeconds: 1, endSeconds: 5 }]);
  assert.deepEqual(pauseRegions(analysis.regions), [{ startSeconds: 3, endSeconds: 4 }]);
});

test("selection intersections and cuts distinguish speech, pause, and outside evidence", () => {
  assert.deepEqual(speechSummary(analysis.regions, { start: 2, end: 6 }), { speechDuration: 3, speechPercent: 75, pauseCount: 1, pauseDuration: 1 });
  assert.equal(classifyCut(2, analysis.regions), "during speech");
  assert.equal(classifyCut(3.5, analysis.regions), "during a pause");
  assert.equal(classifyCut(.5, analysis.regions), "other non-speech region");
});

test("cache validity rejects a changed media signature or model settings", () => {
  assert.equal(isSpeechAnalysisValid(analysis, "media-a"), true);
  assert.equal(isSpeechAnalysisValid(analysis, "other-file"), false);
  assert.equal(isSpeechAnalysisValid({ ...analysis, settingsVersion: "old" }, "media-a"), false);
});

test("speech evidence survives the project backup contract", () => {
  const project = newProject(); project.duration = 10; project.speechAnalysis = analysis;
  const restored = parseBackup(JSON.stringify(makeBackup(project)));
  assert.deepEqual(restored.speechAnalysis, analysis);
});
