import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateEyeTrace,
  detectWhiplashClusters,
  getSaccadeRangeStats,
} from "../src/analysis/cuts";
import type { FocalPoint, GazeMomentum, Project, Shot, CutAnnotation } from "../src/models/project";
import { makeBackup, parseBackup } from "../src/storage/backup";

test("Eye-Trace Saccade Engine - Complete 4-Phase Audit", async (t) => {
  // =========================================================================
  // PHASE 1 AUDIT: Interactive Vector Cut Flow & Saccadic Geometry
  // =========================================================================
  await t.test("Phase 1: Zero-distance cut (identical focal point) produces 0% hop and smooth rating", () => {
    const p1: FocalPoint = { x: 0.5, y: 0.5, type: "face", confidence: 0.95 };
    const p2: FocalPoint = { x: 0.5, y: 0.5, type: "face", confidence: 0.95 };
    const trace = calculateEyeTrace(p1, p2);

    assert.equal(trace.jumpDistance, 0);
    assert.equal(trace.jumpDistancePercent, 0);
    assert.equal(trace.rating, "anchored");
    assert.equal(trace.screenDirection, "neutral");
  });

  await t.test("Phase 1: Extreme diagonal corner-to-corner leap produces maximum jarring hop", () => {
    const p1: FocalPoint = { x: 0.0, y: 0.0, type: "saliency", confidence: 0.8 };
    const p2: FocalPoint = { x: 1.0, y: 1.0, type: "saliency", confidence: 0.8 };
    const trace = calculateEyeTrace(p1, p2);

    // Diagonal distance across normalized 1x1 plane is sqrt(2) ≈ 1.414 -> 100% of diagonal
    assert.equal(trace.jumpDistancePercent, 100);
    assert.equal(trace.rating, "scattered");
    assert.equal(trace.screenDirection, "left-to-right");
    const degrees = (trace.jumpDistancePercent / 100) * 35;
    assert.equal(degrees, 35);
  });

  await t.test("Phase 1: Horizontal screen direction boundaries (L->R vs R->L vs Neutral)", () => {
    // dx > 0.08 -> left-to-right
    const lr = calculateEyeTrace(
      { x: 0.40, y: 0.5, type: "eyes", confidence: 0.9 },
      { x: 0.55, y: 0.5, type: "eyes", confidence: 0.9 }
    );
    assert.equal(lr.screenDirection, "left-to-right");

    // dx < -0.08 -> right-to-left
    const rl = calculateEyeTrace(
      { x: 0.55, y: 0.5, type: "eyes", confidence: 0.9 },
      { x: 0.40, y: 0.5, type: "eyes", confidence: 0.9 }
    );
    assert.equal(rl.screenDirection, "right-to-left");

    // |dx| <= 0.08 -> neutral
    const neutral = calculateEyeTrace(
      { x: 0.50, y: 0.3, type: "eyes", confidence: 0.9 },
      { x: 0.53, y: 0.7, type: "eyes", confidence: 0.9 }
    );
    assert.equal(neutral.screenDirection, "neutral");
  });

  // =========================================================================
  // PHASE 2 AUDIT: Pre-cut Optical Flow Kinetic Gaze Momentum & Collisions
  // =========================================================================
  await t.test("Phase 2: Momentum Match (cos >= 0.40)", () => {
    const outP: FocalPoint = { x: 0.3, y: 0.5, type: "eyes", confidence: 0.9 };
    const inP: FocalPoint = { x: 0.7, y: 0.5, type: "eyes", confidence: 0.9 };
    const momentum: GazeMomentum = {
      vx: 0.8,
      vy: 0.0,
      velocity: 80,
      alignment: "momentum-match",
      cosineScore: 1.0,
    };
    const trace = calculateEyeTrace(outP, inP, momentum);
    assert.ok(trace.momentum);
    assert.equal(trace.momentum.alignment, "momentum-match");
    assert.equal(trace.momentum.cosineScore, 1.0);
  });

  await t.test("Phase 2: Kinetic Collision (cos <= -0.40)", () => {
    const outP: FocalPoint = { x: 0.7, y: 0.5, type: "eyes", confidence: 0.9 };
    const inP: FocalPoint = { x: 0.3, y: 0.5, type: "eyes", confidence: 0.9 };
    const momentum: GazeMomentum = {
      vx: 0.8,
      vy: 0.0,
      velocity: 80,
      alignment: "momentum-collision",
      cosineScore: -1.0,
    };
    const trace = calculateEyeTrace(outP, inP, momentum);
    assert.ok(trace.momentum);
    assert.equal(trace.momentum.alignment, "momentum-collision");
    assert.equal(trace.momentum.cosineScore, -1.0);
  });

  await t.test("Phase 2: Neutral Gaze Momentum (-0.40 < cos < 0.40)", () => {
    const outP: FocalPoint = { x: 0.5, y: 0.3, type: "face", confidence: 0.85 };
    const inP: FocalPoint = { x: 0.5, y: 0.7, type: "face", confidence: 0.85 };
    // Pre-cut motion was purely horizontal, but cut jump is purely vertical -> orthogonal (cos = 0)
    const momentum: GazeMomentum = {
      vx: 0.6,
      vy: 0.0,
      velocity: 60,
      alignment: "neutral",
      cosineScore: 0.0,
    };
    const trace = calculateEyeTrace(outP, inP, momentum);
    assert.ok(trace.momentum);
    assert.equal(trace.momentum.alignment, "neutral");
    assert.equal(trace.momentum.cosineScore, 0.0);
  });

  // =========================================================================
  // PHASE 3 AUDIT: The Cut Doctor (Saccade Nudge Optimizer)
  // =========================================================================
  await t.test("Phase 3: The Cut Doctor prescription generation logic", () => {
    const current = { offset: 0, jumpDistancePercent: 52, rating: "jarring" as const };
    const candidates = [
      { offset: -3, jumpDistancePercent: 38, rating: "natural" as const },
      { offset: -2, jumpDistancePercent: 14, rating: "smooth" as const }, // Best candidate (-2f)
      { offset: -1, jumpDistancePercent: 28, rating: "natural" as const },
      current,
      { offset: +1, jumpDistancePercent: 56, rating: "jarring" as const },
      { offset: +2, jumpDistancePercent: 60, rating: "jarring" as const },
      { offset: +3, jumpDistancePercent: 64, rating: "jarring" as const },
    ];

    let best = candidates[0];
    for (const c of candidates) {
      if (c.jumpDistancePercent < best.jumpDistancePercent) {
        best = c;
      }
    }

    assert.equal(best.offset, -2);
    assert.equal(best.jumpDistancePercent, 14);
    assert.equal(best.rating, "smooth");

    const diff = current.jumpDistancePercent - best.jumpDistancePercent;
    assert.equal(diff, 38);

    // Formulation check
    const prescription =
      diff >= 6
        ? `Trimming ${Math.abs(best.offset)} frames off Shot A reduces saccadic jump from ${current.jumpDistancePercent}% down to ${best.jumpDistancePercent}% (${best.rating.toUpperCase()} FLOW).`
        : `Current cut is already within visual sweet spot (${current.jumpDistancePercent}% hop).`;

    assert.match(prescription, /Trimming 2 frames off Shot A reduces/);
    assert.match(prescription, /down to 14% \(SMOOTH FLOW\)/);
  });

  await t.test("Phase 3: When current cut is already optimal, prescription confirms sweet spot", () => {
    const current = { offset: 0, jumpDistancePercent: 10, rating: "smooth" as const };
    const candidates = [
      { offset: -3, jumpDistancePercent: 25, rating: "natural" as const },
      { offset: -2, jumpDistancePercent: 18, rating: "smooth" as const },
      { offset: -1, jumpDistancePercent: 14, rating: "smooth" as const },
      current, // Best candidate is 0f
      { offset: +1, jumpDistancePercent: 15, rating: "smooth" as const },
      { offset: +2, jumpDistancePercent: 20, rating: "natural" as const },
      { offset: +3, jumpDistancePercent: 30, rating: "natural" as const },
    ];

    let best = candidates[0];
    for (const c of candidates) {
      if (c.jumpDistancePercent < best.jumpDistancePercent) {
        best = c;
      }
    }

    assert.equal(best.offset, 0);
    const diff = current.jumpDistancePercent - best.jumpDistancePercent;
    assert.equal(diff, 0);

    const isAlreadyOptimal = diff < 6;
    assert.ok(isAlreadyOptimal);
  });

  // =========================================================================
  // PHASE 4 AUDIT: Macro Timeline Saccade Radar & Whiplash Cluster Engine
  // =========================================================================
  await t.test("Phase 4: Whiplash Clusters groups adjacent jarring cuts but ignores isolated cuts", () => {
    const shots: Shot[] = [
      { id: "s1", index: 1, startSeconds: 0, endSeconds: 2.0, duration: 2.0 } as any,
      { id: "s2", index: 2, startSeconds: 2.0, endSeconds: 4.0, duration: 2.0 } as any,
      { id: "s3", index: 3, startSeconds: 4.0, endSeconds: 6.0, duration: 2.0 } as any,
      { id: "s4", index: 4, startSeconds: 6.0, endSeconds: 8.0, duration: 2.0 } as any,
      { id: "s5", index: 5, startSeconds: 8.0, endSeconds: 10.0, duration: 2.0 } as any,
      { id: "s6", index: 6, startSeconds: 10.0, endSeconds: 12.0, duration: 2.0 } as any,
    ];

    const annotations: CutAnnotation[] = [
      // Cut 1 (s1->s2): Jarring (50%) -> Isolated!
      {
        outgoingId: "s1",
        incomingId: "s2",
        interpretation: "Unmarked",
        notes: "",
        eyeTrace: {
          outgoingFocalPoint: { x: 0.1, y: 0.2, type: "person", confidence: 0.8 },
          incomingFocalPoint: { x: 0.9, y: 0.8, type: "person", confidence: 0.8 },
          jumpDistance: 0.8,
          jumpDistancePercent: 50,
          rating: "jarring",
        },
      },
      // Cut 2 (s2->s3): Smooth (10%)
      {
        outgoingId: "s2",
        incomingId: "s3",
        interpretation: "Unmarked",
        notes: "",
        eyeTrace: {
          outgoingFocalPoint: { x: 0.5, y: 0.5, type: "face", confidence: 0.9 },
          incomingFocalPoint: { x: 0.55, y: 0.52, type: "face", confidence: 0.9 },
          jumpDistance: 0.05,
          jumpDistancePercent: 10,
          rating: "smooth",
        },
      },
      // Cut 3 (s3->s4): Jarring (60%) \
      //                                -> Cluster 1 (2 cuts)
      // Cut 4 (s4->s5): Jarring (56%) /
      {
        outgoingId: "s3",
        incomingId: "s4",
        interpretation: "Unmarked",
        notes: "",
        eyeTrace: {
          outgoingFocalPoint: { x: 0.1, y: 0.2, type: "person", confidence: 0.8 },
          incomingFocalPoint: { x: 0.9, y: 0.8, type: "person", confidence: 0.8 },
          jumpDistance: 0.8,
          jumpDistancePercent: 60,
          rating: "jarring",
        },
      },
      {
        outgoingId: "s4",
        incomingId: "s5",
        interpretation: "Unmarked",
        notes: "",
        eyeTrace: {
          outgoingFocalPoint: { x: 0.9, y: 0.8, type: "person", confidence: 0.8 },
          incomingFocalPoint: { x: 0.1, y: 0.2, type: "person", confidence: 0.8 },
          jumpDistance: 0.8,
          jumpDistancePercent: 56,
          rating: "jarring",
        },
      },
      // Cut 5 (s5->s6): Natural (25%)
      {
        outgoingId: "s5",
        incomingId: "s6",
        interpretation: "Unmarked",
        notes: "",
        eyeTrace: {
          outgoingFocalPoint: { x: 0.4, y: 0.5, type: "face", confidence: 0.9 },
          incomingFocalPoint: { x: 0.6, y: 0.5, type: "face", confidence: 0.9 },
          jumpDistance: 0.2,
          jumpDistancePercent: 25,
          rating: "natural",
        },
      },
    ];

    const clusters = detectWhiplashClusters(shots, annotations);
    // Cut 1 was isolated, so only cuts 3 & 4 should form a cluster!
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].cutCount, 2);
    assert.equal(clusters[0].startTime, 6.0); // Cut 3 start
    assert.equal(clusters[0].endTime, 8.0); // Cut 4 start
    assert.equal(clusters[0].avgJumpPercent, 58); // (60 + 56) / 2 = 58
  });

  await t.test("Phase 4: Saccade Range Stats accurately windows and counts collisions", () => {
    const shots: Shot[] = [
      { id: "s1", index: 1, startSeconds: 0, endSeconds: 5.0, duration: 5.0 } as any,
      { id: "s2", index: 2, startSeconds: 5.0, endSeconds: 10.0, duration: 5.0 } as any,
      { id: "s3", index: 3, startSeconds: 10.0, endSeconds: 15.0, duration: 5.0 } as any,
      { id: "s4", index: 4, startSeconds: 15.0, endSeconds: 20.0, duration: 5.0 } as any,
    ];

    const annotations: CutAnnotation[] = [
      // Cut 1 at 5.0s: Smooth (12%)
      {
        outgoingId: "s1",
        incomingId: "s2",
        interpretation: "Unmarked",
        notes: "",
        eyeTrace: {
          outgoingFocalPoint: { x: 0.5, y: 0.5, type: "face", confidence: 0.9 },
          incomingFocalPoint: { x: 0.55, y: 0.5, type: "face", confidence: 0.9 },
          jumpDistance: 0.05,
          jumpDistancePercent: 12,
          rating: "smooth",
        },
      },
      // Cut 2 at 10.0s: Jarring (50%) with Kinetic Collision
      {
        outgoingId: "s2",
        incomingId: "s3",
        interpretation: "Unmarked",
        notes: "",
        eyeTrace: {
          outgoingFocalPoint: { x: 0.8, y: 0.5, type: "person", confidence: 0.9 },
          incomingFocalPoint: { x: 0.2, y: 0.5, type: "person", confidence: 0.9 },
          jumpDistance: 0.6,
          jumpDistancePercent: 50,
          rating: "jarring",
          momentum: {
            vx: 0.8,
            vy: 0,
            velocity: 80,
            alignment: "momentum-collision",
            cosineScore: -1.0,
          },
        },
      },
      // Cut 3 at 15.0s: Natural (28%)
      {
        outgoingId: "s3",
        incomingId: "s4",
        interpretation: "Unmarked",
        notes: "",
        eyeTrace: {
          outgoingFocalPoint: { x: 0.3, y: 0.4, type: "face", confidence: 0.9 },
          incomingFocalPoint: { x: 0.55, y: 0.45, type: "face", confidence: 0.9 },
          jumpDistance: 0.25,
          jumpDistancePercent: 28,
          rating: "natural",
        },
      },
    ];

    // Query entire range [0..20]
    const allStats = getSaccadeRangeStats(shots, annotations, 0, 20);
    assert.equal(allStats.totalCuts, 3);
    assert.equal(allStats.scannedCuts, 3);
    assert.equal(allStats.anchoredCount, 1);
    assert.equal(allStats.shiftedCount, 1);
    assert.equal(allStats.scatteredCount, 1);
    assert.equal(allStats.collisionCount, 1);
    assert.equal(allStats.avgJumpPercent, 30); // (12 + 50 + 28) / 3 = 30%
    assert.equal(allStats.overallRating, "shifted");

    // Query window [4.0..8.0] (only Cut 1 included)
    const window1 = getSaccadeRangeStats(shots, annotations, 4.0, 8.0);
    assert.equal(window1.totalCuts, 1);
    assert.equal(window1.scannedCuts, 1);
    assert.equal(window1.anchoredCount, 1);
    assert.equal(window1.avgJumpPercent, 12);
    assert.equal(window1.overallRating, "anchored");

    // Query window [9.0..12.0] (only Cut 2 included)
    const window2 = getSaccadeRangeStats(shots, annotations, 9.0, 12.0);
    assert.equal(window2.totalCuts, 1);
    assert.equal(window2.scannedCuts, 1);
    assert.equal(window2.jarringCount, 1);
    assert.equal(window2.collisionCount, 1);
    assert.equal(window2.avgJumpPercent, 50);
    assert.equal(window2.overallRating, "scattered");
  });

  await t.test("Full Backup Round-Trip Audit: Complete Project with 4-phase EyeTrace data", () => {
    const project: Project = {
      id: "audit-proj",
      name: "Audit Project",
      frameRate: 24,
      duration: 10,
      recordOrigin: "01:00:00:00",
      dropFrame: false,
      colorMode: "cinematic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      shots: [
        {
          id: "s1",
          index: 1,
          startSeconds: 0,
          endSeconds: 5,
          duration: 5,
          sourceReel: "A01",
          sourceIn: "00:00:00:00",
          sourceOut: "00:00:05:00",
          startTimecode: "01:00:00:00",
          endTimecode: "01:00:05:00",
          transition: "Cut",
          shotSize: "MS",
          notes: "",
        },
        {
          id: "s2",
          index: 2,
          startSeconds: 5,
          endSeconds: 10,
          duration: 5,
          sourceReel: "A01",
          sourceIn: "00:00:05:00",
          sourceOut: "00:00:10:00",
          startTimecode: "01:00:05:00",
          endTimecode: "01:00:10:00",
          transition: "Cut",
          shotSize: "CU",
          notes: "",
        },
      ],
      cutAnnotations: [
        {
          outgoingId: "s1",
          incomingId: "s2",
          interpretation: "Reaction",
          notes: "Audited eye cut",
          eyeTrace: {
            outgoingFocalPoint: { x: 0.35, y: 0.42, type: "eyes", confidence: 0.94 },
            incomingFocalPoint: { x: 0.65, y: 0.45, type: "eyes", confidence: 0.91 },
            jumpDistance: 0.301,
            jumpDistancePercent: 30,
            rating: "natural",
            screenDirection: "left-to-right",
            momentum: {
              vx: 0.75,
              vy: -0.1,
              velocity: 76,
              alignment: "momentum-match",
              cosineScore: 0.98,
            },
          },
        },
      ],
    };

    const backupJson = JSON.stringify(makeBackup(project));
    const restored = parseBackup(backupJson);

    assert.equal(restored.cutAnnotations?.length, 1);
    const ann = restored.cutAnnotations![0];
    assert.equal(ann.outgoingId, "s1");
    assert.equal(ann.incomingId, "s2");
    assert.equal(ann.interpretation, "Reaction");
    assert.equal(ann.notes, "Audited eye cut");

    assert.ok(ann.eyeTrace);
    assert.equal(ann.eyeTrace.rating, "natural");
    assert.equal(ann.eyeTrace.jumpDistancePercent, 30);
    assert.equal(ann.eyeTrace.screenDirection, "left-to-right");
    assert.equal(ann.eyeTrace.outgoingFocalPoint.type, "eyes");
    assert.equal(ann.eyeTrace.incomingFocalPoint.type, "eyes");

    assert.ok(ann.eyeTrace.momentum);
    assert.equal(ann.eyeTrace.momentum.alignment, "momentum-match");
    assert.equal(ann.eyeTrace.momentum.velocity, 76);
    assert.equal(ann.eyeTrace.momentum.cosineScore, 0.98);
  });
});
