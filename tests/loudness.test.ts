import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDynamicContrast,
  getRangeLoudness,
  getShotLoudness,
  isLoudnessAnalysisValid,
  lufsToNormalized,
} from "../src/analysis/loudness";
import { newProject, type LoudnessAnalysis, type Project } from "../src/models/project";
import { makeBackup, parseBackup } from "../src/storage/backup";

const sampleAnalysis: LoudnessAnalysis = {
  integratedLoudness: -23.1,
  loudnessRange: 14.5,
  lraLow: -36.2,
  lraHigh: -21.7,
  truePeak: -1.4,
  maxMomentary: -12.3,
  maxShortTerm: -15.8,
  threshold: -33.1,
  momentary: [-30, -30, -20, -10, -25, -25, -24, -24, -23, -23],
  shortTerm: [-30, -28, -22, -16, -20, -22, -23, -23, -23, -23],
  truePeaks: [-10, -10, -5, -1.4, -6, -8, -12, -12, -14, -14],
  transitions: [
    {
      time: 3.0,
      duration: 0.5,
      fromLufs: -30.0,
      toLufs: -10.0,
      deltaLufs: 20.0,
      type: "quiet-to-loud",
    },
  ],
  binCount: 10,
  duration: 10,
  mediaSignature: "sig-xyz-123",
  model: "ffmpeg-ebur128",
  modelVersion: "EBU-R128-BS.1770-4",
  scannedAt: "2026-09-12T20:00:00.000Z",
  processingSeconds: 0.85,
};

test("isLoudnessAnalysisValid validates signature, model, and arrays", () => {
  assert.equal(isLoudnessAnalysisValid(sampleAnalysis, "sig-xyz-123"), true);
  assert.equal(isLoudnessAnalysisValid(sampleAnalysis, "different-sig"), false);
  assert.equal(isLoudnessAnalysisValid(undefined, "sig-xyz-123"), false);
  assert.equal(
    isLoudnessAnalysisValid({ ...sampleAnalysis, modelVersion: "old-version" }, "sig-xyz-123"),
    false,
  );
});

test("classifyDynamicContrast differentiates wide, moderate, and controlled ranges", () => {
  const wide = classifyDynamicContrast(18.2);
  assert.equal(wide.level, "Wide");
  assert.equal(wide.badgeClass, "high");

  const moderate = classifyDynamicContrast(11.0);
  assert.equal(moderate.level, "Moderate");
  assert.equal(moderate.badgeClass, "moderate");

  const controlled = classifyDynamicContrast(5.5);
  assert.equal(controlled.level, "Controlled");
  assert.equal(controlled.badgeClass, "low");
});

test("getShotLoudness computes metrics and identifies quiet-to-loud cut transitions", () => {
  const shot1 = { startSeconds: 0, endSeconds: 2.5 };
  const shot2 = { startSeconds: 2.6, endSeconds: 5.0 };

  const m1 = getShotLoudness(shot1, sampleAnalysis);
  assert.ok(m1.avgMomentary < -20);
  assert.equal(m1.isQuietToLoudTransition, false);

  const m2 = getShotLoudness(shot2, sampleAnalysis, shot1);
  // Shot 2 has momentary jump from -30 to -10 at bin 3
  assert.ok(m2.maxShortTerm >= -20);
  assert.equal(m2.isQuietToLoudTransition, true);
  assert.ok((m2.entranceDelta ?? 0) >= 6.0);
});

test("lufsToNormalized normalizes within range", () => {
  assert.equal(lufsToNormalized(-60, -60, 0), 0);
  assert.equal(lufsToNormalized(0, -60, 0), 1);
  assert.equal(lufsToNormalized(-30, -60, 0), 0.5);
});

test("getRangeLoudness computes metrics across arbitrary range and handles edge cases", () => {
  const fullRange = getRangeLoudness({ start: 0, end: 10 }, sampleAnalysis);
  assert.equal(typeof fullRange.avgMomentary, "number");
  assert.equal(typeof fullRange.maxShortTerm, "number");
  assert.equal(fullRange.peakTruePeak, -1.4);

  // Sub-range where momentary jump occurred (bins 2-4: -20, -10, -25)
  const jumpRange = getRangeLoudness({ start: 2.0, end: 4.5 }, sampleAnalysis);
  assert.ok(jumpRange.maxShortTerm >= -20);
  assert.ok(jumpRange.shortTermRange >= 0);

  // Inverted range order start > end
  const inverted = getRangeLoudness({ start: 5.0, end: 2.0 }, sampleAnalysis);
  assert.equal(inverted.peakTruePeak, jumpRange.peakTruePeak);

  // Edge cases: empty or missing analysis arrays
  const emptyAnalysis = { ...sampleAnalysis, momentary: [] };
  const emptyRes = getRangeLoudness({ start: 0, end: 5 }, emptyAnalysis);
  assert.equal(emptyRes.avgMomentary, -70);
  assert.equal(emptyRes.peakTruePeak, -70);
});

test("loudness analysis survives project backup export and restore", () => {
  const project: Project = newProject();
  project.duration = 10;
  project.loudnessAnalysis = sampleAnalysis;

  const json = JSON.stringify(makeBackup(project));
  const restored = parseBackup(json);

  assert.deepEqual(restored.loudnessAnalysis, sampleAnalysis);
});

test("lufsToNormalized correctly maps -23 LUFS reference line position", () => {
  const norm23 = lufsToNormalized(-23, -60, 0);
  assert.ok(Math.abs(norm23 - 37 / 60) < 0.0001);

  // SVG Y coordinate: 200 - norm * 200
  const y23 = 200 - norm23 * 200;
  assert.ok(y23 > 66 && y23 < 100, "-23 LUFS line must sit between -20 and -30 LUFS");
});

