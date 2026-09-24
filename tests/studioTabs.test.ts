import { test } from "node:test";
import assert from "node:assert/strict";
import { TABS } from "../src/components/StudioToolRail";

test("StudioToolRail defines analytical tabs in exact approved order", () => {
  const tabIds = TABS.map((t) => t.id);
  assert.deepEqual(tabIds, [
    "rhythm",
    "framing",
    "sequence",
    "sound",
    "cuts",
    "cast",
    "color",
  ]);

  assert.equal(TABS[0].label, "Rhythm");
  assert.equal(TABS[1].label, "Framing");
  assert.equal(TABS[2].label, "Structure");
  assert.equal(TABS[3].label, "Sound");
  assert.equal(TABS[4].label, "Cuts");
  assert.equal(TABS[5].label, "Cast");
  assert.equal(TABS[6].label, "Color");

  const rhythmIndex = tabIds.indexOf("rhythm");
  const framingIndex = tabIds.indexOf("framing");
  const sequenceIndex = tabIds.indexOf("sequence");
  const soundIndex = tabIds.indexOf("sound");
  const cutsIndex = tabIds.indexOf("cuts");

  assert.equal(framingIndex, rhythmIndex + 1, "Framing tab must come directly after Rhythm");
  assert.equal(sequenceIndex, framingIndex + 1, "Structure tab must come directly after Framing");
  assert.equal(soundIndex, sequenceIndex + 1, "Sound tab must come directly after Structure (sequence)");
  assert.equal(cutsIndex, soundIndex + 1, "Cuts tab must come directly after Sound");
});
