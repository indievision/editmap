import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEDL } from "../src/parsers/edl";
import {
  actualRate,
  formatTimecode,
  rates,
  timecodeFrames,
  timecodeSeconds,
} from "../src/utils/timecode";
import { activeShot, clampSeek } from "../src/analysis/playback";
import { colorMatchAtCut, cutPairAt, durationChange, framingChange } from "../src/analysis/cuts";
import { waveformBins } from "../src/analysis/audio";
import { detectVideoShots } from "../src/analysis/videoScanner";
const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}.edl`, import.meta.url), "utf8");
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
for (const fps of rates)
  test(`frame precision and round trip at ${fps}`, () => {
    near(
      timecodeSeconds("00:00:01:00", fps),
      Math.round(fps) / actualRate(fps),
    );
    for (const n of [0, 1, 23, 1799, 1800, 18000, 86401]) {
      const tc = formatTimecode(n / actualRate(fps), fps);
      assert.equal(timecodeFrames(tc, fps), n);
    }
  });
test("record offset, duration and proportional widths", () => {
  const p = parseEDL(fixture("cuts-24"), 24);
  assert.equal(p.recordOrigin, "01:00:00:00");
  assert.deepEqual(
    p.shots.map((s) => s.startSeconds),
    [0, 1, 3.5],
  );
  assert.deepEqual(
    p.shots.map((s) => s.duration),
    [1, 2.5, 10],
  );
  assert.equal(p.duration, 13.5);
  assert.equal(p.shots[2].duration / p.shots[0].duration, 10);
});
test("explicit origin preserves leading gap", () => {
  const p = parseEDL(fixture("cuts-24"), 24, "00:59:59:00");
  assert.equal(p.shots[0].startSeconds, 1);
});
test("drop frame minute boundary and 10-minute round trips", () => {
  const p = parseEDL(fixture("drop-2997"), 29.97);
  near(p.shots[0].duration, 1.001);
  for (const n of [1799, 1800, 17981, 17982, 107892])
    assert.equal(
      timecodeFrames(
        formatTimecode(n / actualRate(29.97), 29.97, true),
        29.97,
        true,
      ),
      n,
    );
  assert.equal(timecodeFrames("01:00:00;00", 29.97), 107892);
});
test("gaps have no active shot; audio ignored; boundary belongs to next shot", () => {
  const p = parseEDL(fixture("gaps-25"), 25);
  assert.equal(p.shots.length, 2);
  assert.equal(activeShot(p.shots, 2), undefined);
  assert.equal(activeShot(p.shots, 4)?.index, 3);
  const cuts = parseEDL(fixture("cuts-24"), 24);
  assert.equal(activeShot(cuts.shots, 1)?.index, 2);
  assert.equal(activeShot(cuts.shots, 13.5), undefined);
});
test("playback clock crossing every shot, seeking and frame stepping", () => {
  const { shots, duration } = parseEDL(fixture("cuts-24"), 24);
  for (let f = 0; f < 324; f++) {
    const t = f / 24;
    assert.equal(activeShot(shots, t)?.index, t < 1 ? 1 : t < 3.5 ? 2 : 3);
  }
  assert.equal(clampSeek(-1, duration), 0);
  assert.equal(clampSeek(100, duration), duration);
  near(clampSeek(1 + 1 / 24, duration) - 1, 1 / 24);
});
test("malformed and dropped labels are rejected", () => {
  assert.throws(() => parseEDL(fixture("invalid-24"), 24), /Line 2/);
  for (const tc of ["00:60:00:00", "00:00:00:24", "foo"])
    assert.throws(() => timecodeSeconds(tc, 24));
  assert.throws(() => timecodeSeconds("00:01:00;00", 29.97), /dropped/);
  assert.throws(() => parseEDL(fixture("drop-2997"), 24), /29.97/);
  assert.throws(() => parseEDL("nothing", 24), /No video events/);
  assert.throws(() => parseEDL("001 AX V D 00:00:00:00 00:00:00:00 01:00:00:00 01:00:00:00", 24), /non-zero-duration/);
});
test("overlap rejected instead of hiding shots", () => {
  assert.throws(
    () =>
      parseEDL(
        "001 AX V C 00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n002 AX V C 00:00:00:00 00:00:02:00 00:00:01:00 00:00:03:00",
        24,
      ),
    /Overlapping/,
  );
});
test("cut comparison only joins contiguous shots and reports measurable changes", () => {
  const { shots } = parseEDL(fixture("cuts-24"), 24);
  shots[0].shotSize = "WS";
  shots[1].shotSize = "CU";
  const pair = cutPairAt(shots, shots[1].id);
  assert.ok(pair);
  assert.equal(pair.time, 1);
  assert.deepEqual(framingChange(pair), { label: "Tighter", detail: "WS → CU" });
  assert.deepEqual(durationChange(pair), { label: "Longer", detail: "1.00s → 2.50s" });
  assert.equal(cutPairAt(parseEDL(fixture("gaps-25"), 25).shots, "event-003-2"), undefined);
});

test("cut colour match uses near-boundary samples when present", () => {
  const { shots } = parseEDL(fixture("cuts-24"), 24);
  const profile = (luminance: number, palette: string[]) => ({ luminance, temperature: 0, saturation: .5, palette });
  shots[0].colorProfile = { ...profile(.2, ["#202020"]), mood: "Neutral", harmony: { type: "neutral", label: "Neutral", confidence: 1, dominantHue: 0 }, temporal: { samples: [{ time: .2, ...profile(.8, ["#F0F0F0"]) }, { time: .8, ...profile(.8, ["#F0F0F0"]) }, { time: .9, ...profile(.8, ["#F0F0F0"]) }], boundary: { start: { time: .01, ...profile(.2, ["#202020"]) }, end: { time: .99, ...profile(.2, ["#202020"]) } }, deltaLuminance: 0, deltaTemperature: 0, deltaSaturation: 0, deltaPalette: 0, changeScore: 0, changed: false } };
  shots[1].colorProfile = { ...profile(.8, ["#F0F0F0"]), mood: "Neutral", harmony: { type: "neutral", label: "Neutral", confidence: 1, dominantHue: 0 }, temporal: { samples: [{ time: 1.1, ...profile(.2, ["#202020"]) }, { time: 2, ...profile(.2, ["#202020"]) }, { time: 3, ...profile(.2, ["#202020"]) }], boundary: { start: { time: 1.01, ...profile(.8, ["#F0F0F0"]) }, end: { time: 3.99, ...profile(.8, ["#F0F0F0"]) } }, deltaLuminance: 0, deltaTemperature: 0, deltaSaturation: 0, deltaPalette: 0, changeScore: 0, changed: false } };
  assert.equal(colorMatchAtCut(shots[0], shots[1]).label, "Luminance jump");
});

test("TransNet cut import keeps soft transitions and project timecode", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => new Response(JSON.stringify(
    String(url).includes("detect-shots-status")
      ? { available: true }
      : { fps: 25, model_backend: "onnx", shots: [
        { start_seconds: 0, end_seconds: 1.5, transition_type: "cut" },
        { start_seconds: 1.5, end_seconds: 3, transition_type: "soft" },
      ] },
  )));
  const shots = await detectVideoShots(new File(["fixture"], "fixture.mp4"), { fps: 24 });
  assert.equal(shots[0].endTimecode, "00:00:01:12");
  assert.equal(shots[1].transition, "SOFT");
});
test("waveform bins retain local peaks without making a sound classification", () => {
  const bins = waveformBins(new Float32Array([0, -0.25, 0.8, -0.4]), 2);
  assert.ok(Math.abs(bins[0] - 0.25) < 1e-6);
  assert.ok(Math.abs(bins[1] - 0.8) < 1e-6);
  assert.deepEqual(waveformBins(new Float32Array(), 8), []);
});

test("parses CMX-3600 track B (Both audio and video) events", () => {
  const edl = `TITLE: Track B Test
FCM: NON-DROP FRAME
001 AX B C 00:00:00:00 00:00:02:00 01:00:00:00 01:00:02:00
002 AX V C 00:00:02:00 00:00:04:00 01:00:02:00 01:00:04:00
`;
  const result = parseEDL(edl, 24);
  assert.equal(result.shots.length, 2);
  assert.equal(result.shots[0].index, 1);
  assert.equal(result.shots[0].duration, 2);
  assert.equal(result.shots[1].index, 2);
});

test("handles non-chronological event order by using earliest record-in as origin", () => {
  const edl = `TITLE: Non-chronological events
FCM: NON-DROP FRAME
001 REEL_B V C 00:00:00:00 00:00:03:00 01:00:05:00 01:00:08:00
002 REEL_A V C 00:00:00:00 00:00:05:00 01:00:00:00 01:00:05:00
`;
  const result = parseEDL(edl, 24);
  assert.equal(result.shots.length, 2);
  assert.equal(result.recordOrigin, "01:00:00:00");
  assert.equal(result.shots[0].index, 2);
  assert.equal(result.shots[0].startSeconds, 0);
  assert.equal(result.shots[0].endSeconds, 5);
  assert.equal(result.shots[1].index, 1);
  assert.equal(result.shots[1].startSeconds, 5);
  assert.equal(result.shots[1].endSeconds, 8);
});
