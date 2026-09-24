import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTimecode } from "../src/utils/timecode";
import type { ScreeningMark } from "../src/models/project";

test("Screening seek bar progress percentage calculation and bounds", () => {
  const duration = 100;
  const calculateProgress = (time: number, dur: number) => {
    const safeDuration = Math.max(0.001, dur || 0);
    return Math.min(100, Math.max(0, (time / safeDuration) * 100));
  };

  assert.equal(calculateProgress(0, duration), 0);
  assert.equal(calculateProgress(50, duration), 50);
  assert.equal(calculateProgress(100, duration), 100);
  assert.equal(calculateProgress(-10, duration), 0);
  assert.equal(calculateProgress(150, duration), 100);
  assert.equal(calculateProgress(0, 0), 0);
});

test("Screening seek bar mark pip position mapping", () => {
  const duration = 60;
  const marks: ScreeningMark[] = [
    {
      id: "m1",
      passId: "p1",
      time: 15,
      anchorTime: 14.5,
      createdAt: new Date().toISOString(),
      resolved: false,
    },
    {
      id: "m2",
      passId: "p1",
      time: 45,
      createdAt: new Date().toISOString(),
      resolved: true,
    },
  ];

  const pips = marks.map((m) => {
    const markTime = m.anchorTime ?? m.time;
    const markPercent = Math.min(100, Math.max(0, (markTime / duration) * 100));
    return {
      id: m.id,
      time: markTime,
      percent: markPercent,
      tc: formatTimecode(markTime, 24, false),
    };
  });

  assert.equal(pips.length, 2);
  assert.equal(pips[0].percent, (14.5 / 60) * 100);
  assert.equal(pips[0].tc, "00:00:14:12");
  assert.equal(pips[1].percent, (45 / 60) * 100);
  assert.equal(pips[1].tc, "00:00:45:00");
});

test("Screening seek bar frame stepping calculations", () => {
  const frameRate = 24;
  const frameStep = 1 / frameRate;
  const duration = 10;
  let time = 1.0;

  // ArrowRight step
  time = Math.min(duration, time + frameStep);
  assert.ok(Math.abs(time - (1.0 + 1 / 24)) < 1e-6);

  // ArrowLeft step
  time = Math.max(0, time - frameStep);
  assert.ok(Math.abs(time - 1.0) < 1e-6);

  // Large step (Shift + Arrow)
  time = Math.min(duration, time + 1.0);
  assert.equal(time, 2.0);
});
