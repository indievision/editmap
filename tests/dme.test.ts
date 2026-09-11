import { test } from "node:test";
import assert from "node:assert/strict";
import type { DmeWaveforms, Project } from "../src/models/project";
import { audioIntensityCurve } from "../src/analysis/audio";
import { calculatePearsonCorrelation } from "../src/analysis/pacing";

test("DmeWaveforms preserves separated stem arrays on project", () => {
  const dme: DmeWaveforms = {
    dialogue: [0.1, 0.5, 0.8, 0.2],
    music: [0.3, 0.4, 0.6, 0.7],
    effects: [0.9, 0.1, 0.05, 0.4],
    binCount: 4,
    duration: 10.0,
    separatedAt: new Date().toISOString(),
  };

  const project: Partial<Project> = {
    id: "test-proj",
    duration: 10.0,
    dmeWaveforms: dme,
  };

  assert.ok(project.dmeWaveforms);
  assert.equal(project.dmeWaveforms.binCount, 4);
  assert.equal(project.dmeWaveforms.dialogue.length, 4);
  assert.equal(project.dmeWaveforms.music.length, 4);
  assert.equal(project.dmeWaveforms.effects.length, 4);
});

test("audioIntensityCurve computes separate intensity curves per DME stem", () => {
  const dme: DmeWaveforms = {
    dialogue: [0.0, 0.8, 0.8, 0.0],
    music: [0.5, 0.5, 0.5, 0.5],
    effects: [0.0, 0.0, 1.0, 0.0],
    binCount: 4,
    duration: 4.0,
    separatedAt: new Date().toISOString(),
  };

  const dxCurve = audioIntensityCurve(dme.dialogue, dme.duration, 1.0, 5);
  const mxCurve = audioIntensityCurve(dme.music, dme.duration, 1.0, 5);
  const fxCurve = audioIntensityCurve(dme.effects, dme.duration, 1.0, 5);

  assert.equal(dxCurve.length, 5);
  assert.equal(mxCurve.length, 5);
  assert.equal(fxCurve.length, 5);

  // Peak of effects should be significantly higher at the 3rd quarter
  const fxPeak = Math.max(...fxCurve.map((p) => p.normalized));
  assert.ok(fxPeak > 0.8, "FX peak should be high");

  // Music is steady across the track
  const mxNormalized = mxCurve.map((p) => p.normalized);
  const mxVariance = Math.max(...mxNormalized) - Math.min(...mxNormalized);
  assert.ok(mxVariance < 0.2, "Music intensity should be relatively steady");
});

test("pacing correlation correctly differentiates between dialogue vs music rhythm", () => {
  const pacingRates = [10, 30, 45, 12, 8]; // Rapid cutting in the middle
  const musicIntensity = [-30, -10, -3, -25, -35]; // Music swells during cutting
  const dialogueIntensity = [-6, -24, -36, -6, -4]; // Dialogue drops during action cut sequence

  const musicCorr = calculatePearsonCorrelation(pacingRates, musicIntensity);
  const dialogueCorr = calculatePearsonCorrelation(pacingRates, dialogueIntensity);

  assert.ok(
    musicCorr > 0.7,
    `Music should correlate strongly with fast cuts (got ${musicCorr})`,
  );
  assert.ok(
    dialogueCorr < -0.7,
    `Dialogue should inversely correlate with action cuts (got ${dialogueCorr})`,
  );
});
