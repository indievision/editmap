import { useEffect, useMemo, useRef, useState } from "react";
import {
  newProject,
  peopleLabels,
  subjectLabels,
  selectableShotSizes,
  updateShotTags,
  type CastMember,
  type CharacterAnalysis,
  type Project,
  type Shot,
} from "../models/project";
import { parseEDL } from "../parsers/edl";
import { actualRate, formatTimecode, rates } from "../utils/timecode";
import { activeShot, clampSeek } from "../analysis/playback";
import { listProjects, saveProject } from "../storage/projects";
import { MAX_BACKUP_BYTES, makeBackup, parseBackup } from "../storage/backup";
import EditingMap from "../timeline/EditingMap";
import ShotAnalysis from "../components/ShotAnalysis";
import AllShotsAnalysis from "../components/AllShotsAnalysis";
import EditingRhythm from "../components/EditingRhythm";
import SequenceReading, { type TimeRange } from "../components/SequenceReading";
import CutReading from "../components/CutReading";
import type { CutPair } from "../analysis/cuts";
import { useThumbnails } from "../video/useThumbnails";
import { analyzeLocalAudio } from "../analysis/audio";
import { separateDmeAudio } from "../analysis/dme";
import CharacterSummary, { CastGallery } from "../components/CharacterSummary";
import { sampleFrame, createFrameSampler, analyzeFrame } from "../analysis/localModel";
import { discoverCharactersAcrossShots, isEligibleForCharacterScan } from "../analysis/characters";
import ReviewFilters from "../components/ReviewFilters";
import { matchesReviewFilter, type ReviewFilter } from "../analysis/review";
import ColorReading from "../components/ColorReading";
import ReportExportModal, { type ReportExportConfig } from "../components/ReportExportModal";
import PrintableReport from "../components/PrintableReport";
import { detectVideoShots, type ScanProgress } from "../analysis/videoScanner";

const shotSizeLabels: Record<Shot["shotSize"], string> = {
  EWS: "Extreme wide shot",
  WS: "Wide shot",
  FS: "Full shot",
  AS: "American shot",
  MS: "Medium shot",
  MCU: "Medium close-up",
  CU: "Close-up",
  ECU: "Extreme close-up",
  MWS: "Medium wide shot",
  Insert: "Insert",
  OTS: "Over the shoulder",
  POV: "Point of view",
  Unknown: "Unknown",
  "Not applicable": "Not applicable",
};

const shotSizeDescriptions: Partial<Record<Shot["shotSize"], string>> = {
  EWS: "Environment dominates; subject tiny or absent",
  WS: "Whole subject with substantial surroundings",
  MWS: "Approximately knees or waist up with surroundings",
  MS: "Approximately waist up",
  MCU: "Approximately chest up",
  CU: "Face or main object fills much of the frame",
  ECU: "Small, isolated detail fills the frame",
  Insert: "Cutaway detail or inanimate object relevant to the scene",
  OTS: "Looking past the shoulder of another person",
  POV: "Scene viewed from character perspective",
  FS: "Person framed head to toe",
  AS: "Person framed approximately knees up",
};

const sizeShortcuts: Record<string, string> = {
  EWS: "1",
  WS: "2",
  MWS: "3",
  MS: "4",
  MCU: "5",
  CU: "6",
  ECU: "7",
  Insert: "8",
  OTS: "9",
  POV: "0",
  Unknown: "U",
};

export type AnalysisStage = "cuts" | "framing" | "characters" | "done";

export interface UnifiedAnalysisProgress {
  stage: AnalysisStage;
  overallPercent: number;
  cutsFound: number;
  currentTime: number;
  totalDuration: number;
  framingDone: number;
  framingTotal: number;
  facesFound: number;
  previewImage?: string;
  previewDescription?: string;
  statusText: string;
  fullPipeline: boolean;
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null),
    [url, setUrl] = useState(""),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [selected, setSelected] = useState<string>(),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [saveState, setSaveState] = useState<"Saving" | "Saved" | "Failed" | "">(""),
    [saved, setSaved] = useState<Project[] | null>(null),
    [edl, setEdl] = useState<{ text: string; name: string } | null>(null),
    [fps, setFps] = useState(24),
    [origin, setOrigin] = useState(""),
    [volume, setVolume] = useState(1),
    [muted, setMuted] = useState(false);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [selectedCut, setSelectedCut] = useState<string>();
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [selectedRange, setSelectedRange] = useState<TimeRange>();
  const [zoom, setZoom] = useState(1);
  const [dropFrame, setDropFrame] = useState(false);
  const [scanningAll, setScanningAll] = useState(false);
  const [scanningShot, setScanningShot] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<string>();
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [deckTab, setDeckTab] = useState<"rhythm" | "sequence" | "inspector" | "cuts" | "cast" | "color">("rhythm");
  const [edlRevision, setEdlRevision] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState<UnifiedAnalysisProgress | null>(null);
  const [isDmeSeparating, setIsDmeSeparating] = useState(false);
  const [dmeSeparationStatus, setDmeSeparationStatus] = useState("");
  const detectAbortRef = useRef<AbortController | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportConfig, setReportConfig] = useState<ReportExportConfig>({
    theme: "ink-saver",
    format: "A4 Landscape",
    sections: {
      summary: true,
      rhythm: true,
      pacing: true,
      framing: true,
      color: true,
      cast: true,
      notes: true,
    },
  });

  const handleExportPDF = (config: ReportExportConfig) => {
    setReportConfig(config);
    let pageStyle = document.getElementById("editmap-print-page-style") as HTMLStyleElement | null;
    if (!pageStyle) {
      pageStyle = document.createElement("style");
      pageStyle.id = "editmap-print-page-style";
      document.head.appendChild(pageStyle);
    }
    const sizeVal =
      config.format === "A4 Portrait"
        ? "A4 portrait"
        : config.format === "Letter"
        ? "letter landscape"
        : "A4 landscape";
    pageStyle.textContent = `@page { size: ${sizeVal}; margin: 10mm; }`;

    requestAnimationFrame(() => {
      window.print();
    });
  };

  const [analyzedFrame, setAnalyzedFrame] = useState<{
    image: string;
    url: string;
  } | null>(null);
  const { frames: thumbnails, colorProfiles } = useThumbnails(
    url,
    project?.shots ?? [],
    playing || scanningAll || scanningShot || Boolean(analysisProgress),
  );

  const appliedColorProfiles = useRef<Set<string>>(new Set());
  useEffect(() => {
    appliedColorProfiles.current.clear();
  }, [project?.id]);

  useEffect(() => {
    if (!project || !Object.keys(colorProfiles).length) return;
    let hasChanges = false;
    const nextShots = project.shots.map((s) => {
      const profile = colorProfiles[s.id];
      if (profile && !appliedColorProfiles.current.has(s.id)) {
        appliedColorProfiles.current.add(s.id);
        hasChanges = true;
        return { ...s, colorProfile: profile };
      }
      return s;
    });
    if (hasChanges) {
      revision.current++;
      setProject((curr) =>
        curr && curr.id === project.id
          ? { ...curr, updatedAt: new Date().toISOString(), shots: nextShots }
          : curr,
      );
      setDirty(true);
    }
  }, [colorProfiles, project?.id]);
  const video = useRef<HTMLVideoElement>(null),
    videoInput = useRef<HTMLInputElement>(null),
    edlInput = useRef<HTMLInputElement>(null),
    backupInput = useRef<HTMLInputElement>(null),
    stopAt = useRef<number | null>(null),
    playbackRange = useRef<{ start: number; end: number; loop: boolean } | null>(null),
    pendingFile = useRef<File | null>(null);
  const scrubTarget = useRef<number | null>(null);
  const lastTimeUpdate = useRef(0);
  const lastActiveShotId = useRef<string | undefined>(undefined);
  const projectRef = useRef<Project | null>(null);
  const revision = useRef(0);
  const saveQueue = useRef(Promise.resolve());
  const mediaGeneration = useRef(0);
  const undoStack = useRef<Project[]>([]);
  const redoStack = useRef<Project[]>([]);
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const current = project ? activeShot(project.shots, time) : undefined,
    shot = project?.shots.find((s) => s.id === selected);
  const reviewMatches = useMemo(
    () => project ? project.shots.filter((candidate) => matchesReviewFilter(candidate, reviewFilter)) : [],
    [project?.shots, reviewFilter],
  );
  const reviewMatchIds = useMemo(() => reviewMatches.map((candidate) => candidate.id), [reviewMatches]);
  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  const commitSave = (snapshot: Project, savedRevision: number) => {
    setSaveState("Saving");
    const write = saveQueue.current.then(() => saveProject(snapshot));
    // Keep subsequent saves usable after a failed IndexedDB transaction.
    saveQueue.current = write.catch(() => undefined);
    return write.then(() => {
      const currentProject = projectRef.current;
      if (currentProject?.id === snapshot.id && revision.current === savedRevision) {
        setDirty(false);
        setSaveState("Saved");
      }
    }, () => {
      if (projectRef.current?.id === snapshot.id) {
        setSaveState("Failed");
        setError("Save failed. Browser storage may be full or unavailable.");
      }
      throw new Error("Save failed.");
    });
  };
  useEffect(() => {
    if (!dirty || !project) return;
    const timer = setTimeout(() => {
      void commitSave(project, revision.current).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [dirty, project]);
  const recordHistory = (snapshot: Project | null) => {
    if (!snapshot) return;
    undoStack.current = [...undoStack.current.slice(-29), snapshot];
    redoStack.current = [];
    setHistoryState({ undo: undoStack.current.length, redo: 0 });
  };
  const update = (patch: Partial<Project>, record = true) => {
    if (record) recordHistory(project);
    revision.current++;
    setProject((p) => p ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p);
    setDirty(true);
    setSaveState("");
  };
  const restoreHistory = (direction: "undo" | "redo") => {
    const from = direction === "undo" ? undoStack.current : redoStack.current;
    const to = direction === "undo" ? redoStack.current : undoStack.current;
    const target = from.pop();
    if (!target || !project) return;
    to.push(project);
    mediaGeneration.current++;
    video.current?.pause();
    revision.current++;
    setProject({ ...target, updatedAt: new Date().toISOString() });
    setDirty(true); setSaveState("");
    setHistoryState({ undo: undoStack.current.length, redo: redoStack.current.length });
    setMessage(`${direction === "undo" ? "Undid" : "Redid"} the last project edit.`);
  };
  const seek = (t: number) => {
    scrubTarget.current = null;
    setAnalyzedFrame(null);
    stopAt.current = null;
    playbackRange.current = null;
    const target = clampSeek(
      t,
      video.current?.duration || project?.duration || 0,
    );
    if (video.current && url) video.current.currentTime = target;
    lastTimeUpdate.current = performance.now();
    setTime(target);
  };
  const scrub = (t: number) => {
    const v = video.current;
    v?.pause();
    stopAt.current = null;
    playbackRange.current = null;
    setAnalyzedFrame(null);
    const target = clampSeek(t, v?.duration || project?.duration || 0);
    lastTimeUpdate.current = performance.now();
    setTime(target);
    setSelected(project ? activeShot(project.shots, target)?.id : undefined);
    if (v && url) {
      scrubTarget.current = target;
      // Finish the current decode, then seek to the newest pointer position.
      if (!v.seeking) v.currentTime = target;
    }
  };
  const toggle = () => {
    const v = video.current;
    if (!v || !url) return;
    if (v.paused) {
      stopAt.current = null;
      playbackRange.current = null;
      void v.play().catch((e) => setError(e.message));
    } else v.pause();
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() !== "z") ||
        e.altKey ||
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        restoreHistory(e.shiftKey ? "redo" : "undo");
        return;
      }
      const size = (
        {
          "1": "EWS",
          "2": "WS",
          "3": "MWS",
          "4": "MS",
          "5": "MCU",
          "6": "CU",
          "7": "ECU",
          "8": "Insert",
          "9": "OTS",
          "0": "POV",
          u: "Unknown",
        } as Record<string, Shot["shotSize"]>
      )[e.key.toLowerCase()];
      if (size && shot) {
        e.preventDefault();
        tagShot(size);
        return;
      }
      if (e.code === "Space" && !(e.target as HTMLElement).closest("button")) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  useEffect(() => {
    if (!playing) return;
    let handle = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        const range = playbackRange.current;
        let pausedBoundary = false;
        if (range && v.currentTime >= range.end) {
          if (range.loop) v.currentTime = range.start;
          else {
            v.pause();
            v.currentTime = range.end;
            playbackRange.current = null;
            pausedBoundary = true;
          }
        } else if (stopAt.current !== null && v.currentTime >= stopAt.current) {
          v.pause();
          v.currentTime = stopAt.current;
          stopAt.current = null;
          pausedBoundary = true;
        }

        const now = performance.now();
        const active = project ? activeShot(project.shots, v.currentTime) : undefined;
        const shotChanged = active?.id !== lastActiveShotId.current;

        if (pausedBoundary || shotChanged || now - lastTimeUpdate.current >= 100) {
          lastTimeUpdate.current = now;
          lastActiveShotId.current = active?.id;
          setTime(v.currentTime);
        }
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, project]);
  useEffect(() => {
    if (video.current) {
      video.current.volume = volume;
      video.current.muted = muted;
    }
  }, [volume, muted, url, project?.id]);
  const selectShot = (s: Shot) => {
    video.current?.pause();
    setSelected(s.id);
    seek(s.startSeconds);
  };
  const previewAnalysis = (s: Shot, time: number, image?: string) => {
    video.current?.pause();
    setSelected(s.id);
    seek(time);
    if (image) setAnalyzedFrame({ image, url });
  };
  const restoreLivePreview = () => {
    const v = video.current;
    if (!v || !url) return;
    const restoreTime = clampSeek(time, v.duration || project?.duration || 0);
    setAnalyzedFrame(null);
    // Sampling uses a separate decoder. Reload the visible one once the pass
    // ends so a rejected seek/play request cannot leave the monitor black.
    const restore = () => { v.currentTime = restoreTime; };
    v.addEventListener("loadeddata", restore, { once: true });
    v.pause();
    v.load();
  };
  const tagShot = (size: Shot["shotSize"]) => {
    if (!project || !shot || shot.content === "Text / title card") return;
    video.current?.pause();
    applyShotPatch(project.id, shot.id, { shotSize: size }, true);
    if (autoAdvance) {
      // Ordinary tagging retains its established end-of-timeline behavior.
      // A review filter deliberately wraps through only its matching set.
      const next = reviewFilter === "all"
        ? project.shots.slice(project.shots.findIndex((candidate) => candidate.id === shot.id) + 1).find((candidate) => candidate.reviewStatus !== "Confirmed")
        : nextReviewShot(shot.id, reviewMatches.filter((candidate) => candidate.id !== shot.id));
      if (next) selectShot(next);
      else setMessage(reviewFilter === "all" ? "Last shot tagged. Review the map or save your project." : "No other matching shots. Review filters wrap when matches remain.");
    }
  };
  const nextReviewShot = (fromId: string | undefined, candidates: Shot[], direction = 1) => {
    if (!candidates.length) return undefined;
    const source = project?.shots ?? [];
    const at = Math.max(0, source.findIndex((candidate) => candidate.id === fromId));
    for (let offset = 1; offset <= source.length; offset++) {
      const candidate = source[(at + direction * offset + source.length * 2) % source.length];
      if (candidates.some((match) => match.id === candidate.id)) return candidate;
    }
    return undefined;
  };
  const navigateReviewMatches = (direction: 1 | -1) => {
    const next = nextReviewShot(selected, reviewMatches, direction);
    if (next) selectShot(next);
  };
  const playShot = (s: Shot) => {
    selectShot(s);
    if (video.current && url) {
      stopAt.current = s.endSeconds;
      void video.current.play().catch((e) => setError(e.message));
    }
  };
  const playCut = (pair: CutPair, lead: number, follow: number, loop: boolean) => {
    const v = video.current;
    if (!v || !url) return;
    const start = Math.max(pair.outgoing.startSeconds, pair.time - lead);
    const end = Math.min(pair.incoming.endSeconds, pair.time + follow);
    stopAt.current = null;
    playbackRange.current = { start, end, loop };
    setSelectedCut(pair.incoming.id);
    setSelected(pair.incoming.id);
    v.currentTime = start;
    setTime(start);
    void v.play().catch((e) => setError(e.message));
  };
  const playRange = (range: TimeRange, loop: boolean) => {
    const v = video.current;
    if (!v || !url) return;
    const start = clampSeek(range.start, project?.duration || 0);
    const end = clampSeek(range.end, project?.duration || 0);
    if (end <= start) return;
    stopAt.current = null;
    playbackRange.current = { start, end, loop };
    v.currentTime = start;
    setTime(start);
    void v.play().catch((e) => setError(e.message));
  };
  const replace = (p: Project) => {
    mediaGeneration.current++;
    scrubTarget.current = null;
    setAnalyzedFrame(null);
    video.current?.pause();
    setProject(p);
    setUrl("");
    setTime(0);
    setPlaying(false);
    setSelected(undefined);
    setSelectedCut(undefined);
    setSelectedRange(undefined);
    setWaveform([]);
    setDirty(false);
    revision.current++;
    setSaveState("");
    setSaved(null);
    setEdl(null);
    undoStack.current = []; redoStack.current = [];
    setHistoryState({ undo: 0, redo: 0 });
    detectAbortRef.current?.abort();
    setAnalysisProgress(null);
    setError("");
    setMessage(
      p.videoMetadata
        ? "Relink the original video to resume playback."
        : "Project ready. Import a film to auto-detect shots, or import an EDL.",
    );
  };
  const open = async () => {
    try {
      setSaved(await listProjects());
    } catch {
      setError(
        "Local projects could not be opened. Check browser storage permissions.",
      );
    }
  };
  const save = async () => {
    if (!project) return;
    try {
      await commitSave(project, revision.current);
      setMessage("Project saved on this browser.");
      setError("");
    } catch { /* commitSave reports a visible failure */ }
  };
  const exportProject = () => {
    if (!project) return;
    const blob = new Blob([JSON.stringify(makeBackup(project), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${project.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "editmap-project"}.editmap.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage("Project backup exported. Relink the original video after restoring it.");
  };
  const importBackup = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) { setError(`Backup is too large (limit ${Math.round(MAX_BACKUP_BYTES / 1024 / 1024)} MB).`); return; }
    try {
      const restored = parseBackup(await file.text());
      const now = new Date().toISOString();
      replace({ ...restored, id: crypto.randomUUID(), createdAt: now, updatedAt: now });
      setMessage(`Restored “${restored.name}” as a new project. Relink the original video to resume playback.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import this backup."); }
  };
  const openVideoPicker = () => {
    const input = videoInput.current;
    if (!input) {
      setError("Video picker is not ready. Please try again.");
      return;
    }
    // Chrome's native picker is more reliable than a synthetic input click,
    // especially when the input is visually hidden in the app shell.
    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.click();
    } catch {
      input.click();
    }
  };
  const loadVideo = async (file?: File) => {
    if (!file) return;
    const candidate = await new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
      const probe = document.createElement("video"); const probeUrl = URL.createObjectURL(file);
      probe.preload = "metadata";
      probe.onloadedmetadata = () => { const metadata = { duration: probe.duration, width: probe.videoWidth, height: probe.videoHeight }; URL.revokeObjectURL(probeUrl); resolve(metadata); };
      probe.onerror = () => { URL.revokeObjectURL(probeUrl); reject(new Error("This video could not be inspected.")); };
      probe.src = probeUrl;
    }).catch((cause) => { setError(cause instanceof Error ? cause.message : "This video could not be inspected."); return null; });
    if (!candidate) return;
    const expected = project?.videoMetadata;
    const mismatch = expected && (Math.abs(expected.duration - candidate.duration) > 1 / actualRate(project.frameRate) || expected.width !== candidate.width || expected.height !== candidate.height || expected.size !== file.size);
    if (mismatch && !confirm(`This file differs from the expected video.\nExpected: ${expected.filename}, ${expected.width}×${expected.height}, ${expected.duration.toFixed(2)}s, ${expected.size} bytes\nCandidate: ${file.name}, ${candidate.width}×${candidate.height}, ${candidate.duration.toFixed(2)}s, ${file.size} bytes\n\nUse this video anyway?`)) return;
    mediaGeneration.current++;
    const oldUrl = url;
    scrubTarget.current = null;
    setAnalyzedFrame(null);
    pendingFile.current = file;
    video.current?.pause();
    setTime(0);
    stopAt.current = null;
    setUrl(URL.createObjectURL(file));
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    setWaveform([]);
    const generation = mediaGeneration.current;
    void analyzeLocalAudio(file).then((next) => { if (generation === mediaGeneration.current) setWaveform(next); }).catch(() => {
      setMessage("Video connected. Waveform could not be decoded in this browser; manual sound spans remain available.");
    });
    setError("");
  };

  const handleSeparateDme = async () => {
    const file = pendingFile.current;
    if (!file) {
      setError("Please connect a video file first to separate DME stems.");
      return;
    }
    setIsDmeSeparating(true);
    setDmeSeparationStatus("Starting local Demucs engine...");
    try {
      const dme = await separateDmeAudio(file, 1400, (msg) => {
        setDmeSeparationStatus(msg);
      });
      update({ dmeWaveforms: dme });
      setMessage("DME separation complete! Dialogue, Music, and Effects stems loaded.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`DME separation error: ${msg}`);
    } finally {
      setIsDmeSeparating(false);
      setDmeSeparationStatus("");
    }
  };

  const importEDL = () => {
    if (!project || !edl) return;
    try {
      const result = parseEDL(edl.text, fps, origin || undefined);
      const replacing = project.shots.length > 0;
      if (replacing && !confirm(`Replace the current ${project.shots.length}-shot timeline with ${result.shots.length} shots? This is undoable. Only annotations on exact source/timing matches are retained.`)) return;
      const oldByIdentity = new Map(project.shots.map((s) => [`${s.sourceReel}|${s.sourceIn}|${s.sourceOut}|${s.startTimecode}|${s.endTimecode}`, s]));
      const oldToNew = new Map<string, string>();
      const matchedShots = result.shots.map((candidate) => {
        const old = oldByIdentity.get(`${candidate.sourceReel}|${candidate.sourceIn}|${candidate.sourceOut}|${candidate.startTimecode}|${candidate.endTimecode}`);
        if (!old || project.frameRate !== fps || project.recordOrigin !== result.recordOrigin) return candidate;
        oldToNew.set(old.id, candidate.id);
        return { ...candidate, shotSize: old.shotSize, notes: old.notes, reviewStatus: old.reviewStatus, protectedFields: old.protectedFields, composition: old.composition, content: old.content, uncertain: old.uncertain, suggestion: old.suggestion, characterAnalysis: old.characterAnalysis };
      });
      const cutAnnotations = (project.cutAnnotations ?? []).flatMap((cut) => {
        const outgoingId = oldToNew.get(cut.outgoingId), incomingId = oldToNew.get(cut.incomingId);
        return outgoingId && incomingId ? [{ ...cut, outgoingId, incomingId }] : [];
      });
      const cast = (project.cast ?? []).map((member) => ({ ...member, references: member.references.flatMap((ref) => {
        const shotId = oldToNew.get(ref.shotId); return shotId ? [{ ...ref, shotId }] : [];
      }) }));
      const duration = Math.max(result.duration, project.videoMetadata?.duration || 0);
      const sequences = (project.sequences ?? []).filter((s) => s.startSeconds >= 0 && s.endSeconds <= duration);
      const soundSpans = (project.soundSpans ?? []).filter((s) => s.startSeconds >= 0 && s.endSeconds <= duration);
      setEdlRevision((revision) => revision + 1);
      update({
        ...result,
        shots: matchedShots, cutAnnotations, cast, sequences, soundSpans,
        frameRate: fps,
        duration: Math.max(
          result.duration,
          project.videoMetadata?.duration || 0,
        ),
      });
      setSelected(undefined);
      setSelectedCut(undefined);
      setSelectedRange(undefined);
      seek(0);
      setEdl(null);
      setError("");
      setMessage(
        `Imported ${result.shots.length} shots. Timeline starts at ${result.recordOrigin}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const startUnifiedAnalysis = async (videoUrl = url, fullPipeline = true) => {
    if (!project || !videoUrl) return;
    const abort = new AbortController();
    detectAbortRef.current = abort;

    const totalDur = project.duration || video.current?.duration || 1;
    setAnalysisProgress({
      stage: "cuts",
      overallPercent: 0,
      cutsFound: 0,
      currentTime: 0,
      totalDuration: totalDur,
      framingDone: 0,
      framingTotal: 0,
      facesFound: 0,
      statusText: "Detecting scene cuts...",
      fullPipeline,
    });

    try {
      // -------------------------------------------------------------
      // STAGE 1: CUT DETECTION
      // -------------------------------------------------------------
      const detectedShots = await detectVideoShots(videoUrl, {
        fps: project.frameRate || 24,
        dropFrame: project.dropFrame,
        signal: abort.signal,
        onProgress: (p) => {
          setAnalysisProgress((prev) => prev ? {
            ...prev,
            cutsFound: p.shotsCount,
            currentTime: p.currentTime,
            overallPercent: fullPipeline ? Math.round(p.percent * 0.3) : Math.round(p.percent),
            statusText: `Scanning cuts · ${p.shotsCount} shots found (${Math.round(p.percent)}%)`,
          } : prev);
        },
      });

      if (abort.signal.aborted) return;
      if (detectedShots.length === 0) {
        setMessage("No cuts detected. Ensure the video plays properly.");
        return;
      }

      const maxDur = Math.max(
        ...detectedShots.map((s) => s.endSeconds),
        project.duration,
        project.videoMetadata?.duration || 0,
      );

      // If user chose ONLY cut detection, finish here
      if (!fullPipeline) {
        recordHistory(project);
        revision.current++;
        setProject((curr) => curr ? {
          ...curr,
          shots: detectedShots,
          duration: maxDur,
          updatedAt: new Date().toISOString(),
        } : curr);
        setEdlRevision((rev) => rev + 1);
        setDirty(true);
        setSelected(undefined);
        setSelectedCut(undefined);
        setSelectedRange(undefined);
        seek(0);
        setError("");
        setMessage(`Auto-detected ${detectedShots.length} shots across the film.`);
        return;
      }

      // -------------------------------------------------------------
      // STAGE 2: FRAMING & PEOPLE SCAN
      // -------------------------------------------------------------
      setAnalysisProgress((prev) => prev ? {
        ...prev,
        stage: "framing",
        cutsFound: detectedShots.length,
        framingDone: 0,
        framingTotal: detectedShots.length,
        overallPercent: 30,
        statusText: `Analyzing framing across ${detectedShots.length} shots...`,
      } : prev);

      const sampler = await createFrameSampler(videoUrl, abort.signal);
      let updatedShots = [...detectedShots];

      for (let i = 0; i < detectedShots.length; i++) {
        if (abort.signal.aborted) break;
        const currentShot = detectedShots[i];
        const midpointTime = (currentShot.startSeconds + currentShot.endSeconds) / 2;

        try {
          const image = await sampler.sample(midpointTime);
          if (abort.signal.aborted) break;

          const tags = await analyzeFrame(image, abort.signal);
          if (abort.signal.aborted) break;

          updatedShots[i] = {
            ...currentShot,
            ...tags,
            reviewStatus: "Needs review",
          };

          const framingPercent = Math.round(((i + 1) / detectedShots.length) * 100);
          const overallP = 30 + Math.round((framingPercent * 0.35));

          setAnalysisProgress((prev) => prev ? {
            ...prev,
            framingDone: i + 1,
            overallPercent: overallP,
            previewImage: image,
            previewDescription: `Shot ${i + 1}: ${tags.shotSize} · ${tags.composition}`,
            statusText: `Analyzing framing · ${i + 1} of ${detectedShots.length} shots (${framingPercent}%)`,
          } : prev);
        } catch (e) {
          if (abort.signal.aborted) break;
          console.warn(`Framing scan failed for shot ${i + 1}:`, e);
        }
      }

      if (abort.signal.aborted) {
        sampler.dispose();
        return;
      }

      // -------------------------------------------------------------
      // STAGE 3: CHARACTER DISCOVERY & CLUSTERING
      // -------------------------------------------------------------
      const peopleShots = updatedShots.filter(isEligibleForCharacterScan);
      setAnalysisProgress((prev) => prev ? {
        ...prev,
        stage: "characters",
        overallPercent: 65,
        statusText: `Discovering characters across ${peopleShots.length} shots with people...`,
      } : prev);

      let newCast: CastMember[] = [];
      let newAnalyses = new Map<string, CharacterAnalysis>();

      if (peopleShots.length > 0) {
        const autoResult = await discoverCharactersAcrossShots(
          updatedShots,
          sampler,
          abort.signal,
          {
            similarityThreshold: 0.50,
            minAppearances: 1,
            onProgress: (p) => {
              const charPercent = Math.round((p.completedShots / p.totalShots) * 100);
              const overallP = 65 + Math.round((charPercent * 0.35));
              setAnalysisProgress((prev) => prev ? {
                ...prev,
                overallPercent: Math.min(99, overallP),
                facesFound: p.facesFound,
                statusText: p.stage === "sampling"
                  ? `Scanning faces · ${p.completedShots}/${p.totalShots} shots (${p.facesFound} faces found)`
                  : `Clustering ${p.facesFound} faces into characters...`,
              } : prev);
            },
            onFrame: (shot, time, img) => {
              setAnalysisProgress((prev) => prev ? {
                ...prev,
                previewImage: img,
                previewDescription: `Shot ${shot.index} (${formatTimecode(time, project.frameRate, project.dropFrame)}): detecting cast`,
              } : prev);
            },
          }
        );

        if (abort.signal.aborted) {
          sampler.dispose();
          return;
        }

        newCast = autoResult.cast;
        newAnalyses = autoResult.shotAnalyses;
      }

      sampler.dispose();

      // Final Assembly & Commit
      const finalShots = updatedShots.map((s) => {
        const charAnalysis = newAnalyses.get(s.id);
        return charAnalysis ? { ...s, characterAnalysis: charAnalysis } : s;
      });

      recordHistory(project);
      revision.current++;
      setProject((curr) => curr ? {
        ...curr,
        shots: finalShots,
        cast: newCast.length > 0 ? newCast : curr.cast,
        duration: maxDur,
        updatedAt: new Date().toISOString(),
      } : curr);

      setEdlRevision((rev) => rev + 1);
      setDirty(true);
      setSelected(undefined);
      setSelectedCut(undefined);
      setSelectedRange(undefined);
      setDeckTab("cast"); // Automatically open Cast gallery
      seek(0);
      setError("");

      setAnalysisProgress((prev) => prev ? {
        ...prev,
        stage: "done",
        overallPercent: 100,
        statusText: `Complete! ${finalShots.length} shots analyzed, ${newCast.length} characters discovered.`,
      } : prev);

      await new Promise((resolve) => setTimeout(resolve, 1200));
      setMessage(`Analysis complete: ${finalShots.length} shots tagged, ${newCast.length} characters ready for renaming in the Cast Gallery.`);

    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessage("Analysis cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Analysis failed.");
      }
    } finally {
      setAnalysisProgress(null);
      detectAbortRef.current = null;
    }
  };
  const startSceneDetection = (videoUrl = url) => startUnifiedAnalysis(videoUrl, false);
  const applyShotPatch = (projectId: string, shotId: string, patch: Partial<Shot>, human = false) => {
    if (human) recordHistory(project);
    revision.current++;
    setProject((currentProject) => {
      if (!currentProject || currentProject.id !== projectId) return currentProject;
      return {
        ...currentProject,
        updatedAt: new Date().toISOString(),
        shots: currentProject.shots.map((item) => {
          if (item.id !== shotId) return item;
          const protectedFields = human
            ? [...new Set([...(item.protectedFields ?? []), ...(["shotSize", "composition", "content", "uncertain", "notes"] as const).filter((field) => field in patch)])]
            : item.protectedFields;
          const safePatch = human ? patch : Object.fromEntries(Object.entries(patch).filter(([field]) =>
            field === "suggestion" ||
            (field === "reviewStatus" ? item.reviewStatus !== "Confirmed" : !item.protectedFields?.includes(field as "shotSize")),
          )) as Partial<Shot>;
          return updateShotTags(item, { ...safePatch, protectedFields });
        }),
      };
    });
    setDirty(true);
    setSaveState("");
  };
  const editShot = (patch: Partial<Shot>) => {
    if (project && shot) applyShotPatch(project.id, shot.id, patch, true);
  };
  const addCastMember = (name: string) => {
    if (!project) return;
    update({ cast: [...(project.cast ?? []), { id: crypto.randomUUID(), name, references: [] }] });
  };
  const addCastReference = async (memberId: string) => {
    if (!project || !shot || !url) return;
    try {
      const time = (shot.startSeconds + shot.endSeconds) / 2;
      const image = await sampleFrame(url, time, new AbortController().signal);
      recordHistory(project);
      setProject((currentProject) => currentProject && currentProject.id === project.id ? {
        ...currentProject, updatedAt: new Date().toISOString(),
        cast: (currentProject.cast ?? []).map((member) => member.id === memberId ? { ...member, references: [...member.references, { id: crypto.randomUUID(), image, shotId: shot.id, time }] } : member),
      } : currentProject);
      setDirty(true);
      previewAnalysis(shot, time, image);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this reference frame.");
    }
  };
  const removeCastMember = (memberId: string) => {
    if (!project) return;
    update({ cast: (project.cast ?? []).filter((member) => member.id !== memberId), shots: project.shots.map((item) => item.characterAnalysis ? { ...item, characterAnalysis: { ...item.characterAnalysis, intervals: item.characterAnalysis.intervals.filter((interval) => interval.memberId !== memberId), manualMemberIds: item.characterAnalysis.manualMemberIds?.filter((id) => id !== memberId) } } : item) });
    if (selectedCharacter === memberId) setSelectedCharacter(undefined);
  };
  const renameCastMember = (memberId: string, newName: string) => {
    if (!project) return;
    recordHistory(project);
    update({
      cast: (project.cast ?? []).map((member) =>
        member.id === memberId ? { ...member, name: newName } : member,
      ),
    });
  };
  const mergeCastMembers = (sourceMemberId: string, targetMemberId: string) => {
    if (!project || sourceMemberId === targetMemberId) return;
    const sourceMember = project.cast?.find((m) => m.id === sourceMemberId);
    const targetMember = project.cast?.find((m) => m.id === targetMemberId);
    if (!sourceMember || !targetMember) return;

    recordHistory(project);
    const mergedReferences = [...targetMember.references, ...sourceMember.references];

    update({
      cast: (project.cast ?? [])
        .filter((m) => m.id !== sourceMemberId)
        .map((m) =>
          m.id === targetMemberId ? { ...m, references: mergedReferences } : m,
        ),
      shots: project.shots.map((item) => {
        if (!item.characterAnalysis) return item;
        const intervals = item.characterAnalysis.intervals.map((int) =>
          int.memberId === sourceMemberId ? { ...int, memberId: targetMemberId } : int,
        );
        const manualMemberIds = item.characterAnalysis.manualMemberIds?.map((id) =>
          id === sourceMemberId ? targetMemberId : id,
        );
        return {
          ...item,
          characterAnalysis: {
            ...item.characterAnalysis,
            intervals,
            manualMemberIds: manualMemberIds ? [...new Set(manualMemberIds)] : undefined,
          },
        };
      }),
    });
    if (selectedCharacter === sourceMemberId) setSelectedCharacter(targetMemberId);
  };
  const confirmCharacterShot = (shotId: string) => {
    if (!project) return;
    update({ shots: project.shots.map((item) => item.id === shotId && item.characterAnalysis ? { ...item, characterAnalysis: { ...item.characterAnalysis, reviewStatus: "Confirmed", intervals: item.characterAnalysis.intervals.map((interval) => ({ ...interval, reviewStatus: "Confirmed" })) } } : item) });
  };
  const removeCharacterAppearance = (shotId: string, memberId: string) => {
    if (!project) return;
    update({ shots: project.shots.map((item) => item.id === shotId && item.characterAnalysis ? { ...item, characterAnalysis: { ...item.characterAnalysis, reviewStatus: "Confirmed", intervals: item.characterAnalysis.intervals.filter((interval) => interval.memberId !== memberId) } } : item) });
  };
  const reviewCharactersInShot = (shotId: string, memberIds: string[]) => {
    if (!project) return;
    update({ shots: project.shots.map((item) => item.id === shotId ? {
      ...item,
      characterAnalysis: {
        ...(item.characterAnalysis ?? { intervals: [], unresolvedTimes: [], sampleTimes: [], reviewStatus: "Needs review" as const, model: "Manual review", createdAt: new Date().toISOString() }),
        manualMemberIds: memberIds,
        manualReviewStatus: "Confirmed" as const,
      },
    } : item) });
  };
  return (
    <div className="app">
      <header>
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">▥</span>EDITMAP
        </a>
        <span className="header-divider" />
        {project && (
          <div className="header-project">
            <input
              aria-label="Project name"
              value={project.name}
              onChange={(e) => update({ name: e.target.value })}
            />
            <span>{dirty ? "Unsaved changes" : "Local project"}</span>
          </div>
        )}
        <button
          onClick={() => {
            if (
              !dirty ||
              confirm("Discard unsaved changes and create a project?")
            )
              replace(newProject());
          }}
        >
          New
        </button>
        <button onClick={() => void open()}>Open</button>
        <button disabled={!project} onClick={() => void save()}>
          Save{dirty ? " •" : ""}
        </button>
        <button disabled={!project} onClick={() => restoreHistory("undo")} title="Undo (Ctrl/Cmd+Z)">
          Undo{historyState.undo ? ` (${historyState.undo})` : ""}
        </button>
        <button disabled={!project || !historyState.redo} onClick={() => restoreHistory("redo")} title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button>
        <button disabled={!project} onClick={exportProject}>Export project</button>
        <button disabled={!project} onClick={() => setReportModalOpen(true)}>Export PDF Report</button>
        <button disabled={!project} onClick={() => backupInput.current?.click()}>Import project</button>
        <div className="header-spacer" />
        {project ? (
          <label className="file-picker-button">
            <span>Import video</span>
            <input
              ref={videoInput}
              type="file"
              accept="video/*,.mkv,.mov"
              aria-label="Import video"
              onChange={(e) => {
                void loadVideo(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        ) : (
          <button disabled>Import video</button>
        )}
        <button
          disabled={!project || !url || Boolean(analysisProgress)}
          onClick={() => {
            if (!project) return;
            if (
              !project.shots.length ||
              confirm(
                `Re-analyze film? This will replace the existing ${project.shots.length} shots.`,
              )
            ) {
              void startUnifiedAnalysis(url, true);
            }
          }}
          title={
            url
              ? "Analyze entire film: Scene Cuts, Framing & Character Discovery"
              : "Link a video first"
          }
        >
          {analysisProgress ? "Analyzing film…" : "Analyze film"}
        </button>
        <button disabled={!project} onClick={() => edlInput.current?.click()}>
          Import EDL
        </button>
      </header>
      <input hidden ref={backupInput} type="file" accept="application/json,.json,.editmap.json" onChange={(e) => { void importBackup(e.target.files?.[0]); e.target.value = ""; }} />
      <input
        hidden
        ref={edlInput}
        type="file"
        accept=".edl,.txt"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) {
            try {
              const text = await f.text();
              const isDrop =
                /FCM:\s*DROP FRAME/i.test(text) ||
                /\d{2}:\d{2}:\d{2};\d{2}/.test(text);
              setEdl({ text, name: f.name });
              setFps(isDrop ? 29.97 : project?.frameRate || 24);
              setOrigin("");
              setError("");
            } catch {
              setError("Could not read this EDL file.");
            }
          }
        }}
      />
      {saved && (
        <div className="open-panel panel">
          <div className="section-head">
            <b>Saved projects</b>
            <button onClick={() => setSaved(null)}>Close</button>
          </div>
          {!saved.length ? (
            <p>No saved projects in this browser yet.</p>
          ) : (
            saved.map((p) => (
              <button
                className="saved-project"
                key={p.id}
                onClick={() => {
                  if (
                    !dirty ||
                    confirm("Discard unsaved changes and open this project?")
                  )
                    replace(p);
                }}
              >
                <b>{p.name}</b>
                <span>
                  {p.shots.length} shots ·{" "}
                  {new Date(p.updatedAt).toLocaleString()}
                </span>
              </button>
            ))
          )}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {!project ? (
        <main className="start">
          <div className="start-mark">▥</div>
          <h1>EDITMAP</h1>
          <p>SEE THE STRUCTURE OF EDITING.</p>
          <button className="primary" onClick={() => replace(newProject())}>
            New project
          </button>
          <small>Film → Automatic Scene Detection & Editing Map</small>
        </main>
      ) : (
        <main className="workspace studio-workbench">
          <div className="project-title">
            <span className="mono muted">
              {project.frameRate} FPS <span className="slash">/</span>{" "}
              {project.shots.length} SHOTS <span className="slash">/</span>{" "}
              {formatTimecode(
                project.duration,
                project.frameRate,
                project.dropFrame,
              )}
            </span>
          </div>
          {project.shots.length === 0 && url && !analysisProgress && (
            <section className="import-panel panel scene-detect-prompt">
              <div>
                <b>Film connected: {project.videoMetadata?.filename || "Video ready"}</b>
                <small>
                  Timeline has no shots yet. Analyze the film automatically (Cuts → Framing → Character Discovery), or import an EDL file.
                </small>
              </div>
              <div className="import-actions">
                <button className="primary primary-hero" onClick={() => void startUnifiedAnalysis(url, true)}>
                  ✨ Analyze Film (Cuts + Framing + Cast)
                </button>
                <button onClick={() => void startUnifiedAnalysis(url, false)}>
                  Only detect cuts
                </button>
                <button onClick={() => edlInput.current?.click()}>
                  Import EDL
                </button>
              </div>
            </section>
          )}
          {edl && (
            <section className="import-panel panel">
              <div>
                <b>{edl.name}</b>
                <small>
                  Confirm timebase before importing. Video events use record
                  in/out.
                </small>
                {project.shots.length > 0 && <small>Replacing {project.shots.length} existing shots. Exact source/timing matches retain their annotations; other timeline-bound annotations are removed.</small>}
              </div>
              <label>
                Frame rate
                <select
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                >
                  {rates.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <details className="import-advanced">
                <summary>Advanced</summary>
                <label>
                  Timeline start timecode
                  <input
                    placeholder="Leave blank to use first record-in"
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                  />
                </label>
                <small>
                  Use only when the film starts later than the first EDL
                  record-in.
                </small>
              </details>
              <div className="import-actions">
                <button className="primary" onClick={importEDL}>
                  Import
                </button>
                <button onClick={() => setEdl(null)}>Cancel</button>
              </div>
            </section>
          )}

          {/* TOP STAGE: Analytical Scopes & Deck (LEFT) + Program Film Monitor (RIGHT) */}
          <div className="top-stage">
            
            {/* LEFT: Analytical Deck */}
            <div className="analytical-deck panel">
              <div className="deck-tabs" role="tablist" aria-label="Studio analytical tools">
                <button
                  role="tab"
                  aria-selected={deckTab === "rhythm"}
                  className={deckTab === "rhythm" ? "active" : ""}
                  onClick={() => setDeckTab("rhythm")}
                >
                  Rhythm & Pacing
                </button>
                <button
                  role="tab"
                  aria-selected={deckTab === "sequence"}
                  className={deckTab === "sequence" ? "active" : ""}
                  onClick={() => setDeckTab("sequence")}
                >
                  Sequence Reading
                </button>
                <button
                  role="tab"
                  aria-selected={deckTab === "inspector"}
                  className={deckTab === "inspector" ? "active" : ""}
                  onClick={() => setDeckTab("inspector")}
                >
                  Shot Inspector
                </button>
                <button
                  role="tab"
                  aria-selected={deckTab === "cuts"}
                  className={deckTab === "cuts" ? "active" : ""}
                  onClick={() => setDeckTab("cuts")}
                >
                  Cut Reading
                </button>
                <button
                  role="tab"
                  aria-selected={deckTab === "cast"}
                  className={deckTab === "cast" ? "active" : ""}
                  onClick={() => setDeckTab("cast")}
                >
                  Cast & AI
                </button>
                <button
                  role="tab"
                  aria-selected={deckTab === "color"}
                  className={deckTab === "color" ? "active" : ""}
                  onClick={() => setDeckTab("color")}
                >
                  Color Reading
                </button>
              </div>

              <div className="deck-pane">
                <div hidden={deckTab !== "rhythm"}>
                  <EditingRhythm
                    project={project}
                    time={time}
                    waveform={waveform}
                    selected={selected}
                    onSelect={selectShot}
                    onSeek={seek}
                  />
                </div>

                <div hidden={deckTab !== "sequence"}>
                  <SequenceReading
                    project={project}
                    range={selectedRange}
                    onRangeChange={setSelectedRange}
                    onSeek={seek}
                    onUpdate={(sequences) => update({ sequences })}
                  />
                </div>

                <div hidden={deckTab !== "inspector"}>
                  <aside className="inspector panel-inner">
                    <div className="section-head">
                      <span className="eyebrow">SHOT INSPECTOR</span>
                      <span
                        className={`review-status ${shot?.reviewStatus === "Confirmed" ? "confirmed" : ""}`}
                      >
                        {shot
                          ? shot.reviewStatus === "Confirmed"
                            ? "CONFIRMED"
                            : "NEEDS REVIEW"
                          : "—"}
                      </span>
                    </div>
                    {shot ? (
                      <>
                        <div className="shot-title">
                          <h2>Shot {String(shot.index).padStart(3, "0")}</h2>
                          <span>
                            {shot.sourceReel} / {shot.transition}
                          </span>
                        </div>
                        <dl>
                          <div>
                            <dt>Record in</dt>
                            <dd>{shot.startTimecode}</dd>
                          </div>
                          <div>
                            <dt>Record out</dt>
                            <dd>{shot.endTimecode}</dd>
                          </div>
                          <div>
                            <dt>Duration</dt>
                            <dd>{shot.duration.toFixed(3)} sec</dd>
                          </div>
                        </dl>
                        {shot.colorProfile && (
                          <div className="shot-color-profile">
                            <div className="color-badge">
                              <span className="mood-tag">{shot.colorProfile.mood}</span>
                              <span className="luma-tag">{Math.round(shot.colorProfile.luminance * 100)}% Luma</span>
                            </div>
                            <div className="color-swatches" aria-label="Dominant color palette">
                              {shot.colorProfile.palette.map((hex, idx) => (
                                <button
                                  key={idx}
                                  className="color-swatch-chip"
                                  style={{ backgroundColor: hex }}
                                  title={`Click to copy ${hex}`}
                                  onClick={() => {
                                    navigator.clipboard.writeText(hex);
                                    setMessage(`Copied ${hex} to clipboard`);
                                  }}
                                >
                                  <span className="swatch-hex">{hex}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <label>
                          Shot size
                          <select
                            aria-label="Shot size"
                            title={shotSizeDescriptions[shot.shotSize]}
                            disabled={shot.content === "Text / title card"}
                            value={shot.shotSize}
                            onChange={(e) =>
                              editShot({
                                shotSize: e.target.value as Shot["shotSize"],
                              })
                            }
                          >
                            {[
                              ...selectableShotSizes,
                              "Not applicable",
                              ...(["FS", "AS"].includes(shot.shotSize)
                                ? [shot.shotSize]
                                : []),
                            ].map((s) => (
                              <option
                                key={s}
                                value={s}
                                title={shotSizeDescriptions[s as Shot["shotSize"]]}
                              >
                                {s === "Unknown" || s === "Not applicable"
                                  ? s
                                  : `${s} — ${shotSizeLabels[s as Shot["shotSize"]]}`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="tag-fields">
                          <label>
                            People in frame
                            <select
                              aria-label="People in frame"
                              title="Count featured people; ignore incidental background figures."
                              value={shot.composition ?? "Unknown"}
                              onChange={(e) =>
                                editShot({
                                  composition: e.target.value as Shot["composition"],
                                })
                              }
                            >
                              {Object.entries(peopleLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Main subject
                            <select
                              aria-label="Main subject"
                              title="What is primarily shown? Text / graphics means a title or graphic fills the image, not subtitles over footage."
                              value={shot.content ?? "Unknown"}
                              onChange={(e) =>
                                editShot({
                                  content: e.target.value as Shot["content"],
                                })
                              }
                            >
                              {Object.entries(subjectLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label className="uncertain-field">
                          <input
                            type="checkbox"
                            checked={shot.uncertain ?? false}
                            onChange={(e) =>
                              editShot({ uncertain: e.target.checked })
                            }
                          />{" "}
                          Shot size uncertain
                        </label>
                        {shot.content === "Text / title card" && (
                          <p className="tag-help">
                            Full-frame text / graphics have no shot size. Changing the
                            main subject resets size to Unknown.
                          </p>
                        )}
                        <fieldset className="character-review">
                          <legend>Characters</legend>
                          {!project.cast?.length ? <p className="tag-help">Add characters in the cast gallery to review this shot manually.</p> : <>
                            <div className="character-checks">
                              {project.cast.map((member) => {
                                const selectedIds = shot.characterAnalysis?.manualMemberIds ?? [...new Set(shot.characterAnalysis?.intervals.map((interval) => interval.memberId) ?? [])];
                                return <label key={member.id}><input type="checkbox" checked={selectedIds.includes(member.id)} onChange={(event) => reviewCharactersInShot(shot.id, event.target.checked ? [...selectedIds, member.id] : selectedIds.filter((id) => id !== member.id))} /> {member.name}</label>;
                              })}
                            </div>
                            <p className="tag-help">{shot.characterAnalysis?.manualReviewStatus === "Confirmed" ? (shot.characterAnalysis.manualMemberIds?.length ? "Confirmed manual shot assignment. It does not create screen-time boundaries." : "Confirmed: no characters in this shot.") : "Suggestions remain editable. Checking a name confirms a shot-level assignment; clear every name to confirm no characters."}</p>
                          </>}
                        </fieldset>
                        {["FS", "AS"].includes(shot.shotSize) && (
                          <p className="tag-help">
                            Legacy tag preserved. Choose an active framing size
                            independently of the main subject or people in frame.
                          </p>
                        )}
                        <label>
                          Notes
                          <textarea
                            placeholder="Add an editing note…"
                            value={shot.notes}
                            onChange={(e) => editShot({ notes: e.target.value })}
                          />
                        </label>
                        <ShotAnalysis
                          key={`${project.id}-${shot.id}-${url}`}
                          shot={shot}
                          url={url}
                          disabled={scanningAll}
                          onBusyChange={setScanningShot}
                          onPreview={previewAnalysis}
                          onUpdate={(patch) => applyShotPatch(project.id, shot.id, patch)}
                          onFailure={(failure) => applyShotPatch(project.id, shot.id, { analysisFailures: { framing: { message: failure, createdAt: new Date().toISOString() } } })}
                          onNext={() => {
                            const next = nextReviewShot(shot.id, reviewFilter === "all" ? project.shots.filter((s) => s.reviewStatus !== "Confirmed" && s.id !== shot.id) : reviewMatches.filter((s) => s.id !== shot.id));
                            if (next) selectShot(next);
                            else setMessage(reviewFilter === "all" ? "No other unreviewed shots." : "No other matching shots.");
                          }}
                        />
                      </>
                    ) : (
                      <div className="inspector-empty">
                        Select a shot on the map
                        <br />
                        to inspect and annotate it.
                      </div>
                    )}
                  </aside>
                </div>

                <div hidden={deckTab !== "cuts"}>
                  <CutReading
                    project={project}
                    incomingId={selectedCut}
                    url={url}
                    onSeek={seek}
                    onPlay={playCut}
                    onUpdate={(cutAnnotations) => update({ cutAnnotations })}
                  />
                </div>

                <div hidden={deckTab !== "cast"}>
                  <AllShotsAnalysis
                    key={`${project.id}-${url}-${edlRevision}`}
                    shots={project.shots}
                    url={url}
                    disabled={scanningShot}
                    onBusyChange={setScanningAll}
                    onPreview={previewAnalysis}
                    cast={project.cast}
                    onResult={(id, tags) => applyShotPatch(project.id, id, {
                      ...tags,
                      analysisFailures: undefined,
                      suggestion: { ...tags, model: "qwen3-vl:4b", createdAt: new Date().toISOString() },
                      reviewStatus: "Needs review",
                    })}
                    onFramingFailure={(id, failure) => applyShotPatch(project.id, id, { analysisFailures: { framing: { message: failure, createdAt: new Date().toISOString() } } })}
                    onCharacterResult={(id, characterAnalysis) => {
                      revision.current++;
                      setProject((p) => p && p.id === project.id ? {
                        ...p, updatedAt: new Date().toISOString(),
                        shots: p.shots.map((s) => s.id === id ? s.characterAnalysis?.reviewStatus === "Confirmed" || s.characterAnalysis?.manualReviewStatus === "Confirmed" ? s : { ...s, characterAnalysis } : s),
                      } : p);
                      setDirty(true);
                      setSaveState("");
                    }}
                    onAutoDiscoverComplete={(newCast, shotAnalyses) => {
                      recordHistory(project);
                      revision.current++;
                      setProject((p) => p && p.id === project.id ? {
                        ...p,
                        updatedAt: new Date().toISOString(),
                        cast: newCast,
                        shots: p.shots.map((s) => {
                          const analysis = shotAnalyses.get(s.id);
                          if (analysis) {
                            return s.characterAnalysis?.reviewStatus === "Confirmed" || s.characterAnalysis?.manualReviewStatus === "Confirmed"
                              ? s
                              : { ...s, characterAnalysis: analysis };
                          }
                          return s;
                        }),
                      } : p);
                      setDirty(true);
                      setSaveState("");
                    }}
                    onComplete={restoreLivePreview}
                  />
                  <CastGallery
                    cast={project.cast ?? []}
                    shot={shot}
                    disabled={scanningAll || scanningShot || !url}
                    onAdd={addCastMember}
                    onReference={addCastReference}
                    onRemove={removeCastMember}
                    onRename={renameCastMember}
                    onMerge={mergeCastMembers}
                  />
                  <CharacterSummary project={project} range={selectedRange} selectedMember={selectedCharacter} onSelect={setSelectedCharacter} onInspect={selectShot} onConfirmShot={confirmCharacterShot} onRemoveAppearance={removeCharacterAppearance} onRangeChange={setSelectedRange} onPlayRange={(range) => playRange(range, false)} onSeek={seek} />
                </div>

                <div hidden={deckTab !== "color"}>
                  {project && (
                    <ColorReading
                      project={project}
                      thumbnails={thumbnails}
                      selected={selected}
                      onSelect={(id) => {
                        const targetShot = project.shots.find((s) => s.id === id);
                        if (targetShot) selectShot(targetShot);
                      }}
                      onSeek={seek}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT: Film Monitor */}
            <section className="monitor panel">
              <div className="section-head">
                <span className="eyebrow">PROGRAM FILM PREVIEW</span>
                <span className="muted">
                  {playing ? "PLAYING" : "PAUSED"} ·{" "}
                  {current
                    ? `SHOT ${String(current.index).padStart(3, "0")}`
                    : "—"}
                </span>
              </div>
              <div className="screen">
                <video
                  ref={video}
                  src={url || undefined}
                  playsInline
                  onLoadedMetadata={() => {
                    const v = video.current!,
                      f = pendingFile.current;
                    if (!f) return;
                    update({
                      videoMetadata: {
                        filename: f.name,
                        duration: v.duration,
                        width: v.videoWidth,
                        height: v.videoHeight,
                        size: f.size,
                      },
                      duration: Math.max(
                        v.duration,
                        ...project.shots.map((s) => s.endSeconds),
                      ),
                    });
                    setMessage(
                      "Video connected. Picture and original audio stay on this device.",
                    );
                  }}
                  onTimeUpdate={() => {
                    if (scrubTarget.current === null)
                      setTime(video.current?.currentTime || 0);
                  }}
                  onSeeked={() => {
                    const v = video.current!;
                    const target = scrubTarget.current;
                    if (target === null) return;
                    if (Math.abs(v.currentTime - target) > 0.001)
                      v.currentTime = target;
                    else scrubTarget.current = null;
                  }}
                  onPlay={() => {
                    setAnalyzedFrame(null);
                    setPlaying(true);
                  }}
                  onPause={() => {
                    setPlaying(false);
                    if (video.current && scrubTarget.current === null) {
                      setTime(video.current.currentTime);
                    }
                  }}
                  onEnded={() => {
                    setPlaying(false);
                    stopAt.current = null;
                    if (video.current && scrubTarget.current === null) {
                      setTime(video.current.currentTime);
                    }
                  }}
                  onError={() =>
                    setError(
                      "This video could not be played. Try a browser-compatible MP4 (H.264/AAC) or WebM.",
                    )
                  }
                />
                {url && analyzedFrame?.url === url && (
                  <div className="analysis-preview">
                    <img
                      src={`data:image/jpeg;base64,${analyzedFrame.image}`}
                      alt="Exact frame sent for analysis"
                    />
                    <span>
                      {scanningAll || scanningShot
                        ? "ANALYZING FRAME"
                        : "ANALYZED FRAME"}
                    </span>
                  </div>
                )}
                {!url && (
                  <div className="screen-empty">
                    <span>▻</span>
                    <b>
                      {project.videoMetadata
                        ? "Video needs relinking"
                        : "Connect your film"}
                    </b>
                    <p>
                      {project.videoMetadata?.filename ||
                        "Original picture. Original sound."}
                    </p>
                    <button onClick={openVideoPicker}>
                      {project.videoMetadata ? "Relink video" : "Choose video"}
                    </button>
                  </div>
                )}
              </div>
              <div className="transport">
                <button
                  disabled={!url}
                  aria-label="Previous frame"
                  onClick={() => {
                    video.current?.pause();
                    seek(time - 1 / actualRate(project.frameRate));
                  }}
                >
                  Ⅰ‹
                </button>
                <button
                  disabled={!url}
                  className="play"
                  aria-label={playing ? "Pause" : "Play"}
                  onClick={toggle}
                >
                  {playing ? "Ⅱ" : "▶"}
                </button>
                <button
                  disabled={!url}
                  aria-label="Next frame"
                  onClick={() => {
                    video.current?.pause();
                    seek(time + 1 / actualRate(project.frameRate));
                  }}
                >
                  ›Ⅰ
                </button>
                <span className="timecode">
                  {formatTimecode(time, project.frameRate, project.dropFrame)}
                </span>
                <input
                  className="seek"
                  aria-label="Seek film"
                  type="range"
                  min="0"
                  max={project.duration || 1}
                  step={1 / actualRate(project.frameRate)}
                  value={time}
                  onChange={(e) => seek(Number(e.target.value))}
                />
                <button
                  aria-label={muted ? "Unmute" : "Mute"}
                  onClick={() => setMuted(!muted)}
                >
                  {muted ? "Muted" : "Sound"}
                </button>
                <input
                  className="volume"
                  aria-label="Volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                />
              </div>
              <div className="video-meta">
                {project.videoMetadata
                  ? `${project.videoMetadata.filename} · ${project.videoMetadata.width} × ${project.videoMetadata.height} · ${project.videoMetadata.duration.toFixed(2)}s`
                  : "No video connected"}
                <span>SPACE TO PLAY / PAUSE</span>
              </div>
            </section>
          </div>

          {/* BOTTOM STAGE: Integrated Timeline */}
          <div className="bottom-stage">
            <EditingMap
              project={project}
              thumbnails={thumbnails}
              time={time}
              selected={selected}
              active={current?.id}
              onSeek={seek}
              onScrub={scrub}
              onShot={selectShot}
              onPlayShot={playShot}
              selectedCut={selectedCut}
              onCut={(incoming) => { video.current?.pause(); setSelectedCut(incoming.id); setSelected(incoming.id); seek(incoming.startSeconds); setDeckTab("cuts"); }}
              range={selectedRange}
              onRangeChange={(r) => { setSelectedRange(r); if (r) setDeckTab("sequence"); }}
              waveform={waveform}
              reviewMatchIds={reviewFilter === "all" ? undefined : reviewMatchIds}
              highlightedShotIds={selectedCharacter ? project.shots.filter((s) => s.characterAnalysis?.manualReviewStatus === "Confirmed" ? s.characterAnalysis.manualMemberIds?.includes(selectedCharacter) : s.characterAnalysis?.intervals.some((interval) => interval.memberId === selectedCharacter)).map((s) => s.id) : undefined}
              onColorModeChange={(colorMode) => update({ colorMode })}
              onSeparateDme={handleSeparateDme}
              isDmeSeparating={isDmeSeparating}
              dmeSeparationStatus={dmeSeparationStatus}
              hasVideo={Boolean(pendingFile.current || project.videoMetadata)}
              tagBar={
                <div className="timeline-action-bar">
                  <div className="tag-toolbar-inline">
                    <span className="eyebrow">TAG SHOT</span>
                    <div className="tag-keys">
                      {selectableShotSizes.map((size) => {
                        const shortcut = sizeShortcuts[size] ?? "";
                        return (
                          <button
                            key={size}
                            disabled={!shot || shot.content === "Text / title card"}
                            title={`Assign ${size} (${shortcut})`}
                            onClick={() => tagShot(size)}
                          >
                            <kbd>{shortcut}</kbd> {size}
                          </button>
                        );
                      })}
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={autoAdvance}
                        onChange={(e) => setAutoAdvance(e.target.checked)}
                      />
                      Advance after tagging
                    </label>
                  </div>
                  <ReviewFilters
                    project={project}
                    filter={reviewFilter}
                    matchIds={reviewMatchIds}
                    onFilter={setReviewFilter}
                    onPrevious={() => navigateReviewMatches(-1)}
                    onNext={() => navigateReviewMatches(1)}
                  />
                </div>
              }
            />
          </div>

          {project.videoMetadata &&
            project.shots.some(
              (s) =>
                s.endSeconds >
                project.videoMetadata!.duration +
                  1 / actualRate(project.frameRate),
            ) && (
              <p className="warning">
                Some EDL events extend beyond the video. Check frame rate and
                timeline start timecode.
              </p>
            )}
          <footer>
            <span role="status">{message}</span>
            <span>
              {saveState || (dirty ? "UNSAVED CHANGES" : "LOCAL PROJECT")} · NO MEDIA UPLOADS
            </span>
          </footer>
        </main>
      )}

      {project && reportModalOpen && (
        <>
          <ReportExportModal
            project={project}
            isOpen={reportModalOpen}
            config={reportConfig}
            onChangeConfig={setReportConfig}
            onClose={() => setReportModalOpen(false)}
            onExport={handleExportPDF}
          />
          <div id="printable-report-wrapper">
            <PrintableReport
              project={project}
              theme={reportConfig.theme}
              format={reportConfig.format}
              sections={reportConfig.sections}
            />
          </div>
        </>
      )}

      {project && analysisProgress && (
        <div className="scene-detect-modal unified-analysis-modal">
          <div className="modal panel">
            <div className="section-head">
              <b>{analysisProgress.stage === "done" ? "Analysis Complete!" : analysisProgress.fullPipeline ? "Analyzing Film" : "Scanning Scene Cuts"}</b>
              <span className="mono" style={{ color: "#e5a444", fontWeight: "bold" }}>
                {analysisProgress.overallPercent}%
              </span>
            </div>

            {/* 3-Stage Stepper Checklist */}
            {analysisProgress.fullPipeline && (
              <div className="analysis-stepper">
                {/* Step 1: Cut Detection */}
                <div className={`analysis-step-row ${
                  analysisProgress.stage === "cuts" ? "active" : "completed"
                }`}>
                  <div className="analysis-step-left">
                    <span className="analysis-step-badge">
                      {analysisProgress.stage !== "cuts" ? "✓" : "1"}
                    </span>
                    <span>1. Scene Cut Detection</span>
                  </div>
                  <span className="analysis-step-meta">
                    {analysisProgress.cutsFound > 0 ? `${analysisProgress.cutsFound} shots found` : "Scanning..."}
                  </span>
                </div>

                {/* Step 2: Framing & People */}
                <div className={`analysis-step-row ${
                  analysisProgress.stage === "cuts" ? "" :
                  analysisProgress.stage === "framing" ? "active" : "completed"
                }`}>
                  <div className="analysis-step-left">
                    <span className="analysis-step-badge">
                      {analysisProgress.stage === "cuts" ? "2" :
                       analysisProgress.stage === "framing" ? "●" : "✓"}
                    </span>
                    <span>2. Framing & Shot Sizes</span>
                  </div>
                  <span className="analysis-step-meta">
                    {analysisProgress.stage === "cuts" ? "Waiting..." :
                     analysisProgress.stage === "framing" ? `${analysisProgress.framingDone}/${analysisProgress.framingTotal}` :
                     "Tagged"}
                  </span>
                </div>

                {/* Step 3: Character Discovery */}
                <div className={`analysis-step-row ${
                  analysisProgress.stage === "characters" ? "active" :
                  analysisProgress.stage === "done" ? "completed" : ""
                }`}>
                  <div className="analysis-step-left">
                    <span className="analysis-step-badge">
                      {analysisProgress.stage === "done" ? "✓" :
                       analysisProgress.stage === "characters" ? "●" : "3"}
                    </span>
                    <span>3. Character Discovery & Cast</span>
                  </div>
                  <span className="analysis-step-meta">
                    {analysisProgress.stage === "done" ? "Clustered" :
                     analysisProgress.stage === "characters" ? `${analysisProgress.facesFound} faces` :
                     "Waiting..."}
                  </span>
                </div>
              </div>
            )}

            {/* Overall Progress Bar */}
            <div className="scene-progress-bar-container">
              <div
                className="scene-progress-bar"
                style={{ width: `${analysisProgress.overallPercent}%` }}
              />
            </div>

            {/* Preview Box */}
            {analysisProgress.previewImage ? (
              <div className="analysis-preview-box">
                <img src={`data:image/jpeg;base64,${analysisProgress.previewImage}`} alt="Analyzing frame" className="analysis-preview-thumb" />
                <div className="analysis-preview-desc">
                  <b>{analysisProgress.previewDescription || "Analyzing frame visual cues..."}</b>
                  <span className="muted">{analysisProgress.statusText}</span>
                </div>
              </div>
            ) : (
              <div className="scene-progress-meta mono">
                <span>
                  {formatTimecode(
                    analysisProgress.currentTime,
                    project.frameRate,
                    project.dropFrame,
                  )}{" "}
                  /{" "}
                  {formatTimecode(
                    analysisProgress.totalDuration,
                    project.frameRate,
                    project.dropFrame,
                  )}
                </span>
                <span>
                  {analysisProgress.cutsFound}{" "}
                  {analysisProgress.cutsFound === 1 ? "shot" : "shots"} found
                </span>
              </div>
            )}

            <div className="modal-actions">
              <button
                onClick={() => {
                  detectAbortRef.current?.abort();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
