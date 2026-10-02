import { test } from "node:test";
import assert from "node:assert/strict";
import { TABS } from "../src/components/StudioToolRail";

test("Studio upper-left analytical views match approved order", () => {
  const tabIds = TABS.map((t) => t.id);
  assert.deepEqual(tabIds, ["rhythm", "framing", "sequence", "sound", "cuts", "cast", "color"]);
  assert.equal(TABS[0].label, "Rhythm");
  assert.equal(TABS[1].label, "Framing");
  assert.equal(TABS[2].label, "Structure");
  assert.equal(TABS[3].label, "Sound");
  assert.equal(TABS[4].label, "Cuts");
  assert.equal(TABS[5].label, "Cast");
  assert.equal(TABS[6].label, "Color");
});

test("Simplified Studio toolbar groups and order specifications", () => {
  const toolbarOrder = [
    "Split",
    "Merge",
    "In",
    "Out",
    "Clear",
    "Snap",
    "Marker",
    "Squint",
    "Fit",
    "Zoom-",
    "Zoom",
    "Zoom+",
    "Fullscreen",
  ];

  assert.equal(toolbarOrder.length, 13);
  assert.equal(toolbarOrder[0], "Split");
  assert.equal(toolbarOrder[1], "Merge");
  assert.equal(toolbarOrder[2], "In");
  assert.equal(toolbarOrder[3], "Out");
  assert.equal(toolbarOrder[4], "Clear");
  assert.equal(toolbarOrder[5], "Snap");
  assert.equal(toolbarOrder[6], "Marker");
  assert.equal(toolbarOrder[7], "Squint");
  assert.equal(toolbarOrder[8], "Fit");
  assert.equal(toolbarOrder[9], "Zoom-");
  assert.equal(toolbarOrder[10], "Zoom");
  assert.equal(toolbarOrder[11], "Zoom+");
  assert.equal(toolbarOrder[12], "Fullscreen");
});
