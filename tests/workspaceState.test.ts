import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot, sameView, shouldRelayPlayhead } from "../src/playback/workspaceState";

test("a snapshot carries the playhead only when asked to", () => {
  assert.deepEqual(buildSnapshot({ mode: "review" }, null), { mode: "review" });
  assert.deepEqual(buildSnapshot({ mode: "studio", deckTab: "cast" }, { time: 12.5, playing: true }), { mode: "studio", deckTab: "cast", time: 12.5, playing: true });
  assert.equal(buildSnapshot({ mode: "studio" }, { time: Number.NaN, playing: false }).time, 0);
  assert.equal(buildSnapshot({ mode: "studio" }, { time: -3, playing: false }).time, 0);
});

test("views compare by what a guest would see", () => {
  assert.equal(sameView({ mode: "studio", deckTab: "cast" }, { mode: "studio", deckTab: "cast" }), true);
  assert.equal(sameView({ mode: "studio", deckTab: "cast" }, { mode: "studio", deckTab: "cuts" }), false);
  assert.equal(sameView({ mode: "studio" }, { mode: "studio", selectedShot: "s1" }), false);
});

test("the playhead is relayed on jumps and play/pause, and about once a second while playing", () => {
  const last = { time: 10, playing: true, at: 1000 };
  assert.equal(shouldRelayPlayhead(null, { time: 0, playing: false }, 0), true, "the first one always goes");
  assert.equal(shouldRelayPlayhead(last, { time: 10.2, playing: true }, 1200), false, "steady playback inside a second");
  assert.equal(shouldRelayPlayhead(last, { time: 11.1, playing: true }, 2100), true, "a second has passed");
  assert.equal(shouldRelayPlayhead(last, { time: 30, playing: true }, 1100), true, "a jump");
  assert.equal(shouldRelayPlayhead(last, { time: 10.1, playing: false }, 1100), true, "pausing");
  assert.equal(shouldRelayPlayhead({ time: 10, playing: false, at: 1000 }, { time: 10, playing: false }, 9000), false, "a paused playhead that has not moved is not resent");
  assert.equal(shouldRelayPlayhead({ time: 10, playing: false, at: 1000 }, { time: 14, playing: false }, 9000), true, "a paused scrub");
});
