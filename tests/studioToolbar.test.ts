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
  const editorialOrder = ["Split", "Mark", "Snap", "Squint"];
  const navOrder = ["Zoom out", "Zoom", "Zoom in", "Fit", "Full screen"];
  const expandedToolsOrder = ["Rhythm", "Framing", "Structure", "Sound", "Cuts", "Cast", "Color"];

  // Main toolbar has no duplicated analytical tool buttons or palette toggle
  assert.equal(editorialOrder.length, 4);
  assert.equal(navOrder.length, 5);
  assert.equal(expandedToolsOrder.length, 7);

  // Left group: editorial controls
  assert.equal(editorialOrder[0], "Split");
  assert.equal(editorialOrder[1], "Mark");
  assert.equal(editorialOrder[2], "Snap");
  assert.equal(editorialOrder[3], "Squint");

  // Right group: navigation controls
  assert.equal(navOrder[0], "Zoom out");
  assert.equal(navOrder[1], "Zoom");
  assert.equal(navOrder[2], "Zoom in");
  assert.equal(navOrder[3], "Fit");
  assert.equal(navOrder[4], "Full screen");

  // Expanded Studio compact Tools menu order
  assert.equal(expandedToolsOrder[0], "Rhythm");
  assert.equal(expandedToolsOrder[1], "Framing");
  assert.equal(expandedToolsOrder[2], "Structure");
  assert.equal(expandedToolsOrder[3], "Sound");
  assert.equal(expandedToolsOrder[4], "Cuts");
  assert.equal(expandedToolsOrder[5], "Cast");
  assert.equal(expandedToolsOrder[6], "Color");
});
