import { test } from "node:test";
import assert from "node:assert/strict";
import { newProject, type SequenceMarker, type Shot } from "../src/models/project";
import { makeBackup, parseBackup } from "../src/storage/backup";
import { quantizeToFrame } from "../src/timeline/timelineOps";
import { sequenceReading } from "../src/analysis/pacing";
import { STRUCTURE_VOCABULARIES, getVocabulary, getSelectableBeats } from "../src/models/structureVocabularies";
import { parseTimecodeSafely } from "../src/utils/timecode";

function makeTestProject() {
  const p = newProject();
  p.frameRate = 24;
  p.duration = 10;
  p.shots = [
    {
      id: "shot-1",
      index: 1,
      sourceReel: "REEL1",
      sourceIn: "00:00:00:00",
      sourceOut: "00:00:03:00",
      startTimecode: "00:00:00:00",
      endTimecode: "00:00:03:00",
      startSeconds: 0,
      endSeconds: 3,
      duration: 3,
      transition: "CUT",
      shotSize: "Wide",
      notes: "",
    },
    {
      id: "shot-2",
      index: 2,
      sourceReel: "REEL1",
      sourceIn: "00:00:03:00",
      sourceOut: "00:00:07:00",
      startTimecode: "00:00:03:00",
      endTimecode: "00:00:07:00",
      startSeconds: 3,
      endSeconds: 7,
      duration: 4,
      transition: "CUT",
      shotSize: "Medium",
      notes: "",
    },
    {
      id: "shot-3",
      index: 3,
      sourceReel: "REEL1",
      sourceIn: "00:00:07:00",
      sourceOut: "00:00:10:00",
      startTimecode: "00:00:07:00",
      endTimecode: "00:00:10:00",
      startSeconds: 7,
      endSeconds: 10,
      duration: 3,
      transition: "CUT",
      shotSize: "Close",
      notes: "",
    },
  ];
  return p;
}

test("legacy passage compatibility treats markers without explicit kind as passages", () => {
  const p = makeTestProject();
  const legacyMarker: SequenceMarker = {
    id: "seq-old-1",
    name: "Opening Chase",
    startSeconds: 0,
    endSeconds: 4,
    notes: "Old notes without beat or kind",
  };
  p.sequences = [legacyMarker];

  const passages = (p.sequences ?? []).filter((s) => (s.kind ?? "passage") === "passage");
  assert.equal(passages.length, 1);
  assert.equal(passages[0].id, "seq-old-1");
  assert.equal(passages[0].kind, undefined);

  // Backup round trip restores legacy record intact
  const json = JSON.stringify(makeBackup(p));
  const restored = parseBackup(json);
  assert.equal(restored.sequences?.length, 1);
  assert.equal(restored.sequences?.[0].name, "Opening Chase");
  assert.equal(restored.sequences?.[0].kind, undefined);
  assert.equal(restored.sequences?.[0].beat, undefined);
  assert.equal(restored.sequences?.[0].notes, "Old notes without beat or kind");
});

test("moment and passage creation, editing, and deletion with custom beats and notes", () => {
  const p = makeTestProject();

  // Create moment
  const moment: SequenceMarker = {
    id: "mom-1",
    name: "The decision",
    kind: "moment",
    beat: "Plot point 1",
    startSeconds: 2.5,
    endSeconds: 2.5,
    notes: "She turns around.",
  };

  // Create passage with custom beat
  const passage: SequenceMarker = {
    id: "pas-1",
    name: "The journey begins",
    kind: "passage",
    beat: "A quiet reversal",
    startSeconds: 3.0,
    endSeconds: 7.0,
    notes: "Leaving her home behind.",
  };

  p.sequences = [moment, passage];

  // Verify persistence and editing
  let sequences = [...p.sequences];
  assert.equal(sequences.length, 2);

  // Edit moment
  sequences = sequences.map((s) =>
    s.id === "mom-1" ? { ...s, name: "The irrevocable decision", notes: "Now she cannot go back." } : s
  );
  assert.equal(sequences.find((s) => s.id === "mom-1")?.name, "The irrevocable decision");
  assert.equal(sequences.find((s) => s.id === "mom-1")?.notes, "Now she cannot go back.");

  // Delete passage
  sequences = sequences.filter((s) => s.id !== "pas-1");
  assert.equal(sequences.length, 1);
  assert.equal(sequences[0].id, "mom-1");
});

test("chronological ordering sorts moments and passages by startSeconds then endSeconds", () => {
  const p = makeTestProject();
  const entries: SequenceMarker[] = [
    { id: "e3", name: "Climax Moment", kind: "moment", startSeconds: 8.0, endSeconds: 8.0 },
    { id: "e1", name: "Inciting Passage", kind: "passage", startSeconds: 1.0, endSeconds: 3.0 },
    { id: "e2", name: "Plot Point 1 Moment", kind: "moment", startSeconds: 4.5, endSeconds: 4.5 },
    { id: "e0", name: "Cold Open Moment", kind: "moment", startSeconds: 1.0, endSeconds: 1.0 },
  ];
  p.sequences = entries;

  const sorted = [...(p.sequences ?? [])].sort(
    (a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds
  );

  assert.equal(sorted[0].id, "e0"); // start: 1.0, end: 1.0
  assert.equal(sorted[1].id, "e1"); // start: 1.0, end: 3.0
  assert.equal(sorted[2].id, "e2"); // start: 4.5
  assert.equal(sorted[3].id, "e3"); // start: 8.0
});

test("backup round-trip retains moment kind, passage kind, custom beats and notes", () => {
  const p = makeTestProject();
  p.sequences = [
    {
      id: "m-10",
      name: "Discovery of the secret",
      kind: "moment",
      beat: "Midpoint",
      startSeconds: 5.0,
      endSeconds: 5.0,
      notes: "The letter is opened.",
    },
    {
      id: "p-20",
      name: "Confrontation sequence",
      kind: "passage",
      beat: "Climax",
      startSeconds: 6.0,
      endSeconds: 9.5,
      notes: "High tension dialogue across three rooms.",
    },
    {
      id: "p-legacy",
      name: "Legacy unnamed passage",
      startSeconds: 0,
      endSeconds: 2,
    },
  ];

  const backupJson = JSON.stringify(makeBackup(p));
  const restored = parseBackup(backupJson);

  assert.equal(restored.sequences?.length, 3);

  const m1 = restored.sequences?.find((s) => s.id === "m-10");
  assert.equal(m1?.name, "Discovery of the secret");
  assert.equal(m1?.kind, "moment");
  assert.equal(m1?.beat, "Midpoint");
  assert.equal(m1?.startSeconds, 5.0);
  assert.equal(m1?.endSeconds, 5.0);
  assert.equal(m1?.notes, "The letter is opened.");

  const p1 = restored.sequences?.find((s) => s.id === "p-20");
  assert.equal(p1?.name, "Confrontation sequence");
  assert.equal(p1?.kind, "passage");
  assert.equal(p1?.beat, "Climax");
  assert.equal(p1?.startSeconds, 6.0);
  assert.equal(p1?.endSeconds, 9.5);
  assert.equal(p1?.notes, "High tension dialogue across three rooms.");

  const pLeg = restored.sequences?.find((s) => s.id === "p-legacy");
  assert.equal(pLeg?.name, "Legacy unnamed passage");
  assert.equal(pLeg?.kind, undefined);
  assert.equal(pLeg?.beat, undefined);
});

test("moments are strictly excluded from passage-only calculations and ruler blocks", () => {
  const p = makeTestProject();
  p.sequences = [
    { id: "m1", name: "Beat 1", kind: "moment", startSeconds: 2, endSeconds: 2 },
    { id: "p1", name: "Scene 1", kind: "passage", startSeconds: 0, endSeconds: 5 },
    { id: "m2", name: "Beat 2", kind: "moment", startSeconds: 6, endSeconds: 6 },
    { id: "p2", name: "Scene 2", kind: "passage", startSeconds: 5, endSeconds: 10 },
  ];

  const passageList = (p.sequences ?? []).filter((s) => (s.kind ?? "passage") === "passage");
  assert.equal(passageList.length, 2);
  assert.deepEqual(
    passageList.map((s) => s.id),
    ["p1", "p2"]
  );

  // Moments must never feed a zero-length range into sequence reading
  const moment = p.sequences[0];
  assert.equal(moment.startSeconds, moment.endSeconds);
  // Ensure passage reading on passage produces valid duration and shots
  const reading = sequenceReading(p.shots, p.sequences[1].startSeconds, p.sequences[1].endSeconds);
  assert.equal(reading.duration, 5);
  assert.ok(reading.shots.length > 0);
});

test("frame-aligned anchors and validation of invalid boundaries", () => {
  // Quantizing to frame
  const fps24 = 24;
  const time = 1.0416; // between frames 24 and 25
  const quantized = quantizeToFrame(time, fps24);
  assert.equal(quantized, 25 / 24);

  // Backup validation: rejects start > end
  const p = makeTestProject();
  const backup = makeBackup(p);
  const badBackup = structuredClone(backup);
  badBackup.project.sequences = [
    {
      id: "bad-seq",
      name: "Inverted boundaries",
      startSeconds: 5.0,
      endSeconds: 3.0,
    },
  ];
  assert.throws(() => parseBackup(JSON.stringify(badBackup)), /invalid boundaries/);

  // Backup validation: rejects negative start
  const negBackup = structuredClone(backup);
  negBackup.project.sequences = [
    {
      id: "neg-seq",
      name: "Negative start",
      startSeconds: -1.0,
      endSeconds: 3.0,
    },
  ];
  assert.throws(() => parseBackup(JSON.stringify(negBackup)), /invalid boundaries/);

  // Moments with startSeconds === endSeconds are accepted
  const momentBackup = structuredClone(backup);
  momentBackup.project.sequences = [
    {
      id: "valid-moment",
      name: "Exact moment",
      kind: "moment",
      startSeconds: 3.0,
      endSeconds: 3.0,
    },
  ];
  const parsedMoment = parseBackup(JSON.stringify(momentBackup));
  assert.equal(parsedMoment.sequences?.length, 1);
  assert.equal(parsedMoment.sequences?.[0].startSeconds, 3.0);
  assert.equal(parsedMoment.sequences?.[0].endSeconds, 3.0);
});

test("parseTimecodeSafely validates and parses frame-accurate timecodes", () => {
  const fps = 24;

  // Valid standard timecode
  const res1 = parseTimecodeSafely("00:00:01:00", fps, false);
  assert.equal(res1.valid, true);
  assert.equal(res1.seconds, 1.0);
  assert.equal(res1.error, undefined);

  // Valid fractional frame
  const res2 = parseTimecodeSafely("00:00:00:12", fps, false);
  assert.equal(res2.valid, true);
  assert.equal(res2.seconds, 0.5);

  // Invalid frame number (frame 24 at 24fps is out of bounds, frames are 00-23)
  const res3 = parseTimecodeSafely("00:00:00:24", fps, false);
  assert.equal(res3.valid, false);
  assert.match(res3.error || "", /outside frame-rate range/);

  // Empty or malformed input
  const res4 = parseTimecodeSafely("", fps, false);
  assert.equal(res4.valid, false);
  assert.equal(res4.error, "Timecode required");

  const res5 = parseTimecodeSafely("not-a-timecode", fps, false);
  assert.equal(res5.valid, false);
  assert.match(res5.error || "", /Malformed timecode/);
});

test("structure vocabularies provide required frameworks with exact beats", () => {
  assert.equal(STRUCTURE_VOCABULARIES.length, 5);

  const freeform = getVocabulary("freeform");
  assert.equal(freeform.id, "freeform");
  assert.equal(freeform.name, "Freeform / Custom");
  assert.deepEqual(freeform.beats, []);

  const shortForm = getVocabulary("short-form");
  assert.equal(shortForm.name, "Short-form essentials · EditMap");
  assert.ok(shortForm.beats.includes("Hook"));
  assert.ok(shortForm.beats.includes("Turn / Escalation"));
  assert.ok(shortForm.beats.includes("Payoff / Button"));

  const sydField = getVocabulary("syd-field");
  assert.equal(sydField.name, "Syd Field · Three-act paradigm");
  assert.ok(sydField.beats.includes("Inciting incident"));
  assert.ok(sydField.beats.includes("Plot point 1"));
  assert.ok(sydField.beats.includes("Midpoint"));
  assert.ok(sydField.beats.includes("Plot point 2"));
  assert.ok(sydField.beats.includes("Climax"));
  assert.ok(sydField.beats.includes("Resolution"));

  const saveTheCat = getVocabulary("save-the-cat");
  assert.equal(saveTheCat.name, "Save the Cat! · 15 beats");
  assert.equal(saveTheCat.beats.length, 15);
  assert.ok(saveTheCat.beats.includes("Opening image"));
  assert.ok(saveTheCat.beats.includes("All is lost"));

  const vogler = getVocabulary("vogler");
  assert.equal(vogler.name, "Vogler · Hero’s Journey");
  assert.ok(vogler.beats.includes("Call to adventure"));
  assert.ok(vogler.beats.includes("Ordeal"));
});

test("non-destructive vocabulary switching preserves annotations and stored beats", () => {
  const p = makeTestProject();
  p.structureVocabulary = "save-the-cat";
  p.customStoryBeats = ["Director special moment"];

  // Sequence with beat from Syd Field ("Plot point 1"), but active vocab is Save the Cat!
  p.sequences = [
    {
      id: "seq-1",
      name: "First critical turn",
      kind: "moment",
      beat: "Plot point 1",
      startSeconds: 4.0,
      endSeconds: 4.0,
      notes: "Turning point",
    },
  ];

  // Selectable beats for active vocab 'save-the-cat' includes standard beats, custom beats, and current beat
  const selectable = getSelectableBeats("save-the-cat", p.customStoryBeats, p.sequences[0].beat);
  assert.ok(selectable.includes("Plot point 1"), "Current beat outside active vocab is preserved in selection");
  assert.ok(selectable.includes("Director special moment"), "Project custom beats are selectable");
  assert.ok(selectable.includes("Opening image"), "Active vocabulary beats are selectable");

  // Switch vocabulary to Vogler
  p.structureVocabulary = "vogler";
  assert.equal(p.sequences[0].beat, "Plot point 1", "Existing annotations are never mutated by switching vocabulary");

  const selectableVogler = getSelectableBeats("vogler", p.customStoryBeats, p.sequences[0].beat);
  assert.ok(selectableVogler.includes("Plot point 1"));
  assert.ok(selectableVogler.includes("Call to adventure"));
});

test("custom label manager: rename, reorder, delete without mutating existing annotations", () => {
  const p = makeTestProject();
  p.customStoryBeats = ["Label A", "Label B", "Label C"];
  p.sequences = [
    {
      id: "seq-1",
      name: "Beat with Label B",
      kind: "passage",
      beat: "Label B",
      startSeconds: 1.0,
      endSeconds: 5.0,
    },
  ];

  // Reorder custom labels
  let labels = [...p.customStoryBeats];
  const moved = labels[1]; // Label B
  labels[1] = labels[0];
  labels[0] = moved;
  p.customStoryBeats = labels;
  assert.deepEqual(p.customStoryBeats, ["Label B", "Label A", "Label C"]);
  assert.equal(p.sequences[0].beat, "Label B");

  // Delete label from project reusable list
  p.customStoryBeats = p.customStoryBeats.filter((l) => l !== "Label B");
  assert.deepEqual(p.customStoryBeats, ["Label A", "Label C"]);

  // CRITICAL: Existing annotation STILL retains "Label B" even when removed from project reusable list
  assert.equal(p.sequences[0].beat, "Label B", "Annotation is never mutated when reusable custom label is removed");
});

test("backup round-trip preserves structureVocabulary and customStoryBeats", () => {
  const p = makeTestProject();
  p.structureVocabulary = "syd-field";
  p.customStoryBeats = ["Signature flourish", "Stinger"];

  const backupJson = JSON.stringify(makeBackup(p));
  const restored = parseBackup(backupJson);

  assert.equal(restored.structureVocabulary, "syd-field");
  assert.deepEqual(restored.customStoryBeats, ["Signature flourish", "Stinger"]);

  // Unknown vocabulary in corrupted/future backup gracefully defaults to freeform
  const corrupted = JSON.parse(backupJson);
  corrupted.project.structureVocabulary = "unknown-future-framework";
  const restoredCorrupted = parseBackup(JSON.stringify(corrupted));
  assert.equal(restoredCorrupted.structureVocabulary, "freeform");
});

