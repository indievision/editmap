import {
  cutInterpretations,
  peopleLabels,
  shotSizes,
  soundKinds,
  subjectLabels,
  type Project,
  type Shot,
} from "../models/project";
import { rates } from "../utils/timecode";

export const BACKUP_FORMAT = "editmap-project";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

export interface ProjectBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  project: Project;
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
};
const string = (value: unknown, label: string) => {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  return value;
};
const number = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
};
const array = (value: unknown, label: string) => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
};
const oneOf = <T extends readonly string[]>(value: unknown, choices: T, label: string): T[number] => {
  if (typeof value !== "string" || !choices.includes(value)) throw new Error(`${label} is unsupported.`);
  return value as T[number];
};
const image = (value: unknown, label: string) => {
  const result = string(value, label);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(result) || result.length > 12 * 1024 * 1024) throw new Error(`${label} must be a bounded base64 image.`);
  return result;
};

function validateShot(raw: unknown, i: number): Shot {
  const s = object(raw, `Shot ${i + 1}`);
  const startSeconds = number(s.startSeconds, `Shot ${i + 1} start`);
  const endSeconds = number(s.endSeconds, `Shot ${i + 1} end`);
  if (startSeconds < 0 || endSeconds <= startSeconds || number(s.duration, `Shot ${i + 1} duration`) <= 0) throw new Error(`Shot ${i + 1} has invalid boundaries.`);
  const result: Shot = {
    id: string(s.id, `Shot ${i + 1} id`), index: number(s.index, `Shot ${i + 1} index`),
    sourceReel: string(s.sourceReel, `Shot ${i + 1} reel`), sourceIn: string(s.sourceIn, `Shot ${i + 1} source in`), sourceOut: string(s.sourceOut, `Shot ${i + 1} source out`),
    startTimecode: string(s.startTimecode, `Shot ${i + 1} record in`), endTimecode: string(s.endTimecode, `Shot ${i + 1} record out`),
    startSeconds, endSeconds, duration: number(s.duration, `Shot ${i + 1} duration`), transition: string(s.transition, `Shot ${i + 1} transition`),
    shotSize: oneOf(s.shotSize, shotSizes, `Shot ${i + 1} size`), notes: string(s.notes, `Shot ${i + 1} notes`),
  };
  if (s.reviewStatus !== undefined) result.reviewStatus = oneOf(s.reviewStatus, ["Needs review", "Confirmed"] as const, `Shot ${i + 1} review state`);
  if (s.composition !== undefined) result.composition = oneOf(s.composition, Object.keys(peopleLabels), `Shot ${i + 1} composition`) as Shot["composition"];
  if (s.content !== undefined) result.content = oneOf(s.content, Object.keys(subjectLabels), `Shot ${i + 1} content`) as Shot["content"];
  if (s.uncertain !== undefined) { if (typeof s.uncertain !== "boolean") throw new Error(`Shot ${i + 1} uncertainty must be true or false.`); result.uncertain = s.uncertain; }
  if (s.protectedFields !== undefined) result.protectedFields = array(s.protectedFields, `Shot ${i + 1} protected fields`).map((x) => oneOf(x, ["shotSize", "composition", "content", "uncertain", "notes"] as const, `Shot ${i + 1} protected field`));
  // Evidence is retained only when it has the same compact, local representation.
  if (s.suggestion !== undefined) {
    const v = object(s.suggestion, `Shot ${i + 1} suggestion`);
    result.suggestion = { shotSize: oneOf(v.shotSize, shotSizes, `Shot ${i + 1} suggested size`), model: string(v.model, "Suggestion model"), createdAt: string(v.createdAt, "Suggestion date") };
    if (v.frame !== undefined) { const f = object(v.frame, "Suggestion frame"); result.suggestion.frame = { image: image(f.image, "Suggestion image"), time: number(f.time, "Suggestion time") }; }
  }
  if (s.characterAnalysis !== undefined) {
    const v = object(s.characterAnalysis, `Shot ${i + 1} character evidence`);
    const intervals = array(v.intervals, "Character intervals").map((rawInterval, n) => { const interval = object(rawInterval, `Character interval ${n + 1}`); const startSeconds = number(interval.startSeconds, "Character interval start"); const endSeconds = number(interval.endSeconds, "Character interval end"); if (endSeconds < startSeconds) throw new Error("Character interval has invalid boundaries."); return { memberId: string(interval.memberId, "Character member id"), startSeconds, endSeconds, reviewStatus: oneOf(interval.reviewStatus, ["Needs review", "Confirmed"] as const, "Character review state") }; });
    const times = (key: "unresolvedTimes" | "sampleTimes" | "failedTimes") => v[key] === undefined ? undefined : array(v[key], key).map((time) => number(time, key));
    result.characterAnalysis = { intervals, unresolvedTimes: times("unresolvedTimes") ?? [], sampleTimes: times("sampleTimes") ?? [], reviewStatus: oneOf(v.reviewStatus, ["Needs review", "Confirmed"] as const, "Character evidence review state"), model: string(v.model, "Character model"), createdAt: string(v.createdAt, "Character evidence date"), ...(times("failedTimes") ? { failedTimes: times("failedTimes") } : {}), ...(v.lastError === undefined ? {} : { lastError: string(v.lastError, "Character error") }), ...(v.mode === undefined ? {} : { mode: oneOf(v.mode, ["fast", "detailed"] as const, "Character mode") }), ...(v.partial === undefined ? {} : { partial: (() => { if (typeof v.partial !== "boolean") throw new Error("Character partial state must be true or false."); return v.partial; })() }), ...(v.manualMemberIds === undefined ? {} : { manualMemberIds: array(v.manualMemberIds, "Manual character ids").map((id) => string(id, "Manual character id")) }), ...(v.manualReviewStatus === undefined ? {} : { manualReviewStatus: oneOf(v.manualReviewStatus, ["Confirmed"] as const, "Manual character review state") }), ...(v.referenceSignature === undefined ? {} : { referenceSignature: string(v.referenceSignature, "Reference signature") }) };
  }
  return result;
}

export function makeBackup(project: Project): ProjectBackup {
  // JSON serialization deliberately drops transient URL/object/video handles.
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), project: JSON.parse(JSON.stringify(project)) };
}

export function parseBackup(text: string): Project {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("Backup is not valid JSON."); }
  const backup = object(raw, "Backup");
  if (backup.format !== BACKUP_FORMAT) throw new Error("This is not an EDITMAP project backup.");
  if (backup.version !== BACKUP_VERSION) throw new Error(`Backup version ${String(backup.version)} is not supported.`);
  const p = object(backup.project, "Backup project");
  const frameRate = number(p.frameRate, "Frame rate");
  if (!rates.includes(frameRate)) throw new Error("Backup uses an unsupported frame rate.");
  const shots = array(p.shots, "Shots").map(validateShot);
  const ids = new Set<string>();
  for (const [i, shot] of shots.entries()) { if (ids.has(shot.id)) throw new Error(`Shot ${i + 1} duplicates an identifier.`); ids.add(shot.id); if (i && shot.startSeconds < shots[i - 1].endSeconds - .00001) throw new Error("Shots overlap or are out of order."); }
  const project: Project = {
    id: string(p.id, "Project id"), name: string(p.name, "Project name"), frameRate, duration: number(p.duration, "Duration"), recordOrigin: string(p.recordOrigin, "Record origin"),
    dropFrame: (() => { if (typeof p.dropFrame !== "boolean") throw new Error("Drop-frame state must be true or false."); return p.dropFrame; })(), shots,
    colorMode: string(p.colorMode, "Color mode"), createdAt: string(p.createdAt, "Created date"), updatedAt: string(p.updatedAt, "Updated date"),
  };
  if (project.duration < 0) throw new Error("Duration cannot be negative.");
  if (p.videoMetadata !== undefined) { const m = object(p.videoMetadata, "Video metadata"); project.videoMetadata = { filename: string(m.filename, "Video filename"), duration: number(m.duration, "Video duration"), width: number(m.width, "Video width"), height: number(m.height, "Video height"), size: number(m.size, "Video size") }; }
  if (p.sequences !== undefined) project.sequences = array(p.sequences, "Sequences").map((x, i) => { const v = object(x, `Sequence ${i + 1}`); return { id: string(v.id, "Sequence id"), name: string(v.name, "Sequence name"), startSeconds: number(v.startSeconds, "Sequence start"), endSeconds: number(v.endSeconds, "Sequence end"), ...(v.notes === undefined ? {} : { notes: string(v.notes, "Sequence notes") }) }; });
  if (p.soundSpans !== undefined) project.soundSpans = array(p.soundSpans, "Sound spans").map((x, i) => { const v = object(x, `Sound span ${i + 1}`); return { id: string(v.id, "Sound span id"), kind: oneOf(v.kind, soundKinds, "Sound kind"), startSeconds: number(v.startSeconds, "Sound start"), endSeconds: number(v.endSeconds, "Sound end"), notes: string(v.notes, "Sound notes") }; });
  if (p.cutAnnotations !== undefined) project.cutAnnotations = array(p.cutAnnotations, "Cut annotations").map((x, i) => { const v = object(x, `Cut annotation ${i + 1}`); const outgoingId = string(v.outgoingId, "Cut outgoing shot"); const incomingId = string(v.incomingId, "Cut incoming shot"); if (!ids.has(outgoingId) || !ids.has(incomingId)) throw new Error("A cut annotation references a missing shot."); return { outgoingId, incomingId, interpretation: oneOf(v.interpretation, cutInterpretations, "Cut interpretation"), notes: string(v.notes, "Cut notes") }; });
  if (p.cast !== undefined) project.cast = array(p.cast, "Cast").map((x, i) => { const v = object(x, `Cast member ${i + 1}`); return { id: string(v.id, "Cast id"), name: string(v.name, "Cast name"), references: array(v.references, "Cast references").map((ref, j) => { const r = object(ref, `Reference ${j + 1}`); const shotId = string(r.shotId, "Reference shot id"); if (!ids.has(shotId)) throw new Error("A cast reference points to a missing shot."); return { id: string(r.id, "Reference id"), image: image(r.image, "Reference image"), shotId, time: number(r.time, "Reference time") }; }) }; });
  const castIds = new Set((project.cast ?? []).map((member) => member.id));
  for (const shot of project.shots) for (const interval of shot.characterAnalysis?.intervals ?? []) if (!castIds.has(interval.memberId)) throw new Error("Character evidence references a missing cast member.");
  return project;
}
