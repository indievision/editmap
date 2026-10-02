import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSymmetricalWaveformPath,
  generateSteppedFramingPath,
  generatePacingPathAndArea,
  generateMotionFlowPathAndArea,
  generateCutDensityPathAndArea,
} from "../src/timeline/FullscreenMapVisualization";
import { formatTimecode } from "../src/utils/timecode";
import type { Shot, Project } from "../src/models/project";

test("generateSymmetricalWaveformPath returns empty string for empty levels or non-positive duration", () => {
  assert.equal(generateSymmetricalWaveformPath([], 10, 10, 30), "");
  assert.equal(generateSymmetricalWaveformPath([0.5, 0.8], 0, 10, 30), "");
  assert.equal(generateSymmetricalWaveformPath([0.5, 0.8], 10, 0, 30), "");
});

test("generateSymmetricalWaveformPath generates closed mirrored SVG path", () => {
  const levels = [0.2, 0.8, 0.5];
  const path = generateSymmetricalWaveformPath(levels, 10, 10, 40);
  assert.ok(path.startsWith("M 0.0"), "Should start with M at origin");
  assert.ok(path.endsWith("Z"), "Should end with Z to close path");
  // Center is 20, maxAmp is 18.
  // Top for 0.8: 20 - 0.8 * 18 = 5.6
  // Bottom for 0.8: 20 + 0.8 * 18 = 34.4
  assert.ok(path.includes("5.6"), "Should contain peak top coordinate");
  assert.ok(path.includes("34.4"), "Should contain mirrored bottom coordinate");
});

test("generateSteppedFramingPath returns empty string when shots have no framing data", () => {
  const shots: Shot[] = [
    {
      id: "s1",
      index: 1,
      startSeconds: 0,
      endSeconds: 5,
      duration: 5,
      shotSize: "Unknown",
      reviewStatus: "Unreviewed",
    },
  ];
  assert.equal(generateSteppedFramingPath(shots, 10, 40), "");
});

test("generateSteppedFramingPath generates horizontal and vertical stepped line across cuts", () => {
  const shots: Shot[] = [
    {
      id: "s1",
      index: 1,
      startSeconds: 0,
      endSeconds: 5,
      duration: 5,
      shotSize: "Wide",
      reviewStatus: "Confirmed",
    },
    {
      id: "s2",
      index: 2,
      startSeconds: 5,
      endSeconds: 10,
      duration: 5,
      shotSize: "Close",
      reviewStatus: "Confirmed",
    },
  ];
  const scale = 10;
  const path = generateSteppedFramingPath(shots, scale, 40);
  assert.ok(path.startsWith("M 0.0"), "Starts at time 0");
  assert.ok(path.includes("H 50.0"), "Horizontal segment across Shot 1");
  assert.ok(path.includes("V "), "Vertical step at boundary");
  assert.ok(path.includes("H 100.0"), "Horizontal segment across Shot 2");
});

test("generatePacingPathAndArea produces path and closed gradient area", () => {
  const shots: Shot[] = [
    {
      id: "s1",
      index: 1,
      startSeconds: 0,
      endSeconds: 2,
      duration: 2,
      shotSize: "Medium",
      reviewStatus: "Confirmed",
    },
    {
      id: "s2",
      index: 2,
      startSeconds: 2,
      endSeconds: 4,
      duration: 2,
      shotSize: "Medium",
      reviewStatus: "Confirmed",
    },
  ];
  const { path, area } = generatePacingPathAndArea(shots, 4, 20, 60);
  assert.ok(path.length > 0, "Pacing line path should not be empty");
  assert.ok(area.startsWith(path), "Area begins with line path");
  assert.ok(area.endsWith("Z"), "Area closes with Z");
  assert.ok(area.includes("L 80.0"), "Area extends to full canvas width");
});

test("generateMotionFlowPathAndArea returns hasData false when shots have no motion profiles", () => {
  const shots: Shot[] = [
    {
      id: "s1",
      index: 1,
      startSeconds: 0,
      endSeconds: 5,
      duration: 5,
    },
  ];
  const res = generateMotionFlowPathAndArea(shots, 5, 10, 80);
  assert.equal(res.hasData, false);
  assert.equal(res.path, "");
  assert.equal(res.area, "");
});

test("generateMotionFlowPathAndArea generates smooth kinetic flow wave and closed SVG area", () => {
  const shots: Shot[] = [
    {
      id: "s1",
      index: 1,
      startSeconds: 0,
      endSeconds: 4,
      duration: 4,
      motionProfile: {
        cameraMovement: "Static",
        cameraEnergy: 5,
        subjectEnergy: 5,
        totalKineticEnergy: 10,
        confidence: 0.8,
      },
    },
    {
      id: "s2",
      index: 2,
      startSeconds: 4,
      endSeconds: 8,
      duration: 4,
      motionProfile: {
        cameraMovement: "Dynamic / Action",
        cameraEnergy: 60,
        subjectEnergy: 75,
        totalKineticEnergy: 70,
        confidence: 0.9,
      },
    },
  ];
  const scale = 10;
  const height = 100;
  const res = generateMotionFlowPathAndArea(shots, 8, scale, height);
  assert.equal(res.hasData, true);
  assert.ok(res.path.startsWith("M "), "Path starts with M command");
  assert.ok(res.path.includes("C "), "Path contains smooth cubic curves");
  assert.ok(res.area.startsWith(res.path), "Area begins with curve path");
  assert.ok(res.area.endsWith("Z"), "Area closes with Z");
  assert.ok(res.area.includes("L 80.0"), "Area extends to full timeline canvas width");
});

test("generateCutDensityPathAndArea produces smooth kinetic energy wave and closed SVG area", () => {
  const shots: Shot[] = [
    {
      id: "s1",
      index: 1,
      startSeconds: 0,
      endSeconds: 3,
      duration: 3,
    },
    {
      id: "s2",
      index: 2,
      startSeconds: 3,
      endSeconds: 5,
      duration: 2,
    },
    {
      id: "s3",
      index: 3,
      startSeconds: 5,
      endSeconds: 6,
      duration: 1,
    },
  ];
  const scale = 10;
  const height = 50;
  const res = generateCutDensityPathAndArea(shots, 6, scale, height);
  assert.equal(res.hasData, true);
  assert.ok(res.path.startsWith("M "), "Path starts with M command");
  assert.ok(res.path.includes("C "), "Path contains smooth cubic curves");
  assert.ok(res.area.startsWith(res.path), "Area begins with curve path");
  assert.ok(res.area.endsWith("Z"), "Area closes with Z");
  assert.ok(res.area.includes("L 60.0"), "Area extends to full timeline canvas width");
});

test("formatTimecode produces SMPTE compliant timecode for HUD readout", () => {
  assert.equal(formatTimecode(0, 24), "00:00:00:00");
  assert.equal(formatTimecode(1.5, 24), "00:00:01:12");
  assert.equal(formatTimecode(65.25, 24), "00:01:05:06");
});
