import test from "node:test";
import assert from "node:assert/strict";
import type { CastMember, LoudnessAnalysis, Shot } from "../src/models/project";
import {
  buildExploreSequence,
  getShotBrightnessSummary,
  getShotDurationSummary,
  getShotLoudnessSummary,
  getShotMotionSummary,
  reconstructExploreSequence,
  shotContainsCharacter,
  shotContainsOnlyCharacter,
} from "../src/analysis/explore";
import {
  clampSequenceTime,
  findEntryIndexAtSequenceTime,
  sequenceTimeToSourceTime,
  sourceTimeToSequenceTime,
} from "../src/analysis/explorePlayback";
import { makeBackup, parseBackup } from "../src/storage/backup";
import { newProject } from "../src/models/project";

function createMockShot(
  index: number,
  start: number,
  end: number,
  overrides: Partial<Shot> = {},
): Shot {
  return {
    id: `shot-${index}`,
    index,
    sourceReel: "A01",
    sourceIn: "00:00:00:00",
    sourceOut: "00:00:00:00",
    startTimecode: "01:00:00:00",
    endTimecode: "01:00:00:00",
    startSeconds: start,
    endSeconds: end,
    duration: end - start,
    transition: "C",
    shotSize: "Medium",
    notes: "",
    ...overrides,
  };
}

test("combined filters: character, duration, composition and shot size", () => {
  const cast: CastMember[] = [
    { id: "anna", name: "Anna", references: [] },
    { id: "ben", name: "Ben", references: [] },
  ];

  const shot1 = createMockShot(1, 0, 5, {
    shotSize: "Close",
    composition: "Single person",
    characterAnalysis: {
      intervals: [{ memberId: "anna", startSeconds: 1, endSeconds: 4, reviewStatus: "Confirmed" }],
      unresolvedTimes: [],
      sampleTimes: [2.5],
      reviewStatus: "Confirmed",
      model: "test",
      createdAt: "2026-01-01",
    },
  });

  const shot2 = createMockShot(2, 5, 12, {
    shotSize: "Medium",
    composition: "Two-shot",
    characterAnalysis: {
      intervals: [
        { memberId: "anna", startSeconds: 6, endSeconds: 11, reviewStatus: "Confirmed" },
        { memberId: "ben", startSeconds: 6, endSeconds: 11, reviewStatus: "Confirmed" },
      ],
      unresolvedTimes: [],
      sampleTimes: [8.5],
      reviewStatus: "Confirmed",
      model: "test",
      createdAt: "2026-01-01",
    },
  });

  const shot3 = createMockShot(3, 12, 16, {
    shotSize: "Close",
    composition: "Single person",
    characterAnalysis: {
      intervals: [{ memberId: "ben", startSeconds: 13, endSeconds: 15, reviewStatus: "Confirmed" }],
      unresolvedTimes: [],
      sampleTimes: [14],
      reviewStatus: "Confirmed",
      model: "test",
      createdAt: "2026-01-01",
    },
  });

  // Filter Anna only
  assert.equal(shotContainsCharacter(shot1, "anna"), true);
  assert.equal(shotContainsCharacter(shot2, "anna"), true);
  assert.equal(shotContainsCharacter(shot3, "anna"), false);

  // "Only Anna"
  assert.equal(shotContainsOnlyCharacter(shot1, "anna"), true);
  assert.equal(shotContainsOnlyCharacter(shot2, "anna"), false); // two-shot with Ben
  assert.equal(shotContainsOnlyCharacter(shot3, "anna"), false);

  // Manual character override semantics
  const shot4 = createMockShot(4, 16, 20, {
    characterAnalysis: {
      intervals: [],
      unresolvedTimes: [],
      sampleTimes: [18],
      reviewStatus: "Needs review",
      model: "test",
      createdAt: "2026-01-01",
      manualMemberIds: ["anna"],
      manualReviewStatus: "Confirmed",
    },
    composition: "Single person",
  });
  assert.equal(shotContainsCharacter(shot4, "anna"), true);
  assert.equal(shotContainsOnlyCharacter(shot4, "anna"), true);

  // Build sequence with combined filters: Anna + under 8s
  const seq = buildExploreSequence(
    [shot1, shot2, shot3, shot4],
    { characterId: "anna", maxDuration: 8 },
    { measure: "original", direction: "asc" },
    { cast },
  );

  // shot1 (5s) and shot4 (4s) match; shot2 (7s) matches Anna; wait shot2 is 7s (12 - 5 = 7s) so it matches under 8s too
  assert.equal(seq.entries.length, 3);
  assert.deepEqual(
    seq.entries.map((e) => e.shotId),
    ["shot-1", "shot-2", "shot-4"],
  );

  // With "onlyThisCharacter"
  const seqOnly = buildExploreSequence(
    [shot1, shot2, shot3, shot4],
    { characterId: "anna", onlyThisCharacter: true, maxDuration: 8 },
    { measure: "original", direction: "asc" },
    { cast },
  );
  assert.equal(seqOnly.entries.length, 2);
  assert.deepEqual(
    seqOnly.entries.map((e) => e.shotId),
    ["shot-1", "shot-4"],
  );
});

test("stable sorting by brightness, duration, motion, and loudness", () => {
  const s1 = createMockShot(1, 0, 5, {
    colorProfile: {
      palette: ["#000000"],
      luminance: 0.8,
      temperature: 0,
      saturation: 0.5,
      mood: "Bright",
      harmony: { type: "neutral", label: "Neutral", confidence: 1, dominantHue: 0 },
    },
    motionProfile: {
      cameraMovement: "Static",
      cameraEnergy: 10,
      subjectEnergy: 10,
      totalKineticEnergy: 25,
      confidence: 0.9,
    },
  });

  const s2 = createMockShot(2, 5, 8, {
    colorProfile: {
      palette: ["#000000"],
      luminance: 0.1,
      temperature: 0,
      saturation: 0.5,
      mood: "Dark",
      harmony: { type: "neutral", label: "Neutral", confidence: 1, dominantHue: 0 },
    },
    motionProfile: {
      cameraMovement: "Static",
      cameraEnergy: 10,
      subjectEnergy: 10,
      totalKineticEnergy: 75,
      confidence: 0.9,
    },
  });

  const s3 = createMockShot(3, 8, 15, {
    colorProfile: {
      palette: ["#000000"],
      luminance: 0.4,
      temperature: 0,
      saturation: 0.5,
      mood: "Mid",
      harmony: { type: "neutral", label: "Neutral", confidence: 1, dominantHue: 0 },
    },
    motionProfile: {
      cameraMovement: "Static",
      cameraEnergy: 10,
      subjectEnergy: 10,
      totalKineticEnergy: 25, // tie with s1
      confidence: 0.9,
    },
  });

  // Brightness: Darkest first (asc)
  const lumaAsc = buildExploreSequence([s1, s2, s3], {}, { measure: "brightness", direction: "asc" });
  assert.deepEqual(
    lumaAsc.entries.map((e) => e.shotId),
    ["shot-2", "shot-3", "shot-1"], // 0.1, 0.4, 0.8
  );

  // Brightness: Brightest first (desc)
  const lumaDesc = buildExploreSequence([s1, s2, s3], {}, { measure: "brightness", direction: "desc" });
  assert.deepEqual(
    lumaDesc.entries.map((e) => e.shotId),
    ["shot-1", "shot-3", "shot-2"], // 0.8, 0.4, 0.1
  );

  // Duration: Shortest first (asc) -> s2 is 3s, s1 is 5s, s3 is 7s
  const durAsc = buildExploreSequence([s1, s2, s3], {}, { measure: "duration", direction: "asc" });
  assert.deepEqual(
    durAsc.entries.map((e) => e.shotId),
    ["shot-2", "shot-1", "shot-3"],
  );

  // Motion: Highest first (desc) -> s2 is 75, s1 & s3 are 25 (tie broken by original chronological order s1 before s3)
  const motionDesc = buildExploreSequence([s1, s2, s3], {}, { measure: "motion", direction: "desc" });
  assert.deepEqual(
    motionDesc.entries.map((e) => e.shotId),
    ["shot-2", "shot-1", "shot-3"],
  );
});

test("loudness aggregation: energy-averaged momentary power and missing data handling", () => {
  const signature = "media-sig-123";
  const loudness: LoudnessAnalysis = {
    integratedLoudness: -20,
    loudnessRange: 8,
    lraLow: -24,
    lraHigh: -16,
    truePeak: -1.0,
    maxMomentary: -12,
    maxShortTerm: -15,
    threshold: -30,
    // 10 bins across 10 seconds (1 sec per bin)
    // bins: 0s=-20, 1s=-20, 2s=-10, 3s=-30, 4s=-30, 5s=-14, 6s=-14, 7s=-20, 8s=-20, 9s=-20
    momentary: [-20, -20, -10, -30, -30, -14, -14, -20, -20, -20],
    shortTerm: [-20, -20, -15, -25, -25, -15, -15, -20, -20, -20],
    truePeaks: [-3, -3, -1, -5, -5, -2, -2, -3, -3, -3],
    transitions: [],
    binCount: 10,
    duration: 10,
    mediaSignature: signature,
    model: "ffmpeg-ebur128",
    modelVersion: "EBU-R128-BS.1770-4",
    scannedAt: "2026-01-01",
    processingSeconds: 1,
  };

  const shotQuiet = createMockShot(1, 3, 5); // bins 3 & 4: -30 LUFS each
  const shotLoud = createMockShot(2, 5, 7);  // bins 5 & 6: -14 LUFS each
  const shotMixed = createMockShot(3, 2, 4); // bins 2 & 3: -10 and -30 LUFS

  const quietLoudness = getShotLoudnessSummary(shotQuiet, loudness, signature);
  assert.ok(quietLoudness);
  assert.equal(quietLoudness.value, -30);

  const loudLoudness = getShotLoudnessSummary(shotLoud, loudness, signature);
  assert.ok(loudLoudness);
  assert.equal(loudLoudness.value, -14);

  // Mixed shot: -10 LUFS (power 0.1) and -30 LUFS (power 0.001)
  // Mean power = 0.101 / 2 = 0.0505
  // 10 * log10(0.0505) = -12.966 -> approx -13.0 LUFS
  // NOTE: Naive dB average would be (-10 + -30)/2 = -20 LUFS, which is completely wrong energy-wise!
  const mixedLoudness = getShotLoudnessSummary(shotMixed, loudness, signature);
  assert.ok(mixedLoudness);
  assert.equal(mixedLoudness.value, -13.0);

  // Missing / stale signature
  assert.equal(getShotLoudnessSummary(shotQuiet, loudness, "wrong-sig"), null);
  assert.equal(getShotLoudnessSummary(shotQuiet, undefined), null);

  // Build sequence sorted by loudness (loudest first)
  const seq = buildExploreSequence(
    [shotQuiet, shotLoud, shotMixed],
    {},
    { measure: "loudness", direction: "desc" },
    { loudnessAnalysis: loudness, mediaSignature: signature },
  );
  assert.deepEqual(
    seq.entries.map((e) => e.shotId),
    ["shot-3", "shot-2", "shot-1"], // -13.0, -14.0, -30.0
  );

  // If loudness analysis is completely missing, report reason and 0 results
  const seqNoData = buildExploreSequence(
    [shotQuiet, shotLoud],
    {},
    { measure: "loudness", direction: "desc" },
    { loudnessAnalysis: undefined },
  );
  assert.ok(seqNoData.missingMeasureReason);
  assert.equal(seqNoData.entries.length, 0);
});

test("missing measurements are excluded and counted, never coerced to zero", () => {
  const sWithLuma = createMockShot(1, 0, 5, {
    colorProfile: {
      palette: ["#000"],
      luminance: 0.5,
      temperature: 0,
      saturation: 0,
      mood: "Mid",
      harmony: { type: "neutral", label: "Neutral", confidence: 1, dominantHue: 0 },
    },
  });

  const sWithoutLuma = createMockShot(2, 5, 10, {
    colorProfile: undefined, // no color scan yet
  });

  const seq = buildExploreSequence(
    [sWithLuma, sWithoutLuma],
    {},
    { measure: "brightness", direction: "asc" },
  );

  assert.equal(seq.entries.length, 1);
  assert.equal(seq.entries[0].shotId, "shot-1");
  assert.equal(seq.excludedCount, 1);
});

test("original shot array remains strictly unmodified after building sequence", () => {
  const shots = [
    createMockShot(1, 0, 5),
    createMockShot(2, 5, 12),
    createMockShot(3, 12, 20),
  ];
  const originalJSON = JSON.stringify(shots);

  buildExploreSequence(shots, { maxDuration: 6 }, { measure: "duration", direction: "desc" });

  assert.equal(JSON.stringify(shots), originalJSON);
});

test("bidirectional time mapping: sequence time to source time and backward jumps", () => {
  // Sequence with 3 shots in reverse original order (backward jumps)
  // Entry 0: Shot 3 (source: 10s -> 15s, duration 5s, sequence: 0s -> 5s)
  // Entry 1: Shot 1 (source: 0s -> 4s, duration 4s, sequence: 5s -> 9s)
  // Entry 2: Shot 2 (source: 4s -> 10s, duration 6s, sequence: 9s -> 15s)
  const entries = [
    {
      sequenceIndex: 0,
      shotId: "shot-3",
      originalIndex: 3,
      sourceStart: 10,
      sourceEnd: 15,
      duration: 5,
      sequenceStart: 0,
      sequenceEnd: 5,
    },
    {
      sequenceIndex: 1,
      shotId: "shot-1",
      originalIndex: 1,
      sourceStart: 0,
      sourceEnd: 4,
      duration: 4,
      sequenceStart: 5,
      sequenceEnd: 9,
    },
    {
      sequenceIndex: 2,
      shotId: "shot-2",
      originalIndex: 2,
      sourceStart: 4,
      sourceEnd: 10,
      duration: 6,
      sequenceStart: 9,
      sequenceEnd: 15,
    },
  ];

  // At sequence time 2s (within entry 0, shot 3):
  const pos0 = sequenceTimeToSourceTime(2, entries);
  assert.ok(pos0);
  assert.equal(pos0.entry.shotId, "shot-3");
  assert.equal(pos0.entryIndex, 0);
  assert.equal(pos0.sourceTime, 12); // 10 + 2
  assert.equal(sourceTimeToSequenceTime(12, entries[0]), 2);

  // At boundary: sequence time 5.0s (start of entry 1, shot 1 - backward jump from 15s to 0s!)
  const pos1 = sequenceTimeToSourceTime(5, entries);
  assert.ok(pos1);
  assert.equal(pos1.entry.shotId, "shot-1");
  assert.equal(pos1.entryIndex, 1);
  assert.equal(pos1.sourceTime, 0); // start of shot 1
  assert.equal(sourceTimeToSequenceTime(0, entries[1]), 5);

  // At sequence time 7.5s (within entry 1):
  const pos1Mid = sequenceTimeToSourceTime(7.5, entries);
  assert.ok(pos1Mid);
  assert.equal(pos1Mid.sourceTime, 2.5); // 0 + (7.5 - 5)

  // At sequence time 14s (within entry 2):
  const pos2 = sequenceTimeToSourceTime(14, entries);
  assert.ok(pos2);
  assert.equal(pos2.entry.shotId, "shot-2");
  assert.equal(pos2.sourceTime, 9); // 4 + (14 - 9) = 9

  // Boundary clamping
  const beforeStart = sequenceTimeToSourceTime(-1, entries);
  assert.equal(beforeStart?.sourceTime, 10);
  const afterEnd = sequenceTimeToSourceTime(20, entries);
  assert.equal(afterEnd?.sourceTime, 10); // clamped at shot 2 sourceEnd
});

test("saved sequences backup compatibility and handling of deleted source shots", () => {
  const p = newProject();
  p.shots = [
    createMockShot(1, 0, 5),
    createMockShot(2, 5, 10),
  ];
  p.savedExploreSequences = [
    {
      id: "seq-1",
      name: "Saved Test Sequence",
      filters: { minDuration: 2 },
      arrange: { measure: "duration", direction: "desc" },
      shotIds: ["shot-2", "shot-1"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  // Export and restore backup
  const backupText = JSON.stringify(makeBackup(p));
  const restored = parseBackup(backupText);

  assert.equal(restored.savedExploreSequences?.length, 1);
  assert.equal(restored.savedExploreSequences?.[0].name, "Saved Test Sequence");
  assert.deepEqual(restored.savedExploreSequences?.[0].shotIds, ["shot-2", "shot-1"]);

  // Now simulate deleted source shot: shot-1 was deleted from project
  const remainingShots = [p.shots[1]]; // only shot-2 remains
  const { sequence, missingShotIds } = reconstructExploreSequence(
    restored.savedExploreSequences![0].shotIds,
    remainingShots,
    restored.savedExploreSequences![0].filters,
    restored.savedExploreSequences![0].arrange,
  );

  assert.deepEqual(missingShotIds, ["shot-1"]);
  assert.equal(sequence.entries.length, 1);
  assert.equal(sequence.entries[0].shotId, "shot-2");
});
