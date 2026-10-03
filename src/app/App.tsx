import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  newProject,
  peopleLabels,
  subjectLabels,
  selectableShotSizes,
  updateShotTags,
  type CastMember,
  type CharacterAnalysis,
  type CutAnnotation,
  type Project,
  type ScreeningMark,
  type SequenceMarker,
  type Shot,
} from "../models/project";
import { parseEDL } from "../parsers/edl";
import { playhead, setPlayhead, usePlayheadSelector } from "../playback/playhead";
import { PlayheadSeekSlider, PlayheadTimecode } from "../playback/PlayheadReadouts";
import { actualRate, formatTimecode, rates } from "../utils/timecode";
import { activeShot, clampSeek } from "../analysis/playback";
import { getProject, listProjects, requestPersistentStorage, saveProject, storageUsage, type StorageError } from "../storage/projects";
import { MAX_BACKUP_BYTES, makeBackup, parseBackup } from "../storage/backup";
import EditingMap, { DEFAULT_MAP_LAYERS, type MapLayerState } from "../timeline/EditingMap";
import FullscreenMapVisualization from "../timeline/FullscreenMapVisualization";
import AllShotsAnalysis from "../components/AllShotsAnalysis";
import EditingRhythm from "../components/EditingRhythm";
import FramingDrawer from "../components/FramingDrawer";
import SequenceReading, { type DraftRange, type TimeRange } from "../components/SequenceReading";
import SoundDrawer from "../components/SoundDrawer";
import CutReading from "../components/CutReading";
import { scanProjectEyeTrace, type CutPair } from "../analysis/cuts";
import { useThumbnails } from "../video/useThumbnails";
import { analyzeLocalAudio } from "../analysis/audio";
import { separateDmeAudio } from "../analysis/dme";
import { isSpeechAnalysisValid, mediaSignature } from "../analysis/speech";
import { scanSpeechAudio } from "../analysis/speechService";
import { isLoudnessAnalysisValid } from "../analysis/loudness";
import { scanLoudnessAudio } from "../analysis/loudnessService";
import CastDrawer from "../components/CastDrawer";
import { sampleFrame, createFrameSampler, analyzeFrames, sampleShotFrames, MODEL } from "../analysis/localModel";
import { discoverCharactersAcrossShots, isEligibleForCharacterScan, mergeDiscoveredCast } from "../analysis/characters";
import ReviewFilters from "../components/ReviewFilters";
import { matchesReviewFilter, reviewReasons, reviewReasonLabel, type ReviewFilter } from "../analysis/review";
import ColorDrawer from "../components/ColorDrawer";
import ReportExportModal, { type ReportExportConfig } from "../components/ReportExportModal";
import PrintableReport from "../components/PrintableReport";
import { detectVideoShots, type ScanProgress } from "../analysis/videoScanner";
import { analyzeShotMotion } from "../analysis/motion";
import { splitShotAtTime, mergeShotsAtCut, rollCutBoundary, nudgeCutBoundary, quantizeToFrame } from "../timeline/timelineOps";
import ProjectHeader, { type WorkspaceMode } from "../components/ProjectHeader";
import ShotInspector from "../components/ShotInspector";
import ScreeningReview from "../components/ScreeningReview";
import DuetConsole from "../components/DuetConsole";
import ExploreWorkspace from "../components/explore/ExploreWorkspace";
import MapShotSummary from "../components/MapShotSummary";
import ResizeHandle from "../components/ResizeHandle";
import { useWorkspaceLayout } from "../hooks/useWorkspaceLayout";
import { getSquintFilter } from "../utils/squint";
import WelcomeScreen from "../components/WelcomeScreen";
import { StudioToolRail, type StudioToolTab } from "../components/StudioToolRail";
import ScannerSettingsModal from "../components/ScannerSettingsModal";
import type { MeasureId } from "../analysis/comparison";


const shotSizeLabels: Record<Shot["shotSize"], string> = {
  "Extreme wide": "Extreme wide",
  Wide: "Wide",
  Full: "Full",
  American: "American",
  Medium: "Medium",
  "Medium close-up": "Medium close-up",
  Close: "Close",
  "Extreme close": "Extreme close",
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
  "Extreme wide": "Environment dominates; subject tiny or absent",
  Wide: "Subject small or surrounded by substantial environment",
  Full: "Full body or subject with contextual surroundings",
  American: "Approximately knees up; also called a cowboy shot",
  Medium: "Subject emphasis with meaningful environment retained",
  "Medium close-up": "Approximately chest up",
  Close: "Face or main subject fills a substantial part of frame",
  "Extreme close": "An isolated facial, bodily, or prop detail dominates",
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
  "Extreme wide": "1",
  Wide: "2",
  Full: "3",
  American: "4",
  Medium: "5",
  "Medium close-up": "6",
  Close: "7",
  "Extreme close": "8",
  Unknown: "U",
};

export {
  type ScanOptions,
  QUICK_ANALYSIS_PRESET,
  FULL_ANALYSIS_PRESET,
} from "../models/scanOptions";
import {
  type ScanOptions,
  QUICK_ANALYSIS_PRESET,
  FULL_ANALYSIS_PRESET,
} from "../models/scanOptions";

export type AnalysisStage = "cuts" | "framing" | "characters" | "dialogue" | "loudness" | "motion" | "stems" | "done";

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
  options: ScanOptions;
}

export interface BgScanStatus {
  active: boolean;
  stage: AnalysisStage;
  stageLabel: string;
  progress: number;
  stageProgress: number;
  statusText: string;
  motionActive?: boolean;
  motionProgress?: number;
  stemsActive?: boolean;
  stemsStatusText?: string;
}

export default function App() {
  const [project, setProject] = useState<Project>(() => newProject()),
    [url, setUrl] = useState(""),
    setTime = setPlayhead,
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
  const [selectedRange, setSelectedRange] = useState<DraftRange>();
  const [isRangeLooping, setIsRangeLooping] = useState(false);
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [mapLayers, setMapLayers] = useState<MapLayerState>(DEFAULT_MAP_LAYERS);
  const [isFullscreenGraph, setIsFullscreenGraph] = useState(false);
  const [dropFrame, setDropFrame] = useState(false);
  const [scanningAll, setScanningAll] = useState(false);
  const [scanningShot, setScanningShot] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<string>();
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("screening");
  const [isScreeningRoomEntered, setIsScreeningRoomEntered] = useState(false);
  const isScreeningSetup = workspaceMode === "screening" && !isScreeningRoomEntered;
  const [filmReplacementPending, setFilmReplacementPending] = useState<{
    type: "file";
    file: File | string;
    name: string;
  } | {
    type: "project";
    project: Project;
  } | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const {
    leftWidth,
    rightWidth,
    topHeightRatio,
    leftCollapsed,
    rightCollapsed,
    resizeLeft,
    resizeRight,
    resizeTopPixels,
    toggleLeftCollapse,
    toggleRightCollapse,
    resetLeftWidth,
    resetRightWidth,
    resetTopHeightRatio,
  } = useWorkspaceLayout(workspaceMode);
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);
  const [studioDrawerOpen, setStudioDrawerOpen] = useState(false);
  const [studioTagBarOpen, setStudioTagBarOpen] = useState(true);
  const [deckTab, setDeckTab] = useState<StudioToolTab>("rhythm");
  const [initialCompareMeasure, setInitialCompareMeasure] = useState<MeasureId | undefined>();
  const [mapExpanded, setMapExpanded] = useState(false);
  const drawerBeforeExpand = useRef(false);
  const toggleExpandedMap = () => {
    if (mapExpanded) {
      setStudioDrawerOpen(drawerBeforeExpand.current);
    } else {
      drawerBeforeExpand.current = studioDrawerOpen;
      setStudioDrawerOpen(false);
    }
    setMapExpanded((expanded) => !expanded);
  };
  const [edlRevision, setEdlRevision] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState<UnifiedAnalysisProgress | null>(null);
  const [scanOptions, setScanOptions] = useState<ScanOptions>(QUICK_ANALYSIS_PRESET);
  const [bgScanStatus, setBgScanStatus] = useState<BgScanStatus | null>(null);
  const [showScanConfigModal, setShowScanConfigModal] = useState(false);
  const [isInitialScanDismissed, setIsInitialScanDismissed] = useState(false);
  const [scannerSettingsOpen, setScannerSettingsOpen] = useState(false);
  const dmeAbortRef = useRef<AbortController | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const loudnessAbortRef = useRef<AbortController | null>(null);
  // Ask the browser to keep project data through storage pressure, and warn early when nearly full.
  useEffect(() => {
    void (async () => {
      await requestPersistentStorage();
      const usage = await storageUsage();
      if (usage && usage.usage / usage.quota > 0.85) {
        setMessage(`Browser storage is ${Math.round((usage.usage / usage.quota) * 100)}% full. Export a backup and clear old projects soon.`);
      }
    })();
  }, []);
  useEffect(() => () => { dmeAbortRef.current?.abort(); speechAbortRef.current?.abort(); loudnessAbortRef.current?.abort(); }, []);
  const [isDmeSeparating, setIsDmeSeparating] = useState(false);
  const [dmeSeparationStatus, setDmeSeparationStatus] = useState("");
  const [isSpeechScanning, setIsSpeechScanning] = useState(false);
  const [speechStatus, setSpeechStatus] = useState("");
  const [showSpeechOverlay, setShowSpeechOverlay] = useState(true);
  const completeSelectedRange: TimeRange | undefined = useMemo(() => {
    if (selectedRange && selectedRange.start !== undefined && selectedRange.end !== undefined && selectedRange.end > selectedRange.start) {
      return { start: selectedRange.start, end: selectedRange.end };
    }
    return undefined;
  }, [selectedRange]);
  const [isLoudnessScanning, setIsLoudnessScanning] = useState(false);
  const [loudnessStatus, setLoudnessStatus] = useState("");
  const [linkedMediaSignature, setLinkedMediaSignature] = useState<string>();
  const [snapToCuts, setSnapToCuts] = useState(true);
  const [squintMode, setSquintMode] = useState(false);
  const [squintLevel, setSquintLevel] = useState(4);
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
    setMessage("PDF analysis report exported successfully.");
  };

  const handleSystemPrint = (config: ReportExportConfig) => {
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

  const appliedColorProfileSignatures = useRef<Record<string, string>>({});
  useEffect(() => {
    appliedColorProfileSignatures.current = {};
  }, [project?.id, url]);

  useEffect(() => {
    if (!project || !Object.keys(colorProfiles).length) return;
    let hasChanges = false;
    const nextShots = project.shots.map((s) => {
      const profile = colorProfiles[s.id];
      const signature = profile && JSON.stringify(profile);
      if (profile && typeof signature === "string" && signature !== appliedColorProfileSignatures.current[s.id]) {
        appliedColorProfileSignatures.current[s.id] = signature;
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
  // Only the active shot's id is derived from the clock, so App re-renders when
  // playback crosses a cut, not on every frame.
  const currentId = usePlayheadSelector((t) => project ? activeShot(project.shots, t)?.id : undefined);
  // The analytical drawer is on screen only in Studio with the panel open; hidden drawers stop following the clock.
  const deckVisible = workspaceMode === "studio" && (mapExpanded ? studioDrawerOpen : !leftCollapsed);
  const current = project && currentId ? project.shots.find((s) => s.id === currentId) : undefined,
    shot = project?.shots.find((s) => s.id === selected);
  const [reviewSearchQuery, setReviewSearchQuery] = useState("");
  const reviewMatches = useMemo(
    () => project ? project.shots.filter((candidate) => matchesReviewFilter(candidate, reviewFilter)) : [],
    [project?.shots, reviewFilter],
  );
  const reviewMatchIds = useMemo(() => reviewMatches.map((candidate) => candidate.id), [reviewMatches]);
  const queuedReviewShots = useMemo(() => {
    if (!project) return [];
    const query = reviewSearchQuery.trim().toLowerCase();
    return project.shots.filter((s) => {
      if (!matchesReviewFilter(s, reviewFilter)) return false;
      if (!query) return true;
      const indexStr = String(s.index);
      const subjectStr = (s.content || "").toLowerCase();
      const notesStr = (s.notes || "").toLowerCase();
      const reasonsStr = reviewReasonLabel(reviewReasons(s)).toLowerCase();
      return (
        indexStr.includes(query) ||
        subjectStr.includes(query) ||
        notesStr.includes(query) ||
        reasonsStr.includes(query)
      );
    });
  }, [project?.shots, reviewFilter, reviewSearchQuery]);
  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => {
    void listProjects().then((projects) => {
      if (projects.length > 0 && (!projectRef.current || projectRef.current.shots.length === 0)) {
        const candidate = projects.find((p) => p.shots && p.shots.length > 0) || projects[0];
        if (candidate && candidate.shots && candidate.shots.length > 0) {
          replace(candidate);
        }
      }
    }).catch(() => {});
  }, []);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  // Blob URLs applied straight to the <video> (outside `url` state) are cached
  // per file, so re-renders never mint new ones, and are released on unmount.
  const sideLoadedUrls = useRef(new Map<File, string>());
  const sideLoadedUrl = (file: File) => {
    let existing = sideLoadedUrls.current.get(file);
    if (!existing) {
      existing = URL.createObjectURL(file);
      sideLoadedUrls.current.set(file, existing);
    }
    return existing;
  };
  useEffect(() => {
    const registry = sideLoadedUrls.current;
    return () => {
      for (const created of registry.values()) URL.revokeObjectURL(created);
      registry.clear();
    };
  }, []);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  // A new project must not inherit the previous film: drop the retained file and
  // tell the Screening hub (an iframe) to clear the film it has selected.
  const forgetLinkedFilm = () => {
    pendingFile.current = null;
    (window as any).selectedFile = null;
    const iframe = document.querySelector(".duet-console-iframe") as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({ type: "RESET_FILM" }, "*");
  };
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
    }, async (failure: StorageError) => {
      if (projectRef.current?.id === snapshot.id) {
        setSaveState("Failed");
        if (failure?.kind === "quota") {
          const usage = await storageUsage();
          const used = usage ? ` (${Math.round(usage.usage / 1048576)} MB of ${Math.round(usage.quota / 1048576)} MB used)` : "";
          setError(`Save failed: browser storage is full${used}. Export a backup and delete projects you no longer need.`);
        } else {
          setError("Save failed. Browser storage may be unavailable (private window or blocked site data).");
        }
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
    dmeAbortRef.current?.abort(); speechAbortRef.current?.abort(); loudnessAbortRef.current?.abort();
    detectAbortRef.current?.abort();
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
    if (workspaceMode === "screening" || workspaceMode === "review") {
      return;
    }
    const v = video.current;
    if (!v || !url) {
      if (project && project.shots.length > 0) {
        setPlaying((p) => !p);
      }
      return;
    }
    if (v.paused) {
      stopAt.current = null;
      if (
        isRangeLooping &&
        selectedRange?.start !== undefined &&
        selectedRange?.end !== undefined &&
        selectedRange.end > selectedRange.start
      ) {
        const fps = project?.frameRate || 24;
        const start = quantizeToFrame(selectedRange.start, fps);
        const end = quantizeToFrame(selectedRange.end, fps);
        playbackRange.current = { start, end, loop: true };
        if (v.currentTime < start || v.currentTime >= end) {
          v.currentTime = start;
          setTime(start);
        }
      } else {
        playbackRange.current = null;
      }
      setPlaying(true);
      const playPromise = v.play();
      if (playPromise !== undefined) {
        playPromise.catch((e: Error) => {
          if (e.name !== "AbortError") {
            setError(e.message);
          }
        });
      }
    } else {
      v.pause();
      setPlaying(false);
      setTime(v.currentTime);
    }
  };

  const handleSplitShot = (targetTime: number) => {
    if (!project) return;
    const res = splitShotAtTime(project, targetTime);
    if (!res) {
      setMessage("Cannot add cut here (too close to shot boundary or outside film).");
      return;
    }
    recordHistory(project);
    revision.current++;
    setProject(res.updatedProject);
    setDirty(true);
    setEdlRevision((rev) => rev + 1);
    setSelected(res.newCutId);
    setSelectedCut(res.newCutId);
    seek(res.splitShot.startSeconds);
    setMessage(`Split shot at ${formatTimecode(res.splitShot.startSeconds, project.frameRate, project.dropFrame)}.`);
  };

  const handleMergeShots = (incomingId: string) => {
    if (!project) return;
    const res = mergeShotsAtCut(project, incomingId);
    if (!res) {
      setMessage("Cannot merge shots across this boundary.");
      return;
    }
    recordHistory(project);
    revision.current++;
    setProject(res.updatedProject);
    setDirty(true);
    setEdlRevision((rev) => rev + 1);
    setSelected(res.mergedShotId);
    setSelectedCut(undefined);
    setMessage("Cut deleted and adjacent shots merged.");
  };

  const handleRollCut = (incomingId: string, newTime: number) => {
    if (!project) return;
    const res = rollCutBoundary(project, incomingId, newTime);
    if (!res) return;
    recordHistory(project);
    revision.current++;
    setProject(res.updatedProject);
    setDirty(true);
    setEdlRevision((rev) => rev + 1);
    seek(res.rolledTime);
    setMessage(`Rolled cut boundary to ${formatTimecode(res.rolledTime, project.frameRate, project.dropFrame)}.`);
  };

  const handleNudgeCut = (incomingId: string, framesDelta: number) => {
    if (!project) return;
    const res = nudgeCutBoundary(project, incomingId, framesDelta);
    if (!res) return;
    recordHistory(project);
    revision.current++;
    setProject(res.updatedProject);
    setDirty(true);
    setEdlRevision((rev) => rev + 1);
    seek(res.rolledTime);
    const sign = framesDelta > 0 ? "+" : "";
    setMessage(`Nudged cut ${sign}${framesDelta} frame${Math.abs(framesDelta) > 1 ? "s" : ""}.`);
  };

  const handleToggleSnap = () => {
    setSnapToCuts((s) => {
      const next = !s;
      setMessage(`Playhead snapping ${next ? "enabled" : "disabled"}.`);
      return next;
    });
  };

  const handleCloseStudioDrawer = useCallback(() => {
    setStudioDrawerOpen(false);
    if (!leftCollapsed) {
      toggleLeftCollapse();
    }
  }, [leftCollapsed, toggleLeftCollapse]);

  const handleUpdateShots = useCallback((shots: Shot[]) => {
    update({ shots });
  }, [update]);

  const handleUpdateSequences = useCallback((sequences: SequenceMarker[]) => {
    update({ sequences });
  }, [update]);

  const handleUpdateCutAnnotations = useCallback((cutAnnotations: CutAnnotation[]) => {
    update({ cutAnnotations });
  }, [update]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.altKey ||
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        restoreHistory(e.shiftKey ? "redo" : "undo");
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (isFullscreenGraph) {
        // Fullscreen map has its own self-contained keyboard navigation and shortcuts
        return;
      }

      if (e.key === "Escape" && workspaceMode === "screening") {
        e.preventDefault();
        setWorkspaceMode("review");
        const iframe = document.querySelector(".duet-console-iframe") as HTMLIFrameElement | null;
        iframe?.contentWindow?.postMessage({ type: "SET_MODE", mode: "review" }, "*");
        return;
      }

      if (workspaceMode !== "studio") return;

      if (e.key === "Escape") {
        if (isFullscreenGraph) {
          e.preventDefault();
          setIsFullscreenGraph(false);
          return;
        }
        if (workspaceMode === "studio" && (!leftCollapsed || studioDrawerOpen)) {
          e.preventDefault();
          setStudioDrawerOpen(false);
          if (!leftCollapsed) {
            toggleLeftCollapse();
          }
          return;
        }
        if (inspectorDrawerOpen) {
          e.preventDefault();
          setInspectorDrawerOpen(false);
          return;
        }
      }

      if (workspaceMode === "studio" && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        const frameSec = quantizeToFrame(playhead.get(), project?.frameRate || 24);
        setSelectedRange((prev) => ({
          ...prev,
          start: frameSec,
        }));
        setDeckTab("sequence");
        setStudioDrawerOpen(true);
        if (leftCollapsed) {
          toggleLeftCollapse();
        }
        return;
      }
      if (workspaceMode === "studio" && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        const frameSec = quantizeToFrame(playhead.get(), project?.frameRate || 24);
        setSelectedRange((prev) => ({
          ...prev,
          end: frameSec,
        }));
        setDeckTab("sequence");
        setStudioDrawerOpen(true);
        if (leftCollapsed) {
          toggleLeftCollapse();
        }
        return;
      }

      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        handleSplitShot(playhead.get());
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        handleToggleSnap();
        return;
      }
      if (selectedSequenceId && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        const updated = (project?.sequences || []).filter((s) => s.id !== selectedSequenceId);
        handleUpdateSequences(updated);
        setSelectedSequenceId(null);
        setSelectedRange(undefined);
        return;
      }
      if (selectedCut && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        handleMergeShots(selectedCut);
        return;
      }
      if (selectedCut && (e.key === "[" || e.key === "{")) {
        e.preventDefault();
        handleNudgeCut(selectedCut, e.shiftKey ? -5 : -1);
        return;
      }
      if (selectedCut && (e.key === "]" || e.key === "}")) {
        e.preventDefault();
        handleNudgeCut(selectedCut, e.shiftKey ? 5 : 1);
        return;
      }

      const size = (
        {
          "1": "Extreme wide",
          "2": "Wide",
          "3": "Full",
          "4": "American",
          "5": "Medium",
          "6": "Medium close-up",
          "7": "Close",
          "8": "Extreme close",
          u: "Unknown",
        } as Record<string, Shot["shotSize"]>
      )[e.key.toLowerCase()];
      if (size && shot) {
        e.preventDefault();
        tagShot(size);
        return;
      }
      if (e.key === "Escape") {
        setIsInitialScanDismissed(true);
        setShowScanConfigModal(false);
        return;
      }
      if (e.code === "Space" && !(e.target as HTMLElement).closest("button")) {
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === "Enter" && shot && !e.shiftKey && !e.ctrlKey && !e.metaKey && !(e.target as HTMLElement).closest("button")) {
        e.preventDefault();
        confirmAndNext();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  useEffect(() => {
    if (workspaceMode === "screening" || workspaceMode === "review") {
      if (video.current) {
        video.current.pause();
        video.current.muted = true;
      }
      setPlaying(false);
    } else if (workspaceMode === "studio") {
      if (video.current) {
        video.current.muted = false;
      }
    }
  }, [workspaceMode]);
  useEffect(() => {
    if (!playing) return;
    let handle = 0;
    let lastTickTime = performance.now();
    const tick = () => {
      const v = video.current;
      if (v && url) {
        if (v.paused) {
          setPlaying(false);
          return;
        }
        const range = playbackRange.current;
        let pausedBoundary = false;
        const frameSec = 1 / (project?.frameRate || 24);
        if (range && v.currentTime >= range.end - frameSec / 2) {
          if (range.loop) {
            v.currentTime = range.start;
            setTime(range.start);
          } else {
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

        if (pausedBoundary) {
          setPlaying(false);
          return;
        }

        setTime(v.currentTime);
      } else {
        const now = performance.now();
        const dt = (now - lastTickTime) / 1000;
        lastTickTime = now;
        setTime((prev) => {
          const maxDur = projectRef.current?.duration || 100;
          if (prev + dt >= maxDur) {
            setPlaying(false);
            return maxDur;
          }
          return prev + dt;
        });
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, project, url]);
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
    const restoreTime = clampSeek(playhead.get(), v.duration || project?.duration || 0);
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
  const confirmAndNext = () => {
    if (!project || !shot) return;
    video.current?.pause();
    applyShotPatch(project.id, shot.id, { reviewStatus: "Confirmed", uncertain: false }, true);
    if (autoAdvance) {
      const unconfirmedCandidates = queuedReviewShots.filter(
        (s) => s.id !== shot.id && s.reviewStatus !== "Confirmed",
      );
      if (unconfirmedCandidates.length === 0) {
        setMessage("All matching shots in review queue confirmed.");
        return;
      }
      const curIdx = queuedReviewShots.findIndex((s) => s.id === shot.id);
      const subsequentCandidates = queuedReviewShots
        .slice(curIdx + 1)
        .filter((s) => s.id !== shot.id && s.reviewStatus !== "Confirmed");
      const next = subsequentCandidates.length > 0 ? subsequentCandidates[0] : unconfirmedCandidates[0];
      if (next) selectShot(next);
      else setMessage("All matching shots in review queue confirmed.");
    }
  };
  const markUncertainAndNext = () => {
    if (!project || !shot) return;
    const nextUncertain = !shot.uncertain;
    applyShotPatch(project.id, shot.id, { uncertain: nextUncertain }, true);
    if (autoAdvance && nextUncertain) {
      const curIdx = queuedReviewShots.findIndex((s) => s.id === shot.id);
      const after = queuedReviewShots.slice(curIdx + 1).filter((s) => s.id !== shot.id);
      const next = after.length > 0 ? after[0] : undefined;
      if (next) selectShot(next);
    }
  };
  const goToPrevShot = () => {
    if (!project || !shot) return;
    const curIdx = project.shots.indexOf(shot);
    if (curIdx > 0) selectShot(project.shots[curIdx - 1]);
  };
  const goToNextShot = () => {
    if (!project || !shot) return;
    const curIdx = project.shots.indexOf(shot);
    if (curIdx < project.shots.length - 1) selectShot(project.shots[curIdx + 1]);
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

  useEffect(() => {
    if (isRangeLooping) {
      if (
        selectedRange &&
        selectedRange.start !== undefined &&
        selectedRange.end !== undefined &&
        selectedRange.end > selectedRange.start
      ) {
        const fps = project?.frameRate || 24;
        const start = quantizeToFrame(selectedRange.start, fps);
        const end = quantizeToFrame(selectedRange.end, fps);
        playbackRange.current = { start, end, loop: true };
      } else {
        setIsRangeLooping(false);
        playbackRange.current = null;
      }
    }
  }, [isRangeLooping, project?.frameRate, selectedRange]);

  const handleToggleLoopRange = useCallback(
    (active?: boolean) => {
      setIsRangeLooping((prev) => {
        const next = active !== undefined ? active : !prev;
        const v = video.current;
        if (
          !next ||
          !selectedRange ||
          selectedRange.start === undefined ||
          selectedRange.end === undefined ||
          selectedRange.end <= selectedRange.start
        ) {
          playbackRange.current = null;
          return false;
        }
        const fps = project?.frameRate || 24;
        const start = quantizeToFrame(selectedRange.start, fps);
        const end = quantizeToFrame(selectedRange.end, fps);
        playbackRange.current = { start, end, loop: true };
        if (v) {
          if (v.currentTime < start || v.currentTime >= end) {
            v.currentTime = start;
            setTime(start);
          }
        }
        return true;
      });
    },
    [project?.frameRate, selectedRange],
  );

  const replace = (p: Project) => {
    projectRef.current = p;
    pendingFile.current = null;
    setLinkedMediaSignature(undefined);
    dmeAbortRef.current?.abort(); speechAbortRef.current?.abort(); loudnessAbortRef.current?.abort();
    detectAbortRef.current?.abort();
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
    setIsRangeLooping(false);
    playbackRange.current = null;
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
    dmeAbortRef.current?.abort(); speechAbortRef.current?.abort(); loudnessAbortRef.current?.abort();
    detectAbortRef.current?.abort();
    mediaGeneration.current++;
    const oldUrl = url;
    scrubTarget.current = null;
    setAnalyzedFrame(null);
    pendingFile.current = file;
    setLinkedMediaSignature(undefined);
    video.current?.pause();
    setTime(0);
    stopAt.current = null;
    const newUrl = URL.createObjectURL(file);
    if (typeof window !== "undefined") {
      (window as any).selectedFile = file;
      (window as any).__editmap_video_url = newUrl;
    }
    setUrl(newUrl);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    const cleanName = file.name.replace(/\.[^/.]+$/, "");
    setProject((curr) => {
      if (!curr) return curr;
      const shouldUpdateName = !curr.name || curr.name === "Untitled film" || curr.name === "Untitled Project";
      return {
        ...curr,
        name: shouldUpdateName ? cleanName : curr.name,
        videoMetadata: {
          filename: file.name,
          duration: candidate.duration,
          width: candidate.width,
          height: candidate.height,
          size: file.size,
        },
        screeningMarks: mismatch || !expected ? [] : curr.screeningMarks,
        updatedAt: new Date().toISOString(),
      };
    });
    setWaveform([]);
    const generation = mediaGeneration.current;
    void mediaSignature(file).then((signature) => { if (generation === mediaGeneration.current) setLinkedMediaSignature(signature); }).catch(() => undefined);
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
    if (!project || dmeAbortRef.current) return;
    const owner = project.id, generation = mediaGeneration.current;
    const controller = new AbortController();
    dmeAbortRef.current = controller;
    setIsDmeSeparating(true);
    setDmeSeparationStatus("Starting local DME engine...");
    try {
      const dme = await separateDmeAudio(file, 1400, setDmeSeparationStatus, controller.signal);
      if (controller.signal.aborted || generation !== mediaGeneration.current || projectRef.current?.id !== owner) return;
      revision.current++;
      setProject(p => p?.id === owner ? { ...p, dmeWaveforms: dme, updatedAt: new Date().toISOString() } : p);
      setDirty(true);
      setMessage("DME separation complete. Dialogue, Music, and Effects loaded.");
    } catch (err: unknown) {
      if (!controller.signal.aborted && generation === mediaGeneration.current && projectRef.current?.id === owner) setError(`DME separation error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (dmeAbortRef.current === controller) {
        dmeAbortRef.current = null;
        setIsDmeSeparating(false);
        setDmeSeparationStatus("");
      }
    }
  };

  const handleScanSpeech = async () => {
    const file = pendingFile.current;
    if (!file || !project || speechAbortRef.current) { if (!file) setError("Please connect the original video file first to scan speech."); return; }
    const owner = project.id, generation = mediaGeneration.current, controller = new AbortController();
    speechAbortRef.current = controller; setIsSpeechScanning(true); setSpeechStatus("Preparing local speech scan…");
    try {
      const signature = await mediaSignature(file);
      setLinkedMediaSignature(signature);
      const result = await scanSpeechAudio(file, signature, (job) => {
        const progress = Number.isFinite(job.progress) ? ` · ${Math.round((job.progress ?? 0) * 100)}%` : "";
        const elapsed = Number.isFinite(job.elapsedSeconds) ? ` · ${(job.elapsedSeconds ?? 0).toFixed(0)}s elapsed` : "";
        const eta = Number.isFinite(job.etaSeconds) ? ` · ~${(job.etaSeconds ?? 0).toFixed(0)}s remaining` : "";
        setSpeechStatus(`${job.phase === "provisioning" ? "Setting up Silero VAD" : "Detecting speech activity"}${progress}${elapsed}${eta}`);
      }, controller.signal);
      if (controller.signal.aborted || generation !== mediaGeneration.current || projectRef.current?.id !== owner) return;
      revision.current++; setProject((current) => current?.id === owner ? { ...current, speechAnalysis: result, updatedAt: new Date().toISOString() } : current); setDirty(true); setMessage(result.regions.length ? "Speech and pause evidence is ready." : "Speech scan complete: no speech detected.");
    } catch (cause) {
      if (!controller.signal.aborted && generation === mediaGeneration.current && projectRef.current?.id === owner) setError(`Speech scan error: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { if (speechAbortRef.current === controller) { speechAbortRef.current = null; setIsSpeechScanning(false); setSpeechStatus(""); } }
  };

  const handleScanLoudness = async () => {
    const file = pendingFile.current;
    if (!file || !project || loudnessAbortRef.current) {
      if (!file) setError("Please connect the original video file first to scan loudness.");
      return;
    }
    const owner = project.id, generation = mediaGeneration.current, controller = new AbortController();
    loudnessAbortRef.current = controller;
    setIsLoudnessScanning(true);
    setLoudnessStatus("Preparing EBU R128 loudness scan…");
    try {
      const signature = linkedMediaSignature || (await mediaSignature(file));
      setLinkedMediaSignature(signature);
      const result = await scanLoudnessAudio(file, signature, (job) => {
        const progress = Number.isFinite(job.progress) ? ` · ${Math.round((job.progress ?? 0) * 100)}%` : "";
        const elapsed = Number.isFinite(job.elapsedSeconds) ? ` · ${(job.elapsedSeconds ?? 0).toFixed(0)}s elapsed` : "";
        const eta = Number.isFinite(job.etaSeconds) ? ` · ~${(job.etaSeconds ?? 0).toFixed(0)}s remaining` : "";
        setLoudnessStatus(`Measuring EBU R128 loudness${progress}${elapsed}${eta}`);
      }, controller.signal);
      if (controller.signal.aborted || generation !== mediaGeneration.current || projectRef.current?.id !== owner) return;
      revision.current++;
      setProject((current) => current?.id === owner ? { ...current, loudnessAnalysis: result, updatedAt: new Date().toISOString() } : current);
      setDirty(true);
      setMessage(`EBU R128 loudness analysis ready: I = ${result.integratedLoudness.toFixed(1)} LUFS, LRA = ${result.loudnessRange.toFixed(1)} LU.`);
    } catch (cause) {
      if (!controller.signal.aborted && generation === mediaGeneration.current && projectRef.current?.id === owner) {
        setError(`Loudness scan error: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    } finally {
      if (loudnessAbortRef.current === controller) {
        loudnessAbortRef.current = null;
        setIsLoudnessScanning(false);
        setLoudnessStatus("");
      }
    }
  };

  const importEDL = () => {
    if (!project || !edl) return;
    try {
      const { skipped, ...result } = parseEDL(edl.text, fps, origin || undefined, { lenient: true });
      if (skipped.length) {
        const shown = skipped.slice(0, 5).map((e) => `line ${e.line}: ${e.reason}`).join("\n");
        const more = skipped.length > 5 ? `\n…and ${skipped.length - 5} more` : "";
        if (!confirm(`${skipped.length} EDL event${skipped.length === 1 ? "" : "s"} could not be read and will be left out:\n${shown}${more}\n\nImport the remaining ${result.shots.length} shots?`)) return;
      }
      const replacing = project.shots.length > 0;
      if (replacing && !confirm(`Replace the current ${project.shots.length}-shot timeline with ${result.shots.length} shots? This is undoable. Only annotations on exact source/timing matches are retained.`)) return;
      detectAbortRef.current?.abort();
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
  const startUnifiedAnalysis = async (
    videoUrl = url,
    options: ScanOptions = scanOptions,
    isBackground = false,
    targetProjectId?: string
  ) => {
    const currentProject = projectRef.current || project;
    if (!currentProject || !videoUrl || detectAbortRef.current) return;
    const abort = new AbortController();
    const owner = targetProjectId || currentProject.id;
    let sampler: Awaited<ReturnType<typeof createFrameSampler>> | undefined;
    detectAbortRef.current = abort;

    const totalDur = currentProject.duration || video.current?.duration || 1;
    let workingShots: Shot[] = [...currentProject.shots];

    // Identify active foreground stages for smooth progress calculation
    const activeForegroundStages: AnalysisStage[] = [
      options.cuts ? "cuts" : null,
      options.framing ? "framing" : null,
      options.cast ? "characters" : null,
      options.dialogue ? "dialogue" : null,
      options.loudness ? "loudness" : null,
    ].filter(Boolean) as AnalysisStage[];

    const stageWeights: Record<AnalysisStage, number> = {
      cuts: 20,
      framing: 35,
      characters: 25,
      dialogue: 10,
      loudness: 10,
      motion: 0,
      stems: 0,
      done: 0,
    };

    const calcOverallProgress = (stage: AnalysisStage, subPercent: number) => {
      let totalW = 0;
      for (const s of activeForegroundStages) totalW += stageWeights[s];
      if (totalW === 0) return 100;

      let doneW = 0;
      for (const s of activeForegroundStages) {
        if (s === stage) {
          doneW += (stageWeights[s] * Math.min(100, Math.max(0, subPercent))) / 100;
          break;
        }
        doneW += stageWeights[s];
      }
      return Math.round((doneW / totalW) * 100);
    };

    const stageLabels: Record<AnalysisStage, string> = {
      cuts: "Cuts",
      framing: "Framing",
      characters: "Cast",
      dialogue: "Dialogue",
      loudness: "Loudness",
      motion: "Motion",
      stems: "Stems",
      done: "Complete",
    };

    const initialStage = activeForegroundStages[0] || "done";

    const updateProgress = (
      stage: AnalysisStage,
      subPercent: number,
      statusText: string,
      extra?: {
        cutsFound?: number;
        currentTime?: number;
        framingDone?: number;
        facesFound?: number;
        previewImage?: string;
        previewDescription?: string;
      }
    ) => {
      const overallPercent = calcOverallProgress(stage, subPercent);
      const roundedSubPercent = Math.min(100, Math.round(subPercent));
      if (isBackground) {
        setBgScanStatus((prev) => ({
          active: true,
          stage,
          stageLabel: stageLabels[stage] || stage,
          progress: overallPercent,
          stageProgress: roundedSubPercent,
          statusText,
          motionActive: prev?.motionActive ?? options.motion,
          motionProgress: prev?.motionProgress ?? 0,
          stemsActive: prev?.stemsActive ?? options.stems,
          stemsStatusText: prev?.stemsStatusText ?? "",
        }));
      } else {
        setAnalysisProgress((prev) => prev ? {
          ...prev,
          stage,
          overallPercent,
          statusText,
          cutsFound: extra?.cutsFound !== undefined ? extra.cutsFound : prev.cutsFound,
          currentTime: extra?.currentTime !== undefined ? extra.currentTime : prev.currentTime,
          framingDone: extra?.framingDone !== undefined ? extra.framingDone : prev.framingDone,
          facesFound: extra?.facesFound !== undefined ? extra.facesFound : prev.facesFound,
          previewImage: extra?.previewImage !== undefined ? extra.previewImage : prev.previewImage,
          previewDescription: extra?.previewDescription !== undefined ? extra.previewDescription : prev.previewDescription,
        } : prev);
      }
    };

    if (isBackground) {
      setAnalysisProgress(null);
      setBgScanStatus({
        active: true,
        stage: initialStage,
        stageLabel: stageLabels[initialStage] || "Scan",
        progress: 0,
        stageProgress: 0,
        statusText: options.cuts ? "Detecting scene cuts..." : "Preparing unified analysis...",
        motionActive: options.motion,
        motionProgress: 0,
        stemsActive: options.stems,
        stemsStatusText: "",
      });
    } else {
      setAnalysisProgress({
        stage: initialStage,
        overallPercent: 0,
        cutsFound: workingShots.length,
        currentTime: 0,
        totalDuration: totalDur,
        framingDone: 0,
        framingTotal: workingShots.length,
        facesFound: 0,
        statusText: options.cuts ? "Detecting scene cuts..." : "Preparing unified analysis...",
        fullPipeline: true,
        options,
      });
    }

    try {
      // -------------------------------------------------------------
      // STAGE 1: CUT DETECTION
      // -------------------------------------------------------------
      if (options.cuts) {
        const detectedShots = await detectVideoShots(pendingFile.current ?? videoUrl, {
          fps: project.frameRate || 24,
          dropFrame: project.dropFrame,
          signal: abort.signal,
          onProgress: (p) => {
            const currentTc = formatTimecode(p.currentTime, project.frameRate, project.dropFrame);
            const totalTc = formatTimecode(p.totalDuration, project.frameRate, project.dropFrame);
            const detectorLabel = p.detector === "transnet" ? "TransNet V2" : "Browser";
            const statusText = `Scanning cuts (${detectorLabel}) · ${p.shotsCount} cuts · ${currentTc} / ${totalTc}`;
            updateProgress("cuts", p.percent, statusText, {
              cutsFound: p.shotsCount,
              currentTime: p.currentTime,
            });
          },
          onDetector: (detector) => {
            const statusText = detector === "transnet"
              ? "Scanning cuts (TransNet V2)..."
              : "Scanning cuts (Browser engine)...";
            updateProgress("cuts", 0, statusText);
          },
        });

        if (abort.signal.aborted) return;
        if (detectedShots.length === 0) {
          setMessage("No cuts detected. Ensure the video plays properly.");
          return;
        }

        workingShots = detectedShots;
        const maxDur = Math.max(
          ...workingShots.map((s) => s.endSeconds),
          project.duration,
          project.videoMetadata?.duration || 0,
        );

        // Immediate progressive render on timeline!
        recordHistory(projectRef.current || project);
        revision.current++;
        setProject((curr) => {
          if (!curr) return curr;
          return {
            ...curr,
            shots: workingShots,
            duration: maxDur,
            updatedAt: new Date().toISOString(),
          };
        });
        if (projectRef.current) {
          projectRef.current.shots = workingShots;
          projectRef.current.duration = maxDur;
        }
        setIsInitialScanDismissed(true);
        setEdlRevision((rev) => rev + 1);
        setDirty(true);
        setSelected(undefined);
        setSelectedCut(undefined);
        setSelectedRange(undefined);
      }

      if (workingShots.length === 0) {
        setError("No shots available to analyze. Please run cut detection or import an EDL first.");
        return;
      }

      // -------------------------------------------------------------
      // STAGE 2: FRAMING & SHOT SIZES
      // -------------------------------------------------------------
      let framingFailed = 0;
      let firstFramingFailure = "";
      if (options.framing && !abort.signal.aborted) {
        updateProgress("framing", 0, `Analyzing framing across ${workingShots.length} shots...`, {
          framingDone: 0,
        });

        sampler = await createFrameSampler(videoUrl, abort.signal);
        let updatedShots = [...workingShots];

        for (let i = 0; i < workingShots.length; i++) {
          if (abort.signal.aborted) break;
          const currentShot = workingShots[i];
          try {
            const samples = await sampleShotFrames(sampler, currentShot.startSeconds, currentShot.endSeconds);
            if (abort.signal.aborted) break;

            const tags = await analyzeFrames(samples.images, AbortSignal.any([abort.signal, AbortSignal.timeout(120000)]));
            if (abort.signal.aborted) break;

            updatedShots[i] = {
              ...currentShot,
              ...tags,
              reviewStatus: "Needs review",
            };

            applyShotPatch(owner, currentShot.id, { ...tags, reviewStatus: "Needs review", suggestion: { ...tags, model: tags.model ?? MODEL, createdAt: new Date().toISOString() }, analysisFailures: undefined });
            const framingPercent = Math.round(((i + 1) / workingShots.length) * 100);

            updateProgress("framing", framingPercent, `Analyzing framing · ${i + 1} of ${workingShots.length} shots (${framingPercent}%)`, {
              framingDone: i + 1,
              previewImage: samples.previewImage,
              previewDescription: `Shot ${i + 1}: ${tags.shotSize} · ${tags.composition}`,
            });
          } catch (e) {
            if (abort.signal.aborted) break;
            const failure = { framing: { message: e instanceof Error ? e.message : "Framing failed", createdAt: new Date().toISOString() } };
            framingFailed++;
            firstFramingFailure ||= failure.framing.message;
            updatedShots[i] = { ...currentShot, analysisFailures: failure };
            applyShotPatch(owner, currentShot.id, { analysisFailures: failure });
          }
        }
        workingShots = updatedShots;
      }

      if (abort.signal.aborted) {
        sampler?.dispose();
        return;
      }

      // -------------------------------------------------------------
      // STAGE 3: CHARACTER DISCOVERY & CLUSTERING
      // -------------------------------------------------------------
      let newCast: CastMember[] = [];
      let newAnalyses = new Map<string, CharacterAnalysis>();

      if (options.cast && !abort.signal.aborted) {
        if (!sampler) sampler = await createFrameSampler(videoUrl, abort.signal);
        const peopleShots = workingShots.filter(isEligibleForCharacterScan);
        updateProgress("characters", 0, `Discovering characters across ${peopleShots.length} shots with people...`);

        if (peopleShots.length > 0) {
          try {
            const autoResult = await discoverCharactersAcrossShots(
              workingShots,
              sampler,
              abort.signal,
              {
                existingCast: projectRef.current?.cast ?? [],
                onCheckpoint: (id, analysis) => applyShotPatch(owner, id, { characterAnalysis: analysis }),
                minAppearances: peopleShots.length >= 2 ? 2 : 1,
                onProgress: (p) => {
                  const charPercent = Math.round((p.completedShots / p.totalShots) * 100);
                  const statusText = p.stage === "sampling"
                    ? `Scanning faces · ${p.completedShots}/${p.totalShots} shots (${p.facesFound} faces found)`
                    : `Clustering ${p.facesFound} faces into characters...`;
                  updateProgress("characters", charPercent, statusText, {
                    facesFound: p.facesFound,
                  });
                },
                onFrame: (shot, time, img) => {
                  if (!isBackground) {
                    setAnalysisProgress((prev) => prev ? {
                      ...prev,
                      previewImage: img,
                      previewDescription: `Shot ${shot.index} (${formatTimecode(time, project.frameRate, project.dropFrame)}): detecting cast`,
                    } : prev);
                  }
                },
              }
            );

            if (!abort.signal.aborted) {
              newCast = autoResult.cast;
              newAnalyses = autoResult.shotAnalyses;
              workingShots = workingShots.map((s) => {
                const analysis = newAnalyses.get(s.id);
                return analysis ? { ...s, characterAnalysis: analysis } : s;
              });
              revision.current++;
              setProject((curr) => {
                if (!curr) return curr;
                const nextShots = curr.shots.map(s => {
                  const analysis = newAnalyses.get(s.id);
                  return !analysis || s.characterAnalysis?.reviewStatus === "Confirmed" || s.characterAnalysis?.manualReviewStatus === "Confirmed" ? s : { ...s, characterAnalysis: analysis };
                });
                const nextCast = mergeDiscoveredCast(curr.cast ?? [], newCast);
                if (projectRef.current) {
                  projectRef.current.shots = nextShots;
                  projectRef.current.cast = nextCast;
                }
                return {
                  ...curr,
                  shots: nextShots,
                  cast: nextCast,
                  updatedAt: new Date().toISOString(),
                };
              });
            }
          } catch (e) {
            if (!abort.signal.aborted) console.warn("Character scan error:", e);
          }
        }
      }

      sampler?.dispose();
      sampler = undefined;

      // -------------------------------------------------------------
      // STAGE 4: DIALOGUE SPEECH SCAN
      // -------------------------------------------------------------
      const file = pendingFile.current ?? (typeof window !== "undefined" ? (window as any).selectedFile : undefined);
      if (options.dialogue && file && !abort.signal.aborted) {
        updateProgress("dialogue", 0, "Preparing speech VAD scan...");

        try {
          const signature = linkedMediaSignature || (await mediaSignature(file));
          setLinkedMediaSignature(signature);

          const speechResult = await scanSpeechAudio(file, signature, (job) => {
            const progress = Number.isFinite(job.progress) ? Math.round((job.progress ?? 0) * 100) : 0;
            updateProgress("dialogue", progress, `Scanning speech VAD · ${progress}%`);
          }, abort.signal);

          if (!abort.signal.aborted) {
            revision.current++;
            setProject((curr) => {
              if (!curr) return curr;
              if (projectRef.current) {
                projectRef.current.speechAnalysis = speechResult;
              }
              return { ...curr, speechAnalysis: speechResult, updatedAt: new Date().toISOString() };
            });
          }
        } catch (err) {
          if (!abort.signal.aborted) console.warn("Speech scan skipped or failed:", err);
        }
      }

      // -------------------------------------------------------------
      // STAGE 5: LOUDNESS SCAN
      // -------------------------------------------------------------
      if (options.loudness && file && !abort.signal.aborted) {
        updateProgress("loudness", 0, "Preparing EBU R128 loudness scan...");

        try {
          const signature = linkedMediaSignature || (await mediaSignature(file));
          setLinkedMediaSignature(signature);

          const loudnessResult = await scanLoudnessAudio(file, signature, (job) => {
            const progress = Number.isFinite(job.progress) ? Math.round((job.progress ?? 0) * 100) : 0;
            updateProgress("loudness", progress, `Measuring EBU R128 loudness · ${progress}%`);
          }, abort.signal);

          if (!abort.signal.aborted) {
            revision.current++;
            setProject((curr) => {
              if (!curr) return curr;
              if (projectRef.current) {
                projectRef.current.loudnessAnalysis = loudnessResult;
              }
              return { ...curr, loudnessAnalysis: loudnessResult, updatedAt: new Date().toISOString() };
            });
          }
        } catch (err) {
          if (!abort.signal.aborted) console.warn("Loudness scan skipped or failed:", err);
        }
      }

      // -------------------------------------------------------------
      // AUTOMATIC EYE-TRACE & CUT SACCADE DYNAMICS SCAN
      // -------------------------------------------------------------
      if (videoUrl && workingShots.length >= 2 && !abort.signal.aborted) {
        try {
          const eyeAnnotations = await scanProjectEyeTrace(
            workingShots,
            projectRef.current?.cutAnnotations,
            videoUrl,
            project.frameRate || 24,
            undefined,
            abort.signal
          );
          if (!abort.signal.aborted && eyeAnnotations.length > 0) {
            revision.current++;
            if (projectRef.current) {
              projectRef.current.cutAnnotations = eyeAnnotations;
            }
            setProject((curr) => {
              if (!curr) return curr;
              return {
                ...curr,
                cutAnnotations: eyeAnnotations,
                updatedAt: new Date().toISOString(),
              };
            });
          }
        } catch (err) {
          if (!abort.signal.aborted) console.warn("Eye-trace batch scan skipped or failed:", err);
        }
      }

      // Complete foreground modal overlay if active
      setAnalysisProgress(null);

      // -------------------------------------------------------------
      // STAGE 6 & 7: ASYNCHRONOUS BACKGROUND SCANS (MOTION & STEMS)
      // -------------------------------------------------------------
      if ((options.motion || options.stems) && !abort.signal.aborted) {
        setBgScanStatus({
          active: true,
          stage: "motion",
          stageLabel: "Motion & Stems",
          progress: 0,
          stageProgress: 0,
          statusText: "Analyzing motion energy & DME stems...",
          motionActive: options.motion,
          motionProgress: 0,
          stemsActive: options.stems,
          stemsStatusText: options.stems ? "Preparing DME stem separation..." : "",
        });

        await Promise.allSettled([
          // Stage 6: Motion energy scanning
          (async () => {
            if (options.motion && !abort.signal.aborted) {
              try {
                const shotsToScan = projectRef.current?.shots || workingShots;
                let currentShots = [...shotsToScan];
                for (let i = 0; i < currentShots.length; i++) {
                  if (abort.signal.aborted) break;
                  const shot = currentShots[i];
                  if (!shot.motionProfile) {
                    try {
                      const profile = await analyzeShotMotion(videoUrl, shot, abort.signal);
                      if (abort.signal.aborted) break;
                      currentShots[i] = {
                        ...shot,
                        motionProfile: profile,
                        cameraMovement: shot.cameraMovement ?? profile.cameraMovement,
                      };
                      applyShotPatch(owner, shot.id, {
                        motionProfile: profile,
                        cameraMovement: shot.cameraMovement ?? profile.cameraMovement,
                      });
                    } catch {
                      // Continue to next shot
                    }
                  }
                  const p = Math.round(((i + 1) / currentShots.length) * 100);
                  setBgScanStatus((prev) => prev ? {
                    ...prev,
                    motionProgress: p,
                    stageProgress: p,
                    progress: p,
                    statusText: `Analyzing motion energy (${p}%)`,
                  } : null);
                }
              } catch (e) {
                console.warn("Background motion scan error:", e);
              }
              setBgScanStatus((prev) => prev ? { ...prev, motionActive: false } : null);
            }
          })(),

          // Stage 7: DME Stems separation
          (async () => {
            if (options.stems && file && !abort.signal.aborted) {
              try {
                const dme = await separateDmeAudio(
                  file,
                  1400,
                  (statusStr) => setBgScanStatus((prev) => prev ? {
                    ...prev,
                    stemsStatusText: statusStr,
                    statusText: statusStr,
                  } : null),
                  abort.signal
                );
                if (!abort.signal.aborted) {
                  revision.current++;
                  if (projectRef.current) {
                    projectRef.current.dmeWaveforms = dme;
                  }
                  setProject((p) => {
                    if (!p) return p;
                    return { ...p, dmeWaveforms: dme, updatedAt: new Date().toISOString() };
                  });
                  setDirty(true);
                }
              } catch (e) {
                console.warn("Background DME separation error:", e);
              }
              setBgScanStatus((prev) => prev ? { ...prev, stemsActive: false } : null);
            }
          })(),
        ]);
      }

      setBgScanStatus(null);
      setEdlRevision((rev) => rev + 1);
      setDirty(true);
      if (options.cast) setDeckTab("cast");
      if (framingFailed > 0) {
        const detail = `Framing failed for ${framingFailed} of ${workingShots.length} shots (${firstFramingFailure}). Those shots stay untagged and can be retried.`;
        if (framingFailed === workingShots.length) setError(`Analysis finished without framing results. ${detail}`);
        else setMessage(`Analysis finished with problems. ${detail}`);
      } else {
        setMessage("Multi-scan analysis sequence completed.");
      }

    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessage("Analysis cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Analysis failed.");
      }
    } finally {
      sampler?.dispose();
      if (detectAbortRef.current === abort) {
        setAnalysisProgress(null);
        setBgScanStatus(null);
        detectAbortRef.current = null;
      }
    }
  };

  const startSceneDetection = (videoUrl = url) =>
    startUnifiedAnalysis(videoUrl, { ...QUICK_ANALYSIS_PRESET, framing: false, cast: false, dialogue: false, loudness: false });

  const handleEnterScreeningRoom = (customUrl?: string, customFile?: File) => {
    setIsScreeningRoomEntered(true);
    const file = customFile ?? pendingFile.current ?? (typeof window !== "undefined" ? (window as any).selectedFile : undefined);
    if (file && !pendingFile.current) {
      pendingFile.current = file;
    }
    const targetUrl = customUrl ?? url ?? (file ? URL.createObjectURL(file) : "");
    if (!targetUrl && !file) return;

    if (!url && targetUrl) {
      setUrl(targetUrl);
    }

    if (detectAbortRef.current) return;

    // Run full scan with all scanners in background!
    // Cuts will automatically detect shots if no shots exist yet; if shots already exist, preserve cuts.
    const effectiveOptions: ScanOptions = {
      ...FULL_ANALYSIS_PRESET,
      cuts: (projectRef.current?.shots.length ?? 0) === 0,
    };

    void startUnifiedAnalysis(targetUrl, effectiveOptions, true);
  };

  const handleChangeFilm = useCallback(() => {
    if (video.current && !video.current.paused) {
      video.current.pause();
    }
    const iframe = document.querySelector(".duet-console-iframe") as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({ type: "PAUSE" }, "*");
    setIsScreeningRoomEntered(false);
    setWorkspaceMode("screening");
    iframe?.contentWindow?.postMessage({ type: "SHOW_ONBOARDING", canCancel: true }, "*");
  }, []);

  const handleExportEdlMarkers = useCallback(() => {
    const iframe = document.querySelector(".duet-console-iframe") as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({ type: "EXPORT_EDL" }, "*");
  }, []);

  const executeNewProjectFromVideo = useCallback(async (file: File | string, name: string) => {
    const fileName = typeof file === "string" ? file.split("/").pop() || file : file.name;
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    const currentP = projectRef.current;

    // 1. If current project in memory already matches, preserve it!
    if (
      currentP &&
      (currentP.videoMetadata?.filename === fileName || currentP.name === baseName || currentP.name === fileName)
    ) {
      if (currentP.name === "Untitled film") {
        currentP.name = baseName;
        setProject((p) => (p ? { ...p, name: baseName, updatedAt: new Date().toISOString() } : p));
      }
      if (typeof file !== "string") {
        pendingFile.current = file;
        setUrl(URL.createObjectURL(file));
      } else if (file) {
        setUrl(file);
      }
      setIsScreeningRoomEntered(true);
      return;
    }

    // 2. Check if this film was already scanned and saved in IndexedDB!
    try {
      const savedProjects = await listProjects();
      const matched = savedProjects.find(
        (sp) =>
          sp.shots &&
          sp.shots.length > 0 &&
          (sp.videoMetadata?.filename === fileName || sp.name === baseName || sp.name === fileName)
      );
      if (matched) {
        if (matched.name === "Untitled film") {
          matched.name = baseName;
        }
        replace(matched);
        if (typeof file !== "string") {
          pendingFile.current = file;
          setUrl(URL.createObjectURL(file));
        } else {
          setUrl(file);
        }
        setIsInitialScanDismissed(true);
        setIsScreeningRoomEntered(true);
        return;
      }
    } catch (e) {
      console.warn("Could not query saved projects:", e);
    }

    // 3. Brand new unscanned film
    const p = newProject();
    p.name = baseName || name || "Film Cut";
    if (typeof file !== "string") {
      p.videoMetadata = {
        filename: file.name,
        duration: p.duration || 0,
        width: 1920,
        height: 1080,
        size: file.size,
      };
    }
    projectRef.current = p;
    replace(p);
    projectRef.current = p;
    const targetUrl = typeof file === "string" ? file : URL.createObjectURL(file);
    if (typeof file !== "string") {
      pendingFile.current = file;
    }
    setUrl(targetUrl);
    setWorkspaceMode("screening");
    setIsScreeningRoomEntered(true);

    // Auto-start background scan while screening if not already running
    if (!detectAbortRef.current && targetUrl) {
      void startUnifiedAnalysis(targetUrl, FULL_ANALYSIS_PRESET, true, p.id);
    }
  }, [replace, startUnifiedAnalysis]);

  const syncDuetMarkersToProject = useCallback((duetMarkers: any[]) => {
    if (!Array.isArray(duetMarkers)) return;
    setProject((curr) => {
      if (!curr) return curr;
      const existing = curr.screeningMarks ?? [];
      const updatedMarks: ScreeningMark[] = duetMarkers.map((dm, idx) => {
        const id = String(dm.id || `duet-mark-${idx}-${dm.seconds ?? dm.time}`);
        const mTime = typeof dm.seconds === "number" ? dm.seconds : typeof dm.time === "number" ? dm.time : 0;
        const prev = existing.find((e) => e.id === id);
        return {
          id,
          passId: prev?.passId || "screening-pass-1",
          time: mTime,
          anchorTime: prev?.anchorTime ?? mTime,
          createdAt: prev?.createdAt || new Date().toISOString(),
          mirror: false,
          darken: false,
          muted: false,
          notes: dm.note || dm.notes || prev?.notes || "",
          resolved: Boolean(dm.solved || dm.resolved || prev?.resolved),
          colorHex: dm.colorHex || dm.hex || (dm.colorKey === "1" ? "#f43f5e" : dm.colorKey === "2" ? "#fbbf24" : dm.colorKey === "3" ? "#34d399" : dm.colorKey === "4" ? "#38bdf8" : "#e5a93c"),
          colorKey: dm.colorKey || dm.key,
          authorName: dm.authorName || prev?.authorName || "Reviewer",
          authorAvatar: dm.authorAvatar || prev?.authorAvatar || "🎬",
          smpte: dm.smpte || prev?.smpte || formatTimecode(mTime, curr.frameRate, curr.dropFrame),
          thumbnail: dm.thumbnail || prev?.thumbnail,
        };
      });
      return {
        ...curr,
        screeningMarks: updatedMarks,
        updatedAt: new Date().toISOString(),
      };
    });
    setDirty(true);
  }, []);

  const ensureStudioVideoReady = useCallback(() => {
    try {
      const iframe = document.querySelector(".duet-console-iframe") as HTMLIFrameElement | null;
      const win = iframe?.contentWindow as any;
      if (win) {
        const duetTime = typeof win.video?.currentTime === "number" ? win.video.currentTime : playhead.get();
        if (win.selectedFile) {
          const selectedFile = win.selectedFile;
          pendingFile.current = selectedFile;
          const targetUrl = url && url.startsWith("blob:") ? url : URL.createObjectURL(selectedFile);
          setUrl(targetUrl);
          if (video.current) {
            if (video.current.src !== targetUrl) {
              video.current.src = targetUrl;
            }
            video.current.currentTime = duetTime;
          }
          if (projectRef.current && projectRef.current.shots.length === 0 && selectedFile.name) {
            const fileName = selectedFile.name;
            const baseName = fileName.replace(/\.[^/.]+$/, "");
            void listProjects().then((savedProjects) => {
              const matched = savedProjects.find(
                (sp) =>
                  sp.shots &&
                  sp.shots.length > 0 &&
                  (sp.videoMetadata?.filename === fileName || sp.name === baseName || sp.name === fileName)
              );
              if (matched) {
                replace(matched);
                pendingFile.current = selectedFile;
                setUrl(targetUrl);
                if (video.current) {
                  video.current.src = targetUrl;
                  video.current.currentTime = duetTime;
                }
                setIsInitialScanDismissed(true);
                if (Array.isArray(win.markers) && win.markers.length > 0) {
                  syncDuetMarkersToProject(win.markers);
                }
              }
            }).catch(() => {});
          }
          if (projectRef.current) {
            setIsInitialScanDismissed(true);
            if (!projectRef.current.videoMetadata || !projectRef.current.videoMetadata.filename) {
              setProject((p) => p ? {
                ...p,
                videoMetadata: {
                  filename: selectedFile.name,
                  duration: p.duration,
                  width: win.video?.videoWidth || 1920,
                  height: win.video?.videoHeight || 1080,
                  size: selectedFile.size,
                },
                updatedAt: new Date().toISOString(),
              } : p);
            }
          }
        } else if (win.video?.src && !url) {
          setUrl(win.video.src);
          if (video.current) {
            video.current.src = win.video.src;
            video.current.currentTime = duetTime;
          }
        }
        if (Array.isArray(win.markers) && win.markers.length > 0) {
          syncDuetMarkersToProject(win.markers);
        }
        setIsInitialScanDismissed(true);
      }
    } catch (e) {
      console.warn("Could not sync video/markers from Duet console:", e);
    }
  }, [url, syncDuetMarkersToProject]);
  const applyShotPatch = (projectId: string, shotId: string, patch: Partial<Shot>, human = false) => {
    if (human) recordHistory(project);
    revision.current++;
    setProject((currentProject) => {
      if (!currentProject) return currentProject;
      const hasShot = currentProject.shots.some((s) => s.id === shotId);
      if (currentProject.id !== projectId && !hasShot) return currentProject;
      const updatedProject = {
        ...currentProject,
        updatedAt: new Date().toISOString(),
        shots: currentProject.shots.map((item) => {
          if (item.id !== shotId) return item;
          const protectedFields = human
            ? [...new Set([...(item.protectedFields ?? []), ...(["shotSize", "composition", "content", "uncertain", "notes", "cameraMovement"] as const).filter((field) => field in patch)])]
            : item.protectedFields;
          const isConfirmed = item.reviewStatus === "Confirmed";
          const safePatch = human
            ? patch
            : (Object.fromEntries(
                Object.entries(patch).filter(([field]) => {
                  if (field === "suggestion" || field === "analysisFailures") return true;
                  if (isConfirmed) return false;
                  if (field === "reviewStatus") return true;
                  return !item.protectedFields?.includes(field as any);
                }),
              ) as Partial<Shot>);
          return updateShotTags(item, { ...safePatch, protectedFields });
        }),
      };
      if (projectRef.current) {
        projectRef.current = updatedProject;
      }
      return updatedProject;
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
    const targetShot = shot ?? current;
    if (!project || !targetShot || !url) return;
    try {
      const time = (targetShot.startSeconds + targetShot.endSeconds) / 2;
      const image = await sampleFrame(url, time, new AbortController().signal);
      recordHistory(project);
      setProject((currentProject) => currentProject && currentProject.id === project.id ? {
        ...currentProject, updatedAt: new Date().toISOString(),
        cast: (currentProject.cast ?? []).map((member) => member.id === memberId ? { ...member, references: [...member.references, { id: crypto.randomUUID(), image, shotId: targetShot.id, time }] } : member),
      } : currentProject);
      setDirty(true);
      previewAnalysis(targetShot, time, image);
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
    update({
      shots: project.shots.map((item) =>
        item.id === shotId && item.characterAnalysis
          ? {
              ...item,
              characterAnalysis: {
                ...item.characterAnalysis,
                reviewStatus: "Confirmed",
                intervals: item.characterAnalysis.intervals.filter(
                  (interval) => interval.memberId !== memberId
                ),
                manualMemberIds: item.characterAnalysis.manualMemberIds?.filter(
                  (id) => id !== memberId
                ),
              },
            }
          : item
      ),
    });
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
      <ProjectHeader
        project={project}
        dirty={dirty}
        saveState={saveState}
        historyState={historyState}
        workspaceMode={workspaceMode}
        isScreeningSetup={isScreeningSetup}
        onModeChange={(mode) => {
          if (mode !== workspaceMode) {
            video.current?.pause();
            setPlaying(false);
            stopAt.current = null;
            playbackRange.current = null;
          }
          if (mode === "studio") {
            ensureStudioVideoReady();
            setIsInitialScanDismissed(true);
            setTimeout(() => {
              const iframe = document.querySelector(".duet-console-iframe") as HTMLIFrameElement | null;
              const win = iframe?.contentWindow as any;
              const curTime = typeof win?.video?.currentTime === "number" ? win.video.currentTime : playhead.get();
              if (video.current) {
                if (win?.selectedFile && (!video.current.src || !video.current.src.startsWith("blob:"))) {
                  video.current.src = sideLoadedUrl(win.selectedFile);
                }
                video.current.currentTime = curTime;
              }
            }, 60);
          }
          setWorkspaceMode(mode);
          if (mode === "screening" && (url || pendingFile.current) && !detectAbortRef.current && project.shots.length === 0) {
            handleEnterScreeningRoom();
          }
        }}
        onHome={() => {
          if (!dirty || confirm("Return to home screen? Unsaved changes will be lost.")) {
            replace(newProject());
            setUrl("");
            setIsScreeningRoomEntered(false);
            setWorkspaceMode("screening");
            forgetLinkedFilm();
            const iframe = document.querySelector(".duet-console-iframe") as HTMLIFrameElement | null;
            iframe?.contentWindow?.postMessage({ type: "SHOW_ONBOARDING" }, "*");
          }
        }}
        onNew={() => {
          if (
            !dirty ||
            confirm("Discard unsaved changes and create a project?")
          ) {
            replace(newProject());
            setUrl("");
            setIsScreeningRoomEntered(false);
            // The film picker is on the Screening setup screen; Studio has nothing to show yet.
            setWorkspaceMode("screening");
            forgetLinkedFilm();
            const iframe = document.querySelector(".duet-console-iframe") as HTMLIFrameElement | null;
            iframe?.contentWindow?.postMessage({ type: "SHOW_ONBOARDING" }, "*");
          }
        }}
        onOpen={() => void open()}
        onSave={() => void save()}
        onUndo={() => restoreHistory("undo")}
        onRedo={() => restoreHistory("redo")}
        onImportVideo={openVideoPicker}
        onImportEdl={() => { setWorkspaceMode("studio"); edlInput.current?.click(); }}
        onImportProject={() => backupInput.current?.click()}
        onExportProject={exportProject}
        onExportPDF={() => setReportModalOpen(true)}
        onAnalyze={() => {
          if (!project || !url) return;
          if (project.shots.length === 0) {
            setIsInitialScanDismissed(false);
            return;
          }
          if (project.shots.length > 0) {
            setScanOptions(prev => ({ ...prev, cuts: false }));
          }
          setShowScanConfigModal(true);
        }}
        isAnalyzing={Boolean(analysisProgress || bgScanStatus)}
        hasVideo={Boolean(url)}
        onProjectNameChange={(name) => update({ name })}
        onOpenSettings={() => setScannerSettingsOpen(true)}
        onOpenProjector={() => {
          const iframe = document.querySelector(".duet-console-iframe") as HTMLIFrameElement | null;
          iframe?.contentWindow?.postMessage({ type: "OPEN_PROJECTOR" }, "*");
        }}
        showChangeFilm={isScreeningRoomEntered && (workspaceMode === "screening" || workspaceMode === "review")}
        onChangeFilm={handleChangeFilm}
        onExportEdlMarkers={handleExportEdlMarkers}
      />
      <input
        hidden
        ref={videoInput}
        type="file"
        accept="video/*,.mkv,.mov"
        aria-label="Import video"
        onChange={(e) => {
          void loadVideo(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
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
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="saved-projects-heading"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSaved(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSaved(null);
          }}
        >
          <div className="open-panel panel modal-dialog-panel">
            <div className="section-head">
              <h2 id="saved-projects-heading" className="modal-title">Saved projects</h2>
              <button type="button" onClick={() => setSaved(null)} aria-label="Close saved projects dialog">Close</button>
            </div>
            <div className="modal-body">
              {!saved.length ? (
                <p>No saved projects in this browser yet.</p>
              ) : (
                saved.map((p) => (
                  <button
                    type="button"
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
          </div>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <>
        <div
          style={workspaceMode === "screening" || workspaceMode === "review" ? { display: "contents" } : { display: "none" }}
          aria-hidden={workspaceMode !== "screening" && workspaceMode !== "review"}
        >
          <DuetConsole
            project={project}
            videoUrl={url}
            workspaceMode={workspaceMode}
            onModeChange={(m) => {
              if (m === "studio") {
                ensureStudioVideoReady();
                setIsInitialScanDismissed(true);
                setTimeout(() => {
                  const iframe = document.querySelector(".duet-console-iframe") as HTMLIFrameElement | null;
                  const win = iframe?.contentWindow as any;
                  const curTime = typeof win?.video?.currentTime === "number" ? win.video.currentTime : playhead.get();
                  if (video.current) {
                    if (win?.selectedFile && (!video.current.src || !video.current.src.startsWith("blob:"))) {
                      video.current.src = sideLoadedUrl(win.selectedFile);
                    }
                    video.current.currentTime = curTime;
                  }
                }, 60);
              }
              setWorkspaceMode(m);
            }}
            onSelectProject={(p) => {
              if (project?.id === p.id) return;
              if (dirty) {
                setFilmReplacementPending({ type: "project", project: p });
                return;
              }
              replace(p);
            }}
            onSelectProjectId={async (id, projectName) => {
              try {
                let p = await getProject(id);
                if (!p) {
                  p = { ...newProject(), id, name: projectName || "New Film Cut" };
                }
                if (project?.id === p.id) return;
                if (dirty) {
                  setFilmReplacementPending({ type: "project", project: p });
                  return;
                }
                replace(p);
              } catch (e) {
                if (dirty) {
                  setFilmReplacementPending({
                    type: "project",
                    project: { ...newProject(), id, name: projectName || "New Film Cut" },
                  });
                }
              }
            }}
            onNewProjectFromVideo={async (file, name) => {
              const fileName = typeof file === "string" ? file.split("/").pop() || file : file.name;
              const baseName = fileName.replace(/\.[^/.]+$/, "");
              const currentP = projectRef.current;

              // Check if same film
              const isSameFilm = Boolean(
                currentP && (
                  currentP.videoMetadata?.filename === fileName ||
                  currentP.name === baseName ||
                  currentP.name === fileName ||
                  (pendingFile.current && pendingFile.current.name === fileName)
                )
              );

              if (isSameFilm) {
                await executeNewProjectFromVideo(file, name);
                return;
              }

              if (dirty) {
                setFilmReplacementPending({ type: "file", file, name });
                return;
              }

              await executeNewProjectFromVideo(file, name);
            }}
            onTimeSync={(t) => setTime(t)}
            onEnterScreeningRoom={handleEnterScreeningRoom}
            bgScanStatus={bgScanStatus}
            onMarkersUpdate={syncDuetMarkersToProject}
          />
        </div>
          <div
            style={workspaceMode === "explore" ? { display: "contents" } : { display: "none" }}
            aria-hidden={workspaceMode !== "explore"}
          >
            <ExploreWorkspace
              key={project.id}
              project={project}
              url={url}
              mediaSignature={linkedMediaSignature}
              thumbnails={thumbnails}
              colorProfiles={colorProfiles}
              activeWorkspace={workspaceMode === "explore" ? "explore" : "studio"}
              onUpdateProject={update}
              onLocateInStudio={(shotId, sourceTime, sequenceId) => {
                setTime(sourceTime);
                setSelected(shotId);
                if (sequenceId) {
                  setSelectedSequenceId(sequenceId);
                  setDeckTab("sequence");
                }
                setWorkspaceMode("studio");
              }}
              onRelinkVideo={openVideoPicker}
            />
          </div>
          <main
            ref={workspaceRef}
            className={`workspace mode-${workspaceMode}${mapExpanded ? " studio-map-expanded" : ""}`}
            style={{
              "--left-panel-width": leftCollapsed ? "0px" : `${leftWidth}px`,
              "--right-panel-width": rightCollapsed ? "0px" : `${rightWidth}px`,
              display: workspaceMode === "studio" ? undefined : "none",
            } as React.CSSProperties}
            aria-hidden={workspaceMode !== "studio"}
          >
          {project.shots.length === 0 && url && !analysisProgress && !bgScanStatus && !isInitialScanDismissed && (
            <div
              className="scene-detect-modal unified-analysis-modal"
              onClick={(e) => {
                if (e.target === e.currentTarget) setIsInitialScanDismissed(true);
              }}
            >
              <section className="modal panel scene-detect-prompt unified-scan-panel" style={{ width: 660, maxWidth: "94vw", position: "relative" }}>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setIsInitialScanDismissed(true)}
                  title="Close (Esc)"
                  style={{
                    position: "absolute",
                    top: 14,
                    right: 14,
                    background: "transparent",
                    border: "none",
                    color: "#94a3b8",
                    fontSize: 20,
                    cursor: "pointer",
                    padding: "4px 8px",
                    lineHeight: 1,
                    borderRadius: 6,
                  }}
                >
                  ✕
                </button>

                <div className="unified-scan-header" style={{ paddingRight: 40 }}>
                  <b>Film connected: {project.videoMetadata?.filename || "Video ready"}</b>
                  <small>Select an analysis preset or customize individual scan steps for this film.</small>
                </div>

                <div className="preset-selector-row">
                  <button
                    type="button"
                    className={`preset-btn ${
                      scanOptions.cuts && scanOptions.framing && scanOptions.cast && scanOptions.dialogue && scanOptions.loudness && !scanOptions.motion && !scanOptions.stems
                        ? "active"
                        : ""
                    }`}
                    onClick={() => setScanOptions(QUICK_ANALYSIS_PRESET)}
                  >
                    ⚡ Quick Analysis (Recommended)
                    <small>Cuts + Framing + Cast + Dialogue + Loudness (~1-2 min)</small>
                  </button>

                  <button
                    type="button"
                    className={`preset-btn ${
                      scanOptions.cuts && scanOptions.framing && scanOptions.cast && scanOptions.dialogue && scanOptions.loudness && scanOptions.motion && scanOptions.stems
                        ? "active"
                        : ""
                    }`}
                    onClick={() => setScanOptions(FULL_ANALYSIS_PRESET)}
                  >
                    🔬 Full Deep Analysis
                    <small>Adds Motion Energy Arc + DME Stems Separation</small>
                  </button>
                </div>

                <div className="custom-toggle-grid">
                  <label className="toggle-item">
                    <input
                      type="checkbox"
                      checked={scanOptions.cuts}
                      disabled={project.shots.length > 0}
                      onChange={(e) => setScanOptions((prev) => ({ ...prev, cuts: e.target.checked }))}
                    />
                    <div className="toggle-item-info">
                      <span>Cuts</span>
                      <small>Scene cut detection</small>
                    </div>
                  </label>
                  <label className="toggle-item">
                    <input
                      type="checkbox"
                      checked={scanOptions.framing}
                      onChange={(e) => setScanOptions((prev) => ({ ...prev, framing: e.target.checked }))}
                    />
                    <div className="toggle-item-info">
                      <span>Framing</span>
                      <small>Shot sizes & composition</small>
                    </div>
                  </label>
                  <label className="toggle-item">
                    <input
                      type="checkbox"
                      checked={scanOptions.cast}
                      onChange={(e) => setScanOptions((prev) => ({ ...prev, cast: e.target.checked }))}
                    />
                    <div className="toggle-item-info">
                      <span>Cast</span>
                      <small>Face clustering & characters</small>
                    </div>
                  </label>
                  <label className="toggle-item">
                    <input
                      type="checkbox"
                      checked={scanOptions.dialogue}
                      onChange={(e) => setScanOptions((prev) => ({ ...prev, dialogue: e.target.checked }))}
                    />
                    <div className="toggle-item-info">
                      <span>Dialogue</span>
                      <small>Speech & pause detection</small>
                    </div>
                  </label>
                  <label className="toggle-item">
                    <input
                      type="checkbox"
                      checked={scanOptions.loudness}
                      onChange={(e) => setScanOptions((prev) => ({ ...prev, loudness: e.target.checked }))}
                    />
                    <div className="toggle-item-info">
                      <span>Loudness</span>
                      <small>EBU R128 dynamics</small>
                    </div>
                  </label>
                  <label className="toggle-item">
                    <input
                      type="checkbox"
                      checked={scanOptions.motion}
                      onChange={(e) => setScanOptions((prev) => ({ ...prev, motion: e.target.checked }))}
                    />
                    <div className="toggle-item-info">
                      <span>Motion</span>
                      <small>Camera & actor movement</small>
                    </div>
                  </label>
                  <label className="toggle-item">
                    <input
                      type="checkbox"
                      checked={scanOptions.stems}
                      onChange={(e) => setScanOptions((prev) => ({ ...prev, stems: e.target.checked }))}
                    />
                    <div className="toggle-item-info">
                      <span>Stems</span>
                      <small>Dialogue/Music/Effects</small>
                    </div>
                  </label>
                </div>

                <div className="import-actions">
                  <button
                    className="primary primary-hero"
                    onClick={() => void startUnifiedAnalysis(url, scanOptions)}
                    disabled={!Object.values(scanOptions).some(Boolean)}
                  >
                    ✨ Start Analysis
                  </button>
                  <button onClick={() => edlInput.current?.click()}>
                    Import EDL
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceMode("screening")}
                    title="Return to Duet Cinema Screening"
                  >
                    🎬 Screening
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsInitialScanDismissed(true)}
                  >
                    Dismiss
                  </button>
                </div>
              </section>
            </div>
          )}
          {edl && (
            <div className="scene-detect-modal">
              <section className="modal panel import-panel" style={{ width: 500, maxWidth: "92vw" }}>
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
            </div>
          )}

          {/* Persistent Studio tools and monitor; expanded layout uses the same mounted elements. */}
          <div
            className={`top-stage ${leftCollapsed ? "left-is-collapsed" : ""} ${rightCollapsed ? "right-is-collapsed" : ""}`}
            style={{
              height: `calc(${topHeightRatio * 100}% - 6px)`,
            }}
          >
            {/* COLUMN 1 in Studio: Analytical Panel (always visible, contains horizontal tabs + content) */}
            <div
              className={`analytical-deck studio-detail-drawer panel ${(leftCollapsed || (mapExpanded && !studioDrawerOpen)) ? "drawer-closed" : "drawer-open"}`}
              hidden={workspaceMode !== "studio" || (mapExpanded ? !studioDrawerOpen : leftCollapsed)}
              style={workspaceMode !== "studio" || (mapExpanded ? !studioDrawerOpen : leftCollapsed) ? { display: "none" } : undefined}
            >
              {/* Horizontal analytical tabs */}
              {workspaceMode === "studio" && (
                <StudioToolRail
                  activeTab={deckTab}
                  drawerOpen={mapExpanded ? studioDrawerOpen : !leftCollapsed}
                  onSelectTab={(tab) => {
                    if (tab !== "rhythm") {
                      setInitialCompareMeasure(undefined);
                    }
                    setDeckTab(tab);
                    setStudioDrawerOpen(true);
                    if (leftCollapsed) {
                      toggleLeftCollapse();
                    }
                  }}
                  onToggleDrawer={() => {
                    setStudioDrawerOpen(leftCollapsed);
                    toggleLeftCollapse();
                  }}
                />
              )}
              <div
                role="tabpanel"
                id={`studio-tabpanel-${deckTab}`}
                aria-labelledby={`studio-tab-${deckTab}`}
              >
              <div className="deck-pane">
                  <div hidden={deckTab !== "rhythm"}>
                    <EditingRhythm
                      active={deckVisible && deckTab === "rhythm"}
                      project={project}
                      waveform={waveform}
                      selected={selected}
                      url={url}
                      onSelect={selectShot}
                      onSeek={seek}
                      onUpdateShots={handleUpdateShots}
                      onClose={handleCloseStudioDrawer}
                      variant="drawer"
                      initialCompareMeasure={initialCompareMeasure}
                      onClearInitialCompareMeasure={() => setInitialCompareMeasure(undefined)}
                      range={selectedRange}
                      onRangeChange={setSelectedRange}
                      onUpdateProject={(patch) => update(patch)}
                      isLoopingRange={isRangeLooping}
                      onToggleLoopRange={handleToggleLoopRange}
                    />
                  </div>

                  <div hidden={deckTab !== "framing"}>
                    <FramingDrawer
                      active={deckVisible && deckTab === "framing"}
                      project={project}
                      selected={selected}
                      onSelect={selectShot}
                      onSeek={seek}
                      onClose={handleCloseStudioDrawer}
                      variant="drawer"
                    />
                  </div>

                  <div hidden={deckTab !== "sequence"}>
                    <SequenceReading
                      active={deckVisible && deckTab === "sequence"}
                      project={project}
                      range={selectedRange}
                      onRangeChange={setSelectedRange}
                      onSeek={seek}
                      onUpdate={handleUpdateSequences}
                      onUpdateProject={(patch) => update(patch)}
                      selectedEntryId={selectedSequenceId}
                      onSelectEntryId={setSelectedSequenceId}
                      onClose={handleCloseStudioDrawer}
                      variant="drawer"
                    />
                  </div>

                  <div hidden={deckTab !== "sound"}>
                    <SoundDrawer
                      active={deckVisible && deckTab === "sound"}
                      project={project}
                      range={completeSelectedRange}
                      selectedShot={current}
                      onRangeChange={setSelectedRange}
                      onPlayRange={playRange}
                      onUpdateSpans={(soundSpans) => update({ soundSpans })}
                      loudnessAnalysis={isLoudnessAnalysisValid(project.loudnessAnalysis, linkedMediaSignature ?? project.loudnessAnalysis?.mediaSignature) ? project.loudnessAnalysis : undefined}
                      isLoudnessScanning={isLoudnessScanning}
                      loudnessStatus={loudnessStatus}
                      onScanLoudness={handleScanLoudness}
                      onCancelLoudness={() => loudnessAbortRef.current?.abort()}
                      speechAnalysis={isSpeechAnalysisValid(project.speechAnalysis, linkedMediaSignature ?? project.speechAnalysis?.mediaSignature) ? project.speechAnalysis : undefined}
                      isSpeechScanning={isSpeechScanning}
                      speechStatus={speechStatus}
                      onScanSpeech={handleScanSpeech}
                      onCancelSpeech={() => speechAbortRef.current?.abort()}
                      onRetrySpeech={handleScanSpeech}
                      onSeek={seek}
                      showSpeechOverlay={showSpeechOverlay}
                      onToggleSpeechOverlay={() => setShowSpeechOverlay((show) => !show)}
                      onClose={handleCloseStudioDrawer}
                    />
                  </div>

                  <div hidden={deckTab !== "cuts"}>
                    <CutReading
                      project={project}
                      incomingId={selectedCut}
                      url={url}
                      onSeek={seek}
                      onPlay={playCut}
                      onUpdate={handleUpdateCutAnnotations}
                      onDeleteCut={handleMergeShots}
                      onNudgeCut={handleNudgeCut}
                      onClose={handleCloseStudioDrawer}
                      variant="drawer"
                    />
                  </div>

                  <div hidden={deckTab !== "cast"}>
                    <div style={{ display: scanningAll ? "block" : "none" }}>
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
                          suggestion: { ...tags, model: tags.model ?? MODEL, createdAt: new Date().toISOString() },
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
                          recordHistory(projectRef.current);
                          revision.current++;
                          setProject((p) => p && p.id === project.id ? {
                            ...p,
                            updatedAt: new Date().toISOString(),
                            cast: mergeDiscoveredCast(p.cast ?? [], newCast),
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
                    </div>
                    <CastDrawer
                      active={deckVisible && deckTab === "cast"}
                      project={project}
                      shot={shot ?? current}
                      thumbnails={thumbnails}
                      range={completeSelectedRange}
                      selectedMember={selectedCharacter}
                      disabled={scanningAll || scanningShot || !url}
                      onSelect={setSelectedCharacter}
                      onAdd={addCastMember}
                      onReference={addCastReference}
                      onRemove={removeCastMember}
                      onRename={renameCastMember}
                      onMerge={mergeCastMembers}
                      onInspect={selectShot}
                      onConfirmShot={confirmCharacterShot}
                      onRemoveAppearance={removeCharacterAppearance}
                      onReviewCharacters={reviewCharactersInShot}
                      onRangeChange={setSelectedRange}
                      onPlayRange={(range) => playRange(range, false)}
                      onSeek={seek}
                      onClose={handleCloseStudioDrawer}
                    />
                  </div>

                  <div hidden={deckTab !== "color"}>
                    {project && (
                      <ColorDrawer
                        active={deckVisible && deckTab === "color"}
                        project={project}
                        shot={shot ?? current}
                        thumbnails={thumbnails}
                        selected={selected}
                        onSelect={(id) => {
                          const targetShot = project.shots.find((s) => s.id === id);
                          if (targetShot) selectShot(targetShot);
                        }}
                        onSeek={seek}
                        onClose={handleCloseStudioDrawer}
                        onOpenCompare={(measure) => {
                          setInitialCompareMeasure(measure);
                          setDeckTab("rhythm");
                          setStudioDrawerOpen(true);
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* COLUMN SPLITTER: Left Panel ↔ Video Monitor */}
            {workspaceMode === "studio" && (
              <ResizeHandle
                direction="col"
                className="resize-handle-left"
                collapseIcon="left"
                isCollapsed={leftCollapsed}
                onToggleCollapse={toggleLeftCollapse}
                onDrag={resizeLeft}
                onReset={resetLeftWidth}
                label="Resize analytical panel"
              />
            )}

            {/* FILM MONITOR (PERSISTENT - ALWAYS MOUNTED IN ALL MODES) */}
            <section
              className={`monitor panel ${mapExpanded ? "expanded-map-monitor" : ""}`}
            >
              <div className="section-head monitor-section-head">
                <div className="monitor-head-left">
                  <span className="eyebrow">
                    PROGRAM FILM PREVIEW
                  </span>
                  {project.videoMetadata && (
                    <span
                      className="monitor-media-meta video-meta"
                      title={`${project.videoMetadata.filename} · ${project.videoMetadata.width} × ${project.videoMetadata.height}${project.videoMetadata.duration != null ? ` · ${project.videoMetadata.duration.toFixed(2)}s` : ""}`}
                    >
                      <span className="monitor-meta-sep" aria-hidden="true">•</span>
                      <span className="monitor-filename">{project.videoMetadata.filename}</span>
                      <span className="monitor-res mono">{project.videoMetadata.width} × {project.videoMetadata.height}</span>
                    </span>
                  )}
                  {squintMode && (
                    <span className="monitor-squint-indicator" title={`Squint Mode Active (Depth Level ${squintLevel})`}>
                      😑 SQUINT L{squintLevel}
                    </span>
                  )}
                </div>
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
                  id="studioVideoPlayer"
                  src={url || (pendingFile.current ? sideLoadedUrl(pendingFile.current) : undefined)}
                  muted={workspaceMode !== "studio"}
                  playsInline
                  style={squintMode ? { filter: getSquintFilter(squintLevel) } : undefined}
                  onLoadedMetadata={() => {
                    const v = video.current!,
                      f = pendingFile.current;
                    if (v.src && !url) {
                      setUrl(v.src);
                    }
                    v.currentTime = Math.min(playhead.get(), Math.max(0, v.duration - 1 / project.frameRate));
                    if (!f) {
                      if (!project.videoMetadata && v.duration) {
                        update({
                          duration: Math.max(
                            v.duration,
                            ...project.shots.map((s) => s.endSeconds),
                          ),
                          videoMetadata: {
                            filename: project.name || "Video",
                            duration: v.duration,
                            width: v.videoWidth,
                            height: v.videoHeight,
                            size: 0,
                          },
                        });
                      }
                      return;
                    }
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
                    if (!playing && scrubTarget.current === null)
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
                      style={squintMode ? { filter: getSquintFilter(squintLevel) } : undefined}
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
              {workspaceMode === "studio" ? (
                <div className="transport studio-transport-bar">
                  <PlayheadTimecode className="timecode studio-timecode mono" frameRate={project.frameRate} dropFrame={project.dropFrame} />
                  <div className="studio-transport-center">
                    <button
                      type="button"
                      className="btn-transport-nav"
                      disabled={!url}
                      onClick={() => {
                        goToPrevShot();
                      }}
                      title="Previous shot"
                      aria-label="Previous shot"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polygon points="19 20 9 12 19 4 19 20" fill="currentColor" />
                        <line x1="5" y1="19" x2="5" y2="5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      disabled={!url}
                      className={`play studio-play-btn ${playing ? "playing" : ""}`}
                      aria-label={playing ? "Pause" : "Play"}
                      title={playing ? "Pause (Space)" : "Play (Space)"}
                      onClick={toggle}
                    >
                      {playing ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <rect x="5" y="4" width="4" height="16" rx="1" />
                          <rect x="15" y="4" width="4" height="16" rx="1" />
                        </svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ marginLeft: 2 }}>
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn-transport-nav"
                      disabled={!url}
                      onClick={() => {
                        goToNextShot();
                      }}
                      title="Next shot"
                      aria-label="Next shot"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" />
                        <line x1="19" y1="5" x2="19" y2="19" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`btn-transport-nav studio-volume-btn ${muted ? "muted" : ""}`}
                      onClick={() => setMuted(!muted)}
                      title={muted ? "Unmute audio" : "Mute audio"}
                      aria-label={muted ? "Unmute audio" : "Mute audio"}
                    >
                      {muted ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
                      )}
                    </button>
                  </div>
                  <div className="studio-transport-actions">
                    <button
                      type="button"
                      className="studio-fullscreen-btn studio-video-fullscreen-btn"
                      onClick={() => {
                        video.current?.requestFullscreen?.().catch(() => {});
                      }}
                      disabled={!url}
                      title="Fullscreen Video Playback"
                      aria-label="Fullscreen Video Playback"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="transport">
                  <button
                    disabled={!url}
                    aria-label="Previous frame"
                    onClick={() => {
                      video.current?.pause();
                      seek(playhead.get() - 1 / actualRate(project.frameRate));
                    }}
                  >
                    Ⅰ‹
                  </button>
                  <button
                    disabled={!url}
                    className="play"
                    aria-label={playing ? "Pause" : "Play"}
                    title={playing ? "Pause (Space)" : "Play (Space)"}
                    onClick={toggle}
                  >
                    {playing ? "Ⅱ" : "▶"}
                  </button>
                  <button
                    disabled={!url}
                    aria-label="Next frame"
                    onClick={() => {
                      video.current?.pause();
                      seek(playhead.get() + 1 / actualRate(project.frameRate));
                    }}
                  >
                    ›Ⅰ
                  </button>
                  <PlayheadTimecode className="timecode" frameRate={project.frameRate} dropFrame={project.dropFrame} />
                  <PlayheadSeekSlider duration={project.duration} frameRate={project.frameRate} onSeek={seek} />
                  <button
                    aria-label={muted ? "Unmute" : "Mute"}
                    onClick={() => setMuted(!muted)}
                  >
                    {muted ? "Muted" : "Sound"}
                  </button>
                  <button
                    type="button"
                    className={`monitor-squint-toggle ${squintMode ? "active" : ""}`}
                    title={squintMode ? `Squint Mode Active (Level ${squintLevel}) - Click to disable` : "Toggle Squint Mode on preview monitor and timeline"}
                    onClick={() => setSquintMode(!squintMode)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 4 }}>
                      <path d="M2 12s3.5-5 10-5 10 5 10 5-3.5 5-10 5-10-5-10-5z" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                    </svg>
                    <span>{squintMode ? `Squint L${squintLevel}` : "Squint"}</span>
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
                  <button
                    type="button"
                    className="btn-transport-nav"
                    aria-label="Fullscreen Video Playback"
                    title="Fullscreen Video Playback"
                    disabled={!url}
                    onClick={() => {
                      video.current?.requestFullscreen?.().catch(() => {});
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="2" y="2" width="20" height="20" rx="2" />
                      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
                    </svg>
                  </button>
                </div>
              )}
            </section>

            {/* COLUMN SPLITTER 2: Center Panel ↔ Right Panel */}
            {!mapExpanded && (
              <ResizeHandle
                direction="col"
                className="resize-handle-right"
                collapseIcon="right"
                isCollapsed={rightCollapsed}
                onToggleCollapse={toggleRightCollapse}
                onDrag={resizeRight}
                onReset={resetRightWidth}
                label="Resize right panel"
              />
            )}

            {/* Right Panel: Shot Inspector in Studio, Review, etc. */}
            {!mapExpanded && !rightCollapsed && (
              <ShotInspector
                shot={shot}
                project={project}
                url={url}
                thumbnail={shot ? thumbnails[shot.id] : undefined}
                scanningAll={scanningAll}
                scanningShot={scanningShot}
                onBusyChange={setScanningShot}
                onPreview={previewAnalysis}
                onEditShot={editShot}
                onModelResult={(pId, sId, patch) => applyShotPatch(pId, sId, patch, false)}
                onNext={goToNextShot}
                onPrevious={goToPrevShot}
                onConfirmAndNext={confirmAndNext}
                onMarkUncertain={markUncertainAndNext}
                onReviewCharacters={reviewCharactersInShot}
                onToggleCollapse={toggleRightCollapse}
                autoAdvance={autoAdvance}
                isStudio={workspaceMode === "studio"}
              />
            )}

            {mapExpanded && (
              <aside className="expanded-map-context" aria-label="Map selection context">
                <MapShotSummary
                  shot={shot}
                  project={project}
                  thumbnail={shot ? thumbnails[shot.id] : undefined}
                  onOpenInspector={() => setInspectorDrawerOpen(true)}
                  onPrevious={goToPrevShot}
                  onNext={goToNextShot}
                />
                {selectedRange && (
                  <button className="expanded-selection-button" onClick={() => {
                    setDeckTab("sequence");
                    setStudioDrawerOpen(true);
                  }}>Open selected range in Structure</button>
                )}
              </aside>
            )}
          </div>

          {/* VERTICAL SPLITTER: Top Stage ↔ Bottom Timeline */}
          <ResizeHandle
            direction="row"
            className="resize-handle-middle"
            collapseIcon="up"
            isCollapsed={mapExpanded}
            onToggleCollapse={toggleExpandedMap}
            onDrag={(delta) => {
              const workspaceHeight = workspaceRef.current?.clientHeight || 800;
              resizeTopPixels(delta, workspaceHeight);
            }}
            onReset={resetTopHeightRatio}
            label="Resize timeline vs upper panels"
          />

          {/* BOTTOM STAGE: Integrated Timeline */}
          <div
            className="bottom-stage"
            style={{
              flex: "1 1 0",
              minHeight: "130px",
              height: `calc(${(1 - topHeightRatio) * 100}% - 6px)`,
            }}
          >
            <EditingMap
              project={project}
              thumbnails={thumbnails}
              selected={selected}
              active={current?.id}
              onSeek={seek}
              onScrub={scrub}
              onShot={selectShot}
              onPlayShot={playShot}
              selectedCut={selectedCut}
              onCut={(incoming) => {
                video.current?.pause();
                setSelectedCut(incoming.id);
                setSelected(incoming.id);
                seek(incoming.startSeconds);
                setDeckTab("cuts");
                if (workspaceMode === "studio") {
                  setStudioDrawerOpen(true);
                  // A collapsed drawer must open too, like it does for a selected range.
                  if (leftCollapsed) toggleLeftCollapse();
                }
              }}
              onSplitShot={handleSplitShot}
              onDeleteCut={handleMergeShots}
              onRollCut={handleRollCut}
              snapToCuts={snapToCuts}
              onToggleSnap={handleToggleSnap}
              onNudgeCut={handleNudgeCut}
              range={selectedRange}
              onRangeChange={(r) => {
                setSelectedRange(r);
                if (r && r.start !== undefined && r.end !== undefined && r.end > r.start && deckTab !== "rhythm") {
                  setDeckTab("sequence");
                  if (workspaceMode === "studio") {
                    setStudioDrawerOpen(true);
                    if (leftCollapsed) toggleLeftCollapse();
                  }
                }
              }}
              selectedSequenceId={selectedSequenceId}
              onSelectSequence={(seq) => {
                setSelectedSequenceId(seq ? seq.id : null);
                if (seq) {
                  setDeckTab("sequence");
                  if (workspaceMode === "studio") {
                    setStudioDrawerOpen(true);
                    if (leftCollapsed) toggleLeftCollapse();
                  }
                }
              }}
              onUpdateSequences={handleUpdateSequences}
              waveform={waveform}
              speechAnalysis={showSpeechOverlay && isSpeechAnalysisValid(project.speechAnalysis, linkedMediaSignature ?? project.speechAnalysis?.mediaSignature) ? project.speechAnalysis : undefined}
              loudnessAnalysis={isLoudnessAnalysisValid(project.loudnessAnalysis, linkedMediaSignature ?? project.loudnessAnalysis?.mediaSignature) ? project.loudnessAnalysis : undefined}
              reviewMatchIds={reviewFilter === "all" ? undefined : reviewMatchIds}
              highlightedShotIds={selectedCharacter ? project.shots.filter((s) => s.characterAnalysis?.manualReviewStatus === "Confirmed" ? s.characterAnalysis.manualMemberIds?.includes(selectedCharacter) : s.characterAnalysis?.intervals.some((interval) => interval.memberId === selectedCharacter)).map((s) => s.id) : undefined}
              onColorModeChange={(colorMode) => update({ colorMode })}
              onSeparateDme={handleSeparateDme}
              onCancelDme={() => dmeAbortRef.current?.abort()}
              isDmeSeparating={isDmeSeparating}
              dmeSeparationStatus={dmeSeparationStatus}
              hasVideo={Boolean(pendingFile.current || project.videoMetadata)}
              url={url}
              onUpdateCutAnnotations={handleUpdateCutAnnotations}
              workspaceMode={workspaceMode}
              layers={mapLayers}
              onLayersChange={setMapLayers}
              zoom={zoom}
              onZoomChange={setZoom}
              scrollLeft={timelineScrollLeft}
              onScrollChange={setTimelineScrollLeft}
              onOpenFullscreen={() => setIsFullscreenGraph(true)}
              expanded={mapExpanded}
              onToggleExpanded={toggleExpandedMap}
              onOpenInspector={() => setInspectorDrawerOpen(true)}
              showMinimap={mapExpanded}
              reviewFilter={reviewFilter}
              onClearReviewFilter={() => setReviewFilter("all")}
              squintMode={squintMode}
              squintLevel={squintLevel}
              onToggleSquint={(active) => setSquintMode(active !== undefined ? active : !squintMode)}
              onSquintLevelChange={setSquintLevel}
              activeTab={deckTab}
              drawerOpen={!leftCollapsed && studioDrawerOpen}
              onSelectTab={(tab) => {
                if (deckTab === tab && !leftCollapsed && studioDrawerOpen) {
                  handleCloseStudioDrawer();
                } else {
                  if (tab !== "rhythm") {
                    setInitialCompareMeasure(undefined);
                  }
                  setDeckTab(tab);
                  setStudioDrawerOpen(true);
                  if (leftCollapsed) {
                    toggleLeftCollapse();
                  }
                }
              }}
              onToggleDrawer={() => {
                if (!leftCollapsed && studioDrawerOpen) {
                  handleCloseStudioDrawer();
                } else {
                  setStudioDrawerOpen(true);
                  if (leftCollapsed) {
                    toggleLeftCollapse();
                  }
                }
              }}
              tagBar={!mapExpanded ? (
                <div className={`timeline-action-bar studio-action-bar ${studioTagBarOpen ? "expanded" : "compact"}`}>
                  <div className="studio-action-bar-left">
                    <button
                      type="button"
                      className={`studio-quick-tag-toggle-btn ${studioTagBarOpen ? "active" : ""}`}
                      onClick={() => setStudioTagBarOpen((prev) => !prev)}
                      title={studioTagBarOpen ? "Collapse quick tags" : "Expand quick tags (1-8 shortcuts)"}
                      aria-expanded={studioTagBarOpen}
                      aria-label={studioTagBarOpen ? "Collapse quick tags" : "Expand quick tags"}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="studio-quick-tag-icon">
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                        <circle cx="7" cy="7" r="1.5" fill="currentColor" />
                      </svg>
                      <span>Quick Tags</span>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="studio-quick-tag-chevron">
                        <polyline points={studioTagBarOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
                      </svg>
                    </button>

                    {studioTagBarOpen && (
                      <div className="tag-toolbar-inline">
                        <div className="tag-keys">
                          {selectableShotSizes.map((size) => {
                            const shortcut = sizeShortcuts[size] ?? "";
                            return (
                              <button
                                key={size}
                                disabled={!shot || shot.content === "Text / title card"}
                                title={`Assign ${size} (${shortcut})`}
                                aria-label={size === "Close" ? "4 Close" : undefined}
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
                          Advance
                        </label>
                      </div>
                    )}
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
              ) : undefined}
            />
          </div>

          {/* Shot inspector drawer */}
          {inspectorDrawerOpen && (
            <div
              className="inspector-drawer-backdrop open"
              onClick={() => setInspectorDrawerOpen(false)}
            >
              <div
                className="inspector-drawer-inner"
                onClick={(e) => e.stopPropagation()}
              >
                <ShotInspector
                  shot={shot}
                  project={project}
                  url={url}
                  thumbnail={shot ? thumbnails[shot.id] : undefined}
                  scanningAll={scanningAll}
                  scanningShot={scanningShot}
                  onBusyChange={setScanningShot}
                  onPreview={previewAnalysis}
                  onEditShot={editShot}
                  onModelResult={(pId, sId, patch) => applyShotPatch(pId, sId, patch, false)}
                  onNext={goToNextShot}
                  onPrevious={goToPrevShot}
                  onConfirmAndNext={confirmAndNext}
                  onMarkUncertain={markUncertainAndNext}
                  onReviewCharacters={reviewCharactersInShot}
                  onCloseDrawer={() => setInspectorDrawerOpen(false)}
                  isDrawer={true}
                  useGridSizes={false}
                  autoAdvance={autoAdvance}
                />
              </div>
            </div>
          )}

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
        </>

      {project && reportModalOpen && (
        <>
          <ReportExportModal
            project={project}
            isOpen={reportModalOpen}
            config={reportConfig}
            onChangeConfig={setReportConfig}
            onClose={() => setReportModalOpen(false)}
            onExport={handleExportPDF}
            onSystemPrint={handleSystemPrint}
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

      {showScanConfigModal && project && (
        <div
          className="modal-backdrop scene-detect-modal"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowScanConfigModal(false);
          }}
        >
          <div className="modal panel unified-scan-panel" style={{ width: 520, maxWidth: "92vw" }}>
            <div className="section-head">
              <b>Analyze Film Pipeline</b>
              <button type="button" onClick={() => setShowScanConfigModal(false)}>Close</button>
            </div>

            <div className="preset-selector-row">
              <button
                type="button"
                className={`preset-btn ${
                  scanOptions.cuts && scanOptions.framing && scanOptions.cast && scanOptions.dialogue && scanOptions.loudness && !scanOptions.motion && !scanOptions.stems
                    ? "active"
                    : ""
                }`}
                onClick={() => setScanOptions({ ...QUICK_ANALYSIS_PRESET, cuts: project.shots.length === 0 })}
              >
                ⚡ Quick Analysis (Recommended)
                <small>Framing + Cast + Dialogue + Loudness (~1-2 min)</small>
              </button>

              <button
                type="button"
                className={`preset-btn ${
                  scanOptions.cuts && scanOptions.framing && scanOptions.cast && scanOptions.dialogue && scanOptions.loudness && scanOptions.motion && scanOptions.stems
                    ? "active"
                    : ""
                }`}
                onClick={() => setScanOptions({ ...FULL_ANALYSIS_PRESET, cuts: project.shots.length === 0 })}
              >
                🔬 Full Deep Analysis
                <small>Adds Motion Energy Arc + DME Stems Separation</small>
              </button>
            </div>

            <div className="custom-toggle-grid">
              <label className="toggle-item">
                <input
                  type="checkbox"
                  checked={scanOptions.cuts}
                  disabled={project.shots.length > 0}
                  onChange={(e) => setScanOptions((prev) => ({ ...prev, cuts: e.target.checked }))}
                />
                <div className="toggle-item-info">
                  <span>Cuts</span>
                  <small>{project.shots.length > 0 ? "Bypassed (Existing shots present)" : "Scene cut detection"}</small>
                </div>
              </label>
              <label className="toggle-item">
                <input
                  type="checkbox"
                  checked={scanOptions.framing}
                  onChange={(e) => setScanOptions((prev) => ({ ...prev, framing: e.target.checked }))}
                />
                <div className="toggle-item-info">
                  <span>Framing</span>
                  <small>Shot sizes & composition</small>
                </div>
              </label>
              <label className="toggle-item">
                <input
                  type="checkbox"
                  checked={scanOptions.cast}
                  onChange={(e) => setScanOptions((prev) => ({ ...prev, cast: e.target.checked }))}
                />
                <div className="toggle-item-info">
                  <span>Cast</span>
                  <small>Face clustering & characters</small>
                </div>
              </label>
              <label className="toggle-item">
                <input
                  type="checkbox"
                  checked={scanOptions.dialogue}
                  onChange={(e) => setScanOptions((prev) => ({ ...prev, dialogue: e.target.checked }))}
                />
                <div className="toggle-item-info">
                  <span>Dialogue</span>
                  <small>Speech & pause detection</small>
                </div>
              </label>
              <label className="toggle-item">
                <input
                  type="checkbox"
                  checked={scanOptions.loudness}
                  onChange={(e) => setScanOptions((prev) => ({ ...prev, loudness: e.target.checked }))}
                />
                <div className="toggle-item-info">
                  <span>Loudness</span>
                  <small>EBU R128 dynamics</small>
                </div>
              </label>
              <label className="toggle-item">
                <input
                  type="checkbox"
                  checked={scanOptions.motion}
                  onChange={(e) => setScanOptions((prev) => ({ ...prev, motion: e.target.checked }))}
                />
                <div className="toggle-item-info">
                  <span>Motion</span>
                  <small>Camera & actor movement</small>
                </div>
              </label>
              <label className="toggle-item">
                <input
                  type="checkbox"
                  checked={scanOptions.stems}
                  onChange={(e) => setScanOptions((prev) => ({ ...prev, stems: e.target.checked }))}
                />
                <div className="toggle-item-info">
                  <span>Stems</span>
                  <small>Dialogue/Music/Effects</small>
                </div>
              </label>
            </div>

            <div className="modal-actions">
              <button
                className="primary"
                disabled={!url || !Object.values(scanOptions).some(Boolean)}
                onClick={() => {
                  setShowScanConfigModal(false);
                  const opts = project.shots.length > 0 ? { ...scanOptions, cuts: false } : scanOptions;
                  void startUnifiedAnalysis(url, opts);
                }}
              >
                {project.shots.length > 0 ? "⚡ Analyze Existing Shots" : "✨ Start Analysis"}
              </button>
              <button onClick={() => setShowScanConfigModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <ScannerSettingsModal
        isOpen={scannerSettingsOpen}
        onClose={() => setScannerSettingsOpen(false)}
      />

      {filmReplacementPending && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="unsaved-modal-title">
          <div className="modal-dialog-panel unsaved-decision-modal" style={{ padding: "24px", maxWidth: "460px" }}>
            <h3 id="unsaved-modal-title" className="modal-title" style={{ fontSize: "16px", marginBottom: "12px", color: "#f3f4f6" }}>
              Save changes before replacing film?
            </h3>
            <p style={{ color: "#9ca3af", fontSize: "13px", lineHeight: "1.5", margin: "0 0 20px 0" }}>
              You have unsaved changes in <strong style={{ color: "#e5e7eb" }}>{project?.name || "current cut"}</strong>. Would you like to save your work before switching to another film?
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="header-action-btn btn-cancel-replacement"
                style={{ padding: "8px 14px", borderRadius: "6px", background: "#21262d", border: "1px solid #363c46", color: "#c9d1d9", cursor: "pointer", fontSize: "13px" }}
                onClick={() => {
                  setFilmReplacementPending(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="header-action-btn btn-discard-replacement"
                style={{ padding: "8px 14px", borderRadius: "6px", background: "#3b1e22", border: "1px solid #7c2d36", color: "#fca5a5", cursor: "pointer", fontSize: "13px" }}
                onClick={async () => {
                  const pending = filmReplacementPending;
                  setFilmReplacementPending(null);
                  if (pending.type === "file") {
                    await executeNewProjectFromVideo(pending.file, pending.name);
                  } else if (pending.type === "project") {
                    replace(pending.project);
                  }
                }}
              >
                Discard &amp; Continue
              </button>
              <button
                type="button"
                className="header-action-btn btn-save-replacement"
                style={{ padding: "8px 14px", borderRadius: "6px", background: "#d97706", border: "1px solid #b45309", color: "#fff", fontWeight: "600", cursor: "pointer", fontSize: "13px" }}
                onClick={async () => {
                  const pending = filmReplacementPending;
                  await save();
                  setFilmReplacementPending(null);
                  if (pending.type === "file") {
                    await executeNewProjectFromVideo(pending.file, pending.name);
                  } else if (pending.type === "project") {
                    replace(pending.project);
                  }
                }}
              >
                Save &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}



      {project && analysisProgress && (
        <div className="scene-detect-modal unified-analysis-modal">
          <div className="modal panel">
            <div className="section-head">
              <b>Analyzing Film Pipeline</b>
              <span className="mono" style={{ color: "#e5a444", fontWeight: "bold" }}>
                {analysisProgress.overallPercent}%
              </span>
            </div>

            <div className="analysis-stepper">
              {analysisProgress.options.cuts && (
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
              )}

              {analysisProgress.options.framing && (
                <div className={`analysis-step-row ${
                  analysisProgress.stage === "framing" ? "active" :
                  ["characters", "dialogue", "loudness", "done"].includes(analysisProgress.stage) ? "completed" : ""
                }`}>
                  <div className="analysis-step-left">
                    <span className="analysis-step-badge">
                      {["characters", "dialogue", "loudness", "done"].includes(analysisProgress.stage) ? "✓" :
                       analysisProgress.stage === "framing" ? "●" : "2"}
                    </span>
                    <span>2. Framing & Shot Sizes</span>
                  </div>
                  <span className="analysis-step-meta">
                    {analysisProgress.stage === "cuts" ? "Waiting..." :
                     analysisProgress.stage === "framing" ? `${analysisProgress.framingDone}/${analysisProgress.framingTotal}` :
                     "Tagged"}
                  </span>
                </div>
              )}

              {analysisProgress.options.cast && (
                <div className={`analysis-step-row ${
                  analysisProgress.stage === "characters" ? "active" :
                  ["dialogue", "loudness", "done"].includes(analysisProgress.stage) ? "completed" : ""
                }`}>
                  <div className="analysis-step-left">
                    <span className="analysis-step-badge">
                      {["dialogue", "loudness", "done"].includes(analysisProgress.stage) ? "✓" :
                       analysisProgress.stage === "characters" ? "●" : "3"}
                    </span>
                    <span>3. Character Discovery & Cast</span>
                  </div>
                  <span className="analysis-step-meta">
                    {analysisProgress.stage === "characters" ? `${analysisProgress.facesFound} faces` :
                     ["dialogue", "loudness", "done"].includes(analysisProgress.stage) ? "Clustered" :
                     "Waiting..."}
                  </span>
                </div>
              )}

              {analysisProgress.options.dialogue && (
                <div className={`analysis-step-row ${
                  analysisProgress.stage === "dialogue" ? "active" :
                  ["loudness", "done"].includes(analysisProgress.stage) ? "completed" : ""
                }`}>
                  <div className="analysis-step-left">
                    <span className="analysis-step-badge">
                      {["loudness", "done"].includes(analysisProgress.stage) ? "✓" :
                       analysisProgress.stage === "dialogue" ? "●" : "4"}
                    </span>
                    <span>4. Speech VAD Detection</span>
                  </div>
                  <span className="analysis-step-meta">
                    {analysisProgress.stage === "dialogue" ? "Scanning..." :
                     ["loudness", "done"].includes(analysisProgress.stage) ? "Complete" :
                     "Waiting..."}
                  </span>
                </div>
              )}

              {analysisProgress.options.loudness && (
                <div className={`analysis-step-row ${
                  analysisProgress.stage === "loudness" ? "active" :
                  analysisProgress.stage === "done" ? "completed" : ""
                }`}>
                  <div className="analysis-step-left">
                    <span className="analysis-step-badge">
                      {analysisProgress.stage === "done" ? "✓" :
                       analysisProgress.stage === "loudness" ? "●" : "5"}
                    </span>
                    <span>5. EBU R128 Loudness</span>
                  </div>
                  <span className="analysis-step-meta">
                    {analysisProgress.stage === "loudness" ? "Measuring..." :
                     analysisProgress.stage === "done" ? "Complete" :
                     "Waiting..."}
                  </span>
                </div>
              )}
            </div>

            {(analysisProgress.options.motion || analysisProgress.options.stems) && (
              <small className="muted" style={{ display: "block", marginTop: -4 }}>
                ⚡ Motion energy & DME stem separation will continue automatically in the background.
              </small>
            )}

            {/* Progress Bar */}
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
                <span>{analysisProgress.statusText}</span>
              </div>
            )}

            <div className="modal-actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (analysisProgress) {
                    setBgScanStatus({
                      active: true,
                      stage: analysisProgress.stage,
                      stageLabel: analysisProgress.stage === "cuts" ? "Cuts" :
                                 analysisProgress.stage === "framing" ? "Framing" :
                                 analysisProgress.stage === "characters" ? "Cast" :
                                 analysisProgress.stage === "dialogue" ? "Dialogue" :
                                 analysisProgress.stage === "loudness" ? "Loudness" : "Scan",
                      progress: analysisProgress.overallPercent,
                      stageProgress: Math.min(100, Math.round(analysisProgress.overallPercent)),
                      statusText: analysisProgress.statusText,
                      motionActive: analysisProgress.options.motion,
                      motionProgress: 0,
                      stemsActive: analysisProgress.options.stems,
                      stemsStatusText: "",
                    });
                    setAnalysisProgress(null);
                  }
                }}
              >
                Minimize to Background
              </button>
              <button
                type="button"
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

      {isFullscreenGraph && project && (
        <FullscreenMapVisualization
          project={project}
          playing={playing}
          onTogglePlay={toggle}
          onSeek={seek}
          onScrub={scrub}
          selected={selected}
          onSelectShot={selectShot}
          zoom={zoom}
          onZoomChange={setZoom}
          scrollLeft={timelineScrollLeft}
          onScrollChange={setTimelineScrollLeft}
          layers={mapLayers}
          waveform={waveform}
          speechAnalysis={showSpeechOverlay && isSpeechAnalysisValid(project.speechAnalysis, linkedMediaSignature) ? project.speechAnalysis : undefined}
          loudnessAnalysis={isLoudnessAnalysisValid(project.loudnessAnalysis, linkedMediaSignature) ? project.loudnessAnalysis : undefined}
          url={url}
          onClose={() => setIsFullscreenGraph(false)}
        />
      )}
    </div>
  );
}
