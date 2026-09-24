import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeValue,
  buildComparisonSeries,
  getComparisonValuesAt,
  MEASURE_METAS,
  type MeasureId,
  formatDisplayTime,
  calculateVisibleInterval,
} from "../src/analysis/comparison";
import { getEligiblePassages } from "../src/analysis/passageComparison";
import { quantizeToFrame } from "../src/timeline/timelineOps";
import { makeBackup, parseBackup } from "../src/storage/backup";
import { newProject, type Project, type Shot } from "../src/models/project";

function createMockShot(
  id: string,
  index: number,
  start: number,
  end: number,
  options: { luminance?: number; motionEnergy?: number; transition?: string } = {},
): Shot {
  return {
    id,
    index,
    sourceReel: "A01",
    sourceIn: "00:00:00:00",
    sourceOut: "00:00:05:00",
    startTimecode: "00:00:00:00",
    endTimecode: "00:00:05:00",
    startSeconds: start,
    endSeconds: end,
    duration: end - start,
    transition: options.transition ?? "CUT",
    shotSize: "Medium",
    notes: "",
    colorProfile:
      options.luminance !== undefined
        ? {
            palette: ["#112233"],
            luminance: options.luminance,
            temperature: 0,
            saturation: 0.5,
            mood: "Neutral",
            harmony: {
              type: "neutral",
              label: "Neutral",
              confidence: 0.9,
              dominantHue: 0,
            },
          }
        : undefined,
    motionProfile:
      options.motionEnergy !== undefined
        ? {
            cameraMovement: "Static",
            cameraEnergy: 0,
            subjectEnergy: 0,
            totalKineticEnergy: options.motionEnergy,
            confidence: 0.9,
          }
        : undefined,
  };
}

function createMockProject(shots: Shot[], duration: number): Project {
  return {
    id: "test-proj-compare",
    name: "Comparison Test",
    frameRate: 24,
    duration,
    recordOrigin: "00:00:00:00",
    dropFrame: false,
    shots,
    colorMode: "shotSize",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("normalizeValue safely normalizes within range", () => {
  assert.equal(normalizeValue(50, 0, 100), 0.5);
  assert.equal(normalizeValue(0, 0, 100), 0);
  assert.equal(normalizeValue(100, 0, 100), 1);
  // Clamps out of range
  assert.equal(normalizeValue(-10, 0, 100), 0);
  assert.equal(normalizeValue(120, 0, 100), 1);
  // Null / undefined returns null
  assert.equal(normalizeValue(null, 0, 100), null);
  assert.equal(normalizeValue(undefined, 0, 100), null);
});

test("normalizeValue handles constant data without division by zero", () => {
  // All shots have identical 50% luminance (min === max === 50)
  assert.equal(normalizeValue(50, 50, 50), 0.5);
  // All zero
  assert.equal(normalizeValue(0, 0, 0), 0);
});

test("MEASURE_METAS defines precise names, units, and stable reference ranges", () => {
  assert.equal(MEASURE_METAS.cutRate.name, "Cut rate");
  assert.equal(MEASURE_METAS.cutRate.unit, "cuts/min");
  assert.equal(MEASURE_METAS.luminance.name, "Brightness");
  assert.equal(MEASURE_METAS.luminance.unit, "%");
  assert.equal(MEASURE_METAS.motion.name, "Motion");
  assert.equal(MEASURE_METAS.motion.unit, "% flow");
});

test("buildComparisonSeries creates authentic gaps for unscanned data", () => {
  // Shot 1: 0s–5s (has luminance 0.4, no motion)
  // Shot 2: 5s–10s (unscanned luminance, has motion 60)
  // Shot 3: 10s–15s (has luminance 0.8, has motion 20)
  const shots: Shot[] = [
    createMockShot("s1", 1, 0, 5, { luminance: 0.4 }),
    createMockShot("s2", 2, 5, 10, { motionEnergy: 60 }),
    createMockShot("s3", 3, 10, 15, { luminance: 0.8, motionEnergy: 20 }),
  ];
  const project = createMockProject(shots, 15);

  const series = buildComparisonSeries(project, { pacingWindow: 10 });

  // Luminance checks
  assert.equal(series.luminance.hasData, true);
  assert.equal(series.luminance.scannedShotsCount, 2);
  assert.equal(series.luminance.totalShotsCount, 3);

  // Luminance has a gap across shot 2 (5s to 10s)
  const lumaPoints = series.luminance.rawPoints;
  // Shot 1: [0, 40], [5, 40]
  assert.deepEqual(lumaPoints[0], [0, 40]);
  assert.deepEqual(lumaPoints[1], [5, 40]);
  // Gap before shot 3
  const hasNullInLuma = lumaPoints.some((pt) => pt[1] === null);
  assert.equal(hasNullInLuma, true);

  // Motion energy checks
  assert.equal(series.motion.hasData, true);
  assert.equal(series.motion.scannedShotsCount, 2);
  assert.equal(series.motion.totalShotsCount, 3);
  // Shot 1 had no motion, so there must be null or gap before shot 2
  const motionPoints = series.motion.rawPoints;
  // Shot 2 has [5, 60], [10, 60]
  const shot2Motion = motionPoints.find((pt) => pt[0] === 5 && pt[1] === 60);
  assert.ok(shot2Motion, "Shot 2 motion segment starts at 5s");
});

test("getComparisonValuesAt aligns measures by timestamp, not array index", () => {
  const shots: Shot[] = [
    createMockShot("s1", 1, 0, 4, { luminance: 0.3, motionEnergy: 10 }),
    createMockShot("s2", 2, 4, 8, { luminance: 0.7, motionEnergy: 80 }),
    createMockShot("s3", 3, 8, 12, {}), // unscanned shot
  ];
  const project = createMockProject(shots, 12);

  // Sample at t = 2s (inside shot 1)
  const valAt2 = getComparisonValuesAt(project, 2, 10);
  assert.equal(valAt2.luminance.available, true);
  assert.equal(valAt2.luminance.rawValue, 30);
  assert.equal(valAt2.motion.available, true);
  assert.equal(valAt2.motion.rawValue, 10);

  // Sample at t = 6s (inside shot 2)
  const valAt6 = getComparisonValuesAt(project, 6, 10);
  assert.equal(valAt6.luminance.available, true);
  assert.equal(valAt6.luminance.rawValue, 70);
  assert.equal(valAt6.motion.available, true);
  assert.equal(valAt6.motion.rawValue, 80);

  // Sample at t = 10s (inside shot 3, unscanned)
  const valAt10 = getComparisonValuesAt(project, 10, 10);
  assert.equal(valAt10.luminance.available, false);
  assert.equal(valAt10.luminance.rawValue, null);
  assert.equal(valAt10.luminance.formattedValue, "Unavailable");
  assert.equal(valAt10.motion.available, false);
  assert.equal(valAt10.motion.rawValue, null);
  assert.equal(valAt10.motion.formattedValue, "Unavailable");
});

test("constant luminance and motion across entire film normalize without error", () => {
  const shots: Shot[] = [
    createMockShot("s1", 1, 0, 5, { luminance: 0.5, motionEnergy: 40 }),
    createMockShot("s2", 2, 5, 10, { luminance: 0.5, motionEnergy: 40 }),
  ];
  const project = createMockProject(shots, 10);

  const series = buildComparisonSeries(project);
  assert.ok(series.luminance.normalizedPoints.every((pt) => pt[1] === null || Number.isFinite(pt[1])));
  assert.ok(series.motion.normalizedPoints.every((pt) => pt[1] === null || Number.isFinite(pt[1])));
});

test("formatDisplayTime formats MM:SS and HH:MM:SS cleanly", () => {
  assert.equal(formatDisplayTime(0), "00:00");
  assert.equal(formatDisplayTime(4), "00:04");
  assert.equal(formatDisplayTime(582), "09:42");
  assert.equal(formatDisplayTime(3665), "01:01:05");
});

test("calculateVisibleInterval anchors zoom correctly", () => {
  const scopeStart = 0;
  const scopeEnd = 100;

  // Zoom 1x fits entire scope
  const [z1Start, z1End] = calculateVisibleInterval(scopeStart, scopeEnd, 1, 20, 0, 100);
  assert.equal(z1Start, 0);
  assert.equal(z1End, 100);

  // Zoom 2x with playhead at 20s visible: visible span is 50s, playhead was at 20% of viewport
  const [z2Start, z2End] = calculateVisibleInterval(scopeStart, scopeEnd, 2, 20, 0, 100);
  assert.equal(z2End - z2Start, 50);
  // 20s should remain inside [z2Start, z2End]
  assert.ok(20 >= z2Start && 20 <= z2End);

  // Zoom 2x with playhead outside viewport (e.g. playhead at 90s, viewport is 0..50s)
  const [z2CenterStart, z2CenterEnd] = calculateVisibleInterval(scopeStart, scopeEnd, 2, 90, 0, 50);
  assert.equal(z2CenterEnd - z2CenterStart, 50);
  // Anchors around center of previous viewport (25s) -> clamped to scopeStart (0)
  assert.equal(z2CenterStart, 0);
  assert.equal(z2CenterEnd, 50);
});

test("Scope passage eligibility supports legacy passages and excludes moments", () => {
  const sequences = [
    { id: "p1", name: "Valid Passage", startSeconds: 10, endSeconds: 40, kind: "passage" as const },
    { id: "p2", name: "Legacy Passage", startSeconds: 50, endSeconds: 80 }, // undefined kind
    { id: "m1", name: "A Moment", startSeconds: 90, endSeconds: 90, kind: "moment" as const },
    { id: "p3", name: "Inverted Passage", startSeconds: 100, endSeconds: 95, kind: "passage" as const },
  ];

  const eligible = getEligiblePassages(sequences);
  assert.equal(eligible.length, 2);
  assert.equal(eligible[0].id, "p1");
  assert.equal(eligible[1].id, "p2");
});

test("Frame-quantized range boundary clamping", () => {
  const fps = 24;
  const rawTime1 = 10.041;
  const q1 = quantizeToFrame(rawTime1, fps);
  assert.equal(Math.round(q1 * fps), Math.round(rawTime1 * fps));

  // Frame boundary difference check
  const start = quantizeToFrame(5.0, fps);
  const end = quantizeToFrame(10.0, fps);
  assert.ok(end > start);
  assert.equal(end - start, 5.0);
});

test("Comparison observations backup export, import, and backward compatibility", () => {
  const p = newProject();
  p.duration = 60;
  p.shots = [createMockShot("s1", 1, 0, 60, { luminance: 0.5, motionEnergy: 30 })];
  p.comparisonObservations = [
    {
      id: "obs-1",
      startSeconds: 10,
      endSeconds: 25,
      notes: "High kinetic contrast scene reading",
      selectedMeasures: ["cutRate", "motion"],
      pacingWindow: 30,
      createdAt: new Date().toISOString(),
    },
  ];

  const backupObj = makeBackup(p);
  const backupJson = JSON.stringify(backupObj);
  const restored = parseBackup(backupJson);

  assert.ok(restored.comparisonObservations);
  assert.equal(restored.comparisonObservations.length, 1);
  assert.equal(restored.comparisonObservations[0].id, "obs-1");
  assert.equal(restored.comparisonObservations[0].notes, "High kinetic contrast scene reading");
  assert.deepEqual(restored.comparisonObservations[0].selectedMeasures, ["cutRate", "motion"]);
  assert.equal(restored.comparisonObservations[0].pacingWindow, 30);

  // Backward compatibility: older backup without comparisonObservations loads cleanly
  const rawOldBackup = JSON.parse(backupJson);
  delete rawOldBackup.project.comparisonObservations;
  const restoredOld = parseBackup(JSON.stringify(rawOldBackup));
  assert.equal(restoredOld.comparisonObservations, undefined);
});

