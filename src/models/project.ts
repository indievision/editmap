export const shotSizes = [
  // The active scale is deliberately coarse: it is the shared contract between
  // CinemaCLIP suggestions, manual review, and the framing rhythm readings.
  "Wide",
  "Full",
  "Medium",
  "Close",
  "Extreme close",
  // Retained solely to open existing projects without data loss. New scans and
  // manual controls use the five values above.
  "EWS",
  "WS",
  "MWS",
  "MS",
  "MCU",
  "CU",
  "ECU",
  "Insert",
  "OTS",
  "POV",
  // Retained so projects tagged with experimental sizes still load.
  "FS",
  "AS",
  "Unknown",
  "Not applicable",
] as const;
export type ShotSize = (typeof shotSizes)[number];
export const selectableShotSizes = [
  "Wide",
  "Full",
  "Medium",
  "Close",
  "Extreme close",
  "Unknown",
] as const satisfies readonly ShotSize[];
// Keep established stored values so existing projects and suggestions still load.
export const peopleLabels = {
  "No people": "No people",
  "Single person": "One person",
  "Two-shot": "Two people",
  Group: "Group (3+)",
  Unknown: "Unknown",
} as const;
export const subjectLabels = {
  People: "People",
  "Object / detail": "Objects",
  Animals: "Animals",
  "Landscape / nature": "Landscape / nature",
  "Architecture / interiors": "Architecture / interiors",
  "Text / title card": "Text / graphics",
  Other: "Other",
  Unknown: "Unknown",
} as const;

export type HarmonyType =
  | "teal-orange"
  | "complementary"
  | "analogous"
  | "monochromatic"
  | "triadic"
  | "neutral";

export interface ColorProfile {
  /** Top 3-5 dominant hex colors sorted by frequency/prominence */
  palette: string[];
  /** Average perceived luminance from 0 (pitch black) to 1 (pure white) */
  luminance: number;
  /** Warm/Cool color temperature score: positive = warm (amber/red), negative = cool (cyan/blue) */
  temperature: number;
  /** Average saturation from 0 (monochrome) to 1 (vivid) */
  saturation: number;
  /** Editorial mood label: e.g. "Low-Key / Dark", "High-Key / Bright", "Warm Interior", "Cool Exterior", "Neutral" */
  mood: string;
  /** Color wheel harmony classification */
  harmony: {
    type: HarmonyType;
    label: string;
    confidence: number;
    dominantHue: number;
  };
}

export const cameraMovementTypes = [
  "Static",
  "Pan",
  "Tilt",
  "Dolly / Track",
  "Handheld",
  "Dynamic / Action",
  "Zoom",
  "Unknown",
] as const;
export type CameraMovementType = (typeof cameraMovementTypes)[number];

export interface MotionProfile {
  /** Dominant camera movement classification */
  cameraMovement: CameraMovementType;
  /** Global camera motion energy 0 to 100 */
  cameraEnergy: number;
  /** Internal subject motion energy 0 to 100 */
  subjectEnergy: number;
  /** Combined visual kinetic energy 0 to 100 */
  totalKineticEnergy: number;
  /** Confidence of estimation 0.0 to 1.0 */
  confidence: number;
}

export interface Shot {
  id: string;
  index: number;
  sourceReel: string;
  sourceIn: string;
  sourceOut: string;
  startTimecode: string;
  endTimecode: string;
  startSeconds: number;
  endSeconds: number;
  duration: number;
  transition: string;
  shotSize: ShotSize;
  notes: string;
  reviewStatus?: "Needs review" | "Confirmed";
  /** Fields changed by a person. Model passes must leave them intact. */
  protectedFields?: Array<"shotSize" | "composition" | "content" | "uncertain" | "notes" | "cameraMovement">;
  suggestion?: {
    shotSize: ShotSize;
    composition?: Shot["composition"];
    content?: Shot["content"];
    cameraMovement?: CameraMovementType;
    uncertain?: boolean;
    model: string;
    createdAt: string;
    frame?: { image: string; time: number };
  };
  composition?: keyof typeof peopleLabels;
  content?: keyof typeof subjectLabels;
  cameraMovement?: CameraMovementType;
  uncertain?: boolean;
  /** Retained operational failures, distinct from an unresolved editorial or cast judgement. */
  analysisFailures?: {
    framing?: { message: string; createdAt: string };
  };
  /** Optional local character pass. It never changes the editorial shot tags. */
  characterAnalysis?: CharacterAnalysis;
  /** Extracted chromatic & lighting profile */
  colorProfile?: ColorProfile;
  /** Extracted camera movement and kinetic energy profile */
  motionProfile?: MotionProfile;
}
export interface CastReference {
  id: string;
  image: string;
  shotId: string;
  time: number;
}
export interface CastMember {
  id: string;
  name: string;
  references: CastReference[];
}
export interface CharacterInterval {
  memberId: string;
  startSeconds: number;
  endSeconds: number;
  /** Estimated readings remain editable; confirmation is a human decision. */
  reviewStatus: "Needs review" | "Confirmed";
}
export interface CharacterAnalysis {
  intervals: CharacterInterval[];
  /** Sample times where a person could not be safely matched to the cast. */
  unresolvedTimes: number[];
  /** Transport, timeout, or invalid-response failures; separate from uncertain identities. */
  failedTimes?: number[];
  lastError?: string;
  sampleTimes: number[];
  reviewStatus: "Needs review" | "Confirmed";
  model: string;
  createdAt: string;
  /** Fast is one midpoint reading; detailed retains five sampled readings. */
  mode?: "fast" | "detailed";
  /** Detailed scans interrupted between samples retain evidence, never coverage claims. */
  partial?: boolean;
  /** A human shot-level decision has no inferred entry or exit boundary. */
  manualMemberIds?: string[];
  manualReviewStatus?: "Confirmed";
  referenceSignature?: string;
}
export interface SequenceMarker {
  id: string;
  name: string;
  startSeconds: number;
  endSeconds: number;
  /** A user reading, never an automated conclusion. */
  notes?: string;
}
export const cutInterpretations = [
  "Unmarked",
  "Reaction",
  "Reveal",
  "Spatial reset",
  "Contrast",
  "Continuation",
] as const;
export type CutInterpretation = (typeof cutInterpretations)[number];

export interface FocalPoint {
  /** Normalized x position 0.0 (left) to 1.0 (right) */
  x: number;
  /** Normalized y position 0.0 (top) to 1.0 (bottom) */
  y: number;
  /** Method of focal detection */
  type: "eyes" | "face" | "person" | "saliency" | "center";
  /** Detection confidence score 0.0 to 1.0 */
  confidence: number;
}

export interface EyeTraceCutReading {
  outgoingFocalPoint: FocalPoint;
  incomingFocalPoint: FocalPoint;
  /** Euclidean distance in normalized coordinate space (0.0 to ~1.41) */
  jumpDistance: number;
  /** Jump distance as a percentage of screen diagonal (0 to 100) */
  jumpDistancePercent: number;
  /** Walter Murch saccadic threshold classification */
  rating: "smooth" | "natural" | "jarring";
  /** Horizontal gaze/flow across cut */
  screenDirection?: "left-to-right" | "right-to-left" | "neutral";
}

/** A manual reading of one ordered pair; it never changes the shot tags. */
export interface CutAnnotation {
  outgoingId: string;
  incomingId: string;
  interpretation: CutInterpretation;
  notes: string;
  eyeTrace?: EyeTraceCutReading;
}
export const soundKinds = ["Dialogue", "Music", "Ambience", "Silence"] as const;
export type SoundKind = (typeof soundKinds)[number];
/** A manual annotation of the mixed production track; never a stem separation claim. */
export interface SoundSpan {
  id: string;
  kind: SoundKind;
  startSeconds: number;
  endSeconds: number;
  notes: string;
}

export interface DmeWaveforms {
  dialogue: number[];
  music: number[];
  effects: number[];
  binCount: number;
  duration: number;
  separatedAt: string;
}

/** Local Silero VAD evidence. It describes detected voice activity, never silence or dialogue quality. */
export interface SpeechRegion { startSeconds: number; endSeconds: number; }
export interface SpeechAnalysis {
  regions: SpeechRegion[];
  /** A sampled-content signature, not a filename, prevents accidental reuse after relinking. */
  mediaSignature: string;
  model: "silero-vad";
  modelVersion: string;
  settingsVersion: string;
  threshold: number;
  minSpeechMs: number;
  minSilenceMs: number;
  duration: number;
  scannedAt: string;
  processingSeconds: number;
}

/** EBU R128 loudness transition marker (quiet-to-loud jump or loud-to-quiet drop). */
export interface LoudnessTransition {
  time: number;
  duration: number;
  fromLufs: number;
  toLufs: number;
  deltaLufs: number;
  type: "quiet-to-loud" | "loud-to-quiet";
}

/** Local EBU R128 loudness and dynamic contrast analysis from FFmpeg ebur128. */
export interface LoudnessAnalysis {
  integratedLoudness: number; // LUFS (I)
  loudnessRange: number; // LU (LRA) - dynamic contrast
  lraLow: number; // LUFS (10th percentile)
  lraHigh: number; // LUFS (95th percentile)
  truePeak: number; // dBTP (Peak)
  maxMomentary: number; // LUFS
  maxShortTerm: number; // LUFS
  threshold: number; // LUFS
  momentary: number[]; // Binned M (LUFS)
  shortTerm: number[]; // Binned S (LUFS)
  truePeaks: number[]; // Binned TPK (dBTP)
  transitions: LoudnessTransition[];
  binCount: number;
  duration: number;
  mediaSignature: string;
  model: "ffmpeg-ebur128";
  modelVersion: string;
  scannedAt: string;
  processingSeconds: number;
}

export interface Project {
  id: string;
  name: string;
  videoMetadata?: {
    filename: string;
    duration: number;
    width: number;
    height: number;
    size: number;
  };
  frameRate: number;
  duration: number;
  recordOrigin: string;
  dropFrame: boolean;
  shots: Shot[];
  sequences?: SequenceMarker[];
  cutAnnotations?: CutAnnotation[];
  soundSpans?: SoundSpan[];
  cast?: CastMember[];
  dmeWaveforms?: DmeWaveforms;
  speechAnalysis?: SpeechAnalysis;
  loudnessAnalysis?: LoudnessAnalysis;
  colorMode: string;
  createdAt: string;
  updatedAt: string;
}
export function newProject(): Project {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "Untitled film",
    frameRate: 24,
    duration: 0,
    recordOrigin: "00:00:00:00",
    dropFrame: false,
    shots: [],
    colorMode: "shotSize",
    createdAt: now,
    updatedAt: now,
  };
}

export function updateShotTags(shot: Shot, patch: Partial<Shot>): Shot {
  const next = { ...shot, ...patch };
  if (next.content === "Text / title card") next.shotSize = "Not applicable";
  else if (
    shot.content === "Text / title card" &&
    patch.content &&
    !patch.shotSize
  )
    next.shotSize = "Unknown";
  return next;
}
