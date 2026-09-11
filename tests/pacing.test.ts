import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutTimes, pacingAt, pacingCurve, sequenceReading, sensoryShockAt, sensoryShockCurve, computeCutShockData } from '../src/analysis/pacing';
import { calculateCutVisualDelta } from '../src/analysis/cuts';
import { parseEDL } from '../src/parsers/edl';

test('normalizes truncated edge windows and counts half-open boundaries', () => {
  assert.deepEqual(pacingAt([2, 5, 9, 15], 20, 10, 0), { time: 0, start: 0, end: 5, count: 1, rate: 12 });
  assert.equal(pacingAt([2, 5, 9, 15], 20, 10, 20).rate, 12);
  assert.equal(pacingAt([2, 5, 9, 15], 20, 10, 10).rate, 12);
  assert.equal(pacingAt([2], 4, 30, 2).rate, 15);
  assert.equal(pacingAt([], 0, 30, 0).rate, 0);
});

test('excludes opening event, gaps and dissolves', () => {
  const p = parseEDL('001 AX V C 00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00\n002 AX V C 00:00:00:00 00:00:01:00 00:00:01:00 00:00:02:00\n003 AX V C 00:00:00:00 00:00:01:00 00:00:03:00 00:00:04:00\n004 AX V D 012 00:00:00:00 00:00:01:00 00:00:04:00 00:00:05:00', 24);
  assert.deepEqual(cutTimes(p.shots), [1]);
  assert.equal(pacingCurve([1], 5, 30).length, 601);
  assert.deepEqual(pacingCurve([], 0, 30), []);
});

test('calculateCutVisualDelta and sensoryShockAt compute visual contrast and shock score', () => {
  const p = parseEDL('001 AX V C 00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n002 AX V C 00:00:00:00 00:00:00:12 00:00:02:00 00:00:02:12', 24);
  const shotA = p.shots[0];
  const shotB = p.shots[1];

  // Pitch black outgoing, pure white incoming
  shotA.colorProfile = {
    palette: ["#000000", "#111111", "#050505"],
    luminance: 0.0,
    temperature: 0,
    saturation: 0,
    mood: "Low-Key / Dark",
    harmony: { type: "monochromatic", label: "Monochromatic", confidence: 1, dominantHue: 0 },
  };
  shotB.colorProfile = {
    palette: ["#FFFFFF", "#EEEEEE", "#FAFAFA"],
    luminance: 1.0,
    temperature: 0,
    saturation: 0,
    mood: "High-Key / Bright",
    harmony: { type: "monochromatic", label: "Monochromatic", confidence: 1, dominantHue: 0 },
  };

  const delta = calculateCutVisualDelta(shotA, shotB);
  assert.equal(delta.deltaLuma, 1.0);
  assert.equal(delta.deltaChroma, 1.0);
  assert.equal(delta.deltaV, 1.0);
  // Fast 0.5s incoming shot amplifies shock score
  assert.ok(delta.shockScore >= 80, `Expected high shock score, got ${delta.shockScore}`);

  const shockResult = sensoryShockAt(p.shots, 3, 10, 2);
  assert.ok(shockResult.shockScore >= 80);
  assert.equal(shockResult.cutCount, 1);

  // Precomputed CutShockData parity
  const cutData = computeCutShockData(p.shots);
  assert.equal(cutData.length, 1);
  assert.equal(cutData[0].shockScore, delta.shockScore);

  const precomputedResult = sensoryShockAt(cutData, 3, 10, 2);
  assert.deepEqual(precomputedResult, shockResult);

  const curve = sensoryShockCurve(cutData, 3, 10);
  assert.equal(curve.length, 601);
});

test('tag fields preserve legacy records and text has no size', async () => {
  const { updateShotTags } = await import('../src/models/project');
  const { shots } = parseEDL('001 AX V C 00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00', 24);
  const original = { ...shots[0], shotSize: 'OTS' as const };
  const group = updateShotTags(original, { composition: 'Group', uncertain: true });
  assert.equal(group.shotSize, 'OTS'); assert.equal(group.uncertain, true);
  const text = updateShotTags(group, { content: 'Text / title card' });
  assert.equal(text.shotSize, 'Not applicable');
  assert.equal(updateShotTags(text, { shotSize: 'CU' }).shotSize, 'Not applicable');
  assert.equal(updateShotTags(text, { content: 'People' }).shotSize, 'Unknown');
});

test('sequence reading reports factual timing and framing changes without interpretation', () => {
  const { shots } = parseEDL('001 AX V C 00:00:00:00 00:00:03:00 00:00:00:00 00:00:03:00\n002 AX V C 00:00:00:00 00:00:02:00 00:00:03:00 00:00:05:00\n003 AX V C 00:00:00:00 00:00:01:00 00:00:05:00 00:00:06:00', 24);
  shots[0].shotSize = 'WS'; shots[1].shotSize = 'MS'; shots[2].shotSize = 'EWS';
  const reading = sequenceReading(shots, 0, 6);
  assert.equal(reading.shots.length, 3); assert.equal(reading.cuts, 2); assert.equal(reading.median, 2);
  assert.deepEqual(reading.framingChanges, { tighter: 1, wider: 1, unchanged: 0, unknown: 0 });
  assert.equal(reading.acceleratingRuns, 1);
});
