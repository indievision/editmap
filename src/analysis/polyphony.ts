import type { Project, Shot, LoudnessAnalysis, DmeWaveforms, SpeechAnalysis } from "../models/project";
import { cutTimes, pacingAt, computeCutShockData } from "./pacing";
import { framingRank } from "./framing";
import { lufsToNormalized } from "./loudness";

export interface PolyphonicChord {
  time: number;
  // Visual Track Components
  cutRate: number; // cuts/min
  cutRateNorm: number; // 0-100
  framingElevation: number; // 0-100 (Extreme wide=10 -> Extreme close=100)
  motionEnergy: number; // 0-100
  shockEnergy: number; // 0-100 (decayed visual delta)
  visualVoltage: number; // 0-100 composite visual charge

  // Acoustic Track Components
  loudnessNorm: number; // 0-100
  speechActive: boolean;
  dmeLevels?: { dialogue: number; music: number; effects: number };
  acousticVoltage: number; // 0-100 composite acoustic charge

  // Master Eisenstein Synthesis
  totalVoltage: number; // 0-100 overall sensory voltage
  counterpointDivergence: number; // 0-100 divergence between eye and ear
  mode: "polyphonic-climax" | "sensory-counterpoint" | "parallel-flow" | "breathing-valley";
  counterpointType?: "visual-fury-sonic-calm" | "visual-still-sonic-dread" | "balanced";
}

export interface PolyphonicClimax {
  id: string;
  startTime: number;
  endTime: number;
  peakTime: number;
  peakVoltage: number;
  duration: number;
  description: string;
}

export interface CounterpointZone {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  avgDivergence: number;
  type: "visual-fury-sonic-calm" | "visual-still-sonic-dread";
  label: string;
  description: string;
}

export interface PolyphonicSummary {
  chords: PolyphonicChord[];
  climaxes: PolyphonicClimax[];
  counterpoints: CounterpointZone[];
  averageVoltage: number;
  climaxSharePercent: number;
  counterpointSharePercent: number;
  breathingSharePercent: number;
}

const FRAMING_VOLTAGES = [
  10, // Extreme wide
  25, // Wide
  40, // Full
  55, // American
  65, // Medium
  80, // Medium close-up
  92, // Close
  100, // Extreme close
];

/**
 * Computes the framing voltage (0-100) for a given shot.
 */
export function getFramingVoltage(shot?: Shot): number {
  if (!shot) return 50;
  const targetShot = shot.shotSize ? shot : { ...shot, shotSize: (shot as any).framing };
  const rank = framingRank(targetShot);
  if (rank === null || rank < 0 || rank >= FRAMING_VOLTAGES.length) return 50;
  return FRAMING_VOLTAGES[rank];
}

/**
 * Computes momentary audio voltage (0-100) from loudness analysis and DME stems.
 */
export function getAcousticVoltageAt(
  time: number,
  duration: number,
  loudness?: LoudnessAnalysis,
  dme?: DmeWaveforms,
  speech?: SpeechAnalysis
): {
  loudnessNorm: number;
  speechActive: boolean;
  dmeLevels?: { dialogue: number; music: number; effects: number };
  acousticVoltage: number;
} {
  let loudnessNorm = 45; // Default ambient cinema floor
  if (loudness && loudness.momentary.length > 0 && duration > 0) {
    const fraction = Math.max(0, Math.min(1, time / duration));
    const idx = Math.min(loudness.momentary.length - 1, Math.floor(fraction * loudness.momentary.length));
    const lufs = loudness.momentary[idx];
    if (Number.isFinite(lufs)) {
      // Map -70 LUFS..-10 LUFS to 0..100
      loudnessNorm = Math.round(lufsToNormalized(lufs) * 100);
    }
  }

  let speechActive = false;
  if (speech && speech.regions) {
    speechActive = speech.regions.some((r) => time >= r.startSeconds && time <= r.endSeconds);
  }

  let dmeLevels: { dialogue: number; music: number; effects: number } | undefined = undefined;
  let dmeBoost = 0;
  if (dme && dme.binCount > 0 && duration > 0) {
    const fraction = Math.max(0, Math.min(1, time / duration));
    const idx = Math.min(dme.binCount - 1, Math.floor(fraction * dme.binCount));
    const d = dme.dialogue[idx] ?? 0;
    const m = dme.music[idx] ?? 0;
    const e = dme.effects[idx] ?? 0;
    dmeLevels = { dialogue: d, music: m, effects: e };
    // Music and loud effects elevate dramatic sonic tension
    dmeBoost = (m * 20) + (e * 20);
  }

  const acousticVoltage = Math.min(100, Math.max(0, Math.round(loudnessNorm * 0.75 + dmeBoost + (speechActive ? 8 : 0))));

  return {
    loudnessNorm,
    speechActive,
    dmeLevels,
    acousticVoltage,
  };
}

/**
 * Computes a single Polyphonic Chord at time t in the project.
 */
export function computePolyphonicChordAt(
  project: Project,
  time: number,
  cuts: number[],
  cutShockMap: Map<number, number>,
  window: number = 20
): PolyphonicChord {
  const duration = project.duration || 1;
  const clampedTime = Math.max(0, Math.min(duration, time));

  // 1. Pacing & Cut Frequency
  const pacing = pacingAt(cuts, duration, window, clampedTime);
  // 45 cuts/min = 100% max cinema cut velocity
  const cutRateNorm = Math.min(100, Math.round((pacing.rate / 45) * 100));

  // 2. Active Shot & Framing Elevation
  const activeShot = project.shots.find((s) => clampedTime >= s.startSeconds && clampedTime < s.endSeconds)
    ?? project.shots[project.shots.length - 1];
  const framingElevation = getFramingVoltage(activeShot);

  // 3. Kinetic Motion Energy
  let motionEnergy = 30; // Baseline ambient motion
  if (activeShot?.motionProfile) {
    motionEnergy = Math.min(100, Math.max(0, activeShot.motionProfile.totalKineticEnergy));
  }

  // 4. Visual Delta / Shock Energy with Temporal Exponential Decay (1.5s half-life)
  let shockEnergy = 0;
  for (const cutTime of cuts) {
    const dt = clampedTime - cutTime;
    if (dt >= 0 && dt <= 3.0) {
      const shock = cutShockMap.get(Math.round(cutTime * 1000)) ?? 20;
      const decay = Math.exp(-dt / 0.8);
      const decayedShock = shock * decay;
      if (decayedShock > shockEnergy) shockEnergy = decayedShock;
    }
  }
  shockEnergy = Math.min(100, Math.round(shockEnergy));

  // 5. Composite Visual Voltage
  // Weights: Pacing (35%), Framing Elevation (25%), Motion Energy (25%), Sensory Shock (15%)
  const visualVoltage = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        cutRateNorm * 0.35 +
        framingElevation * 0.25 +
        motionEnergy * 0.25 +
        shockEnergy * 0.15
      )
    )
  );

  // 6. Acoustic Voltage
  const audio = getAcousticVoltageAt(
    clampedTime,
    duration,
    project.loudnessAnalysis,
    project.dmeWaveforms,
    project.speechAnalysis
  );

  // 7. Master Eisenstein Synthesis
  const totalVoltage = Math.round((visualVoltage + audio.acousticVoltage) / 2);
  const counterpointDivergence = Math.abs(visualVoltage - audio.acousticVoltage);

  let mode: PolyphonicChord["mode"] = "parallel-flow";
  let counterpointType: PolyphonicChord["counterpointType"] = undefined;

  if (totalVoltage >= 75 && counterpointDivergence <= 25) {
    mode = "polyphonic-climax";
  } else if (counterpointDivergence >= 38) {
    mode = "sensory-counterpoint";
    if (visualVoltage > audio.acousticVoltage) {
      counterpointType = "visual-fury-sonic-calm";
    } else {
      counterpointType = "visual-still-sonic-dread";
    }
  } else if (totalVoltage <= 22) {
    mode = "breathing-valley";
  }

  return {
    time: clampedTime,
    cutRate: Number(pacing.rate.toFixed(1)),
    cutRateNorm,
    framingElevation,
    motionEnergy,
    shockEnergy,
    visualVoltage,
    loudnessNorm: audio.loudnessNorm,
    speechActive: audio.speechActive,
    dmeLevels: audio.dmeLevels,
    acousticVoltage: audio.acousticVoltage,
    totalVoltage,
    counterpointDivergence,
    mode,
    counterpointType,
  };
}

/**
 * Generates the complete Vertical Montage polyphonic wave across the film.
 */
export function generatePolyphonicScore(
  project: Project,
  samplePoints: number = 300,
  window: number = 20
): PolyphonicSummary {
  const duration = project.duration || 1;
  const cuts = cutTimes(project.shots);
  const shockData = computeCutShockData(project.shots);
  const cutShockMap = new Map<number, number>();
  for (const s of shockData) {
    cutShockMap.set(Math.round(s.time * 1000), s.shockScore);
  }

  const chords: PolyphonicChord[] = [];
  const count = Math.max(10, samplePoints);
  for (let i = 0; i <= count; i++) {
    const t = (i * duration) / count;
    chords.push(computePolyphonicChordAt(project, t, cuts, cutShockMap, window));
  }

  // Detect Polyphonic Climaxes (runs of chords where mode === "polyphonic-climax" or totalVoltage >= 75)
  const climaxes: PolyphonicClimax[] = [];
  let currentClimax: PolyphonicChord[] = [];

  const flushClimax = () => {
    if (currentClimax.length >= 2) {
      const peak = currentClimax.reduce((max, c) => (c.totalVoltage > max.totalVoltage ? c : max), currentClimax[0]);
      climaxes.push({
        id: `climax-${climaxes.length + 1}`,
        startTime: currentClimax[0].time,
        endTime: currentClimax[currentClimax.length - 1].time,
        peakTime: peak.time,
        peakVoltage: peak.totalVoltage,
        duration: Number((currentClimax[currentClimax.length - 1].time - currentClimax[0].time).toFixed(2)),
        description: `Full audiovisual convergence (peak ${peak.totalVoltage}% voltage at ${peak.time.toFixed(1)}s)`,
      });
    }
    currentClimax = [];
  };

  for (const c of chords) {
    if (c.totalVoltage >= 74 && c.counterpointDivergence <= 28) {
      currentClimax.push(c);
    } else {
      flushClimax();
    }
  }
  flushClimax();

  // Detect Sensory Counterpoint Zones (runs of chords where counterpointDivergence >= 38)
  const counterpoints: CounterpointZone[] = [];
  let currentCounterpoint: PolyphonicChord[] = [];

  const flushCounterpoint = () => {
    if (currentCounterpoint.length >= 2) {
      const avgDiv = Math.round(
        currentCounterpoint.reduce((sum, c) => sum + c.counterpointDivergence, 0) / currentCounterpoint.length
      );
      const isVisualDominant = currentCounterpoint[0].visualVoltage > currentCounterpoint[0].acousticVoltage;
      const type = isVisualDominant ? "visual-fury-sonic-calm" : "visual-still-sonic-dread";
      const label = isVisualDominant ? "Visual Fury / Sonic Stillness" : "Visual Stillness / Sonic Dread";
      const description = isVisualDominant
        ? "Rapid visual editing counterpointed by quiet acoustics (Baptism effect / dramatic irony)"
        : "Extended static framing tension held against heavy sonic energy";

      counterpoints.push({
        id: `counterpoint-${counterpoints.length + 1}`,
        startTime: currentCounterpoint[0].time,
        endTime: currentCounterpoint[currentCounterpoint.length - 1].time,
        duration: Number((currentCounterpoint[currentCounterpoint.length - 1].time - currentCounterpoint[0].time).toFixed(2)),
        avgDivergence: avgDiv,
        type,
        label,
        description,
      });
    }
    currentCounterpoint = [];
  };

  for (const c of chords) {
    if (c.counterpointDivergence >= 36) {
      if (currentCounterpoint.length === 0) {
        currentCounterpoint.push(c);
      } else {
        const prev = currentCounterpoint[currentCounterpoint.length - 1];
        const prevType = prev.visualVoltage > prev.acousticVoltage;
        const currType = c.visualVoltage > c.acousticVoltage;
        if (prevType === currType) {
          currentCounterpoint.push(c);
        } else {
          flushCounterpoint();
          currentCounterpoint = [c];
        }
      }
    } else {
      flushCounterpoint();
    }
  }
  flushCounterpoint();

  // Global metrics
  const totalV = chords.reduce((sum, c) => sum + c.totalVoltage, 0);
  const averageVoltage = chords.length > 0 ? Math.round(totalV / chords.length) : 0;
  const climaxCount = chords.filter((c) => c.mode === "polyphonic-climax").length;
  const counterpointCount = chords.filter((c) => c.mode === "sensory-counterpoint").length;
  const breathingCount = chords.filter((c) => c.mode === "breathing-valley").length;

  return {
    chords,
    climaxes,
    counterpoints,
    averageVoltage,
    climaxSharePercent: Math.round((climaxCount / chords.length) * 100),
    counterpointSharePercent: Math.round((counterpointCount / chords.length) * 100),
    breathingSharePercent: Math.round((breathingCount / chords.length) * 100),
  };
}
