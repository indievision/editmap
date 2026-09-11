import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFrameDelta,
  AdaptiveCutDetector,
  buildShotsFromCuts,
} from "../src/analysis/sceneDetection";

test("computeFrameDelta returns 0 for identical frames", () => {
  const frame1 = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
  const frame2 = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
  const delta = computeFrameDelta(frame1, frame2);
  assert.equal(delta, 0);
});

test("computeFrameDelta detects large delta for high contrast frames", () => {
  // Pure black frame vs pure white frame
  const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
  const white = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
  const delta = computeFrameDelta(black, white);
  // Value difference is 255, saturation is 0, hue is 0. Average delta should be 255 / 3 = 85
  assert.ok(delta > 80, `Expected delta > 80, got ${delta}`);
});

test("AdaptiveCutDetector triggers cut on abrupt visual shift", () => {
  const detector = new AdaptiveCutDetector({
    adaptiveThreshold: 3.0,
    minContentVal: 15.0,
    minShotDurationSeconds: 0.5,
  });

  const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
  const white = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);

  // Frame 1: black (t=0)
  assert.equal(detector.processFrame(black, 0.0).isCut, false);
  // Frame 2: black (t=0.2)
  assert.equal(detector.processFrame(black, 0.2).isCut, false);
  // Frame 3: black (t=0.4)
  assert.equal(detector.processFrame(black, 0.4).isCut, false);
  // Frame 4: abrupt cut to white (t=0.6)
  const cutRes = detector.processFrame(white, 0.6);
  assert.equal(cutRes.isCut, true, "Cut should be detected when transitioning from black to white");
  assert.deepEqual(detector.getCuts(), [0.6]);

  // Frame 5: white continues (t=0.8) - no cut
  assert.equal(detector.processFrame(white, 0.8).isCut, false);
});

test("AdaptiveCutDetector does not falsely trigger on gradual camera pan / subtle motion", () => {
  const detector = new AdaptiveCutDetector({
    adaptiveThreshold: 3.0,
    minContentVal: 20.0,
    minShotDurationSeconds: 0.5,
  });

  // Slowly increment luminance by 2 each frame (simulating a smooth pan or slow lighting change)
  for (let t = 0; t <= 2.0; t += 0.1) {
    const lum = Math.min(255, Math.round(t * 20));
    const frame = new Uint8ClampedArray([lum, lum, lum, 255]);
    const res = detector.processFrame(frame, t);
    assert.equal(res.isCut, false, `Gradual change at t=${t} should not trigger a cut`);
  }
  assert.equal(detector.getCuts().length, 0);
});

test("buildShotsFromCuts builds valid sequential Shot list spanning entire duration", () => {
  const cuts = [5.0, 12.5, 20.0];
  const duration = 30.0;
  const fps = 24;

  const shots = buildShotsFromCuts(cuts, duration, fps);
  assert.equal(shots.length, 4);

  // Shot 1: 0 -> 5.0
  assert.equal(shots[0].index, 1);
  assert.equal(shots[0].startSeconds, 0);
  assert.equal(shots[0].endSeconds, 5.0);
  assert.equal(shots[0].duration, 5.0);

  // Shot 2: 5.0 -> 12.5
  assert.equal(shots[1].index, 2);
  assert.equal(shots[1].startSeconds, 5.0);
  assert.equal(shots[1].endSeconds, 12.5);
  assert.equal(shots[1].duration, 7.5);

  // Shot 3: 12.5 -> 20.0
  assert.equal(shots[2].index, 3);
  assert.equal(shots[2].startSeconds, 12.5);
  assert.equal(shots[2].endSeconds, 20.0);

  // Shot 4: 20.0 -> 30.0
  assert.equal(shots[3].index, 4);
  assert.equal(shots[3].startSeconds, 20.0);
  assert.equal(shots[3].endSeconds, 30.0);
  assert.equal(shots[3].duration, 10.0);

  // Check timecodes
  assert.equal(shots[0].startTimecode, "00:00:00:00");
});

test("AdaptiveCutDetector isCutCandidate gates false candidates before fine search", () => {
  const detector = new AdaptiveCutDetector({
    adaptiveThreshold: 3.0,
    minContentVal: 15.0,
    minShotDurationSeconds: 0.5,
  });

  // Below minContentVal
  assert.equal(detector.isCutCandidate(10.0, 1.0), false);

  // Meets threshold on clean baseline
  assert.equal(detector.isCutCandidate(50.0, 1.0), true);

  // Process a cut
  const black = new Uint8ClampedArray([0, 0, 0, 255]);
  const white = new Uint8ClampedArray([255, 255, 255, 255]);
  detector.processFrame(black, 1.0);
  detector.processFrame(black, 1.2);
  detector.processFrame(white, 1.5);

  // Too soon after previous cut (< minShotDurationSeconds)
  assert.equal(detector.isCutCandidate(60.0, 1.7), false);

  // Steady frames in the new shot
  detector.processFrame(white, 1.7);
  detector.processFrame(white, 1.9);

  // After minShotDurationSeconds and steady shot baseline, satisfies criteria (exceeds 3.0x rolling avg)
  assert.equal(detector.isCutCandidate(70.0, 2.1), true);
  assert.ok(detector.getRollingAverage() >= 0);
});

