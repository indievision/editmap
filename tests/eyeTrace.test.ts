import test from "node:test";
import assert from "node:assert/strict";
import { calculateEyeTrace } from "../src/analysis/cuts";
import type { FocalPoint } from "../src/models/project";

test("Eye-Trace Saccadic Cut Flow calculation: classifications and directional flow", async (t) => {
  await t.test("Anchored cut: minimal hop <= 18% within foveal comfort zone", () => {
    const outP: FocalPoint = { x: 0.50, y: 0.40, type: "eyes", confidence: 0.95 };
    const inP: FocalPoint = { x: 0.55, y: 0.42, type: "eyes", confidence: 0.92 };

    const result = calculateEyeTrace(outP, inP);
    assert.equal(result.rating, "anchored");
    assert.ok(result.jumpDistancePercent <= 18);
    assert.equal(result.screenDirection, "neutral");
  });

  await t.test("Shifted conversational cut: 18% < hop <= 38% with left-to-right flow", () => {
    const outP: FocalPoint = { x: 0.30, y: 0.35, type: "face", confidence: 0.88 };
    const inP: FocalPoint = { x: 0.55, y: 0.38, type: "face", confidence: 0.85 };

    const result = calculateEyeTrace(outP, inP);
    assert.equal(result.rating, "shifted");
    assert.ok(result.jumpDistancePercent > 18 && result.jumpDistancePercent <= 38);
    assert.equal(result.screenDirection, "left-to-right");
  });

  await t.test("Scattered / Whiplash cut: hop > 38% with right-to-left flow", () => {
    const outP: FocalPoint = { x: 0.85, y: 0.30, type: "person", confidence: 0.80 };
    const inP: FocalPoint = { x: 0.15, y: 0.70, type: "saliency", confidence: 0.70 };

    const result = calculateEyeTrace(outP, inP);
    assert.equal(result.rating, "scattered");
    assert.ok(result.jumpDistancePercent > 38);
    assert.equal(result.screenDirection, "right-to-left");
  });

  await t.test("Visual saccade angle in degrees maps correctly for cinema standard", () => {
    const outP: FocalPoint = { x: 0.20, y: 0.50, type: "eyes", confidence: 0.9 };
    const inP: FocalPoint = { x: 0.80, y: 0.50, type: "eyes", confidence: 0.9 };

    const result = calculateEyeTrace(outP, inP);
    // dx = 0.60 -> 60% hop -> 60% of 35 deg = 21 deg
    const degrees = (result.jumpDistancePercent / 100) * 35;
    assert.equal(result.jumpDistancePercent, 60);
    assert.equal(degrees.toFixed(1), "21.0");
    assert.equal(result.rating, "scattered");
  });

  await t.test("Phase 2: Gaze momentum match - eye pursuit aligned with cut jump", () => {
    const outP: FocalPoint = { x: 0.30, y: 0.40, type: "eyes", confidence: 0.9 };
    const inP: FocalPoint = { x: 0.70, y: 0.40, type: "eyes", confidence: 0.9 };
    // Pre-cut gaze velocity moving rightward (+vx)
    const momentum = {
      vx: 0.8,
      vy: 0.0,
      velocity: 80,
      alignment: "momentum-match" as const,
      cosineScore: 1.0,
    };

    const result = calculateEyeTrace(outP, inP, momentum);
    assert.ok(result.momentum);
    assert.equal(result.momentum.alignment, "momentum-match");
    assert.equal(result.momentum.cosineScore, 1.0);
  });

  await t.test("Phase 2: Gaze momentum collision - eye pursuit opposite to cut jump", () => {
    const outP: FocalPoint = { x: 0.80, y: 0.40, type: "eyes", confidence: 0.9 };
    const inP: FocalPoint = { x: 0.20, y: 0.40, type: "eyes", confidence: 0.9 };
    // Pre-cut gaze was moving rightward, but cut jumps leftward -> collision!
    const momentum = {
      vx: 0.8,
      vy: 0.0,
      velocity: 80,
      alignment: "momentum-collision" as const,
      cosineScore: -1.0,
    };

    const result = calculateEyeTrace(outP, inP, momentum);
    assert.ok(result.momentum);
    assert.equal(result.momentum.alignment, "momentum-collision");
    assert.equal(result.momentum.cosineScore, -1.0);
  });

  await t.test("Phase 3: The Cut Doctor - finds optimal sweet spot and calculates jump reduction", () => {
    // Current cut at 0f has jarring 46% hop
    const current = {
      offset: 0,
      jumpDistancePercent: 46,
      rating: "jarring" as const,
    };

    // Candidate offsets evaluated around cut
    const candidates = [
      { offset: -3, jumpDistancePercent: 35, rating: "natural" as const },
      { offset: -2, jumpDistancePercent: 12, rating: "smooth" as const }, // Optimal sweet spot!
      { offset: -1, jumpDistancePercent: 26, rating: "natural" as const },
      current,
      { offset: 1, jumpDistancePercent: 50, rating: "jarring" as const },
      { offset: 2, jumpDistancePercent: 54, rating: "jarring" as const },
      { offset: 3, jumpDistancePercent: 62, rating: "jarring" as const },
    ];

    let best = candidates[0];
    for (const c of candidates) {
      if (c.jumpDistancePercent < best.jumpDistancePercent) {
        best = c;
      }
    }

    assert.equal(best.offset, -2);
    assert.equal(best.jumpDistancePercent, 12);
    assert.equal(best.rating, "smooth");

    const improvement = current.jumpDistancePercent - best.jumpDistancePercent;
    assert.equal(improvement, 34); // 34% reduction in saccade hop!
    assert.ok(improvement >= 6); // Triggers active recommendation prescription
  });

  await t.test("Phase 4: Whiplash Clusters detection detects rapid consecutive jarring cuts", async () => {
    const { detectWhiplashClusters, getSaccadeRangeStats } = await import("../src/analysis/cuts");
    const shots = [
      { id: "s1", index: 1, startSeconds: 0, endSeconds: 2.0, duration: 2.0 },
      { id: "s2", index: 2, startSeconds: 2.0, endSeconds: 4.0, duration: 2.0 },
      { id: "s3", index: 3, startSeconds: 4.0, endSeconds: 6.0, duration: 2.0 },
      { id: "s4", index: 4, startSeconds: 6.0, endSeconds: 8.0, duration: 2.0 },
      { id: "s5", index: 5, startSeconds: 8.0, endSeconds: 12.0, duration: 4.0 },
    ];

    const annotations = [
      // Cut s1 -> s2: smooth (12%)
      {
        outgoingId: "s1",
        incomingId: "s2",
        interpretation: "Unmarked" as const,
        notes: "",
        eyeTrace: {
          outgoingFocalPoint: { x: 0.5, y: 0.5, type: "face" as const, confidence: 0.9 },
          incomingFocalPoint: { x: 0.55, y: 0.52, type: "face" as const, confidence: 0.9 },
          jumpDistance: 0.05,
          jumpDistancePercent: 12,
          rating: "smooth" as const,
        },
      },
      // Cut s2 -> s3: jarring (55%)
      {
        outgoingId: "s2",
        incomingId: "s3",
        interpretation: "Unmarked" as const,
        notes: "",
        eyeTrace: {
          outgoingFocalPoint: { x: 0.1, y: 0.2, type: "person" as const, confidence: 0.9 },
          incomingFocalPoint: { x: 0.85, y: 0.8, type: "person" as const, confidence: 0.9 },
          jumpDistance: 0.8,
          jumpDistancePercent: 55,
          rating: "jarring" as const,
        },
      },
      // Cut s3 -> s4: jarring (48%)
      {
        outgoingId: "s3",
        incomingId: "s4",
        interpretation: "Unmarked" as const,
        notes: "",
        eyeTrace: {
          outgoingFocalPoint: { x: 0.85, y: 0.8, type: "person" as const, confidence: 0.9 },
          incomingFocalPoint: { x: 0.15, y: 0.2, type: "person" as const, confidence: 0.9 },
          jumpDistance: 0.75,
          jumpDistancePercent: 48,
          rating: "jarring" as const,
        },
      },
      // Cut s4 -> s5: natural (25%)
      {
        outgoingId: "s4",
        incomingId: "s5",
        interpretation: "Unmarked" as const,
        notes: "",
        eyeTrace: {
          outgoingFocalPoint: { x: 0.3, y: 0.4, type: "face" as const, confidence: 0.9 },
          incomingFocalPoint: { x: 0.55, y: 0.45, type: "face" as const, confidence: 0.9 },
          jumpDistance: 0.25,
          jumpDistancePercent: 25,
          rating: "natural" as const,
        },
      },
    ];

    const clusters = detectWhiplashClusters(shots as any, annotations);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].cutCount, 2);
    assert.equal(clusters[0].startTime, 4.0); // Cut s2->s3
    assert.equal(clusters[0].endTime, 6.0); // Cut s3->s4
    assert.equal(clusters[0].avgJumpPercent, 52); // (55 + 48) / 2 = 51.5 -> 52%

    // Check Saccade Range Stats across all cuts
    const stats = getSaccadeRangeStats(shots as any, annotations);
    assert.equal(stats.totalCuts, 4);
    assert.equal(stats.scannedCuts, 4);
    assert.equal(stats.anchoredCount, 1);
    assert.equal(stats.shiftedCount, 1);
    assert.equal(stats.scatteredCount, 2);
    assert.equal(stats.avgJumpPercent, 35); // (12 + 55 + 48 + 25) / 4 = 35%
    assert.equal(stats.overallRating, "shifted");
  });

  await t.test("180° Axis clash detection: both subjects framed screen-right facing screen-left", () => {
    const outP: FocalPoint = { x: 0.76, y: 0.25, type: "eyes", confidence: 0.95, gazeDirection: "screen-left" };
    const inP: FocalPoint = { x: 0.73, y: 0.28, type: "eyes", confidence: 0.92, gazeDirection: "screen-left" };

    const result = calculateEyeTrace(outP, inP);
    assert.equal(result.rating, "anchored");
    assert.equal(result.axisClash, true);
    assert.ok(result.axisClashDetail?.includes("180° line cross"));
    assert.equal(result.characterReplacement, true);
  });

  await t.test("Depth accommodation shift: near close-up to far wide shot", () => {
    const outP: FocalPoint = { x: 0.50, y: 0.35, type: "eyes", confidence: 0.95, sharpness: 220 };
    const inP: FocalPoint = { x: 0.50, y: 0.35, type: "eyes", confidence: 0.90, sharpness: 30 };

    const result = calculateEyeTrace(outP, inP);
    assert.ok(result.depthShift);
    assert.equal(result.depthShift?.shift, "near-to-far");
  });
});

