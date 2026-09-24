import test from "node:test";
import assert from "node:assert/strict";
import { newProject, type SequenceMarker, type Shot, type SpeechAnalysis } from "../src/models/project";
import { makeBackup, parseBackup } from "../src/storage/backup";
import {
  calculateZoomScrollAnchor,
  computeMedian,
  computePassageMeasurements,
  findPassageSegmentAtLocalTime,
  getEligiblePassages,
  getIntersectingPassageShots,
  isEligiblePassage,
  localTimeToSourceTime,
  sourceTimeToLocalTime,
} from "../src/analysis/passageComparison";
import {
  computeFramingBreakdown,
  computeMeanSegmentDuration,
  computePacingHistogram,
  getLuminanceSteps,
  getMotionEnergySteps,
  getSpeechOverTimeSeries,
  getTemporalFramingBlocks,
  localTimeToRelativeProgress,
  relativeProgressToLocalTime,
} from "../src/analysis/compareViews";

function makeMockShot(index: number, start: number, end: number): Shot {
  return {
    id: `shot-${index}`,
    index,
    sourceReel: "A01",
    sourceIn: "00:00:00:00",
    sourceOut: "00:00:00:00",
    startTimecode: "00:00:00:00",
    endTimecode: "00:00:00:00",
    startSeconds: start,
    endSeconds: end,
    duration: end - start,
    transition: "CUT",
    shotSize: "Medium",
    notes: "",
  };
}

test("Passage eligibility: positive duration, legacy passages supported, moments excluded", () => {
  const validPassage: SequenceMarker = {
    id: "p1",
    name: "Opening",
    startSeconds: 10,
    endSeconds: 40,
    kind: "passage",
  };
  assert.equal(isEligiblePassage(validPassage), true);

  const legacyPassage: SequenceMarker = {
    id: "p2",
    name: "Legacy passage without kind",
    startSeconds: 5,
    endSeconds: 25,
  };
  assert.equal(isEligiblePassage(legacyPassage), true);

  const moment: SequenceMarker = {
    id: "m1",
    name: "Key moment",
    startSeconds: 15,
    endSeconds: 15,
    kind: "moment",
  };
  assert.equal(isEligiblePassage(moment), false);

  const invertedPassage: SequenceMarker = {
    id: "inv",
    name: "Invalid boundaries",
    startSeconds: 30,
    endSeconds: 20,
    kind: "passage",
  };
  assert.equal(isEligiblePassage(invertedPassage), false);

  const zeroDuration: SequenceMarker = {
    id: "zero",
    name: "Zero duration",
    startSeconds: 10,
    endSeconds: 10,
    kind: "passage",
  };
  assert.equal(isEligiblePassage(zeroDuration), false);

  const list = getEligiblePassages([validPassage, legacyPassage, moment, invertedPassage, zeroDuration]);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "p1");
  assert.equal(list[1].id, "p2");
});

test("Shot clipping at passage boundaries and original order preservation", () => {
  // Shots:
  // Shot 1: 0 - 10
  // Shot 2: 10 - 20
  // Shot 3: 20 - 30
  // Shot 4: 30 - 40
  // Shot 5: 40 - 50
  const shots: Shot[] = [
    makeMockShot(1, 0, 10),
    makeMockShot(2, 10, 20),
    makeMockShot(3, 20, 30),
    makeMockShot(4, 30, 40),
    makeMockShot(5, 40, 50),
  ];

  // Passage spans from 15 to 35 (clips Shot 2 at start, includes Shot 3 fully, clips Shot 4 at end)
  const passage: SequenceMarker = {
    id: "p-test",
    name: "Interior Encounter",
    startSeconds: 15,
    endSeconds: 35,
    kind: "passage",
  };

  const segments = getIntersectingPassageShots(shots, passage);
  assert.equal(segments.length, 3);

  // Shot 2: 10 - 20 clipped to 15 - 20 (duration 5, local 0 - 5)
  assert.equal(segments[0].shot.id, "shot-2");
  assert.equal(segments[0].visibleStart, 15);
  assert.equal(segments[0].visibleEnd, 20);
  assert.equal(segments[0].visibleDuration, 5);
  assert.equal(segments[0].localStart, 0);
  assert.equal(segments[0].localEnd, 5);
  assert.equal(segments[0].isClippedStart, true);
  assert.equal(segments[0].isClippedEnd, false);

  // Shot 3: 20 - 30 fully contained (duration 10, local 5 - 15)
  assert.equal(segments[1].shot.id, "shot-3");
  assert.equal(segments[1].visibleStart, 20);
  assert.equal(segments[1].visibleEnd, 30);
  assert.equal(segments[1].visibleDuration, 10);
  assert.equal(segments[1].localStart, 5);
  assert.equal(segments[1].localEnd, 15);
  assert.equal(segments[1].isClippedStart, false);
  assert.equal(segments[1].isClippedEnd, false);

  // Shot 4: 30 - 40 clipped to 30 - 35 (duration 5, local 15 - 20)
  assert.equal(segments[2].shot.id, "shot-4");
  assert.equal(segments[2].visibleStart, 30);
  assert.equal(segments[2].visibleEnd, 35);
  assert.equal(segments[2].visibleDuration, 5);
  assert.equal(segments[2].localStart, 15);
  assert.equal(segments[2].localEnd, 20);
  assert.equal(segments[2].isClippedStart, false);
  assert.equal(segments[2].isClippedEnd, true);

  // Verify original shots array was NOT mutated
  assert.equal(shots[1].startSeconds, 10);
  assert.equal(shots[1].endSeconds, 20);
  assert.equal(shots[3].startSeconds, 30);
  assert.equal(shots[3].endSeconds, 40);
});

test("Local / source time bidirectional mapping", () => {
  const passage: SequenceMarker = {
    id: "p1",
    name: "Passage 1",
    startSeconds: 120, // 02:00
    endSeconds: 180,   // 03:00 (duration 60s)
    kind: "passage",
  };

  // Local to source
  assert.equal(localTimeToSourceTime(0, passage), 120);
  assert.equal(localTimeToSourceTime(15, passage), 135);
  assert.equal(localTimeToSourceTime(60, passage), 180);
  // Clamping
  assert.equal(localTimeToSourceTime(-5, passage), 120);
  assert.equal(localTimeToSourceTime(100, passage), 180);

  // Source to local
  assert.equal(sourceTimeToLocalTime(120, passage), 0);
  assert.equal(sourceTimeToLocalTime(135, passage), 15);
  assert.equal(sourceTimeToLocalTime(180, passage), 60);
  // Clamping
  assert.equal(sourceTimeToLocalTime(100, passage), 0);
  assert.equal(sourceTimeToLocalTime(250, passage), 60);
});

test("Segment lookup at local time", () => {
  const shots = [
    makeMockShot(1, 10, 20),
    makeMockShot(2, 20, 30),
  ];
  const passage: SequenceMarker = {
    id: "p1",
    name: "P1",
    startSeconds: 10,
    endSeconds: 30,
    kind: "passage",
  };
  const segments = getIntersectingPassageShots(shots, passage);

  // At local 5 (source 15) -> Shot 1
  const seg1 = findPassageSegmentAtLocalTime(segments, 5);
  assert.equal(seg1?.shot.id, "shot-1");

  // At local 15 (source 25) -> Shot 2
  const seg2 = findPassageSegmentAtLocalTime(segments, 15);
  assert.equal(seg2?.shot.id, "shot-2");

  // At local 20 (exact end) -> Shot 2
  const segEnd = findPassageSegmentAtLocalTime(segments, 20);
  assert.equal(segEnd?.shot.id, "shot-2");
});

test("Median calculations", () => {
  assert.equal(computeMedian([]), null);
  assert.equal(computeMedian([5]), 5);
  assert.equal(computeMedian([1, 10, 3]), 3);
  assert.equal(computeMedian([1, 2, 8, 9]), 5); // (2+8)/2 = 5
  assert.equal(computeMedian([4, 5, 4, 7, 3, 6, 8, 3]), 4.5);
});

test("Passage measurements: duration, shot count, median duration, speech coverage", () => {
  const shots = [
    makeMockShot(1, 0, 10),  // 6s visible (4-10)
    makeMockShot(2, 10, 16), // 6s visible (10-16)
    makeMockShot(3, 16, 20), // 4s visible (16-20)
    makeMockShot(4, 20, 30), // 4s visible (20-24)
  ];
  const passage: SequenceMarker = {
    id: "p-meas",
    name: "Measurement test",
    startSeconds: 4,
    endSeconds: 24, // duration = 20s
    kind: "passage",
  };

  const validSig = "abc123sig";
  const validSpeech: SpeechAnalysis = {
    regions: [
      { startSeconds: 0, endSeconds: 6 },   // overlaps 4 - 6 (2s)
      { startSeconds: 10, endSeconds: 18 }, // overlaps 10 - 18 (8s)
    ],
    mediaSignature: validSig,
    model: "silero-vad",
    modelVersion: "6.2.0",
    settingsVersion: "vad-1",
    threshold: 0.5,
    minSpeechMs: 250,
    minSilenceMs: 100,
    duration: 30,
    scannedAt: "2026-09-24",
    processingSeconds: 1,
  };

  // With valid speech analysis
  const m1 = computePassageMeasurements(passage, shots, validSpeech, validSig, 30);
  assert.equal(m1.duration, 20);
  assert.equal(m1.shotCount, 4);
  // visible durations: [6, 6, 4, 4] -> median = 5
  assert.equal(m1.medianShotDuration, 5);
  // speech overlap = 2s + 8s = 10s out of 20s -> 50%
  assert.equal(m1.speechCoverage, 50);
  // ASL = 20 / 4 = 5s
  assert.equal(m1.asl, 5);
  // Cut rate = (4 / 20) * 60 = 12 cuts/min
  assert.equal(m1.cutRateCPM, 12);
  assert.equal(m1.shortestShotDuration, 4);
  assert.equal(m1.longestShotDuration, 6);
  assert.equal(m1.pacingStdDev, 1); // sqrt(((1^2 + 1^2 + (-1)^2 + (-1)^2)/4)) = sqrt(1) = 1
  assert.equal(m1.pacingStyle, "Metronomic"); // cv = 1/5 = 0.20 < 0.35

  // With invalid/mismatched media signature -> speech coverage must be null (Unavailable)
  const m2 = computePassageMeasurements(passage, shots, validSpeech, "different-signature", 30);
  assert.equal(m2.speechCoverage, null);

  // With undefined speech analysis -> null
  const m3 = computePassageMeasurements(passage, shots, undefined, validSig, 30);
  assert.equal(m3.speechCoverage, null);
});

test("Comprehensive passage measurements: framing, camera, color, DME, loudness, and cast", () => {
  const shots: Shot[] = [
    {
      ...makeMockShot(1, 0, 10),
      shotSize: "Close",
      composition: "Single person",
      cameraMovement: "Static",
      motionProfile: { cameraMovement: "Static", cameraEnergy: 5, subjectEnergy: 10, totalKineticEnergy: 15, confidence: 0.9 },
      colorProfile: {
        palette: ["#111111"],
        luminance: 0.4,
        temperature: 0.2, // Warm
        saturation: 0.5,
        mood: "Warm Interior",
        harmony: { type: "neutral", label: "Neutral", confidence: 0.8, dominantHue: 30 },
      },
      characterAnalysis: {
        intervals: [{ memberId: "c1", startSeconds: 0, endSeconds: 10, reviewStatus: "Confirmed" }],
        unresolvedTimes: [],
        sampleTimes: [5],
        reviewStatus: "Confirmed",
        model: "arcface",
        createdAt: "2026-09-24",
      },
    },
    {
      ...makeMockShot(2, 10, 20),
      shotSize: "Wide",
      composition: "Two-shot",
      cameraMovement: "Handheld",
      motionProfile: { cameraMovement: "Handheld", cameraEnergy: 40, subjectEnergy: 30, totalKineticEnergy: 55, confidence: 0.85 },
      colorProfile: {
        palette: ["#222222"],
        luminance: 0.6,
        temperature: 0.1,
        saturation: 0.4,
        mood: "Warm Interior",
        harmony: { type: "neutral", label: "Neutral", confidence: 0.8, dominantHue: 30 },
      },
      characterAnalysis: {
        intervals: [
          { memberId: "c1", startSeconds: 10, endSeconds: 20, reviewStatus: "Confirmed" },
          { memberId: "c2", startSeconds: 10, endSeconds: 15, reviewStatus: "Confirmed" },
        ],
        unresolvedTimes: [],
        sampleTimes: [15],
        reviewStatus: "Confirmed",
        model: "arcface",
        createdAt: "2026-09-24",
      },
    },
  ];

  const passage: SequenceMarker = {
    id: "p-all",
    name: "Full Sequence",
    startSeconds: 0,
    endSeconds: 20,
    kind: "passage",
  };

  const cast = [
    { id: "c1", name: "Elena", references: [] },
    { id: "c2", name: "Marcus", references: [] },
  ];

  const dmeWaveforms: DmeWaveforms = {
    dialogue: new Array(20).fill(0.8),
    music: new Array(20).fill(0.1),
    effects: new Array(20).fill(0.1),
    binCount: 20,
    duration: 20,
  };

  const loudnessAnalysis: LoudnessAnalysis = {
    integratedLoudness: -24,
    loudnessRange: 12,
    momentary: new Array(20).fill(-23.5),
    shortTerm: new Array(20).fill(-23.0),
    truePeaks: new Array(20).fill(-1.0),
    binCount: 20,
    duration: 20,
    mediaSignature: "sig123",
    model: "ffmpeg-ebur128",
    modelVersion: "EBU-R128-BS.1770-4",
  };

  const m = computePassageMeasurements(passage, shots, undefined, "sig123", 20, {
    cast,
    dmeWaveforms,
    loudnessAnalysis,
  });

  // Framing
  assert.equal(m.closeShare, 50); // 10s Close out of 20s
  assert.equal(m.wideShare, 50);  // 10s Wide out of 20s
  assert.equal(m.peoplePresence, 100);

  // Camera & motion
  assert.equal(m.staticShare, 50);
  assert.equal(m.movingShare, 50);
  assert.equal(m.avgKineticEnergy, 35); // (15*10 + 55*10)/20 = 35

  // Color & atmosphere
  assert.equal(m.avgLuminance, 50); // (0.4*10 + 0.6*10)/20 = 0.5 -> 50%
  assert.equal(m.colorTemperature, "Warm");
  assert.equal(m.dominantMood, "Warm Interior");

  // DME & Loudness
  assert.equal(m.dominantAudioStem, "Dialogue");
  assert.equal(m.avgLoudnessLUFS, -23.5);

  // Cast
  assert.equal(m.castCount, 2);
  assert.equal(m.leadingCharacter?.name, "Elena");
  assert.equal(m.leadingCharacter?.screenShare, 100); // 20s / 20s
});

test("Zoom anchoring: visible playhead anchored, otherwise center anchored", () => {
  const viewportWidth = 500;
  const passageDuration = 50; // 50 seconds

  // Case 1: Playhead is at 10s. In 1x zoom (content = 500px), playhead is at 100px.
  // ScrollLeft = 0. Playhead is visible (100px is in [0, 500]).
  // We zoom from 1x to 2x (content = 1000px).
  // New playhead is at 200px.
  // To keep playhead at offset 100px from left edge: scrollLeft = 200 - 100 = 100px.
  const targetScroll1 = calculateZoomScrollAnchor(1, 2, 0, viewportWidth, 10, passageDuration);
  assert.equal(targetScroll1, 100);

  // Case 2: Playhead is at 45s. In 2x zoom (content = 1000px), playhead is at 900px.
  // Current viewport is at scrollLeft = 0 (showing 0..500px). Playhead is NOT visible.
  // When zooming to 3x (content = 1500px):
  // Center of old viewport was at 250px (ratio = 250/1000 = 0.25).
  // New center should be at 0.25 * 1500 = 375px.
  // targetScroll = 375 - 250 = 125px.
  const targetScroll2 = calculateZoomScrollAnchor(2, 3, 0, viewportWidth, 45, passageDuration);
  assert.equal(targetScroll2, 125);
});

test("Saved comparisons backup round-trip and backward compatibility", () => {
  const p = newProject();
  p.name = "Compare project";
  p.duration = 100;
  p.savedExploreComparisons = [
    {
      id: "comp-1",
      name: "Encounter vs Resolution",
      passageAId: "pass-a",
      passageBId: "pass-b",
      note: "Notice the rhythm difference across shots.",
      createdAt: "2026-09-24T10:00:00Z",
      updatedAt: "2026-09-24T10:00:00Z",
    },
  ];

  const backup = makeBackup(p);
  const restored = parseBackup(JSON.stringify(backup));

  assert.equal(restored.savedExploreComparisons?.length, 1);
  assert.equal(restored.savedExploreComparisons?.[0].id, "comp-1");
  assert.equal(restored.savedExploreComparisons?.[0].name, "Encounter vs Resolution");
  assert.equal(restored.savedExploreComparisons?.[0].passageAId, "pass-a");
  assert.equal(restored.savedExploreComparisons?.[0].passageBId, "pass-b");
  assert.equal(restored.savedExploreComparisons?.[0].note, "Notice the rhythm difference across shots.");

  // Older project without savedExploreComparisons
  const oldJson = JSON.stringify({
    ...backup,
    project: {
      ...backup.project,
      savedExploreComparisons: undefined,
    },
  });
  const restoredOld = parseBackup(oldJson);
  assert.equal(restoredOld.savedExploreComparisons, undefined);
});

test("Pacing histogram: binning boundaries, totals, percentages, and empty segments", () => {
  // Empty segments
  const emptyHist = computePacingHistogram([]);
  assert.equal(emptyHist.totalSegments, 0);
  assert.equal(emptyHist.bins.length, 5);
  for (const b of emptyHist.bins) {
    assert.equal(b.count, 0);
    assert.equal(b.percentage, 0);
  }
  assert.equal(computeMeanSegmentDuration([]), null);

  // Segments at exact boundaries:
  // 1.5s -> bin 0 (< 2s)
  // 2.0s -> bin 1 (2 - 4s) [shared boundary is [2, 4), so 2.0 belongs to bin 1]
  // 3.99s -> bin 1 (2 - 4s)
  // 4.0s -> bin 2 (4 - 8s)
  // 8.0s -> bin 3 (8 - 16s)
  // 16.0s -> bin 4 (16+s)
  // 45.0s -> bin 4 (16+s) [long hold]
  const mockSegs = [
    { visibleDuration: 1.5, shot: { id: "s1" } },
    { visibleDuration: 2.0, shot: { id: "s2" } },
    { visibleDuration: 3.99, shot: { id: "s3" } },
    { visibleDuration: 4.0, shot: { id: "s4" } },
    { visibleDuration: 8.0, shot: { id: "s5" } },
    { visibleDuration: 16.0, shot: { id: "s6" } },
    { visibleDuration: 45.0, shot: { id: "s7" } },
  ];

  const hist = computePacingHistogram(mockSegs);
  assert.equal(hist.totalSegments, 7);
  assert.equal(hist.bins[0].count, 1); // [0, 2): 1.5
  assert.equal(hist.bins[1].count, 2); // [2, 4): 2.0, 3.99
  assert.equal(hist.bins[2].count, 1); // [4, 8): 4.0
  assert.equal(hist.bins[3].count, 1); // [8, 16): 8.0
  assert.equal(hist.bins[4].count, 2); // [16, inf): 16.0, 45.0

  // Total percentages sum to 100%
  const sumPct = hist.bins.reduce((sum: number, b: any) => sum + b.percentage, 0);
  assert.ok(Math.abs(sumPct - 100) < 0.001);

  // Mean segment duration: (1.5 + 2.0 + 3.99 + 4.0 + 8.0 + 16.0 + 45.0) / 7 = 80.49 / 7
  const mean = computeMeanSegmentDuration(mockSegs);
  assert.ok(mean !== null);
  assert.ok(Math.abs(mean - 11.4985) < 0.01);
});

test("Framing breakdown: Time vs Shots denominators, coverage gaps, Unknown & Not applicable", () => {
  const passage: SequenceMarker = {
    id: "p-frame",
    name: "Framing Passage",
    startSeconds: 10,
    endSeconds: 30, // 20s total duration
    kind: "passage",
  };

  // Shots:
  // Shot 1: 10-14 (4s) Close
  // Shot 2: 14-18 (4s) Wide
  // Shot 3: 18-20 (2s) Text / title card -> Not applicable
  // Shot 4: 20-24 (4s) No size -> Unknown
  // Gap: 24-30 (6s uncovered)
  const segments = [
    {
      shot: { id: "s1", index: 1, shotSize: "Close" },
      visibleStart: 10,
      visibleEnd: 14,
      visibleDuration: 4,
      localStart: 0,
      localEnd: 4,
      isClippedStart: false,
      isClippedEnd: false,
    },
    {
      shot: { id: "s2", index: 2, shotSize: "Wide" },
      visibleStart: 14,
      visibleEnd: 18,
      visibleDuration: 4,
      localStart: 4,
      localEnd: 8,
      isClippedStart: false,
      isClippedEnd: false,
    },
    {
      shot: { id: "s3", index: 3, content: "Text / title card", shotSize: "Insert" },
      visibleStart: 18,
      visibleEnd: 20,
      visibleDuration: 2,
      localStart: 8,
      localEnd: 10,
      isClippedStart: false,
      isClippedEnd: false,
    },
    {
      shot: { id: "s4", index: 4, shotSize: "UnrecognizedTag" },
      visibleStart: 20,
      visibleEnd: 24,
      visibleDuration: 4,
      localStart: 10,
      localEnd: 14,
      isClippedStart: false,
      isClippedEnd: false,
    },
  ];

  // 1. Time mode
  const timeBreakdown = computeFramingBreakdown(passage, segments, "time");
  assert.equal(timeBreakdown.totalDuration, 20);
  assert.equal(timeBreakdown.gapSeconds, 6); // 20 - 14 = 6s gap
  assert.equal(timeBreakdown.knownSeconds, 8); // 4s Close + 4s Wide
  assert.equal(timeBreakdown.knownPercent, 40); // 8s / 20s = 40%

  const closeItem = timeBreakdown.items.find((i: any) => i.category === "Close");
  assert.equal(closeItem.seconds, 4);
  assert.equal(closeItem.percentage, 20); // 4s / 20s = 20%

  const naItem = timeBreakdown.items.find((i: any) => i.category === "Not applicable");
  assert.equal(naItem.seconds, 2);
  assert.equal(naItem.percentage, 10); // 2s / 20s = 10%

  const unkItem = timeBreakdown.items.find((i: any) => i.category === "Unknown");
  assert.equal(unkItem.seconds, 4);
  assert.equal(unkItem.percentage, 20); // 4s / 20s = 20%

  // 2. Shots mode
  const shotBreakdown = computeFramingBreakdown(passage, segments, "shots");
  assert.equal(shotBreakdown.totalCount, 4);
  assert.equal(shotBreakdown.knownCount, 2);
  assert.equal(shotBreakdown.knownPercent, 50); // 2 / 4 = 50%

  const closeShotItem = shotBreakdown.items.find((i: any) => i.category === "Close");
  assert.equal(closeShotItem.count, 1);
  assert.equal(closeShotItem.percentage, 25); // 1 / 4 = 25%

  // 3. Temporal blocks
  const blocks = getTemporalFramingBlocks(segments);
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].category, "Close");
  assert.equal(blocks[1].category, "Wide");
  assert.equal(blocks[2].category, "Not applicable");
  assert.equal(blocks[3].category, "Unknown");
});

test("Over-time series: motion, luminance, speech and relative/actual time mapping", () => {
  const segments = [
    {
      shot: {
        id: "s1",
        index: 1,
        motionProfile: { totalKineticEnergy: 42.4 },
        colorProfile: { luminance: 0.65 },
      },
      visibleStart: 10,
      visibleEnd: 15,
      visibleDuration: 5,
      localStart: 0,
      localEnd: 5,
    },
    {
      // Missing motion and color
      shot: {
        id: "s2",
        index: 2,
      },
      visibleStart: 15,
      visibleEnd: 20,
      visibleDuration: 5,
      localStart: 5,
      localEnd: 10,
    },
  ];

  // Motion steps
  const motion = getMotionEnergySteps(segments);
  assert.equal(motion.length, 2);
  assert.equal(motion[0].value, 42);
  assert.equal(motion[0].isUnavailable, false);
  assert.equal(motion[1].value, null);
  assert.equal(motion[1].isUnavailable, true);

  // Luminance steps
  const luma = getLuminanceSteps(segments);
  assert.equal(luma.length, 2);
  assert.equal(luma[0].value, 65); // 0.65 * 100 = 65
  assert.equal(luma[0].isUnavailable, false);
  assert.equal(luma[1].value, null);
  assert.equal(luma[1].isUnavailable, true);

  // Speech over time
  const passage: SequenceMarker = {
    id: "p1",
    name: "P1",
    startSeconds: 10,
    endSeconds: 30, // 20s
    kind: "passage",
  };

  const validSig = "test-sig";
  // Invalid media signature -> unavailable
  const invalidSpeech = getSpeechOverTimeSeries(passage, { regions: [] } as any, "wrong-sig", 50);
  assert.equal(invalidSpeech.isValid, false);

  // Valid empty speech -> valid but empty
  const emptySpeech: SpeechAnalysis = {
    regions: [],
    mediaSignature: validSig,
    model: "silero-vad",
    modelVersion: "6.2.0",
    settingsVersion: "vad-1",
    threshold: 0.5,
    minSpeechMs: 250,
    minSilenceMs: 100,
    duration: 50,
    scannedAt: "2026-09-24",
    processingSeconds: 1,
  };
  const validEmptyRes = getSpeechOverTimeSeries(passage, emptySpeech, validSig, 50);
  assert.equal(validEmptyRes.isValid, true);
  assert.equal(validEmptyRes.isEmpty, true);
  assert.equal(validEmptyRes.regions.length, 0);

  // Valid speech overlapping passage
  const populatedSpeech: SpeechAnalysis = {
    ...emptySpeech,
    regions: [
      { startSeconds: 5, endSeconds: 15 }, // overlaps 10 - 15 (local 0 - 5)
      { startSeconds: 25, endSeconds: 35 }, // overlaps 25 - 30 (local 15 - 20)
    ],
  };
  const validPopulatedRes = getSpeechOverTimeSeries(passage, populatedSpeech, validSig, 50);
  assert.equal(validPopulatedRes.isValid, true);
  assert.equal(validPopulatedRes.isEmpty, false);
  assert.equal(validPopulatedRes.regions.length, 2);
  assert.equal(validPopulatedRes.regions[0].localStart, 0);
  assert.equal(validPopulatedRes.regions[0].localEnd, 5);
  assert.equal(validPopulatedRes.regions[1].localStart, 15);
  assert.equal(validPopulatedRes.regions[1].localEnd, 20);

  // Relative / Local progress bidirectional mapping
  assert.equal(relativeProgressToLocalTime(0, 20), 0);
  assert.equal(relativeProgressToLocalTime(0.5, 20), 10);
  assert.equal(relativeProgressToLocalTime(1, 20), 20);
  assert.equal(localTimeToRelativeProgress(0, 20), 0);
  assert.equal(localTimeToRelativeProgress(10, 20), 0.5);
  assert.equal(localTimeToRelativeProgress(20, 20), 1);
});

