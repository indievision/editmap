import test from "node:test";
import assert from "node:assert/strict";
import type { Project, Shot } from "../src/models/project";
import {
  getFramingVoltage,
  getAcousticVoltageAt,
  computePolyphonicChordAt,
  generatePolyphonicScore,
} from "../src/analysis/polyphony";

test("Polyphony Engine - Eisenstein's Vertical Montage", async (t) => {
  const mockShots: Shot[] = [
    {
      id: "s1",
      shotNumber: 1,
      startSeconds: 0,
      endSeconds: 10,
      duration: 10,
      thumbnail: "",
      shotSize: "Extreme wide",
      framing: "Extreme wide",
    },
    {
      id: "s2",
      shotNumber: 2,
      startSeconds: 10,
      endSeconds: 12,
      duration: 2,
      thumbnail: "",
      shotSize: "Extreme close",
      framing: "Extreme close",
      motionProfile: {
        totalKineticEnergy: 85,
        dominantDirection: "pan_right",
        panTiltEnergy: 80,
        zoomEnergy: 10,
        turbulence: 20,
        vectors: [],
      },
    },
    {
      id: "s3",
      shotNumber: 3,
      startSeconds: 12,
      endSeconds: 14,
      duration: 2,
      thumbnail: "",
      shotSize: "Close",
      framing: "Close",
      motionProfile: {
        totalKineticEnergy: 90,
        dominantDirection: "tilt_up",
        panTiltEnergy: 85,
        zoomEnergy: 15,
        turbulence: 25,
        vectors: [],
      },
    },
    {
      id: "s4",
      shotNumber: 4,
      startSeconds: 14,
      endSeconds: 20,
      duration: 6,
      thumbnail: "",
      shotSize: "Medium",
      framing: "Medium",
    },
  ];

  const mockProject: Project = {
    id: "proj-polyphony-test",
    name: "Polyphony Test",
    duration: 20,
    aspectRatio: "16:9",
    shots: mockShots,
    loudnessAnalysis: {
      integrated: -18,
      range: 8,
      truePeak: -1.2,
      momentary: [-30, -30, -12, -12, -14, -14, -28, -28],
      shortTerm: [-24, -24, -14, -14, -15, -15, -24, -24],
      integratedWaveform: [-20, -20, -18, -18],
      truePeakWaveform: [-3, -3, -1, -1],
      binCount: 8,
    },
    dmeWaveforms: {
      binCount: 8,
      dialogue: [0.1, 0.1, 0.2, 0.2, 0.1, 0.1, 0.05, 0.05],
      music: [0.2, 0.2, 0.8, 0.8, 0.7, 0.7, 0.1, 0.1],
      effects: [0.1, 0.1, 0.7, 0.7, 0.6, 0.6, 0.05, 0.05],
    },
    speechAnalysis: {
      regions: [{ startSeconds: 10, endSeconds: 15, text: "High dramatic line" }],
      speechTimeSeconds: 5,
      speechPercentage: 25,
    },
  };

  await t.test("calculates framing voltage correctly across scales", () => {
    assert.equal(getFramingVoltage(mockShots[0]), 10); // Extreme wide
    assert.equal(getFramingVoltage(mockShots[1]), 100); // Extreme close
    assert.equal(getFramingVoltage(mockShots[2]), 92); // Close
    assert.equal(getFramingVoltage(mockShots[3]), 65); // Medium
    assert.equal(getFramingVoltage(undefined), 50);
  });

  await t.test("computes acoustic voltage incorporating loudness, DME stems, and speech", () => {
    // At quiet intro (t = 2s)
    const quietAudio = getAcousticVoltageAt(
      2,
      20,
      mockProject.loudnessAnalysis,
      mockProject.dmeWaveforms,
      mockProject.speechAnalysis
    );
    assert.equal(quietAudio.speechActive, false);
    assert.ok(quietAudio.acousticVoltage < 60);

    // At dramatic peak (t = 11s)
    const peakAudio = getAcousticVoltageAt(
      11,
      20,
      mockProject.loudnessAnalysis,
      mockProject.dmeWaveforms,
      mockProject.speechAnalysis
    );
    assert.equal(peakAudio.speechActive, true);
    assert.ok(peakAudio.acousticVoltage > quietAudio.acousticVoltage);
  });

  await t.test("computes single polyphonic chord with visual, acoustic, and counterpoint metrics", () => {
    const cuts = [10, 12, 14];
    const cutShockMap = new Map<number, number>([
      [10000, 75],
      [12000, 80],
      [14000, 50],
    ]);

    const chordAt11 = computePolyphonicChordAt(mockProject, 11, cuts, cutShockMap, 20);
    assert.equal(chordAt11.time, 11);
    assert.equal(chordAt11.framingElevation, 100); // Extreme close
    assert.equal(chordAt11.motionEnergy, 85);
    assert.ok(chordAt11.visualVoltage >= 55);
    assert.ok(chordAt11.totalVoltage > 50);
  });

  await t.test("generates complete score with climaxes, counterpoints, and global metrics", () => {
    const summary = generatePolyphonicScore(mockProject, 60, 15);
    assert.ok(summary.chords.length > 10);
    assert.ok(summary.averageVoltage > 0);
    assert.ok(summary.averageVoltage <= 100);
    assert.ok(summary.climaxSharePercent >= 0);
    assert.ok(summary.counterpointSharePercent >= 0);
  });

  await t.test("detects sensory counterpoint when visual and acoustic tracks diverge", () => {
    // Create a project with high visual editing but silent audio (Godfather baptism archetype)
    const godfatherProject: Project = {
      ...mockProject,
      loudnessAnalysis: {
        integrated: -45,
        range: 4,
        truePeak: -20,
        momentary: [-50, -50, -50, -50],
        shortTerm: [-50, -50, -50, -50],
        integratedWaveform: [-50, -50],
        truePeakWaveform: [-20, -20],
        binCount: 4,
      },
      dmeWaveforms: undefined,
      speechAnalysis: undefined,
    };

    const summary = generatePolyphonicScore(godfatherProject, 40, 10);
    const counterpointChords = summary.chords.filter((c) => c.mode === "sensory-counterpoint");
    assert.ok(counterpointChords.length > 0);
    assert.equal(counterpointChords[0].counterpointType, "visual-fury-sonic-calm");
  });
});
