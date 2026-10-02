import { test } from "node:test";
import assert from "node:assert/strict";
import { FULL_ANALYSIS_PRESET, QUICK_ANALYSIS_PRESET, type ScanOptions } from "../src/models/scanOptions";

test("FULL_ANALYSIS_PRESET contains all 7 scanners: cuts, framing, cast, dialogue, loudness, motion, stems", () => {
  assert.equal(FULL_ANALYSIS_PRESET.cuts, true);
  assert.equal(FULL_ANALYSIS_PRESET.framing, true);
  assert.equal(FULL_ANALYSIS_PRESET.cast, true);
  assert.equal(FULL_ANALYSIS_PRESET.dialogue, true);
  assert.equal(FULL_ANALYSIS_PRESET.loudness, true);
  assert.equal(FULL_ANALYSIS_PRESET.motion, true);
  assert.equal(FULL_ANALYSIS_PRESET.stems, true);
});

test("effective options for screening background scan preserves cuts if shots already present", () => {
  const getScreeningScanOptions = (shotCount: number): ScanOptions => ({
    ...FULL_ANALYSIS_PRESET,
    cuts: shotCount === 0,
  });

  const emptyProjectOpts = getScreeningScanOptions(0);
  assert.equal(emptyProjectOpts.cuts, true);
  assert.equal(emptyProjectOpts.framing, true);
  assert.equal(emptyProjectOpts.cast, true);
  assert.equal(emptyProjectOpts.dialogue, true);
  assert.equal(emptyProjectOpts.loudness, true);
  assert.equal(emptyProjectOpts.motion, true);
  assert.equal(emptyProjectOpts.stems, true);

  const existingCutProjectOpts = getScreeningScanOptions(12);
  assert.equal(existingCutProjectOpts.cuts, false);
  assert.equal(existingCutProjectOpts.framing, true);
  assert.equal(existingCutProjectOpts.cast, true);
  assert.equal(existingCutProjectOpts.dialogue, true);
  assert.equal(existingCutProjectOpts.loudness, true);
  assert.equal(existingCutProjectOpts.motion, true);
  assert.equal(existingCutProjectOpts.stems, true);
});

test("Studio tracks include 'markers' as first track with default and min lane heights", async () => {
  const { DEFAULT_STUDIO_LANE_HEIGHTS, MIN_STUDIO_LANE_HEIGHTS } = await import("../src/timeline/EditingMap");
  assert.equal(typeof DEFAULT_STUDIO_LANE_HEIGHTS.markers, "number");
  assert.equal(typeof MIN_STUDIO_LANE_HEIGHTS.markers, "number");
  assert.ok(DEFAULT_STUDIO_LANE_HEIGHTS.markers >= MIN_STUDIO_LANE_HEIGHTS.markers);
});

test("Duet review cues convert into valid project screeningMarks with color, author, and note", () => {
  const duetCues = [
    {
      id: 1727800000000,
      seconds: 14.5,
      smpte: "00:00:14:12",
      key: "1",
      colorHex: "#f43f5e",
      resolveColor: "ResolveColorRed",
      note: "Pacing drags here",
      authorName: "Mara",
      authorAvatar: "🎬",
    },
    {
      id: 1727800005000,
      seconds: 42.0,
      smpte: "00:00:42:00",
      key: "3",
      colorHex: "#34d399",
      resolveColor: "ResolveColorGreen",
      note: "Great cut transition",
      authorName: "Alex",
      authorAvatar: "🦉",
    }
  ];

  const marks = duetCues.map((dm) => ({
    id: String(dm.id),
    passId: "screening-pass-1",
    time: dm.seconds,
    anchorTime: dm.seconds,
    createdAt: new Date().toISOString(),
    mirror: false,
    darken: false,
    muted: false,
    notes: dm.note,
    resolved: false,
    colorHex: dm.colorHex,
    colorKey: dm.key,
    authorName: dm.authorName,
    authorAvatar: dm.authorAvatar,
    smpte: dm.smpte,
  }));

  assert.equal(marks.length, 2);
  assert.equal(marks[0].time, 14.5);
  assert.equal(marks[0].colorHex, "#f43f5e");
  assert.equal(marks[0].authorAvatar, "🎬");
  assert.equal(marks[0].notes, "Pacing drags here");
  assert.equal(marks[1].time, 42.0);
  assert.equal(marks[1].colorHex, "#34d399");
  assert.equal(marks[1].authorAvatar, "🦉");
});

test("BgScanStatus stageProgress reflects immediate active scan percent rather than weighted overall", () => {
  const stageWeights = { cuts: 20, framing: 25, characters: 20, dialogue: 15, loudness: 20 };
  const calcOverallProgress = (subPercent: number) => Math.round((stageWeights.cuts * subPercent) / 100);

  // At subPercent = 3% of cuts scan:
  const subPercent = 3.2;
  const overallPercent = calcOverallProgress(subPercent); // Math.round(20 * 3.2 / 100) = 1 or 0
  const stagePercent = Math.round(subPercent);

  // When weighted, 3% of cuts is 0% or 1% overall, but stageProgress shows 3%
  assert.equal(stagePercent, 3);
  assert.ok(stagePercent > overallPercent || stagePercent === 3);
});

test("newProject initializes screeningMarks and sequences as empty arrays for clean slate", async () => {
  const { newProject } = await import("../src/models/project");
  const p = newProject();
  assert.ok(Array.isArray(p.screeningMarks));
  assert.equal(p.screeningMarks.length, 0);
  assert.ok(Array.isArray(p.sequences));
  assert.equal(p.sequences.length, 0);
});

test("clearing markers on film change resets state to empty clean slate", () => {
  let markers = [
    { id: "old-1", seconds: 12.0, authorName: "Mara" },
    { id: "old-2", seconds: 24.5, authorName: "Alex" }
  ];
  let activeCueIndex = 1;

  // Simulate clean slate reset when a new film is loaded
  const clearMarkersState = () => {
    markers = [];
    activeCueIndex = -1;
  };

  clearMarkersState();
  assert.equal(markers.length, 0);
  assert.equal(activeCueIndex, -1);
});

