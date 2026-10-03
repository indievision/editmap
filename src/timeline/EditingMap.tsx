import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePlayhead } from "../playback/playhead";
import type { Project, Shot, SpeechAnalysis, LoudnessAnalysis, SequenceMarker, CutAnnotation, EyeTraceCutReading } from "../models/project";
import { classifyCut, pauseRegions } from "../analysis/speech";
import { lufsToNormalized } from "../analysis/loudness";
import { colorMappings, sizeColors } from "../analysis/colors";
import { actualRate, formatTimecode } from "../utils/timecode";
import { reviewReasonLabel, reviewReasons, type ReviewFilter } from "../analysis/review";
import { getSnapTime, quantizeToFrame } from "./timelineOps";
import { cutTimes, pacingCurve, pacingAt, computeCutShockData } from "../analysis/pacing";
import { framingRank } from "../analysis/framing";
import { classifyKineticVelocity, classifyMomentumTransition } from "../analysis/motion";
import { detectWhiplashClusters, scanProjectEyeTrace, type BatchScanProgress } from "../analysis/cuts";
import { generatePolyphonicScore } from "../analysis/polyphony";
import { getSquintFilter } from "../utils/squint";
import {
  generatePacingPathAndArea,
  generateMotionFlowPathAndArea,
  generateCutDensityPathAndArea,
  generateSymmetricalWaveformPath,
  generateSteppedFramingPath,
} from "./FullscreenMapVisualization";
import { StudioToolbar } from "../components/StudioToolbar";
import type { StudioToolTab } from "../components/StudioToolRail";

const CAST_PALETTE = [
  "#d97764",
  "#7ca381",
  "#8e7cc3",
  "#d4a34b",
  "#c97282",
  "#6ba3cf",
];

function getCastAvatarSrc(member?: { references?: Array<{ image?: string }> }): string | undefined {
  if (!member?.references?.[0]?.image) return undefined;
  const raw = member.references[0].image;
  return raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}`;
}

export interface MapLayerState {
  framing: boolean;
  pacing: boolean;
  framingArc: boolean;
  motion: boolean;
  characters: boolean;
  audio: boolean;
  scenes: boolean;
}

export const DEFAULT_MAP_LAYERS: MapLayerState = {
  framing: true,
  pacing: true,
  framingArc: true,
  motion: true,
  characters: true,
  audio: true,
  scenes: true,
};

export type StudioTrackId =
  | "markers"
  | "story"
  | "shots"
  | "pacing"
  | "cutDensity"
  | "framing"
  | "motion"
  | "palette"
  | "cast"
  | "sound";

export const DEFAULT_STUDIO_LANE_HEIGHTS: Record<StudioTrackId, number> = {
  markers: 34,
  story: 38,
  shots: 50,
  pacing: 42,
  cutDensity: 42,
  framing: 46,
  motion: 42,
  palette: 42,
  cast: 54,
  sound: 90,
};

export const MIN_STUDIO_LANE_HEIGHTS: Record<StudioTrackId, number> = {
  markers: 24,
  story: 24,
  shots: 28,
  pacing: 24,
  cutDensity: 24,
  framing: 28,
  motion: 24,
  palette: 24,
  cast: 36,
  sound: 50,
};

export function generatePaletteWavePath(
  shots: Shot[],
  scale: number,
  height: number,
): string {
  if (!shots || shots.length === 0 || height <= 8) return "";
  const points = shots.map((s) => {
    const cx = (s.startSeconds + s.duration / 2) * scale;
    const luma = s.colorProfile?.luminance ?? 0.5;
    const cy = Math.max(6, Math.min(height - 6, height * (0.75 - luma * 0.5)));
    return [cx, cy] as [number, number];
  });
  if (points.length === 1) {
    return `M ${(points[0][0] - 10).toFixed(1)} ${points[0][1].toFixed(1)} L ${(points[0][0] + 10).toFixed(1)} ${points[0][1].toFixed(1)}`;
  }
  let path = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return path;
}

export function generateLoudnessCurvePath(
  loudness: LoudnessAnalysis | undefined,
  fallbackWaveform: number[] | undefined,
  duration: number,
  scale: number,
  height: number,
): string {
  if (duration <= 0 || scale <= 0 || height <= 4) return "";
  const totalW = duration * scale;
  const padding = 2;
  const usableH = height - padding * 2;

  if (loudness && loudness.momentary && loudness.momentary.length > 1) {
    const count = loudness.momentary.length;
    let path = "";
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * totalW;
      const norm = lufsToNormalized(loudness.momentary[i], -60, 0);
      const y = height - padding - norm * usableH;
      path += `${i === 0 ? "M" : " L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return path;
  }

  if (fallbackWaveform && fallbackWaveform.length > 1) {
    const count = Math.min(200, fallbackWaveform.length);
    const step = Math.max(1, Math.floor(fallbackWaveform.length / count));
    let path = "";
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * totalW;
      const val = fallbackWaveform[i * step] ?? 0.2;
      const y = height - padding - Math.min(1, Math.max(0.1, val)) * usableH;
      path += `${i === 0 ? "M" : " L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return path;
  }

  return `M 0 ${(height / 2).toFixed(1)} L ${totalW.toFixed(1)} ${(height / 2).toFixed(1)}`;
}

export default memo(function EditingMap({
  project,
  thumbnails,
  selected,
  active,
  onSeek,
  onScrub,
  onShot,
  onPlayShot,
  selectedCut,
  onCut,
  range,
  onRangeChange,
  selectedSequenceId,
  onSelectSequence,
  onUpdateSequences,
  waveform = [],
  speechAnalysis,
  loudnessAnalysis,
  highlightedShotIds,
  reviewMatchIds,
  onColorModeChange,
  tagBar,
  onSeparateDme,
  onCancelDme,
  isDmeSeparating = false,
  dmeSeparationStatus = "",
  hasVideo = false,
  workspaceMode = "studio",
  expanded = false,
  onToggleExpanded,
  showLayersControl = false,
  showMinimap = true,
  reviewFilter,
  onClearReviewFilter,
  onSplitShot,
  onDeleteCut,
  onRollCut,
  snapToCuts = true,
  onToggleSnap,
  onNudgeCut,
  squintMode = false,
  squintLevel = 4,
  onToggleSquint,
  onSquintLevelChange,
  layers: propLayers,
  onLayersChange,
  zoom: propZoom,
  onZoomChange,
  scrollLeft: propScrollLeft,
  onScrollChange,
  onOpenFullscreen,
  onOpenInspector,
  activeTab,
  drawerOpen,
  onSelectTab,
  onToggleDrawer,
  url,
  onUpdateCutAnnotations,
}: {
  project: Project;
  thumbnails: Record<string, string>;
  selected?: string;
  active?: string;
  onSeek: (t: number) => void;
  onScrub: (t: number) => void;
  onShot: (s: Shot) => void;
  onPlayShot: (s: Shot) => void;
  selectedCut?: string;
  onCut?: (shot: Shot) => void;
  range?: { start?: number; end?: number };
  onRangeChange: (range?: { start?: number; end?: number }) => void;
  selectedSequenceId?: string | null;
  onSelectSequence?: (seq: SequenceMarker) => void;
  onUpdateSequences?: (sequences: SequenceMarker[]) => void;
  waveform?: number[];
  speechAnalysis?: SpeechAnalysis;
  loudnessAnalysis?: LoudnessAnalysis;
  highlightedShotIds?: string[];
  /** Filtering never changes timing or visibility; non-matches are only dimmed. */
  reviewMatchIds?: string[];
  onColorModeChange?: (mode: string) => void;
  tagBar?: React.ReactNode;
  onSeparateDme?: () => void;
  onCancelDme?: () => void;
  isDmeSeparating?: boolean;
  dmeSeparationStatus?: string;
  hasVideo?: boolean;
  workspaceMode?: "studio" | "explore" | "review" | "screening";
  expanded?: boolean;
  onToggleExpanded?: () => void;
  showLayersControl?: boolean;
  showMinimap?: boolean;
  reviewFilter?: string;
  onClearReviewFilter?: () => void;
  onSplitShot?: (time: number) => void;
  onDeleteCut?: (incomingId: string) => void;
  onRollCut?: (incomingId: string, newTime: number) => void;
  snapToCuts?: boolean;
  onToggleSnap?: () => void;
  onNudgeCut?: (incomingId: string, framesDelta: number) => void;
  squintMode?: boolean;
  squintLevel?: number;
  onToggleSquint?: (active?: boolean) => void;
  onSquintLevelChange?: (level: number) => void;
  layers?: MapLayerState;
  onLayersChange?: (layers: MapLayerState) => void;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  scrollLeft?: number;
  onScrollChange?: (scrollLeft: number) => void;
  onOpenFullscreen?: () => void;
  onOpenInspector?: () => void;
  url?: string;
  onUpdateCutAnnotations?: (annotations: CutAnnotation[]) => void;
  activeTab?: StudioToolTab;
  drawerOpen?: boolean;
  onSelectTab?: (tab: StudioToolTab) => void;
  onToggleDrawer?: () => void;
}) {
  const time = usePlayhead();
  const isStudio = workspaceMode === "studio";
  const viewport = useRef<HTMLDivElement>(null);
  const trackHeaders = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const minimapDragging = useRef(false);
  const minimapDragOffset = useRef(0);
  const minimapRafId = useRef<number | null>(null);
  const [isMinimapDragging, setIsMinimapDragging] = useState(false);
  const rangeAnchor = useRef<number | null>(null);
  const suppressMapClick = useRef(false);
  const [dragRange, setDragRange] = useState<{ start: number; end: number }>();
  const activeLoudness = loudnessAnalysis || project.loudnessAnalysis;
  const [audioMode, setAudioMode] = useState<"mixed" | "dme" | "loudness">(
    project.dmeWaveforms ? "dme" : activeLoudness ? "loudness" : "mixed"
  );

  // Layers visibility state
  const [localLayers, setLocalLayers] = useState<MapLayerState>(
    propLayers || DEFAULT_MAP_LAYERS
  );
  const layers = propLayers || localLayers;

  const toggleLayer = (layer: keyof MapLayerState) => {
    const next = { ...layers, [layer]: !layers[layer] };
    setLocalLayers(next);
    onLayersChange?.(next);
  };

  useEffect(() => {
    if (project.dmeWaveforms) {
      setAudioMode("dme");
    } else if (activeLoudness) {
      setAudioMode("loudness");
    }
  }, [project.dmeWaveforms, activeLoudness]);

  const [activeCutDrag, setActiveCutDrag] = useState<{
    incomingId: string;
    outgoingId: string;
    originalTime: number;
    currentTime: number;
  } | null>(null);
  const dragCutRef = useRef<{
    incomingId: string;
    outgoingId: string;
    startX: number;
    originalTime: number;
    minTime: number;
    maxTime: number;
    hasMoved: boolean;
  } | null>(null);

  const [collapsedTracks, setCollapsedTracks] = useState<Record<StudioTrackId, boolean>>({
    markers: false,
    story: false,
    shots: false,
    pacing: false,
    cutDensity: false,
    framing: false,
    motion: false,
    palette: false,
    cast: false,
    sound: false,
  });
  const [soloTrack, setSoloTrack] = useState<StudioTrackId | null>(null);
  const [showVoltageOverlay, setShowVoltageOverlay] = useState(false);

  const [laneHeights, setLaneHeights] = useState<Record<StudioTrackId, number>>({
    ...DEFAULT_STUDIO_LANE_HEIGHTS,
  });
  const [resizingTrack, setResizingTrack] = useState<StudioTrackId | null>(null);
  const resizingRef = useRef<{ trackId: StudioTrackId; startY: number; startHeight: number } | null>(null);

  const handleResizePointerDown = useCallback(
    (trackId: StudioTrackId, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      suppressMapClick.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      resizingRef.current = {
        trackId,
        startY: e.clientY,
        startHeight: laneHeights[trackId],
      };
      setResizingTrack(trackId);
    },
    [laneHeights],
  );

  const handleResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    e.preventDefault();
    const delta = e.clientY - resizingRef.current.startY;
    const trackId = resizingRef.current.trackId;
    const minH = MIN_STUDIO_LANE_HEIGHTS[trackId];
    const newH = Math.max(minH, Math.round(resizingRef.current.startHeight + delta));
    setLaneHeights((prev) => ({ ...prev, [trackId]: newH }));
  }, []);

  const handleResizePointerUp = useCallback((e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    resizingRef.current = null;
    setResizingTrack(null);
    setTimeout(() => {
      suppressMapClick.current = false;
    }, 100);
  }, []);

  const handleResizeDoubleClick = useCallback((trackId: StudioTrackId, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLaneHeights((prev) => ({
      ...prev,
      [trackId]: DEFAULT_STUDIO_LANE_HEIGHTS[trackId],
    }));
  }, []);

  const handleResizeKeyDown = useCallback(
    (trackId: StudioTrackId, e: React.KeyboardEvent) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.shiftKey ? 15 : 5;
        const minH = MIN_STUDIO_LANE_HEIGHTS[trackId];
        setLaneHeights((prev) => ({
          ...prev,
          [trackId]: Math.max(minH, prev[trackId] - step),
        }));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const step = e.shiftKey ? 15 : 5;
        setLaneHeights((prev) => ({
          ...prev,
          [trackId]: prev[trackId] + step,
        }));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setLaneHeights((prev) => ({
          ...prev,
          [trackId]: DEFAULT_STUDIO_LANE_HEIGHTS[trackId],
        }));
      }
    },
    [],
  );

  const toggleTrackCollapse = useCallback((trackId: StudioTrackId) => {
    setCollapsedTracks((prev) => ({
      ...prev,
      [trackId]: !prev[trackId],
    }));
  }, []);

  const toggleTrackSolo = useCallback((trackId: StudioTrackId) => {
    setSoloTrack((prev) => (prev === trackId ? null : trackId));
  }, []);

  const isTrackCollapsed = useCallback(
    (trackId: StudioTrackId) => {
      if (soloTrack !== null) {
        return soloTrack !== trackId;
      }
      return Boolean(collapsedTracks[trackId]);
    },
    [collapsedTracks, soloTrack]
  );

  const [width, setWidth] = useState(1000);
  const [localZoom, setLocalZoom] = useState(1);
  const zoom = propZoom !== undefined ? propZoom : localZoom;

  const prevZoomRef = useRef(zoom);
  const isZoomingRef = useRef(false);

  const setZoom = useCallback(
    (action: number | ((prev: number) => number)) => {
      const next = typeof action === "function" ? action(zoom) : action;
      const clamped = Math.max(1, Math.min(128, next));
      isZoomingRef.current = true;
      setLocalZoom(clamped);
      onZoomChange?.(clamped);
    },
    [zoom, onZoomChange],
  );

  const [localScrollLeft, setLocalScrollLeft] = useState(0);
  const scrollLeft = propScrollLeft !== undefined ? propScrollLeft : localScrollLeft;

  useLayoutEffect(() => {
    if (prevZoomRef.current !== zoom || isZoomingRef.current) {
      prevZoomRef.current = zoom;
      isZoomingRef.current = false;
      if (zoom <= 1.001 && minimapDragging.current) {
        minimapDragging.current = false;
        setIsMinimapDragging(false);
        if (minimapRafId.current !== null) {
          cancelAnimationFrame(minimapRafId.current);
          minimapRafId.current = null;
        }
      }
      const el = viewport.current;
      if (!el) return;
      const dur = Math.max(project.duration, 1);
      const newCanvasWidth = Math.max(width, width * zoom);
      const newScale = newCanvasWidth / dur;
      const playheadX = time * newScale;
      const targetScrollLeft = Math.max(
        0,
        Math.min(newCanvasWidth - width, playheadX - width / 2),
      );
      el.scrollLeft = targetScrollLeft;
      setLocalScrollLeft(targetScrollLeft);
      onScrollChange?.(targetScrollLeft);
    }
  }, [zoom, width, time, project.duration, onScrollChange]);

  useEffect(() => {
    if (minimapDragging.current) return;
    if (propScrollLeft !== undefined && viewport.current) {
      if (Math.abs(viewport.current.scrollLeft - propScrollLeft) > 2) {
        viewport.current.scrollLeft = propScrollLeft;
      }
    }
  }, [propScrollLeft]);

  const duration = Math.max(project.duration, 1),
    canvasWidth = Math.max(width, width * zoom),
    scale = canvasWidth / duration;

  const snapPoints = useMemo(() => {
    const pts: number[] = [0, duration];
    for (const s of project.shots) {
      if (s.startSeconds > 0) pts.push(s.startSeconds);
      if (s.endSeconds < duration) pts.push(s.endSeconds);
    }
    return Array.from(new Set(pts)).sort((a, b) => a - b);
  }, [project.shots, duration]);

  const resolveSnap = (targetTime: number) => {
    if (!snapToCuts) {
      return targetTime;
    }
    const thresholdSec = 12 / scale;
    const snap = getSnapTime(targetTime, snapPoints, thresholdSec);
    if (snap.isSnapped && snap.snapTarget !== undefined) {
      return snap.snappedTime;
    }
    return targetTime;
  };

  const scrubAt = (clientX: number) => {
    const left = canvas.current!.getBoundingClientRect().left;
    const raw = Math.max(0, Math.min(project.duration, (clientX - left) / scale));
    const target = resolveSnap(raw);
    onScrub(target);
  };

  const buffer = width * 0.75;
  const visibleStartTime = Math.max(0, (scrollLeft - buffer) / scale);
  const visibleEndTime = Math.min(
    duration,
    (scrollLeft + width + buffer) / scale,
  );

  const visibleShots = useMemo(() => {
    if (zoom <= 1) return project.shots;
    return project.shots.filter(
      (s) =>
        s.endSeconds >= visibleStartTime && s.startSeconds <= visibleEndTime,
    );
  }, [project.shots, visibleStartTime, visibleEndTime, zoom]);

  const visibleCuts = useMemo(() => {
    const cuts: { incoming: Shot; outgoing: Shot }[] = [];
    for (let i = 1; i < project.shots.length; i++) {
      const incoming = project.shots[i];
      const outgoing = project.shots[i - 1];
      if (Math.abs(outgoing.endSeconds - incoming.startSeconds) <= 0.001) {
        if (
          zoom <= 1 ||
          (incoming.startSeconds >= visibleStartTime &&
            incoming.startSeconds <= visibleEndTime)
        ) {
          cuts.push({ incoming, outgoing });
        }
      }
    }
    return cuts;
  }, [project.shots, visibleStartTime, visibleEndTime, zoom]);

  const rulerTicks = useMemo(() => {
    const count = Math.max(2, Math.floor(canvasWidth / 130));
    const ticks: { i: number; t: number; x: number }[] = [];
    for (let i = 0; i < count; i++) {
      const t = (i * duration) / count;
      const x = t * scale;
      if (
        zoom <= 1 ||
        (x >= scrollLeft - 130 && x <= scrollLeft + width + 130)
      ) {
        ticks.push({ i, t, x });
      }
    }
    return ticks;
  }, [canvasWidth, duration, scale, zoom, scrollLeft, width]);

  const visibleSoundSpans = useMemo(() => {
    if (!project.soundSpans) return [];
    if (zoom <= 1) return project.soundSpans;
    return project.soundSpans.filter(
      (s) =>
        s.endSeconds >= visibleStartTime && s.startSeconds <= visibleEndTime,
    );
  }, [project.soundSpans, visibleStartTime, visibleEndTime, zoom]);

  const visibleSequences = useMemo(() => {
    if (!project.sequences) return [];
    if (zoom <= 1) return project.sequences;
    return project.sequences.filter(
      (s) =>
        s.endSeconds >= visibleStartTime && s.startSeconds <= visibleEndTime,
    );
  }, [project.sequences, visibleStartTime, visibleEndTime, zoom]);
  const speechOverlay = useMemo(() => {
    if (!speechAnalysis) return [];
    const regions = speechAnalysis.regions.flatMap((region) => [{ ...region, kind: "speech" as const }, ...pauseRegions(speechAnalysis.regions).map((pause) => ({ ...pause, kind: "pause" as const }))]);
    const visible = regions.filter((region) => region.endSeconds >= visibleStartTime && region.startSeconds <= visibleEndTime);
    // The visual overlay is deliberately bounded; click handling still seeks every stored region.
    return visible.length > 600 ? visible.filter((_, index) => index % Math.ceil(visible.length / 600) === 0) : visible;
  }, [speechAnalysis, visibleStartTime, visibleEndTime]);
  const speechCutOverlay = useMemo(() => {
    if (!speechAnalysis) return [];
    const visible = project.shots.slice(1).filter((shot) => shot.startSeconds >= visibleStartTime && shot.startSeconds <= visibleEndTime);
    const bounded = visible.length > 600 ? visible.filter((_, index) => index % Math.ceil(visible.length / 600) === 0) : visible;
    return bounded.map((shot) => ({ time: shot.startSeconds, kind: classifyCut(shot.startSeconds, speechAnalysis.regions) }));
  }, [speechAnalysis, project.shots, visibleStartTime, visibleEndTime]);

  const currentShot = useMemo(() => {
    return (
      project.shots.find((s) => s.id === (active || selected)) ||
      project.shots.find((s) => time >= s.startSeconds && time <= s.endSeconds)
    );
  }, [project.shots, active, selected, time]);

  const currentMotion = currentShot?.motionProfile;
  const currentMotionVelocity = currentMotion
    ? classifyKineticVelocity(currentMotion.totalKineticEnergy)
    : "";
  const currentMotionMomentum =
    currentMotion?.kineticDelta !== undefined
      ? classifyMomentumTransition(currentMotion.kineticDelta)
      : null;
  const motionReadout = currentMotion
    ? `${currentMotion.totalKineticEnergy}% Flow · ${currentMotionVelocity}${
        currentMotionMomentum && currentMotionMomentum.type !== "initial"
          ? ` (${currentMotionMomentum.label})`
          : ""
      }`
    : "Ready to Scan";

  const cuts = useMemo(() => cutTimes(project.shots), [project.shots]);
  const cutShockData = useMemo(() => computeCutShockData(project.shots), [project.shots]);
  const cutShockMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of cutShockData) {
      map.set(Math.round(c.time * 1000), c.shockScore);
    }
    return map;
  }, [cutShockData]);

  const eyeTraceMap = useMemo(() => {
    const map = new Map<string, EyeTraceCutReading>();
    if (project.cutAnnotations) {
      for (const ann of project.cutAnnotations) {
        if (ann.eyeTrace) {
          map.set(`${ann.outgoingId}->${ann.incomingId}`, ann.eyeTrace);
        }
      }
    }
    return map;
  }, [project.cutAnnotations]);

  const whiplashClusters = useMemo(() => {
    return detectWhiplashClusters(project.shots, project.cutAnnotations);
  }, [project.shots, project.cutAnnotations]);

  const scannedCutCount = eyeTraceMap.size;
  const totalCutCount = Math.max(0, project.shots.length - 1);

  const [isBatchScanningSaccades, setIsBatchScanningSaccades] = useState(false);
  const [batchScanProgress, setBatchScanProgress] = useState<BatchScanProgress>({ current: 0, total: 0, percent: 0 });
  const batchScanAbortRef = useRef<AbortController | null>(null);

  const handleStartBatchScan = useCallback(async () => {
    if (!url || !onUpdateCutAnnotations || isBatchScanningSaccades) return;
    const controller = new AbortController();
    batchScanAbortRef.current = controller;
    setIsBatchScanningSaccades(true);
    setBatchScanProgress({ current: 0, total: totalCutCount, percent: 0 });

    try {
      const updated = await scanProjectEyeTrace(
        project.shots,
        project.cutAnnotations,
        url,
        project.frameRate,
        (p) => setBatchScanProgress(p),
        controller.signal
      );
      if (!controller.signal.aborted) {
        onUpdateCutAnnotations(updated);
      }
    } catch {
      // Aborted or error
    } finally {
      setIsBatchScanningSaccades(false);
      batchScanAbortRef.current = null;
    }
  }, [url, onUpdateCutAnnotations, isBatchScanningSaccades, project.shots, project.cutAnnotations, project.frameRate, totalCutCount]);

  useEffect(() => {
    if (
      url &&
      onUpdateCutAnnotations &&
      project.shots.length >= 2 &&
      eyeTraceMap.size === 0 &&
      !isBatchScanningSaccades
    ) {
      handleStartBatchScan();
    }
  }, [url, project.shots.length, eyeTraceMap.size, onUpdateCutAnnotations, handleStartBatchScan, isBatchScanningSaccades]);

  const pacingPoints = useMemo(
    () => pacingCurve(cuts, duration, 30),
    [cuts, duration]
  );
  const currentPacing = useMemo(
    () => pacingAt(cuts, duration, 30, time),
    [cuts, duration, time]
  );
  const maxPacingRate = useMemo(() => {
    return Math.max(12, Math.ceil(Math.max(...pacingPoints.map((p) => p.rate), 0) / 5) * 5);
  }, [pacingPoints]);

  const riverPacing = useMemo(() => {
    return generatePacingPathAndArea(project.shots, duration, scale, 48);
  }, [project.shots, duration, scale]);
  const pacingSvgPath = riverPacing.path;
  const pacingSvgArea = riverPacing.area;

  const pacingCategory = useMemo(() => {
    const rate = currentPacing.rate;
    if (rate >= 24) return "Rapid Montage";
    if (rate >= 14) return "Dynamic Action";
    if (rate >= 8) return "Brisk Narrative";
    if (rate >= 4) return "Measured Flow";
    return "Contemplative";
  }, [currentPacing.rate]);

  const framingSplinePoints = useMemo(() => {
    if (!visibleShots.length || duration <= 0) return "";
    return visibleShots
      .map((s) => {
        const midTime = (s.startSeconds + s.endSeconds) / 2;
        const rank = framingRank(s) ?? 0;
        const x = midTime * scale;
        const y = 36 - (rank / 8) * 28;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [visibleShots, duration, scale]);

  // Studio Mode rhythm calculations
  const studioPacing = useMemo(() => {
    return generatePacingPathAndArea(project.shots, duration, scale, laneHeights.pacing);
  }, [project.shots, duration, scale, laneHeights.pacing]);

  const cutDensityWave = useMemo(() => {
    return generateCutDensityPathAndArea(
      project.shots,
      duration,
      scale,
      laneHeights.cutDensity,
      project.cutAnnotations
    );
  }, [project.shots, duration, scale, laneHeights.cutDensity, project.cutAnnotations]);

  const studioMedianPacing = useMemo(() => {
    if (!project.shots.length) return 8;
    const cuts = cutTimes(project.shots);
    const pts = pacingCurve(cuts, duration, 30);
    if (!pts.length) return 8;
    const rates = pts.map((p) => p.rate).sort((a, b) => a - b);
    return rates[Math.floor(rates.length / 2)] || 8;
  }, [project.shots, duration]);

  const studioVoltage = useMemo(() => {
    if (!showVoltageOverlay || !project.shots.length || duration <= 0) return null;
    const score = generatePolyphonicScore(project, Math.max(80, Math.min(400, Math.round(duration * 2))), 20);
    const chords = score.chords;
    if (!chords.length) return null;

    const h = laneHeights.pacing;
    const vPts: [number, number][] = [];
    const aPts: [number, number][] = [];

    for (const c of chords) {
      const x = c.time * scale;
      const yV = 4 + (h - 8) * (1 - c.visualVoltage / 100);
      const yA = 4 + (h - 8) * (1 - c.acousticVoltage / 100);
      vPts.push([x, yV]);
      aPts.push([x, yA]);
    }

    const build = (pts: [number, number][]) => {
      let p = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        p += ` L ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
      }
      return p;
    };

    const visualPath = build(vPts);
    const acousticPath = build(aPts);
    const visualArea = `${visualPath} L ${vPts[vPts.length - 1][0].toFixed(1)} ${h} L 0 ${h} Z`;
    const acousticArea = `${acousticPath} L ${aPts[aPts.length - 1][0].toFixed(1)} ${h} L 0 ${h} Z`;

    return {
      visualPath,
      visualArea,
      acousticPath,
      acousticArea,
      score,
    };
  }, [showVoltageOverlay, project, duration, scale, laneHeights.pacing]);

  const studioMotion = useMemo(() => {
    return generateMotionFlowPathAndArea(project.shots, duration, scale, laneHeights.motion);
  }, [project.shots, duration, scale, laneHeights.motion]);

  const soundSubrowH = useMemo(() => {
    return Math.max(10, Math.floor(laneHeights.sound / 5));
  }, [laneHeights.sound]);

  const studioDmePaths = useMemo(() => {
    const dme = project.dmeWaveforms;
    const speechLevels = dme?.dialogue ?? waveform;
    const musicLevels = dme?.music ?? waveform;
    const ambLevels = dme?.effects ?? waveform;
    return {
      speech: generateSymmetricalWaveformPath(speechLevels, duration, scale, soundSubrowH, true),
      music: generateSymmetricalWaveformPath(musicLevels, duration, scale, soundSubrowH, false),
      ambience: generateSymmetricalWaveformPath(ambLevels, duration, scale, soundSubrowH, true),
      hasDme: Boolean(dme),
    };
  }, [project.dmeWaveforms, waveform, duration, scale, soundSubrowH]);

  const studioLoudnessPath = useMemo(() => {
    return generateLoudnessCurvePath(activeLoudness, waveform, duration, scale, soundSubrowH);
  }, [activeLoudness, waveform, duration, scale, soundSubrowH]);

  const activeCastMembers = useMemo(() => {
    if (!project.cast || !project.cast.length) return [];
    return project.cast.slice(0, 5);
  }, [project.cast]);

  const memberIntervalsMap = useMemo(() => {
    const map = new Map<string, Array<{ start: number; end: number; shot: Shot }>>();
    if (!project.cast || !project.cast.length) return map;
    project.cast.forEach((m) => map.set(m.id, []));

    for (const s of project.shots) {
      const ca = s.characterAnalysis;
      if (!ca) continue;
      if (ca.manualReviewStatus === "Confirmed" && ca.manualMemberIds) {
        for (const id of ca.manualMemberIds) {
          map.get(id)?.push({ start: s.startSeconds, end: s.endSeconds, shot: s });
        }
      } else if (ca.intervals && ca.intervals.length > 0) {
        for (const interval of ca.intervals) {
          const start =
            interval.endSeconds > interval.startSeconds + 0.05
              ? interval.startSeconds
              : s.startSeconds;
          const end =
            interval.endSeconds > interval.startSeconds + 0.05
              ? interval.endSeconds
              : s.endSeconds;
          map.get(interval.memberId)?.push({
            start,
            end,
            shot: s,
          });
        }
      }
    }
    return map;
  }, [project.cast, project.shots]);

  const studioCastTokens = useMemo(() => {
    if (!project.cast || !project.cast.length || !visibleShots.length) return [];
    const castMap = new Map<string, { member: (typeof project.cast)[0]; color: string }>();
    project.cast.forEach((m, idx) => {
      castMap.set(m.id, { member: m, color: CAST_PALETTE[idx % CAST_PALETTE.length] });
    });

    const tokens: Array<{
      shotId: string;
      shotIndex: number;
      startSeconds: number;
      duration: number;
      primaryMember: (typeof project.cast)[0];
      primaryColor: string;
      secondaryMembers: Array<{ member: (typeof project.cast)[0]; color: string }>;
    }> = [];

    for (const s of visibleShots) {
      const ca = s.characterAnalysis;
      if (!ca) continue;
      let presentMemberIds: string[] = [];
      if (ca.manualReviewStatus === "Confirmed" && ca.manualMemberIds?.length) {
        presentMemberIds = ca.manualMemberIds;
      } else if (ca.intervals?.length) {
        presentMemberIds = Array.from(new Set(ca.intervals.map((i) => i.memberId)));
      }
      if (!presentMemberIds.length) continue;

      const presentMembers = presentMemberIds
        .map((id) => castMap.get(id))
        .filter((item): item is { member: (typeof project.cast)[0]; color: string } => Boolean(item));

      if (!presentMembers.length) continue;

      tokens.push({
        shotId: s.id,
        shotIndex: s.index,
        startSeconds: s.startSeconds,
        duration: s.duration,
        primaryMember: presentMembers[0].member,
        primaryColor: presentMembers[0].color,
        secondaryMembers: presentMembers.slice(1),
      });
    }
    return tokens;
  }, [project.cast, visibleShots]);

  const memberShotIdsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!project.shots) return map;
    for (const s of project.shots) {
      const ca = s.characterAnalysis;
      if (!ca) continue;
      if (ca.manualMemberIds) {
        for (const id of ca.manualMemberIds) {
          let list = map.get(id);
          if (!list) { list = []; map.set(id, list); }
          list.push(s.id);
        }
      }
      if (ca.intervals) {
        for (const interval of ca.intervals) {
          let list = map.get(interval.memberId);
          if (!list) { list = []; map.set(interval.memberId, list); }
          list.push(s.id);
        }
      }
    }
    return map;
  }, [project.shots]);

  const visibleRange = dragRange ?? range;

  const rangeInfo = useMemo(() => {
    if (!visibleRange || visibleRange.start === undefined || visibleRange.end === undefined || visibleRange.end <= visibleRange.start) {
      return null;
    }
    const start = visibleRange.start;
    const end = visibleRange.end;
    const rangeShots = visibleShots.filter((s) => s.endSeconds > start && s.startSeconds < end);
    const matchingScene = (project.sequences || []).find(
      (sc) => (sc.kind ?? "passage") === "passage" && Math.abs(sc.startSeconds - start) < 1.0 && Math.abs(sc.endSeconds - end) < 1.0
    );

    let descriptor = "balanced rhythm";
    if (rangeShots.length > 0) {
      const energies = rangeShots
        .map((s) => s.motionProfile?.totalKineticEnergy)
        .filter((e): e is number => typeof e === "number");
      if (energies.length >= 2) {
        const half = Math.ceil(energies.length / 2);
        const e1 = energies.slice(0, half).reduce((a, b) => a + b, 0) / half;
        const e2 = energies.slice(half).reduce((a, b) => a + b, 0) / (energies.length - half);
        if (e2 - e1 <= -10) descriptor = "energy falls";
        else if (e2 - e1 >= 10) descriptor = "energy surges";
      }
      if (descriptor === "balanced rhythm") {
        const avgDur = rangeShots.reduce((a, s) => a + s.duration, 0) / rangeShots.length;
        if (avgDur < 1.8) descriptor = "rapid cutting";
        else if (avgDur > 5.5) descriptor = "contemplative hold";
        else {
          const closeCount = rangeShots.filter((s) => {
            const r = framingRank(s);
            return r !== null && r >= 5;
          }).length;
          if (closeCount / rangeShots.length >= 0.6) descriptor = "intimate dialogue";
        }
      }
    }

    return {
      title: matchingScene ? matchingScene.name : (rangeShots.length ? `Scene ${rangeShots[0].index}` : "A quiet turn"),
      start,
      end,
      shotCount: rangeShots.length,
      descriptor,
    };
  }, [visibleRange, visibleShots, project.sequences]);

  const sortedStoryEntries = useMemo(() => {
    return [...(project.sequences || [])].sort(
      (a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds,
    );
  }, [project.sequences]);

  const layoutStoryEntries = useMemo(() => {
    const minSpacingPx = 18;
    const minSpacingSec = scale > 0 ? minSpacingPx / scale : 1;
    const subrowsEnd: number[] = [];
    const result: Array<{ sequence: SequenceMarker; subrow: number }> = [];

    for (const seq of sortedStoryEntries) {
      const isMoment = (seq.kind ?? "passage") === "moment";
      const start = seq.startSeconds;
      const end = isMoment
        ? seq.startSeconds + minSpacingSec
        : Math.max(seq.endSeconds, seq.startSeconds + minSpacingSec);

      let assignedSubrow = -1;
      for (let r = 0; r < subrowsEnd.length; r++) {
        if (start >= subrowsEnd[r]) {
          assignedSubrow = r;
          subrowsEnd[r] = end;
          break;
        }
      }
      if (assignedSubrow === -1) {
        assignedSubrow = subrowsEnd.length;
        subrowsEnd.push(end);
      }
      result.push({ sequence: seq, subrow: assignedSubrow });
    }
    return {
      entries: result,
      totalSubrows: Math.max(1, subrowsEnd.length),
    };
  }, [sortedStoryEntries, scale]);

  const storyLaneHeight = Math.max(34, layoutStoryEntries.totalSubrows * 26 + 8);
  const effectiveStoryHeight = Math.max(laneHeights.story, storyLaneHeight);

  const [activeStoryDrag, setActiveStoryDrag] = useState<{
    sequenceId: string;
    kind: "moment" | "passage-in" | "passage-out" | "passage-move";
    initialStart: number;
    initialEnd: number;
    currentStart: number;
    currentEnd: number;
    startX: number;
    hasMoved: boolean;
  } | null>(null);
  const storyDragRef = useRef<typeof activeStoryDrag>(null);
  storyDragRef.current = activeStoryDrag;

  const handleMomentPointerDown = (e: React.PointerEvent, seq: SequenceMarker) => {
    if (e.button !== 0 || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    suppressMapClick.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const dragObj = {
      sequenceId: seq.id,
      kind: "moment" as const,
      initialStart: seq.startSeconds,
      initialEnd: seq.endSeconds,
      currentStart: seq.startSeconds,
      currentEnd: seq.endSeconds,
      startX: e.clientX,
      hasMoved: false,
    };
    storyDragRef.current = dragObj;
    setActiveStoryDrag(dragObj);
  };

  const handlePassageInPointerDown = (e: React.PointerEvent, seq: SequenceMarker) => {
    if (e.button !== 0 || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    suppressMapClick.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const dragObj = {
      sequenceId: seq.id,
      kind: "passage-in" as const,
      initialStart: seq.startSeconds,
      initialEnd: seq.endSeconds,
      currentStart: seq.startSeconds,
      currentEnd: seq.endSeconds,
      startX: e.clientX,
      hasMoved: false,
    };
    storyDragRef.current = dragObj;
    setActiveStoryDrag(dragObj);
  };

  const handlePassageOutPointerDown = (e: React.PointerEvent, seq: SequenceMarker) => {
    if (e.button !== 0 || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    suppressMapClick.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const dragObj = {
      sequenceId: seq.id,
      kind: "passage-out" as const,
      initialStart: seq.startSeconds,
      initialEnd: seq.endSeconds,
      currentStart: seq.startSeconds,
      currentEnd: seq.endSeconds,
      startX: e.clientX,
      hasMoved: false,
    };
    storyDragRef.current = dragObj;
    setActiveStoryDrag(dragObj);
  };

  const handlePassageBodyPointerDown = (e: React.PointerEvent, seq: SequenceMarker) => {
    if (e.button !== 0 || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    suppressMapClick.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const dragObj = {
      sequenceId: seq.id,
      kind: "passage-move" as const,
      initialStart: seq.startSeconds,
      initialEnd: seq.endSeconds,
      currentStart: seq.startSeconds,
      currentEnd: seq.endSeconds,
      startX: e.clientX,
      hasMoved: false,
    };
    storyDragRef.current = dragObj;
    setActiveStoryDrag(dragObj);
  };

  const handleStoryPointerMove = (e: React.PointerEvent) => {
    const drag = storyDragRef.current;
    if (!drag) return;
    if (Math.abs(e.clientX - drag.startX) > 3) {
      drag.hasMoved = true;
    }
    const deltaSec = (e.clientX - drag.startX) / scale;
    const minDur = 1 / actualRate(project.frameRate);

    let nextStart = drag.currentStart;
    let nextEnd = drag.currentEnd;

    if (drag.kind === "moment") {
      let t = Math.max(0, Math.min(duration, drag.initialStart + deltaSec));
      if (snapToCuts && !e.altKey) {
        const snap = getSnapTime(t, snapPoints, 10 / scale);
        if (snap.isSnapped && snap.snapTarget !== undefined) t = snap.snapTarget;
      }
      t = quantizeToFrame(t, project.frameRate);
      nextStart = t;
      nextEnd = t;
    } else if (drag.kind === "passage-in") {
      let t = Math.max(0, Math.min(drag.initialEnd - minDur, drag.initialStart + deltaSec));
      if (snapToCuts && !e.altKey) {
        const snap = getSnapTime(t, snapPoints, 10 / scale);
        if (snap.isSnapped && snap.snapTarget !== undefined && snap.snapTarget < drag.initialEnd) {
          t = snap.snapTarget;
        }
      }
      t = quantizeToFrame(t, project.frameRate);
      nextStart = t;
    } else if (drag.kind === "passage-out") {
      let t = Math.max(drag.initialStart + minDur, Math.min(duration, drag.initialEnd + deltaSec));
      if (snapToCuts && !e.altKey) {
        const snap = getSnapTime(t, snapPoints, 10 / scale);
        if (snap.isSnapped && snap.snapTarget !== undefined && snap.snapTarget > drag.initialStart) {
          t = snap.snapTarget;
        }
      }
      t = quantizeToFrame(t, project.frameRate);
      nextEnd = t;
    } else if (drag.kind === "passage-move") {
      const dur = drag.initialEnd - drag.initialStart;
      let t = Math.max(0, Math.min(duration - dur, drag.initialStart + deltaSec));
      if (snapToCuts && !e.altKey) {
        const snap = getSnapTime(t, snapPoints, 10 / scale);
        if (snap.isSnapped && snap.snapTarget !== undefined) t = snap.snapTarget;
      }
      t = quantizeToFrame(t, project.frameRate);
      nextStart = t;
      nextEnd = t + dur;
    }

    drag.currentStart = nextStart;
    drag.currentEnd = nextEnd;
    setActiveStoryDrag({ ...drag });
  };

  const handleStoryPointerUp = (e: React.PointerEvent, seq: SequenceMarker) => {
    const drag = storyDragRef.current;
    if (!drag) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    if (drag.hasMoved) {
      const updated = (project.sequences || []).map((s) =>
        s.id === drag.sequenceId
          ? { ...s, startSeconds: drag.currentStart, endSeconds: drag.currentEnd }
          : s,
      );
      onUpdateSequences?.(updated);
      const updatedSeq = updated.find((s) => s.id === drag.sequenceId);
      if (updatedSeq) {
        onSelectSequence?.(updatedSeq);
      }
      if ((seq.kind ?? "passage") === "passage") {
        onRangeChange?.({ start: drag.currentStart, end: drag.currentEnd });
      }
    } else {
      onSelectSequence?.(seq);
      if ((seq.kind ?? "passage") === "passage") {
        onRangeChange?.({ start: seq.startSeconds, end: seq.endSeconds });
      }
      onSeek?.(seq.startSeconds);
    }

    storyDragRef.current = null;
    setActiveStoryDrag(null);
  };

  const getFramingTier = useCallback((shot: Shot): "Close" | "Medium" | "Wide" => {
    const rank = framingRank(shot);
    if (rank === null) return "Medium";
    if (rank >= 5) return "Close";
    if (rank >= 3) return "Medium";
    return "Wide";
  }, []);

  const allRiversOn = layers.pacing && layers.framingArc && layers.motion && layers.characters && layers.audio && layers.scenes;

  const toggleAllRivers = () => {
    const target = !allRiversOn;
    const next = {
      framing: true,
      pacing: target,
      framingArc: target,
      motion: target,
      characters: target,
      audio: target,
      scenes: target,
    };
    setLocalLayers(next);
    onLayersChange?.(next);
  };

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ob = new ResizeObserver(() => setWidth(el.clientWidth));
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  useEffect(() => {
    if (dragging.current || minimapDragging.current) return;
    const el = viewport.current;
    if (!el) return;
    const x = time * scale;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 16)
      el.scrollLeft = Math.max(0, x - el.clientWidth * 0.25);
  }, [time, scale]);

  const changeZoom = (factor: number) =>
    setZoom((z: number) => Math.max(1, Math.min(128, z * factor)));

  const handleMark = useCallback(() => {
    const frameRate = project?.frameRate || 24;
    const exactFrameTime = quantizeToFrame(time, frameRate);
    const currentSequences = project.sequences || [];
    const isPassage =
      range?.start !== undefined &&
      range?.end !== undefined &&
      range.end > range.start;
    const start = isPassage ? range.start! : exactFrameTime;
    const end = isPassage ? range.end! : exactFrameTime;
    const kind = isPassage ? "passage" : "moment";
    const count = currentSequences.filter(
      (s) => (s.kind ?? "passage") === kind,
    ).length;

    const newMarker: SequenceMarker = {
      id: `seq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: isPassage ? `Passage ${count + 1}` : `Marker ${count + 1}`,
      startSeconds: start,
      endSeconds: end,
      kind,
    };
    onUpdateSequences?.([...currentSequences, newMarker]);
    onSelectSequence?.(newMarker);
    if (isPassage) {
      onRangeChange?.({ start, end });
    }
    if (isTrackCollapsed("story")) {
      toggleTrackCollapse("story");
    }
  }, [time, range, project, onUpdateSequences, onSelectSequence, onRangeChange, isTrackCollapsed, toggleTrackCollapse]);

  const handleMarkIn = useCallback(() => {
    const frameRate = project?.frameRate || 24;
    const exactFrameTime = quantizeToFrame(time, frameRate);
    onRangeChange?.({
      start: exactFrameTime,
      end: range?.end !== undefined && range.end > exactFrameTime ? range.end : undefined,
    });
  }, [time, project, range, onRangeChange]);

  const handleMarkOut = useCallback(() => {
    const frameRate = project?.frameRate || 24;
    const exactFrameTime = quantizeToFrame(time, frameRate);
    onRangeChange?.({
      start: range?.start !== undefined && range.start < exactFrameTime ? range.start : undefined,
      end: exactFrameTime,
    });
  }, [time, project, range, onRangeChange]);

  const handleClearInOut = useCallback(() => {
    onRangeChange?.(undefined);
  }, [onRangeChange]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]"
        )
      ) {
        return;
      }
      if ((e.code === "KeyX" || e.key.toLowerCase() === "x" || e.key === "≈") && (e.altKey || e.metaKey)) {
        e.preventDefault();
        handleClearInOut();
        return;
      }
      if (
        e.altKey ||
        e.ctrlKey ||
        e.metaKey
      ) {
        return;
      }
      if (e.key === "Escape" && storyDragRef.current) {
        e.preventDefault();
        storyDragRef.current = null;
        setActiveStoryDrag(null);
        return;
      }
      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        changeZoom(1 / 1.25);
      } else if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        changeZoom(1.25);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setZoom(1);
        if (viewport.current) viewport.current.scrollLeft = 0;
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        onSplitShot?.(time);
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        handleMark();
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        handleMarkIn();
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        handleMarkOut();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        onToggleSnap?.();
      } else if (selectedSequenceId && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        const updated = (project.sequences || []).filter((s) => s.id !== selectedSequenceId);
        onUpdateSequences?.(updated);
        onSelectSequence?.(null as any);
        onRangeChange?.(undefined);
      } else if (selectedCut && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        onDeleteCut?.(selectedCut);
      } else if (selectedCut && (e.key === "[" || e.key === "{")) {
        e.preventDefault();
        onNudgeCut?.(selectedCut, e.shiftKey ? -5 : -1);
      } else if (selectedCut && (e.key === "]" || e.key === "}")) {
        e.preventDefault();
        onNudgeCut?.(selectedCut, e.shiftKey ? 5 : 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [time, selectedCut, onSplitShot, onDeleteCut, onToggleSnap, onNudgeCut, handleMark, handleMarkIn, handleMarkOut, handleClearInOut]);

  const pointAt = (clientX: number) =>
    Math.max(0, Math.min(project.duration, (clientX - canvas.current!.getBoundingClientRect().left) / scale));

  // Cleanup minimap rAF on unmount
  useEffect(() => {
    return () => {
      if (minimapRafId.current !== null) {
        cancelAnimationFrame(minimapRafId.current);
      }
    };
  }, []);

  // Minimap interactions (smooth, non-jumping, glitch-free)
  const updateMinimapScroll = useCallback(
    (clientX: number, isInitialClick: boolean = false) => {
      const el = minimapRef.current;
      const vp = viewport.current;
      if (!el || !vp) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;

      const maxScroll = Math.max(0, canvasWidth - width);
      if (maxScroll <= 0) return;

      const currentBoxWidth = Math.max(8, Math.min(rect.width, (width / canvasWidth) * rect.width));
      const clickX = clientX - rect.left;

      if (isInitialClick) {
        const currentScroll = vp.scrollLeft;
        const currentBoxLeft = (currentScroll / canvasWidth) * rect.width;
        // If clicking within the active visible viewport window, drag with offset to prevent sudden jumping
        if (clickX >= currentBoxLeft && clickX <= currentBoxLeft + currentBoxWidth) {
          minimapDragOffset.current = clickX - currentBoxLeft;
        } else {
          // If clicking elsewhere on track, center viewport window around click
          minimapDragOffset.current = currentBoxWidth / 2;
        }
      }

      const availableTrackWidth = Math.max(1, rect.width - currentBoxWidth);
      const targetBoxLeft = Math.max(
        0,
        Math.min(availableTrackWidth, clickX - minimapDragOffset.current),
      );
      const targetScroll = Math.max(
        0,
        Math.min(maxScroll, (targetBoxLeft / availableTrackWidth) * maxScroll),
      );

      vp.scrollLeft = targetScroll;
      setLocalScrollLeft(targetScroll);
      onScrollChange?.(targetScroll);
    },
    [canvasWidth, width, onScrollChange],
  );

  const handleMinimapPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      minimapDragging.current = true;
      setIsMinimapDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      updateMinimapScroll(e.clientX, true);
    },
    [updateMinimapScroll],
  );

  const handleMinimapPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!minimapDragging.current) return;
      const clientX = e.clientX;
      if (minimapRafId.current !== null) {
        cancelAnimationFrame(minimapRafId.current);
      }
      minimapRafId.current = requestAnimationFrame(() => {
        updateMinimapScroll(clientX, false);
      });
    },
    [updateMinimapScroll],
  );

  const handleMinimapPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (minimapDragging.current) {
        minimapDragging.current = false;
        setIsMinimapDragging(false);
        if (minimapRafId.current !== null) {
          cancelAnimationFrame(minimapRafId.current);
          minimapRafId.current = null;
        }
        updateMinimapScroll(e.clientX, false);
      }
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {}
    },
    [updateMinimapScroll],
  );

  const handleMergeCut = useCallback(() => {
    if (!onDeleteCut) return;
    if (selectedCut) {
      onDeleteCut(selectedCut);
      return;
    }
    // If no cut is currently selected, find cut nearest to current time
    if (project?.shots && project.shots.length > 1) {
      let nearestCutId: string | null = null;
      let minDiff = Infinity;
      for (let i = 1; i < project.shots.length; i++) {
        const cutTime = project.shots[i].startSeconds;
        const diff = Math.abs(time - cutTime);
        if (diff < minDiff) {
          minDiff = diff;
          nearestCutId = project.shots[i].id;
        }
      }
      if (nearestCutId) {
        onDeleteCut(nearestCutId);
      }
    }
  }, [onDeleteCut, selectedCut, project?.shots, time]);

  return (
    <section className={`map panel mode-${workspaceMode}`}>
      {isStudio ? (
        <StudioToolbar
          activeTab={activeTab}
          drawerOpen={drawerOpen}
          onSelectTab={onSelectTab}
          onToggleDrawer={onToggleDrawer}
          expanded={expanded}
          onSplit={() => onSplitShot?.(time)}
          onMerge={handleMergeCut}
          onMark={handleMark}
          snapToCuts={Boolean(snapToCuts)}
          onToggleSnap={() => onToggleSnap?.()}
          onMarkIn={handleMarkIn}
          onMarkOut={handleMarkOut}
          onClearInOut={handleClearInOut}
          squintMode={Boolean(squintMode)}
          onToggleSquint={(active) => onToggleSquint?.(active)}
          zoom={zoom}
          onZoomChange={setZoom}
          onZoomIn={() => changeZoom(1.5)}
          onZoomOut={() => changeZoom(1 / 1.5)}
          onFit={() => {
            setZoom(1);
            if (viewport.current) viewport.current.scrollLeft = 0;
          }}
          onFullscreen={onOpenFullscreen}
        />
      ) : (
        <div className="section-head">
          <div className="map-title-group">
            <span className="eyebrow">{expanded ? "FILM MAP" : "EDITING MAP"}</span>
            <span className="muted">
              {project.shots.length} shots · duration-scaled
            </span>
          </div>

          {expanded && (
            <details className="studio-layer-menu">
              <summary>Layers</summary>
              <div role="group" aria-label="Expanded map layers">
                {([['story', 'Story'], ['shots', 'Shots'], ['pacing', 'Pacing'], ['cutDensity', 'Cut density'], ['framing', 'Framing'], ['motion', 'Motion'], ['cast', 'Cast'], ['sound', 'Sound']] as const).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={!isTrackCollapsed(id)} onClick={() => { setSoloTrack(null); toggleTrackCollapse(id); }}>{label}</button>
                ))}
              </div>
            </details>
          )}
          {/* Toolbar: Color Mode & Layer Toggles & Zoom/Fit */}
          <div className="tools">
            {/* Rivers of Data Visibility Controls */}
            {showLayersControl && (
              <div className="map-layers-group map-rivers-toolbar" role="group" aria-label="Timeline Layer Visibility">
                <span className="layers-label">Rivers:</span>
                <button
                  type="button"
                  className={`river-toggle-chip ${layers.scenes ? "active" : ""}`}
                  onClick={() => toggleLayer("scenes")}
                  title="Dramatic Scenes & Sequences River"
                >
                  🎬 Scenes
                </button>
                <button
                  type="button"
                  className={`river-toggle-chip ${layers.framing ? "active" : ""}`}
                  onClick={() => toggleLayer("framing")}
                  title="V1 Film Shot Track"
                >
                  🎞️ Film
                </button>
                <button
                  type="button"
                  className={`river-toggle-chip ${layers.pacing ? "active" : ""}`}
                  onClick={() => toggleLayer("pacing")}
                  title="Cutting Pacing & Rhythm Velocity River"
                >
                  🌊 Pacing
                </button>
                <button
                  type="button"
                  className={`river-toggle-chip ${layers.framingArc ? "active" : ""}`}
                  onClick={() => toggleLayer("framingArc")}
                  title="Framing Scale Elevation River"
                >
                  📐 Framing
                </button>
                <button
                  type="button"
                  className={`river-toggle-chip ${layers.motion ? "active" : ""}`}
                  onClick={() => toggleLayer("motion")}
                  title="Motion & Kinetic Energy River"
                >
                  ⚡ Motion
                </button>
                <button
                  type="button"
                  className={`river-toggle-chip ${layers.characters ? "active" : ""}`}
                  onClick={() => toggleLayer("characters")}
                  title="Cast & Character Presence River"
                >
                  👥 Characters
                </button>
                <button
                  type="button"
                  className={`river-toggle-chip ${layers.audio ? "active" : ""}`}
                  onClick={() => toggleLayer("audio")}
                  title="Soundtrack & Sonic Rivers (DME / Loudness / Speech)"
                >
                  🔊 Audio
                </button>
                <button
                  type="button"
                  className={`river-flow-all-btn ${allRiversOn ? "active" : ""}`}
                  onClick={toggleAllRivers}
                  title={allRiversOn ? "Collapse secondary data rivers" : "Flow all data rivers synchronously"}
                >
                  {allRiversOn ? "Collapse" : "🌊 Flow All"}
                </button>
              </div>
            )}

            {/* Editorial Cut Tools (Split, Merge, Snap) */}
            <div className="view-toggle-group timeline-edit-group" role="group" aria-label="Timeline Editorial Tools">
              {onSplitShot && (
                <button
                  type="button"
                  className="split-shot-btn"
                  onClick={() => onSplitShot(time)}
                  title="Add Cut / Split shot at current frame (C)"
                >
                  ✂️ Split (C)
                </button>
              )}
              {selectedCut && onDeleteCut && (
                <button
                  type="button"
                  className="merge-cut-btn"
                  onClick={() => onDeleteCut(selectedCut)}
                  title="Merge adjacent shots by deleting this cut (Delete/Backspace)"
                >
                  ⌫ Merge Cut (Del)
                </button>
              )}
              {onToggleSnap && (
                <button
                  type="button"
                  className={`snap-toggle-btn ${snapToCuts ? "active" : ""}`}
                  onClick={onToggleSnap}
                  title={`Playhead snapping to cut boundaries: ${snapToCuts ? "ON" : "OFF"} (S)`}
                >
                  🧲 Snap {snapToCuts ? "ON" : "OFF"}
                </button>
              )}
            </div>

            {/* Squint Mode Toggle */}
            <div className="view-toggle-group" role="group" aria-label="Squint Mode">
              <button
                type="button"
                className={`timeline-squint-btn ${squintMode ? "active" : ""}`}
                onClick={() => onToggleSquint?.(!squintMode)}
                title="Toggle Squint Mode (Multi-effect Notan / Chiaroscuro tonal blur on timeline shots)"
              >
                😑 Squint {squintMode ? `(L${squintLevel})` : ""}
              </button>
            </div>

            {/* Inline Squint Depth Slider on Timeline */}
            {squintMode && onSquintLevelChange && (
              <div className="timeline-squint-slider-wrap" title="Squint Depth: controls diffraction blur, rod desaturation, highlight bloom & chiaroscuro value massing">
                <span className="squint-slider-label">Depth: <b>L{squintLevel}</b></span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={squintLevel}
                  onChange={(e) => onSquintLevelChange(Number(e.target.value))}
                  className="timeline-squint-slider"
                />
              </div>
            )}

            {/* Active Review Filter Indicator & Reset */}
            {reviewFilter && reviewFilter !== "all" && (
              <div className="map-active-filter-badge" title="Active review filter dims non-matching shots">
                <span>Filter: {reviewFilter} ({reviewMatchIds?.length ?? 0})</span>
                {onClearReviewFilter && (
                  <button
                    type="button"
                    className="clear-filter-btn"
                    onClick={onClearReviewFilter}
                    title="Clear review filter and restore all shots"
                  >
                    ✕ Clear
                  </button>
                )}
              </div>
            )}

            <span className="mono zoom-label" title={`Timeline Zoom: ${zoom.toFixed(1)}×`}>
              {zoom.toFixed(1)}×
            </span>

            {onOpenFullscreen && (
              <button
                type="button"
                className="map-fullscreen-btn"
                onClick={onOpenFullscreen}
                title="Fullscreen Graph Visualization (Wordless Score)"
                aria-label="Fullscreen Graph Visualization"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                <span>Score</span>
              </button>
            )}

            {onToggleExpanded && (
              <button
                type="button"
                className={`studio-expand-map-toggle-btn map-expand-icon-btn ${expanded ? "active" : ""}`}
                onClick={onToggleExpanded}
                title={expanded ? "Restore Studio workspace" : "Expand map (hide upper workspace)"}
                aria-label={expanded ? "Restore Studio workspace" : "Expand map"}
                aria-pressed={expanded}
              >
                {expanded ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="4 14 10 14 10 20" />
                    <polyline points="20 10 14 10 14 4" />
                    <line x1="14" y1="10" x2="21" y2="3" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {!isStudio && tagBar && <div className="map-top-bar">{tagBar}</div>}

      {/* Studio Mode: Top Overview Scrubber Minimap (only shown when zoomed in, avoiding visual noise at 100% view) */}
      {isStudio && project.shots.length > 0 && zoom > 1.001 && (
        <div className="studio-top-overview">
          <div
            className={`studio-overview-track ${isMinimapDragging ? "dragging" : ""}`}
            ref={minimapRef}
            onPointerDown={handleMinimapPointerDown}
            onPointerMove={handleMinimapPointerMove}
            onPointerUp={handleMinimapPointerUp}
            onPointerCancel={handleMinimapPointerUp}
            onLostPointerCapture={handleMinimapPointerUp}
            title="Click or drag to pan timeline"
          >
            {project.shots.map((s) => (
              <div
                key={`studio-mini-${s.id}`}
                className="studio-overview-shot"
                style={{
                  left: `${(s.startSeconds / duration) * 100}%`,
                  width: `${Math.max(0.2, (s.duration / duration) * 100)}%`,
                }}
              />
            ))}
            <div
              className={`studio-overview-viewport ${isMinimapDragging ? "dragging" : ""}`}
              style={{
                left: `${(scrollLeft / canvasWidth) * 100}%`,
                width: `${Math.min(100, (width / canvasWidth) * 100)}%`,
              }}
            >
              <div className="studio-viewport-handle left" />
              <div className="studio-viewport-handle right" />
            </div>
            <div
              className="studio-overview-playhead"
              style={{ left: `${Math.min(100, (time / duration) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Studio Timeline Workbench or Map Viewport */}
      <div className={isStudio ? "studio-timeline-workbench" : "map-viewport-wrapper"}>
        {isStudio && (
          <div ref={trackHeaders} className="studio-track-headers" role="region" aria-label="Timeline track controls">
            <div className="studio-header-cell ruler-spacer" />

            {/* 0. Markers Header (First Track from Top to Bottom) */}
            <div
              className={`studio-header-cell markers-header ${isTrackCollapsed("markers") ? "collapsed" : ""}`}
              style={{ height: isTrackCollapsed("markers") ? 0 : laneHeights.markers }}
            >
              <div className="studio-header-row">
                <div className="studio-header-left">
                  <button
                    type="button"
                    className="studio-track-fold-btn"
                    onClick={() => toggleTrackCollapse("markers")}
                    title={isTrackCollapsed("markers") ? "Expand Markers track" : "Collapse Markers track"}
                    aria-label={isTrackCollapsed("markers") ? "Expand Markers track" : "Collapse Markers track"}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points={isTrackCollapsed("markers") ? "9 18 15 12 9 6" : "6 9 12 15 18 9"} />
                    </svg>
                  </button>
                  <span className="studio-track-title">Markers</span>
                  {project.screeningMarks && project.screeningMarks.length > 0 && (
                    <span className="studio-track-count-badge" title={`${project.screeningMarks.length} review cues`}>
                      {project.screeningMarks.length}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className={`studio-track-solo-btn ${soloTrack === "markers" ? "active" : ""}`}
                  onClick={() => toggleTrackSolo("markers")}
                  title={soloTrack === "markers" ? "Unsolo Markers track" : "Solo Markers track"}
                  aria-label={soloTrack === "markers" ? "Unsolo Markers track" : "Solo Markers track"}
                >
                  S
                </button>
              </div>
              <div
                className={`studio-lane-resizer ${resizingTrack === "markers" ? "resizing" : ""}`}
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label="Resize Markers lane"
                aria-valuenow={laneHeights.markers}
                aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.markers}
                onPointerDown={(e) => handleResizePointerDown("markers", e)}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onDoubleClick={(e) => handleResizeDoubleClick("markers", e)}
                onKeyDown={(e) => handleResizeKeyDown("markers", e)}
              >
                <div className="studio-lane-resizer-line" />
              </div>
            </div>

            {/* 1. Story Header */}
            <div
              className={`studio-header-cell story-header ${isTrackCollapsed("story") ? "collapsed" : ""}`}
              style={{ height: isTrackCollapsed("story") ? 0 : effectiveStoryHeight }}
            >
              <div className="studio-header-row">
                <div className="studio-header-left">
                  <button
                    type="button"
                    className="studio-track-fold-btn"
                    onClick={() => toggleTrackCollapse("story")}
                    title={isTrackCollapsed("story") ? "Expand Story track" : "Collapse Story track"}
                    aria-label={isTrackCollapsed("story") ? "Expand Story track" : "Collapse Story track"}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points={isTrackCollapsed("story") ? "9 18 15 12 9 6" : "6 9 12 15 18 9"} />
                    </svg>
                  </button>
                  <span className="studio-track-title">Story</span>
                </div>
                <button
                  type="button"
                  className={`studio-track-solo-btn ${soloTrack === "story" ? "active" : ""}`}
                  onClick={() => toggleTrackSolo("story")}
                  title={soloTrack === "story" ? "Unsolo Story track" : "Solo Story track"}
                  aria-label={soloTrack === "story" ? "Unsolo Story track" : "Solo Story track"}
                >
                  S
                </button>
              </div>
              <div
                className={`studio-lane-resizer ${resizingTrack === "story" ? "resizing" : ""}`}
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label="Resize Story lane"
                aria-valuenow={laneHeights.story}
                aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.story}
                onPointerDown={(e) => handleResizePointerDown("story", e)}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onDoubleClick={(e) => handleResizeDoubleClick("story", e)}
                onKeyDown={(e) => handleResizeKeyDown("story", e)}
              >
                <div className="studio-lane-resizer-line" />
              </div>
            </div>

            {/* 2. Shots Header */}
            <div
              className={`studio-header-cell shots-header ${isTrackCollapsed("shots") ? "collapsed" : ""}`}
              style={{ height: isTrackCollapsed("shots") ? 0 : laneHeights.shots }}
            >
              <div className="studio-header-row">
                <div className="studio-header-left">
                  <button
                    type="button"
                    className="studio-track-fold-btn"
                    onClick={() => toggleTrackCollapse("shots")}
                    title={isTrackCollapsed("shots") ? "Expand Shots track" : "Collapse Shots track"}
                    aria-label={isTrackCollapsed("shots") ? "Expand Shots track" : "Collapse Shots track"}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points={isTrackCollapsed("shots") ? "9 18 15 12 9 6" : "6 9 12 15 18 9"} />
                    </svg>
                  </button>
                  <span className="studio-track-title">Shots</span>
                </div>
                <button
                  type="button"
                  className={`studio-track-solo-btn ${soloTrack === "shots" ? "active" : ""}`}
                  onClick={() => toggleTrackSolo("shots")}
                  title={soloTrack === "shots" ? "Unsolo Shots track" : "Solo Shots track"}
                  aria-label={soloTrack === "shots" ? "Unsolo Shots track" : "Solo Shots track"}
                >
                  S
                </button>
              </div>
              <div
                className={`studio-lane-resizer ${resizingTrack === "shots" ? "resizing" : ""}`}
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label="Resize Shots lane"
                aria-valuenow={laneHeights.shots}
                aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.shots}
                onPointerDown={(e) => handleResizePointerDown("shots", e)}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onDoubleClick={(e) => handleResizeDoubleClick("shots", e)}
                onKeyDown={(e) => handleResizeKeyDown("shots", e)}
              >
                <div className="studio-lane-resizer-line" />
              </div>
            </div>

            {/* 3. Pacing Header */}
            <div
              className={`studio-header-cell pacing-header ${isTrackCollapsed("pacing") ? "collapsed" : ""}`}
              style={{ height: isTrackCollapsed("pacing") ? 0 : laneHeights.pacing }}
            >
              <div className="studio-header-row">
                <div className="studio-header-left">
                  <button
                    type="button"
                    className="studio-track-fold-btn"
                    onClick={() => toggleTrackCollapse("pacing")}
                    title={isTrackCollapsed("pacing") ? "Expand Pacing track" : "Collapse Pacing track"}
                    aria-label={isTrackCollapsed("pacing") ? "Expand Pacing track" : "Collapse Pacing track"}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points={isTrackCollapsed("pacing") ? "9 18 15 12 9 6" : "6 9 12 15 18 9"} />
                    </svg>
                  </button>
                  <span className="studio-track-title">{showVoltageOverlay ? "Voltage" : "Pacing"}</span>
                </div>
                <div className="studio-header-right">
                  <button
                    type="button"
                    className={`studio-track-mode-btn ${showVoltageOverlay ? "active" : ""}`}
                    onClick={() => setShowVoltageOverlay((prev) => !prev)}
                    title={showVoltageOverlay ? "Switch back to standard Pacing curve" : "Eisenstein Sensory Voltage & Counterpoint overlay"}
                    aria-label="Toggle Eisenstein Voltage overlay"
                    style={{
                      fontSize: "10px",
                      padding: "1px 5px",
                      borderRadius: "4px",
                      background: showVoltageOverlay ? "rgba(168, 85, 247, 0.25)" : "transparent",
                      border: showVoltageOverlay ? "1px solid rgba(168, 85, 247, 0.6)" : "1px solid rgba(255, 255, 255, 0.12)",
                      color: showVoltageOverlay ? "#c084fc" : "#94a3b8",
                      cursor: "pointer",
                      marginRight: "4px",
                    }}
                  >
                    ⚡
                  </button>
                  <button
                    type="button"
                    className={`studio-track-solo-btn ${soloTrack === "pacing" ? "active" : ""}`}
                    onClick={() => toggleTrackSolo("pacing")}
                    title={soloTrack === "pacing" ? "Unsolo Pacing track" : "Solo Pacing track"}
                    aria-label={soloTrack === "pacing" ? "Unsolo Pacing track" : "Solo Pacing track"}
                  >
                    S
                  </button>
                </div>
              </div>
              <div
                className={`studio-lane-resizer ${resizingTrack === "pacing" ? "resizing" : ""}`}
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label="Resize Pacing lane"
                aria-valuenow={laneHeights.pacing}
                aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.pacing}
                onPointerDown={(e) => handleResizePointerDown("pacing", e)}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onDoubleClick={(e) => handleResizeDoubleClick("pacing", e)}
                onKeyDown={(e) => handleResizeKeyDown("pacing", e)}
              >
                <div className="studio-lane-resizer-line" />
              </div>
            </div>

            {/* 4. Cut density Header */}
            <div
              className={`studio-header-cell cut-density-header ${isTrackCollapsed("cutDensity") ? "collapsed" : ""}`}
              style={{ height: isTrackCollapsed("cutDensity") ? 0 : laneHeights.cutDensity }}
            >
              <div className="studio-header-row">
                <div className="studio-header-left">
                  <button
                    type="button"
                    className="studio-track-fold-btn"
                    onClick={() => toggleTrackCollapse("cutDensity")}
                    title={isTrackCollapsed("cutDensity") ? "Expand Cut Density track" : "Collapse Cut Density track"}
                    aria-label={isTrackCollapsed("cutDensity") ? "Expand Cut Density track" : "Collapse Cut Density track"}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points={isTrackCollapsed("cutDensity") ? "9 18 15 12 9 6" : "6 9 12 15 18 9"} />
                    </svg>
                  </button>
                  <span className="studio-track-title">Cut density</span>
                </div>
                <div className="studio-header-right">
                  {isBatchScanningSaccades && (
                    <span className="saccade-scan-status scanning" title="Analyzing cut dynamics in background...">
                      {batchScanProgress.percent}%
                    </span>
                  )}
                  <button
                    type="button"
                    className={`studio-track-solo-btn ${soloTrack === "cutDensity" ? "active" : ""}`}
                    onClick={() => toggleTrackSolo("cutDensity")}
                    title={soloTrack === "cutDensity" ? "Unsolo Cut Density track" : "Solo Cut Density track"}
                    aria-label={soloTrack === "cutDensity" ? "Unsolo Cut Density track" : "Solo Cut Density track"}
                  >
                    S
                  </button>
                </div>
              </div>
              <div
                className={`studio-lane-resizer ${resizingTrack === "cutDensity" ? "resizing" : ""}`}
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label="Resize Cut density lane"
                aria-valuenow={laneHeights.cutDensity}
                aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.cutDensity}
                onPointerDown={(e) => handleResizePointerDown("cutDensity", e)}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onDoubleClick={(e) => handleResizeDoubleClick("cutDensity", e)}
                onKeyDown={(e) => handleResizeKeyDown("cutDensity", e)}
              >
                <div className="studio-lane-resizer-line" />
              </div>
            </div>

            {/* 5. Framing Header */}
            <div
              className={`studio-header-cell framing-header ${isTrackCollapsed("framing") ? "collapsed" : ""}`}
              style={{ height: isTrackCollapsed("framing") ? 0 : laneHeights.framing }}
            >
              <div className="studio-header-row studio-framing-header-row">
                <div className="studio-header-left">
                  <button
                    type="button"
                    className="studio-track-fold-btn"
                    onClick={() => toggleTrackCollapse("framing")}
                    title={isTrackCollapsed("framing") ? "Expand Framing track" : "Collapse Framing track"}
                    aria-label={isTrackCollapsed("framing") ? "Expand Framing track" : "Collapse Framing track"}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points={isTrackCollapsed("framing") ? "9 18 15 12 9 6" : "6 9 12 15 18 9"} />
                    </svg>
                  </button>
                  <span className="studio-track-title">Framing</span>
                </div>
                {!isTrackCollapsed("framing") && (
                  <div className="studio-header-sublabels studio-framing-sublabels">
                    <span className="studio-subrow-label">Wide</span>
                    <span className="studio-subrow-label">Medium</span>
                    <span className="studio-subrow-label">Close</span>
                  </div>
                )}
                <button
                  type="button"
                  className={`studio-track-solo-btn ${soloTrack === "framing" ? "active" : ""}`}
                  onClick={() => toggleTrackSolo("framing")}
                  title={soloTrack === "framing" ? "Unsolo Framing track" : "Solo Framing track"}
                  aria-label={soloTrack === "framing" ? "Unsolo Framing track" : "Solo Framing track"}
                >
                  S
                </button>
              </div>
              <div
                className={`studio-lane-resizer ${resizingTrack === "framing" ? "resizing" : ""}`}
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label="Resize Framing lane"
                aria-valuenow={laneHeights.framing}
                aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.framing}
                onPointerDown={(e) => handleResizePointerDown("framing", e)}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onDoubleClick={(e) => handleResizeDoubleClick("framing", e)}
                onKeyDown={(e) => handleResizeKeyDown("framing", e)}
              >
                <div className="studio-lane-resizer-line" />
              </div>
            </div>

            {/* 6. Motion Header */}
            <div
              className={`studio-header-cell motion-header ${isTrackCollapsed("motion") ? "collapsed" : ""}`}
              style={{ height: isTrackCollapsed("motion") ? 0 : laneHeights.motion }}
            >
              <div className="studio-header-row">
                <div className="studio-header-left">
                  <button
                    type="button"
                    className="studio-track-fold-btn"
                    onClick={() => toggleTrackCollapse("motion")}
                    title={isTrackCollapsed("motion") ? "Expand Motion track" : "Collapse Motion track"}
                    aria-label={isTrackCollapsed("motion") ? "Expand Motion track" : "Collapse Motion track"}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points={isTrackCollapsed("motion") ? "9 18 15 12 9 6" : "6 9 12 15 18 9"} />
                    </svg>
                  </button>
                  <span className="studio-track-title">Motion</span>
                </div>
                <button
                  type="button"
                  className={`studio-track-solo-btn ${soloTrack === "motion" ? "active" : ""}`}
                  onClick={() => toggleTrackSolo("motion")}
                  title={soloTrack === "motion" ? "Unsolo Motion track" : "Solo Motion track"}
                  aria-label={soloTrack === "motion" ? "Unsolo Motion track" : "Solo Motion track"}
                >
                  S
                </button>
              </div>
              <div
                className={`studio-lane-resizer ${resizingTrack === "motion" ? "resizing" : ""}`}
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label="Resize Motion lane"
                aria-valuenow={laneHeights.motion}
                aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.motion}
                onPointerDown={(e) => handleResizePointerDown("motion", e)}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onDoubleClick={(e) => handleResizeDoubleClick("motion", e)}
                onKeyDown={(e) => handleResizeKeyDown("motion", e)}
              >
                <div className="studio-lane-resizer-line" />
              </div>
            </div>

            {/* 7. Palette Header (Watercolor Chromatic River) */}
            <div
              className={`studio-header-cell palette-header ${isTrackCollapsed("palette") ? "collapsed" : ""}`}
              style={{ height: isTrackCollapsed("palette") ? 0 : laneHeights.palette }}
            >
              <div className="studio-header-row studio-palette-header-row">
                <div className="studio-header-left">
                  <button
                    type="button"
                    className="studio-track-fold-btn"
                    onClick={() => toggleTrackCollapse("palette")}
                    title={isTrackCollapsed("palette") ? "Expand Palette track" : "Collapse Palette track"}
                    aria-label={isTrackCollapsed("palette") ? "Expand Palette track" : "Collapse Palette track"}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points={isTrackCollapsed("palette") ? "9 18 15 12 9 6" : "6 9 12 15 18 9"} />
                    </svg>
                  </button>
                  <span className="studio-track-title">Palette</span>
                </div>
                {!isTrackCollapsed("palette") && currentShot && (
                  <div
                    className="studio-header-sublabels studio-palette-sublabels"
                    title={`Active shot ${currentShot.index}: ${currentShot.colorProfile?.mood || currentShot.shotSize || "Palette"} · ${Math.round((currentShot.colorProfile?.luminance ?? 0.5) * 100)}% luma`}
                  >
                    <span
                      className="studio-palette-dot"
                      style={{
                        backgroundColor:
                          currentShot.colorProfile?.palette?.[0] ||
                          sizeColors[currentShot.shotSize] ||
                          "#94a3b8",
                      }}
                    />
                    <span className="studio-subrow-label">
                      {currentShot.colorProfile?.mood || "River"}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  className={`studio-track-solo-btn ${soloTrack === "palette" ? "active" : ""}`}
                  onClick={() => toggleTrackSolo("palette")}
                  title={soloTrack === "palette" ? "Unsolo Palette track" : "Solo Palette track"}
                  aria-label={soloTrack === "palette" ? "Unsolo Palette track" : "Solo Palette track"}
                >
                  S
                </button>
              </div>
              <div
                className={`studio-lane-resizer ${resizingTrack === "palette" ? "resizing" : ""}`}
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label="Resize Palette lane"
                aria-valuenow={laneHeights.palette}
                aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.palette}
                onPointerDown={(e) => handleResizePointerDown("palette", e)}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onDoubleClick={(e) => handleResizeDoubleClick("palette", e)}
                onKeyDown={(e) => handleResizeKeyDown("palette", e)}
              >
                <div className="studio-lane-resizer-line" />
              </div>
            </div>

            {/* 8. Cast Header */}
            <div
              className={`studio-header-cell cast-header ${isTrackCollapsed("cast") ? "collapsed" : ""}`}
              style={{ height: isTrackCollapsed("cast") ? 0 : laneHeights.cast }}
            >
              <div className="studio-header-row studio-cast-header-row">
                <div className="studio-header-left">
                  <button
                    type="button"
                    className="studio-track-fold-btn"
                    onClick={() => toggleTrackCollapse("cast")}
                    title={isTrackCollapsed("cast") ? "Expand Cast track" : "Collapse Cast track"}
                    aria-label={isTrackCollapsed("cast") ? "Expand Cast track" : "Collapse Cast track"}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points={isTrackCollapsed("cast") ? "9 18 15 12 9 6" : "6 9 12 15 18 9"} />
                    </svg>
                  </button>
                  <span className="studio-track-title">Cast</span>
                </div>
                {!isTrackCollapsed("cast") && activeCastMembers.length > 0 && (
                  <div className="studio-subrow-labels-column studio-cast-sublabels">
                    {activeCastMembers.map((m, idx) => {
                      const subrowH = laneHeights.cast / activeCastMembers.length;
                      return (
                        <div
                          key={m.id}
                          className="studio-subrow-label-slot"
                          style={{ height: `${subrowH}px` }}
                          title={m.name}
                        >
                          <span
                            className="studio-subrow-label"
                            style={{
                              color: CAST_PALETTE[idx % CAST_PALETTE.length],
                              fontSize: subrowH < 12 ? "8px" : "9px",
                            }}
                          >
                            {m.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  className={`studio-track-solo-btn ${soloTrack === "cast" ? "active" : ""}`}
                  onClick={() => toggleTrackSolo("cast")}
                  title={soloTrack === "cast" ? "Unsolo Cast track" : "Solo Cast track"}
                  aria-label={soloTrack === "cast" ? "Unsolo Cast track" : "Solo Cast track"}
                >
                  S
                </button>
              </div>
              <div
                className={`studio-lane-resizer ${resizingTrack === "cast" ? "resizing" : ""}`}
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label="Resize Cast lane"
                aria-valuenow={laneHeights.cast}
                aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.cast}
                onPointerDown={(e) => handleResizePointerDown("cast", e)}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onDoubleClick={(e) => handleResizeDoubleClick("cast", e)}
                onKeyDown={(e) => handleResizeKeyDown("cast", e)}
              >
                <div className="studio-lane-resizer-line" />
              </div>
            </div>

            {/* 8. Sound Header */}
            <div
              className={`studio-header-cell sound-header ${isTrackCollapsed("sound") ? "collapsed" : ""}`}
              style={{ height: isTrackCollapsed("sound") ? 0 : laneHeights.sound }}
            >
              <div className="studio-header-row studio-sound-header-row">
                <div className="studio-header-left">
                  <button
                    type="button"
                    className="studio-track-fold-btn"
                    onClick={() => toggleTrackCollapse("sound")}
                    title={isTrackCollapsed("sound") ? "Expand Sound track" : "Collapse Sound track"}
                    aria-label={isTrackCollapsed("sound") ? "Expand Sound track" : "Collapse Sound track"}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points={isTrackCollapsed("sound") ? "9 18 15 12 9 6" : "6 9 12 15 18 9"} />
                    </svg>
                  </button>
                  <span className="studio-track-title">Sound</span>
                </div>
                {!isTrackCollapsed("sound") && (
                  <div className="studio-subrow-labels-column studio-sound-sublabels">
                    {[
                      { key: "dialogue", label: "Dialogue" },
                      { key: "music", label: "Music" },
                      { key: "effects", label: "Effects" },
                      { key: "loudness", label: "Loudness" },
                      { key: "speech", label: "Speech" },
                    ].map((stem) => (
                      <div
                        key={stem.key}
                        className="studio-subrow-label-slot"
                        style={{ height: `${soundSubrowH}px` }}
                        title={stem.label}
                      >
                        <span
                          className="studio-subrow-label"
                          style={{
                            fontSize: soundSubrowH < 14 ? "8px" : "9px",
                          }}
                        >
                          {stem.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className={`studio-track-solo-btn ${soloTrack === "sound" ? "active" : ""}`}
                  onClick={() => toggleTrackSolo("sound")}
                  title={soloTrack === "sound" ? "Unsolo Sound track" : "Solo Sound track"}
                  aria-label={soloTrack === "sound" ? "Unsolo Sound track" : "Solo Sound track"}
                >
                  S
                </button>
              </div>
              <div
                className={`studio-lane-resizer ${resizingTrack === "sound" ? "resizing" : ""}`}
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label="Resize Sound lane"
                aria-valuenow={laneHeights.sound}
                aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.sound}
                onPointerDown={(e) => handleResizePointerDown("sound", e)}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onDoubleClick={(e) => handleResizeDoubleClick("sound", e)}
                onKeyDown={(e) => handleResizeKeyDown("sound", e)}
              >
                <div className="studio-lane-resizer-line" />
              </div>
            </div>
          </div>
        )}

        {/* Main Scrollable Canvas */}
        <div
          className={`map-scroll ${isStudio ? "studio-scroll-area" : ""}`}
          ref={viewport}
        onScroll={(e) => {
          const st = e.currentTarget.scrollTop;
          if (trackHeaders.current) {
            requestAnimationFrame(() => {
              if (trackHeaders.current) {
                trackHeaders.current.style.transform = `translateY(${-st}px)`;
              }
            });
          }
          const sl = e.currentTarget.scrollLeft;
          setLocalScrollLeft(sl);
          onScrollChange?.(sl);
        }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            changeZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
          }
        }}
      >
        <div
          ref={canvas}
          className="map-canvas"
          style={{ width: canvasWidth }}
          onPointerDown={(event) => {
            if (!event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            rangeAnchor.current = pointAt(event.clientX);
            suppressMapClick.current = true;
            setDragRange({ start: rangeAnchor.current, end: rangeAnchor.current });
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {}
          }}
          onPointerMove={(event) => {
            if (rangeAnchor.current === null) return;
            setDragRange({ start: Math.min(rangeAnchor.current, pointAt(event.clientX)), end: Math.max(rangeAnchor.current, pointAt(event.clientX)) });
          }}
          onPointerUp={(event) => {
            if (rangeAnchor.current === null) return;
            const end = pointAt(event.clientX), start = rangeAnchor.current;
            rangeAnchor.current = null;
            setDragRange(undefined);
            if (Math.abs(end - start) > 1 / actualRate(project.frameRate)) {
              onRangeChange({ start: Math.min(start, end), end: Math.max(start, end) });
            }
            try {
              event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {}
          }}
          onClick={(e) => {
            if (suppressMapClick.current) {
              suppressMapClick.current = false;
              return;
            }
            const raw = (e.clientX - e.currentTarget.getBoundingClientRect().left) / scale;
            const target = resolveSnap(raw);
            onSeek(target);
          }}
        >
          {/* Timecode Ruler */}
          <div
            className="ruler"
            onPointerDown={(e) => {
              if (e.button !== 0 || e.shiftKey) return;
              e.preventDefault();
              e.stopPropagation();
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              scrubAt(e.clientX);
            }}
            onPointerMove={(e) => {
              if (dragging.current) {
                e.preventDefault();
                scrubAt(e.clientX);
              }
            }}
            onPointerUp={(e) => {
              if (!dragging.current) return;
              scrubAt(e.clientX);
              dragging.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
          >
            {rulerTicks.map(({ i, t, x }) => (
              <span key={i} style={{ left: x }}>
                {formatTimecode(t, project.frameRate, project.dropFrame)}
              </span>
            ))}
          </div>

          {/* STUDIO MODE MULTI-TRACK RHYTHM WORKSTATION */}
          {isStudio ? (
            <div className="studio-tracks-stack" aria-label="Studio rhythm timeline tracks">
              {/* 0. Markers Lane (Review Markers & Cues from Screening Room) */}
              <div
                className={`studio-lane studio-markers-lane ${isTrackCollapsed("markers") ? "collapsed" : ""}`}
                aria-label="Review markers track"
                style={{
                  height: isTrackCollapsed("markers") ? 0 : `${laneHeights.markers}px`,
                }}
              >
                {!isTrackCollapsed("markers") && (
                  <>
                    {(!project.screeningMarks || project.screeningMarks.length === 0) ? (
                      <div className="studio-lane-empty-hint">
                        <span>No review markers · Press 1–4 in Review to drop cues</span>
                      </div>
                    ) : (
                      project.screeningMarks.map((m, idx) => {
                        const mTime = m.time ?? m.anchorTime ?? 0;
                        const x = mTime * scale;
                        const color = m.colorHex || "#e5a93c";
                        const tcStr = formatTimecode(mTime, project.frameRate, project.dropFrame);
                        const isNearPlayhead = Math.abs(time - mTime) < 0.25;

                        return (
                          <div
                            key={m.id || `marker-${idx}`}
                            className={`studio-review-marker-pin ${isNearPlayhead ? "active" : ""}`}
                            style={{
                              left: `${x}px`,
                              "--marker-color": color,
                            } as React.CSSProperties}
                            onClick={(e) => {
                              e.stopPropagation();
                              (onSeek || onScrub)?.(mTime);
                            }}
                            title={`${m.authorAvatar || "🎬"} ${m.authorName || "Reviewer"} · ${tcStr}${m.notes ? `\n"${m.notes}"` : ""}`}
                          >
                            <div className="studio-marker-stem" />
                            <div className="studio-marker-badge">
                              <span className="studio-marker-avatar">{m.authorAvatar || "🎬"}</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </>
                )}
                <div
                  className={`studio-lane-resizer ${resizingTrack === "markers" ? "resizing" : ""}`}
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Resize Markers lane"
                  aria-valuenow={laneHeights.markers}
                  aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.markers}
                  onPointerDown={(e) => handleResizePointerDown("markers", e)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerUp}
                  onDoubleClick={(e) => handleResizeDoubleClick("markers", e)}
                  onKeyDown={(e) => handleResizeKeyDown("markers", e)}
                >
                  <div className="studio-lane-resizer-line" />
                </div>
              </div>

              {/* Story Lane (Moments & Passages, Draft In/Out, Adjustments) */}
              <div
                className={`studio-lane studio-story-lane ${isTrackCollapsed("story") ? "collapsed" : ""}`}
                aria-label="Story structure track"
                style={{
                  height: isTrackCollapsed("story") ? 0 : `${effectiveStoryHeight}px`,
                }}
              >
                {/* Subtle shading for current draft range */}
                {range?.start !== undefined && range?.end !== undefined && range.end > range.start && (
                  <div
                    className="story-draft-shading"
                    style={{
                      left: range.start * scale,
                      width: Math.max(2, (range.end - range.start) * scale),
                    }}
                  />
                )}

                {/* Draft In Flag */}
                {range?.start !== undefined && (
                  <div
                    className="story-draft-flag story-in-flag"
                    style={{ left: range.start * scale }}
                    title={`Draft In: ${formatTimecode(range.start, project.frameRate, project.dropFrame)}`}
                  >
                    <span className="story-flag-tag">IN</span>
                  </div>
                )}

                {/* Draft Out Flag */}
                {range?.end !== undefined && (
                  <div
                    className="story-draft-flag story-out-flag"
                    style={{ left: range.end * scale }}
                    title={`Draft Out: ${formatTimecode(range.end, project.frameRate, project.dropFrame)}`}
                  >
                    <span className="story-flag-tag">OUT</span>
                  </div>
                )}

                {/* Saved Story Markers */}
                {!isTrackCollapsed("story") &&
                  layoutStoryEntries.entries.map((entry) => {
                    const seq = entry.sequence;
                    const isMoment = (seq.kind ?? "passage") === "moment";
                    const isSelected = selectedSequenceId === seq.id;
                    const isDraggingThis = activeStoryDrag?.sequenceId === seq.id;

                    const startSec = (isDraggingThis && activeStoryDrag) ? activeStoryDrag.currentStart : seq.startSeconds;
                    const endSec = (isDraggingThis && activeStoryDrag) ? activeStoryDrag.currentEnd : seq.endSeconds;
                    const topPx = entry.subrow * 26 + 4;

                    if (isMoment) {
                      return (
                        <div
                          key={`story-moment-${seq.id}`}
                          className={`story-lane-moment ${isSelected ? "selected" : ""} ${isDraggingThis ? "dragging" : ""}`}
                          style={{
                            left: startSec * scale,
                            top: `${topPx}px`,
                          }}
                          onPointerDown={(e) => handleMomentPointerDown(e, seq)}
                          onPointerMove={handleStoryPointerMove}
                          onPointerUp={(e) => handleStoryPointerUp(e, seq)}
                          onPointerCancel={(e) => handleStoryPointerUp(e, seq)}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectSequence?.(seq);
                            onSeek?.(seq.startSeconds);
                          }}
                          title={`Moment: ${seq.name} (${formatTimecode(startSec, project.frameRate, project.dropFrame)}) - Click to select, drag to move`}
                          role="button"
                          tabIndex={0}
                          aria-label={`Moment ${seq.name}`}
                        >
                          <div className="story-moment-diamond" />
                          <span className="story-moment-label">
                            {seq.beat && <span className="story-beat-badge">{seq.beat}</span>}
                            <span className="story-title">{seq.name}</span>
                          </span>
                        </div>
                      );
                    }

                    // Passage
                    const widthPx = Math.max(16, (endSec - startSec) * scale);
                    const isDraggingIn = isDraggingThis && activeStoryDrag?.kind === "passage-in";
                    const isDraggingOut = isDraggingThis && activeStoryDrag?.kind === "passage-out";
                    const isDraggingBody = isDraggingThis && activeStoryDrag?.kind === "passage-move";

                    return (
                      <div
                        key={`story-passage-${seq.id}`}
                        className={`story-lane-passage ${isSelected ? "selected" : ""} ${isDraggingThis ? "dragging" : ""}`}
                        style={{
                          left: startSec * scale,
                          width: `${widthPx}px`,
                          top: `${topPx}px`,
                        }}
                        role="region"
                        aria-label={`Passage ${seq.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectSequence?.(seq);
                          onRangeChange?.({ start: seq.startSeconds, end: seq.endSeconds });
                        }}
                      >
                        {/* In Handle */}
                        <div
                          className={`story-passage-handle handle-in left-handle ${isDraggingIn ? "dragging" : ""}`}
                          onPointerDown={(e) => handlePassageInPointerDown(e, seq)}
                          onPointerMove={handleStoryPointerMove}
                          onPointerUp={(e) => handleStoryPointerUp(e, seq)}
                          onPointerCancel={(e) => handleStoryPointerUp(e, seq)}
                          title="Drag to extend or shrink In point"
                        >
                          <span className="handle-grip-line" />
                        </div>
                        {/* Body */}
                        <div
                          className={`story-passage-body ${isDraggingBody ? "dragging" : ""}`}
                          onPointerDown={(e) => handlePassageBodyPointerDown(e, seq)}
                          onPointerMove={handleStoryPointerMove}
                          onPointerUp={(e) => handleStoryPointerUp(e, seq)}
                          onPointerCancel={(e) => handleStoryPointerUp(e, seq)}
                          title={`Passage: ${seq.name} (${formatTimecode(startSec, project.frameRate, project.dropFrame)} to ${formatTimecode(endSec, project.frameRate, project.dropFrame)}) - Drag to move`}
                        >
                          <span className="story-passage-content">
                            {seq.beat && <span className="story-beat-badge">{seq.beat}</span>}
                            <span className="story-title">{seq.name}</span>
                          </span>
                        </div>
                        {/* Out Handle */}
                        <div
                          className={`story-passage-handle handle-out right-handle ${isDraggingOut ? "dragging" : ""}`}
                          onPointerDown={(e) => handlePassageOutPointerDown(e, seq)}
                          onPointerMove={handleStoryPointerMove}
                          onPointerUp={(e) => handleStoryPointerUp(e, seq)}
                          onPointerCancel={(e) => handleStoryPointerUp(e, seq)}
                          title="Drag to extend or shrink Out point"
                        >
                          <span className="handle-grip-line" />
                        </div>
                      </div>
                    );
                  })}
                <div
                  className={`studio-lane-resizer ${resizingTrack === "story" ? "resizing" : ""}`}
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Resize Story lane"
                  aria-valuenow={laneHeights.story}
                  aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.story}
                  onPointerDown={(e) => handleResizePointerDown("story", e)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerUp}
                  onDoubleClick={(e) => handleResizeDoubleClick("story", e)}
                  onKeyDown={(e) => handleResizeKeyDown("story", e)}
                >
                  <div className="studio-lane-resizer-line" />
                </div>
              </div>

              {/* Track 2: Filmstrip Shots (Visual Keyframes + Interactive Cut Drag) */}
              <div
                className={`studio-lane studio-filmstrip-lane studio-shots-lane shot-track ${isTrackCollapsed("shots") ? "collapsed" : ""}`}
                aria-label="Shot visual filmstrip track"
                style={{
                  height: isTrackCollapsed("shots") ? 0 : `${laneHeights.shots}px`,
                }}
              >
                {visibleShots.map((s) => {
                  let startSec = s.startSeconds;
                  let endSec = s.endSeconds;
                  if (activeCutDrag) {
                    if (s.id === activeCutDrag.outgoingId) {
                      endSec = activeCutDrag.currentTime;
                    } else if (s.id === activeCutDrag.incomingId) {
                      startSec = activeCutDrag.currentTime;
                    }
                  }
                  const effDur = Math.max(0, endSec - startSec);
                  const w = effDur * scale;
                  const isSelected = selected === s.id;
                  const isLastShot = s.index === project.shots.length || s.endSeconds >= duration - 0.001;
                  const isPlaying = time >= startSec && (isLastShot ? time <= endSec : time < endSec);
                  const isHighlighted = highlightedShotIds?.includes(s.id);
                  const hasHighlightFilter = Boolean(highlightedShotIds && highlightedShotIds.length > 0);
                  const characterClass = hasHighlightFilter
                    ? isHighlighted
                      ? "character-highlight"
                      : "character-dimmed"
                    : "";
                  const isCoveredByStory = Boolean(
                    (visibleRange && visibleRange.start !== undefined && visibleRange.end !== undefined && visibleRange.end > visibleRange.start && s.endSeconds > visibleRange.start && s.startSeconds < visibleRange.end) ||
                    (selectedSequenceId && project.sequences?.some((seq) => seq.id === selectedSequenceId && (seq.kind ?? "passage") === "passage" && s.endSeconds > seq.startSeconds && s.startSeconds < seq.endSeconds))
                  );
                  const thumb = thumbnails[s.id];
                  const framingColor = s.shotSize && s.shotSize !== "Unknown" ? sizeColors[s.shotSize] : undefined;

                  return (
                    <button
                      type="button"
                      key={`filmstrip-${s.id}`}
                      className={`studio-filmstrip-shot shot ${isSelected ? "selected" : ""} ${isPlaying ? "active" : ""} ${characterClass} ${isCoveredByStory ? "shot-in-story-range" : ""}`}
                      style={{
                        left: startSec * scale,
                        width: w,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onShot(s);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onPlayShot(s);
                      }}
                      title={`Shot ${s.index} · ${s.shotSize} · ${effDur.toFixed(2)}s`}
                      aria-label={`Shot ${s.index}`}
                    >
                      {thumb ? (
                        <div className="studio-shot-frame">
                          <img src={thumb} alt="" className="studio-shot-img" draggable={false} />
                        </div>
                      ) : (
                        <div className="studio-shot-placeholder" />
                      )}
                      {framingColor && (
                        <div
                          className="studio-shot-framing-stripe"
                          style={{ backgroundColor: framingColor }}
                        />
                      )}
                    </button>
                  );
                })}

                {/* Interactive Cut Points between shots */}
                {visibleCuts.map(({ incoming, outgoing }) => {
                  const isBeingDragged = activeCutDrag?.incomingId === incoming.id;
                  const cutPos = isBeingDragged
                    ? activeCutDrag.currentTime * scale
                    : incoming.startSeconds * scale;
                  const cutEye = eyeTraceMap.get(`${outgoing.id}->${incoming.id}`);
                  return (
                    <div
                      key={`studio-cut-${incoming.id}`}
                      role="separator"
                      tabIndex={0}
                      aria-orientation="vertical"
                      aria-label={`Cut between Shot ${outgoing.index} and Shot ${incoming.index}`}
                      aria-valuenow={incoming.startSeconds}
                      aria-valuemin={outgoing.startSeconds}
                      aria-valuemax={incoming.endSeconds}
                      className={`studio-cut-boundary cut-boundary ${selectedCut === incoming.id ? "selected" : ""} ${isBeingDragged ? "dragging" : ""} ${cutEye ? `saccade-${cutEye.rating}` : ""}`}
                      style={{ left: cutPos }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCut?.(incoming);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onCut?.(incoming);
                        } else if (e.key === "ArrowLeft") {
                          e.preventDefault();
                          const step = (e.shiftKey ? 5 : 1) / actualRate(project.frameRate);
                          if (onRollCut) {
                            const minDur = Math.max(1 / actualRate(project.frameRate), 0.08);
                            const newTime = Math.max(outgoing.startSeconds + minDur, incoming.startSeconds - step);
                            onRollCut(incoming.id, newTime);
                            onScrub(newTime);
                          } else if (onNudgeCut) {
                            onNudgeCut(incoming.id, -step);
                          }
                        } else if (e.key === "ArrowRight") {
                          e.preventDefault();
                          const step = (e.shiftKey ? 5 : 1) / actualRate(project.frameRate);
                          if (onRollCut) {
                            const minDur = Math.max(1 / actualRate(project.frameRate), 0.08);
                            const newTime = Math.min(incoming.endSeconds - minDur, incoming.startSeconds + step);
                            onRollCut(incoming.id, newTime);
                            onScrub(newTime);
                          } else if (onNudgeCut) {
                            onNudgeCut(incoming.id, step);
                          }
                        }
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || event.shiftKey) return;
                        event.preventDefault();
                        event.stopPropagation();
                        suppressMapClick.current = true;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        const minDur = Math.max(1 / actualRate(project.frameRate), 0.08);
                        dragCutRef.current = {
                          incomingId: incoming.id,
                          outgoingId: outgoing.id,
                          startX: event.clientX,
                          originalTime: incoming.startSeconds,
                          minTime: outgoing.startSeconds + minDur,
                          maxTime: incoming.endSeconds - minDur,
                          hasMoved: false,
                        };
                        setActiveCutDrag({
                          incomingId: incoming.id,
                          outgoingId: outgoing.id,
                          originalTime: incoming.startSeconds,
                          currentTime: incoming.startSeconds,
                        });
                      }}
                      onPointerMove={(event) => {
                        const drag = dragCutRef.current;
                        if (!drag) return;
                        if (Math.abs(event.clientX - drag.startX) > 2) {
                          drag.hasMoved = true;
                        }
                        const rawTime = drag.originalTime + (event.clientX - drag.startX) / scale;
                        let clamped = Math.max(drag.minTime, Math.min(drag.maxTime, rawTime));
                        if (snapToCuts) {
                          const thresholdSec = 10 / scale;
                          const snap = getSnapTime(clamped, snapPoints, thresholdSec);
                          if (snap.isSnapped && snap.snapTarget !== undefined && snap.snapTarget >= drag.minTime && snap.snapTarget <= drag.maxTime) {
                            clamped = snap.snapTarget;
                          }
                        }
                        const quantized = quantizeToFrame(clamped, project.frameRate);
                        setActiveCutDrag((prev) => prev ? { ...prev, currentTime: quantized } : null);
                        onScrub(quantized);
                      }}
                      onPointerUp={(event) => {
                        const drag = dragCutRef.current;
                        if (!drag) return;
                        event.currentTarget.releasePointerCapture(event.pointerId);
                        if (drag.hasMoved && activeCutDrag) {
                          onRollCut?.(drag.incomingId, activeCutDrag.currentTime);
                        } else if (!drag.hasMoved) {
                          onCut?.(incoming);
                        }
                        dragCutRef.current = null;
                        setActiveCutDrag(null);
                      }}
                      title="Drag to roll cut"
                    >
                      <div className="studio-cut-line" />
                      {cutEye && (
                        <span
                          className={`cut-saccade-pip ${cutEye.rating} ${cutEye.momentum?.alignment === "momentum-collision" ? "collision" : ""}`}
                          title={`Saccade Hop: ${cutEye.jumpDistancePercent}% (${cutEye.rating})${cutEye.momentum?.alignment === "momentum-collision" ? " · Kinetic Collision" : ""}`}
                        />
                      )}
                      {isBeingDragged && (
                        <div className="studio-cut-delta-badge">
                          <small>
                            {(() => {
                              const deltaSec = activeCutDrag.currentTime - activeCutDrag.originalTime;
                              const deltaFrames = Math.round(deltaSec * actualRate(project.frameRate));
                              const sign = deltaFrames > 0 ? "+" : "";
                              return `${sign}${deltaFrames}f (${sign}${deltaSec.toFixed(2)}s)`;
                            })()}
                          </small>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div
                  className={`studio-lane-resizer ${resizingTrack === "shots" ? "resizing" : ""}`}
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Resize Shots lane"
                  aria-valuenow={laneHeights.shots}
                  aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.shots}
                  onPointerDown={(e) => handleResizePointerDown("shots", e)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerUp}
                  onDoubleClick={(e) => handleResizeDoubleClick("shots", e)}
                  onKeyDown={(e) => handleResizeKeyDown("shots", e)}
                >
                  <div className="studio-lane-resizer-line" />
                </div>
              </div>

              {/* Track 3: Pacing (Dedicated Smooth Rhythm Curve) */}
              <div
                className={`studio-lane studio-pacing-lane ${isTrackCollapsed("pacing") ? "collapsed" : ""}`}
                aria-label="Pacing rhythm track"
                style={{ height: isTrackCollapsed("pacing") ? 0 : `${laneHeights.pacing}px` }}
              >
                <svg className="studio-lane-svg" width={canvasWidth} height={laneHeights.pacing} aria-hidden="true">
                  {showVoltageOverlay && studioVoltage ? (
                    <>
                      <defs>
                        <linearGradient id="studioVoltageVisualGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#c084fc" stopOpacity="0.35" />
                          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.02" />
                        </linearGradient>
                        <linearGradient id="studioVoltageAcousticGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#fde047" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="#ca8a04" stopOpacity="0.02" />
                        </linearGradient>
                      </defs>
                      {/* Counterpoint zones in subtle background tint */}
                      {studioVoltage.score.counterpoints.map((cp) => (
                        <rect
                          key={cp.id}
                          x={cp.startTime * scale}
                          y={2}
                          width={Math.max(2, (cp.endTime - cp.startTime) * scale)}
                          height={laneHeights.pacing - 4}
                          fill={cp.type === "visual-fury-sonic-calm" ? "rgba(168, 85, 247, 0.16)" : "rgba(234, 179, 8, 0.16)"}
                          stroke={cp.type === "visual-fury-sonic-calm" ? "rgba(168, 85, 247, 0.3)" : "rgba(234, 179, 8, 0.3)"}
                          strokeWidth="1"
                        />
                      ))}
                      {studioVoltage.visualArea && <path d={studioVoltage.visualArea} fill="url(#studioVoltageVisualGrad)" />}
                      {studioVoltage.acousticArea && <path d={studioVoltage.acousticArea} fill="url(#studioVoltageAcousticGrad)" />}
                      {studioVoltage.visualPath && <path d={studioVoltage.visualPath} fill="none" stroke="#c084fc" strokeWidth="1.5" strokeLinecap="round" />}
                      {studioVoltage.acousticPath && <path d={studioVoltage.acousticPath} fill="none" stroke="#facc15" strokeWidth="1.5" strokeLinecap="round" />}
                      {/* Climax pulse points */}
                      {studioVoltage.score.climaxes.map((climax) => (
                        <g key={climax.id} transform={`translate(${climax.peakTime * scale}, 6)`}>
                          <circle r="3" fill="#facc15" stroke="#fff" strokeWidth="1" />
                        </g>
                      ))}
                      {/* Playhead indicator dot */}
                      <circle
                        cx={time * scale}
                        cy={laneHeights.pacing / 2}
                        r="3"
                        fill="#38bdf8"
                        stroke="#0c0e11"
                        strokeWidth="1.5"
                      />
                    </>
                  ) : (
                    <>
                      <defs>
                        <linearGradient id="studioPacingGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.32" />
                          <stop offset="45%" stopColor="#d97706" stopOpacity="0.14" />
                          <stop offset="100%" stopColor="#b45309" stopOpacity="0.01" />
                        </linearGradient>
                      </defs>
                      {/* Subtle rhythmic guide lines */}
                      <line
                        x1="0"
                        y1={laneHeights.pacing * 0.5}
                        x2={canvasWidth}
                        y2={laneHeights.pacing * 0.5}
                        stroke="rgba(245, 158, 11, 0.08)"
                        strokeDasharray="4 4"
                        strokeWidth="1"
                      />
                      <line
                        x1="0"
                        y1={laneHeights.pacing * 0.25}
                        x2={canvasWidth}
                        y2={laneHeights.pacing * 0.25}
                        stroke="rgba(245, 158, 11, 0.05)"
                        strokeDasharray="2 4"
                        strokeWidth="1"
                      />
                      {studioPacing.area && (
                        <path d={studioPacing.area} fill="url(#studioPacingGrad)" />
                      )}
                      {studioPacing.path && (
                        <>
                          {/* Ambient luminous underglow */}
                          <path
                            d={studioPacing.path}
                            fill="none"
                            stroke="rgba(245, 158, 11, 0.25)"
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {/* Crisp crest stroke */}
                          <path
                            d={studioPacing.path}
                            fill="none"
                            stroke="#fbbf24"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </>
                      )}
                      {/* Playhead indicator dot riding curve */}
                      {(() => {
                        const dotY = studioPacing.getYAtTime
                          ? studioPacing.getYAtTime(time)
                          : Math.max(4, Math.min(laneHeights.pacing - 4, laneHeights.pacing - (currentPacing.rate / maxPacingRate) * (laneHeights.pacing - 8)));
                        return (
                          <g transform={`translate(${time * scale}, ${dotY})`}>
                            <circle r="6" fill="rgba(251, 191, 36, 0.2)" />
                            <circle r="3" fill="#fffbeb" stroke="#d97706" strokeWidth="1.5" />
                          </g>
                        );
                      })()}
                    </>
                  )}
                </svg>
                <div
                  className={`studio-lane-resizer ${resizingTrack === "pacing" ? "resizing" : ""}`}
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Resize Pacing lane"
                  aria-valuenow={laneHeights.pacing}
                  aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.pacing}
                  onPointerDown={(e) => handleResizePointerDown("pacing", e)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerUp}
                  onDoubleClick={(e) => handleResizeDoubleClick("pacing", e)}
                  onKeyDown={(e) => handleResizeKeyDown("pacing", e)}
                >
                  <div className="studio-lane-resizer-line" />
                </div>
              </div>

              {/* Track 4: Cut Density (Slender Stems along baseline + Shock Markers) */}
              <div
                className={`studio-lane studio-cut-density-lane ${isTrackCollapsed("cutDensity") ? "collapsed" : ""}`}
                aria-label="Cut density rhythm track"
                style={{ height: isTrackCollapsed("cutDensity") ? 0 : `${laneHeights.cutDensity}px` }}
              >
                <svg className="studio-lane-svg" width={canvasWidth} height={laneHeights.cutDensity} aria-hidden="true">
                  <defs>
                    <linearGradient id="studioCutDensityEnergyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.32" />
                      <stop offset="40%" stopColor="#f97316" stopOpacity="0.16" />
                      <stop offset="100%" stopColor="#f97316" stopOpacity="0.01" />
                    </linearGradient>
                    <linearGradient id="studioCutStemEmeraldGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#34d399" stopOpacity="0.95" />
                      <stop offset="100%" stopColor="#34d399" stopOpacity="0.15" />
                    </linearGradient>
                    <linearGradient id="studioCutStemAmberGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.95" />
                      <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.15" />
                    </linearGradient>
                    <linearGradient id="studioCutStemRubyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#f87171" stopOpacity="1" />
                      <stop offset="100%" stopColor="#f87171" stopOpacity="0.2" />
                    </linearGradient>
                    <linearGradient id="studioWhiplashGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="rgba(239, 68, 68, 0.3)" />
                      <stop offset="50%" stopColor="rgba(244, 63, 94, 0.45)" />
                      <stop offset="100%" stopColor="rgba(239, 68, 68, 0.3)" />
                    </linearGradient>
                  </defs>

                  {/* Continuous Kinetic Energy Underglow / Cut Density Envelope */}
                  {cutDensityWave.hasData && (
                    <>
                      <path d={cutDensityWave.area} fill="url(#studioCutDensityEnergyGrad)" />
                      <path
                        d={cutDensityWave.path}
                        fill="none"
                        stroke="rgba(251, 146, 60, 0.45)"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </>
                  )}

                  {/* Subtle median reference baseline */}
                  <line
                    x1="0"
                    y1={laneHeights.cutDensity - Math.min(1, studioMedianPacing / maxPacingRate) * (laneHeights.cutDensity - 8)}
                    x2={canvasWidth}
                    y2={laneHeights.cutDensity - Math.min(1, studioMedianPacing / maxPacingRate) * (laneHeights.cutDensity - 8)}
                    stroke="rgba(234, 230, 223, 0.1)"
                    strokeDasharray="4,4"
                    strokeWidth="1"
                  />

                  {/* Whiplash Clusters (consecutive jarring cuts warning banners) */}
                  {whiplashClusters.map((cluster) => {
                    const clusterX1 = cluster.startTime * scale;
                    const clusterX2 = Math.max(clusterX1 + 28, cluster.endTime * scale);
                    const clusterW = clusterX2 - clusterX1;
                    return (
                      <g
                        key={cluster.id}
                        className="saccade-whiplash-cluster"
                        transform={`translate(${clusterX1}, 2)`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSeek(cluster.startTime);
                          if (onCut) {
                            const firstCutIncoming = project.shots.find((s) => s.id === cluster.cuts[0].incomingId);
                            if (firstCutIncoming) onCut(firstCutIncoming);
                          }
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <title>{`Whiplash Cluster: ${cluster.cutCount} jarring cuts in close succession (avg ${cluster.avgJumpPercent}% hop). Click to inspect.`}</title>
                        <rect
                          x="0"
                          y="0"
                          width={clusterW}
                          height="14"
                          rx="4"
                          fill="url(#studioWhiplashGrad)"
                          stroke="rgba(248, 113, 113, 0.8)"
                          strokeWidth="1"
                        />
                        {clusterW >= 55 && (
                          <text x="5" y="10.5" fontSize="8.5" fill="#fee2e2" fontWeight="600" letterSpacing="0.02em">
                            ⚡ WHIPLASH · {cluster.cutCount} cuts
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* Luminous Cut Impact Needles with Saccade / Shock dynamics */}
                  {visibleCuts.map(({ incoming, outgoing }, idx) => {
                    const cutX = incoming.startSeconds * scale;
                    const key = `${outgoing.id}->${incoming.id}`;
                    const eye = eyeTraceMap.get(key);
                    const shock = cutShockMap.get(Math.round(incoming.startSeconds * 1000)) ?? 20;

                    const jump = eye ? eye.jumpDistancePercent : shock;
                    const maxStemH = laneHeights.cutDensity - 8;
                    const stemH = Math.min(maxStemH, Math.max(7, (jump / 100) * maxStemH));
                    const topY = laneHeights.cutDensity - stemH;

                    let strokeGrad = "url(#studioCutStemAmberGrad)";
                    let headColor = "#fbbf24";
                    let haloColor = "rgba(251, 191, 36, 0.35)";
                    let isJarring = false;
                    let isCollision = false;

                    if (eye) {
                      if (eye.rating === "anchored" || eye.rating === "smooth") {
                        strokeGrad = "url(#studioCutStemEmeraldGrad)";
                        headColor = "#34d399";
                        haloColor = "rgba(52, 211, 153, 0.35)";
                      } else if (eye.rating === "shifted" || eye.rating === "natural") {
                        strokeGrad = "url(#studioCutStemAmberGrad)";
                        headColor = "#fbbf24";
                        haloColor = "rgba(251, 191, 36, 0.35)";
                      } else {
                        strokeGrad = "url(#studioCutStemRubyGrad)";
                        headColor = "#f87171";
                        haloColor = "rgba(248, 113, 113, 0.55)";
                        isJarring = true;
                      }
                      if (eye.momentum?.alignment === "momentum-collision") {
                        isCollision = true;
                      }
                    }

                    return (
                      <g
                        key={`stem-${incoming.id}-${idx}`}
                        className="studio-cut-impact-node"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSeek(incoming.startSeconds);
                          if (onCut) onCut(incoming);
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <title>{`Cut at ${formatTimecode(incoming.startSeconds, project.frameRate, project.dropFrame)}: ${eye ? `${eye.rating.toUpperCase()} (${eye.jumpDistancePercent}% jump)` : `Shock ${shock}`}`}</title>
                        {/* Slender luminous vertical needle */}
                        <line
                          x1={cutX}
                          y1={laneHeights.cutDensity}
                          x2={cutX}
                          y2={topY}
                          stroke={strokeGrad}
                          strokeWidth={isJarring ? 2 : 1.5}
                          strokeLinecap="round"
                        />
                        {/* Soft Outer Halo */}
                        <circle
                          cx={cutX}
                          cy={topY}
                          r={isJarring ? 5.5 : 3.5}
                          fill={haloColor}
                        />
                        {/* Glowing Impact Bead */}
                        <circle
                          cx={cutX}
                          cy={topY}
                          r={isJarring ? 2.5 : 1.8}
                          fill={headColor}
                          stroke="#0a0c0d"
                          strokeWidth="0.5"
                        />
                        {/* Jarring pulse ring */}
                        {isJarring && (
                          <circle
                            cx={cutX}
                            cy={topY}
                            r="6.5"
                            fill="none"
                            stroke="#f87171"
                            strokeWidth="0.8"
                            strokeDasharray="2,2"
                            opacity="0.8"
                          />
                        )}
                        {/* Directional Shift indicator */}
                        {eye?.screenDirection && eye.screenDirection !== "neutral" && (
                          <polygon
                            points={
                              eye.screenDirection === "left-to-right"
                                ? `${cutX + 3},${topY - 1} ${cutX + 7},${topY} ${cutX + 3},${topY + 1}`
                                : `${cutX - 3},${topY - 1} ${cutX - 7},${topY} ${cutX - 3},${topY + 1}`
                            }
                            fill={headColor}
                            opacity={0.8}
                          />
                        )}
                        {/* Axis Clash Warning */}
                        {eye?.axisClash && (
                          <text x={cutX} y={Math.max(9, topY - 3)} fontSize="8" fill="#f59e0b" textAnchor="middle">⚠️</text>
                        )}
                        {/* Momentum Collision */}
                        {isCollision && !eye?.axisClash && (
                          <text x={cutX} y={Math.max(9, topY - 3)} fontSize="8" fill="#f59e0b" textAnchor="middle">⚡</text>
                        )}
                      </g>
                    );
                  })}

                  {/* Cut shock light accents */}
                  {cutShockData.filter((c) => c.shockScore >= 42).map((c, idx) => (
                    <g key={`studio-shock-${idx}`} transform={`translate(${c.time * scale}, 0)`}>
                      <line y1="2" y2={laneHeights.cutDensity} stroke="rgba(244, 63, 94, 0.35)" strokeWidth="1" strokeDasharray="2,3" />
                      <polygon points="-2,2 0,5 2,2 0,-1" fill="#f43f5e" opacity="0.8" />
                    </g>
                  ))}
                </svg>
                <div
                  className={`studio-lane-resizer ${resizingTrack === "cutDensity" ? "resizing" : ""}`}
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Resize Cut density lane"
                  aria-valuenow={laneHeights.cutDensity}
                  aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.cutDensity}
                  onPointerDown={(e) => handleResizePointerDown("cutDensity", e)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerUp}
                  onDoubleClick={(e) => handleResizeDoubleClick("cutDensity", e)}
                  onKeyDown={(e) => handleResizeKeyDown("cutDensity", e)}
                >
                  <div className="studio-lane-resizer-line" />
                </div>
              </div>

              {/* Track 5: Framing (Stepped Graph in Slate-Blue: Wide, Medium, Close) */}
              <div
                className={`studio-lane studio-framing-lane ${isTrackCollapsed("framing") ? "collapsed" : ""}`}
                aria-label="Framing scale stepped track"
                style={{ height: isTrackCollapsed("framing") ? 0 : `${laneHeights.framing}px` }}
              >
                <div className="studio-framing-guideline" style={{ top: `${laneHeights.framing * 0.22}px` }} />
                <div className="studio-framing-guideline" style={{ top: `${laneHeights.framing * 0.5}px` }} />
                <div className="studio-framing-guideline" style={{ top: `${laneHeights.framing * 0.78}px` }} />
                <svg className="studio-lane-svg" width={canvasWidth} height={laneHeights.framing} aria-hidden="true">
                  {generateSteppedFramingPath(visibleShots, scale, laneHeights.framing) && (
                    <path
                      d={generateSteppedFramingPath(visibleShots, scale, laneHeights.framing)}
                      fill="none"
                      stroke="rgba(107, 163, 207, 0.45)"
                      strokeWidth="1.5"
                      strokeLinecap="square"
                    />
                  )}
                </svg>
                {visibleShots.map((s) => {
                  const tier = getFramingTier(s);
                  const top = tier === "Close"
                    ? laneHeights.framing * 0.12
                    : tier === "Medium"
                      ? laneHeights.framing * 0.42
                      : laneHeights.framing * 0.72;
                  const isSelected = selected === s.id;
                  const isLastShot = s.index === project.shots.length || s.endSeconds >= duration - 0.001;
                  const isPlaying = time >= s.startSeconds && (isLastShot ? time <= s.endSeconds : time < s.endSeconds);
                  const shotW = Math.max(2, s.duration * scale);
                  const shotX = s.startSeconds * scale;
                  const framingColor = sizeColors[s.shotSize] || "#64748b";
                  return (
                    <button
                      key={`studio-framing-${s.id}`}
                      type="button"
                      className={`studio-framing-bar tier-${tier.toLowerCase()} ${isSelected ? "selected" : ""} ${isPlaying ? "active" : ""}`}
                      style={{
                        left: shotX,
                        width: shotW,
                        top: `${top}px`,
                        height: `${Math.max(4, Math.min(10, laneHeights.framing * 0.2))}px`,
                        backgroundColor: framingColor,
                      }}
                      title={`Shot ${s.index}: ${s.shotSize} (${s.duration.toFixed(2)}s)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onShot(s);
                        onSeek(s.startSeconds);
                      }}
                    />
                  );
                })}
                <div
                  className={`studio-lane-resizer ${resizingTrack === "framing" ? "resizing" : ""}`}
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Resize Framing lane"
                  aria-valuenow={laneHeights.framing}
                  aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.framing}
                  onPointerDown={(e) => handleResizePointerDown("framing", e)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerUp}
                  onDoubleClick={(e) => handleResizeDoubleClick("framing", e)}
                  onKeyDown={(e) => handleResizeKeyDown("framing", e)}
                >
                  <div className="studio-lane-resizer-line" />
                </div>
              </div>

              {/* Track 6: Motion (Continuous Cyan Kinetic Wave) */}
              <div
                className={`studio-lane studio-motion-lane ${isTrackCollapsed("motion") ? "collapsed" : ""}`}
                aria-label="Motion flow energy track"
                style={{ height: isTrackCollapsed("motion") ? 0 : `${laneHeights.motion}px` }}
              >
                <svg className="studio-lane-svg" width={canvasWidth} height={laneHeights.motion} aria-hidden="true">
                  <defs>
                    <linearGradient id="studioMotionGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.20" />
                      <stop offset="70%" stopColor="#38bdf8" stopOpacity="0.06" />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.00" />
                    </linearGradient>
                  </defs>
                  {studioMotion.area && (
                    <path d={studioMotion.area} fill="url(#studioMotionGrad)" />
                  )}
                  {studioMotion.path && (
                    <path d={studioMotion.path} fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" />
                  )}
                  {/* Playhead indicator dot riding wave */}
                  <circle
                    cx={time * scale}
                    cy={Math.max(4, Math.min(laneHeights.motion - 4, laneHeights.motion - ((currentShot?.motionProfile?.totalKineticEnergy ?? 40) / 100) * (laneHeights.motion - 8)))}
                    r="3"
                    fill="#38bdf8"
                    stroke="#0c0e11"
                    strokeWidth="1.5"
                  />
                </svg>
                <div
                  className={`studio-lane-resizer ${resizingTrack === "motion" ? "resizing" : ""}`}
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Resize Motion lane"
                  aria-valuenow={laneHeights.motion}
                  aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.motion}
                  onPointerDown={(e) => handleResizePointerDown("motion", e)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerUp}
                  onDoubleClick={(e) => handleResizeDoubleClick("motion", e)}
                  onKeyDown={(e) => handleResizeKeyDown("motion", e)}
                >
                  <div className="studio-lane-resizer-line" />
                </div>
              </div>

              {/* Track 7: Palette (Continuous Watercolor Chromatic River) */}
              <div
                className={`studio-lane studio-palette-lane ${isTrackCollapsed("palette") ? "collapsed" : ""}`}
                aria-label="Watercolor chromatic palette river track"
                style={{ height: isTrackCollapsed("palette") ? 0 : `${laneHeights.palette}px` }}
              >
                <svg className="studio-lane-svg studio-palette-svg" width={canvasWidth} height={laneHeights.palette} aria-hidden="true">
                  <defs>
                    <filter id="studioWatercolorFilter" filterUnits="userSpaceOnUse" x="0" y="0" width={canvasWidth} height={laneHeights.palette}>
                      <feTurbulence type="fractalNoise" baseFrequency="0.03 0.08" numOctaves="1" result="noise" />
                      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" result="displaced" />
                      <feGaussianBlur in="displaced" stdDeviation="1.5" result="blurred" />
                      <feMerge>
                        <feMergeNode in="blurred" opacity="0.85" />
                        <feMergeNode in="SourceGraphic" opacity="0.55" />
                      </feMerge>
                    </filter>
                  </defs>

                  {/* Flowing Watercolor Shot Segments with Organic Soft Bleed */}
                  <g filter="url(#studioWatercolorFilter)">
                    {visibleShots.map((s) => {
                      const shotX = s.startSeconds * scale;
                      const shotW = Math.max(4, s.duration * scale);
                      const luma = s.colorProfile?.luminance ?? 0.5;
                      const domColor = s.colorProfile?.palette?.[0] || sizeColors[s.shotSize] || "#3b4856";
                      const topPad = Math.max(3, (1 - luma) * (laneHeights.palette * 0.28));
                      const segH = Math.max(12, laneHeights.palette - topPad * 2);
                      return (
                        <rect
                          key={`palette-wash-${s.id}`}
                          x={shotX}
                          y={topPad}
                          width={shotW + 2}
                          height={segH}
                          rx={Math.min(8, shotW / 2)}
                          fill={domColor}
                          opacity={0.82}
                        />
                      );
                    })}
                  </g>

                  {/* Luminous Central Wave Current riding the film's tonal temperature */}
                  {generatePaletteWavePath(visibleShots, scale, laneHeights.palette) && (
                    <path
                      d={generatePaletteWavePath(visibleShots, scale, laneHeights.palette)}
                      fill="none"
                      stroke="rgba(255, 255, 255, 0.45)"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  )}

                  {/* Playhead indicator droplet riding the color current */}
                  {currentShot && (
                    <circle
                      cx={time * scale}
                      cy={Math.max(
                        6,
                        Math.min(
                          laneHeights.palette - 6,
                          laneHeights.palette * (0.75 - (currentShot.colorProfile?.luminance ?? 0.5) * 0.5)
                        )
                      )}
                      r="3.5"
                      fill={currentShot.colorProfile?.palette?.[0] || sizeColors[currentShot.shotSize] || "#fcd34d"}
                      stroke="#0c0e11"
                      strokeWidth="1.5"
                    />
                  )}
                </svg>

                {/* Interactive Shot Overlays for click selection & rich palette tooltips */}
                {visibleShots.map((s) => {
                  const shotX = s.startSeconds * scale;
                  const shotW = Math.max(4, s.duration * scale);
                  const isSelected = selected === s.id;
                  const isLastShot = s.index === project.shots.length || s.endSeconds >= duration - 0.001;
                  const isPlaying = time >= s.startSeconds && (isLastShot ? time <= s.endSeconds : time < s.endSeconds);
                  const lumaPercent = Math.round((s.colorProfile?.luminance ?? 0.5) * 100);
                  const mood = s.colorProfile?.mood || s.shotSize;
                  const paletteColors = s.colorProfile?.palette?.slice(0, 5).join(", ") || "Framing scale fallback";
                  return (
                    <button
                      key={`studio-palette-${s.id}`}
                      type="button"
                      className={`studio-palette-shot-btn ${isSelected ? "selected" : ""} ${isPlaying ? "active" : ""}`}
                      style={{
                        left: shotX,
                        width: shotW,
                      }}
                      title={`Shot ${s.index}: ${mood} · ${lumaPercent}% luma · Palette: ${paletteColors}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onShot(s);
                        onSeek(s.startSeconds);
                      }}
                    />
                  );
                })}

                <div
                  className={`studio-lane-resizer ${resizingTrack === "palette" ? "resizing" : ""}`}
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Resize Palette lane"
                  aria-valuenow={laneHeights.palette}
                  aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.palette}
                  onPointerDown={(e) => handleResizePointerDown("palette", e)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerUp}
                  onDoubleClick={(e) => handleResizeDoubleClick("palette", e)}
                  onKeyDown={(e) => handleResizeKeyDown("palette", e)}
                >
                  <div className="studio-lane-resizer-line" />
                </div>
              </div>

              {/* Track 8: Cast (Multi-row Character Swimlanes) */}
              <div
                className={`studio-lane studio-cast-lane ${isTrackCollapsed("cast") ? "collapsed" : ""}`}
                aria-label="Cast presence track"
                style={{ height: isTrackCollapsed("cast") ? 0 : `${laneHeights.cast}px` }}
              >
                {activeCastMembers.length > 0 ? (
                  activeCastMembers.map((member, idx) => {
                    const subrowH = laneHeights.cast / activeCastMembers.length;
                    const color = CAST_PALETTE[idx % CAST_PALETTE.length];
                    const intervals = memberIntervalsMap.get(member.id) ?? [];
                    const barH = Math.max(4, Math.min(10, subrowH - 4));
                    const barTop = Math.max(0, (subrowH - barH) / 2);

                    return (
                      <div
                        key={`cast-subrow-${member.id}`}
                        className="studio-cast-subrow"
                        style={{
                          height: `${subrowH}px`,
                        }}
                      >
                        {intervals.map((item, i) => (
                          <button
                            key={`cast-bar-${member.id}-${i}-${item.start}`}
                            type="button"
                            className="studio-cast-bar"
                            style={{
                              left: item.start * scale,
                              width: Math.max(4, (item.end - item.start) * scale),
                              top: `${barTop}px`,
                              height: `${barH}px`,
                              backgroundColor: color,
                            }}
                            title={`${member.name} · Shot ${item.shot.index} (${(item.end - item.start).toFixed(2)}s)`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onShot(item.shot);
                              onSeek(item.start);
                            }}
                          />
                        ))}
                      </div>
                    );
                  })
                ) : (
                  <div className="studio-cast-empty">
                    <span>No cast data</span>
                  </div>
                )}
                <div
                  className={`studio-lane-resizer ${resizingTrack === "cast" ? "resizing" : ""}`}
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Resize Cast lane"
                  aria-valuenow={laneHeights.cast}
                  aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.cast}
                  onPointerDown={(e) => handleResizePointerDown("cast", e)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerUp}
                  onDoubleClick={(e) => handleResizeDoubleClick("cast", e)}
                  onKeyDown={(e) => handleResizeKeyDown("cast", e)}
                >
                  <div className="studio-lane-resizer-line" />
                </div>
              </div>

              {/* Track 8: Sound (5-Subrow DME Soundtrack: Dialogue, Music, Effects, Loudness, Speech) */}
              <div
                className={`studio-lane studio-sound-lane ${isTrackCollapsed("sound") ? "collapsed" : ""}`}
                aria-label="Soundtrack 5-subrow DME track"
                style={{ height: isTrackCollapsed("sound") ? 0 : `${laneHeights.sound}px` }}
              >
                {/* Subrow 1: Dialogue Waveform */}
                <div
                  className="studio-sound-stem dialogue-stem"
                  title="Dialogue Waveform"
                  style={{ height: `${soundSubrowH}px` }}
                >
                  <svg className="studio-stem-svg" width={canvasWidth} height={soundSubrowH} aria-hidden="true">
                    {studioDmePaths.speech && (
                      <path d={studioDmePaths.speech} fill="rgba(107, 163, 207, 0.65)" />
                    )}
                  </svg>
                </div>

                {/* Subrow 2: Music Waveform */}
                <div
                  className="studio-sound-stem music-stem"
                  title="Music Waveform"
                  style={{ height: `${soundSubrowH}px` }}
                >
                  <svg className="studio-stem-svg" width={canvasWidth} height={soundSubrowH} aria-hidden="true">
                    {studioDmePaths.music && (
                      <path d={studioDmePaths.music} fill="rgba(124, 163, 129, 0.65)" />
                    )}
                  </svg>
                </div>

                {/* Subrow 3: Effects Waveform */}
                <div
                  className="studio-sound-stem effects-stem"
                  title="Effects Waveform"
                  style={{ height: `${soundSubrowH}px` }}
                >
                  <svg className="studio-stem-svg" width={canvasWidth} height={soundSubrowH} aria-hidden="true">
                    {studioDmePaths.ambience && (
                      <path d={studioDmePaths.ambience} fill="rgba(142, 124, 195, 0.65)" />
                    )}
                  </svg>
                </div>

                {/* Subrow 4: Loudness Curve */}
                <div
                  className="studio-sound-stem loudness-stem"
                  title="Loudness Curve"
                  style={{ height: `${soundSubrowH}px` }}
                >
                  <svg className="studio-stem-svg" width={canvasWidth} height={soundSubrowH} aria-hidden="true">
                    {studioLoudnessPath && (
                      <path d={studioLoudnessPath} fill="none" stroke="#eae6df" strokeWidth="1.2" strokeLinecap="round" />
                    )}
                  </svg>
                </div>

                {/* Subrow 5: Speech Blocks */}
                <div
                  className="studio-sound-stem speech-blocks-stem"
                  title="Speech Activity"
                  style={{ height: `${soundSubrowH}px` }}
                >
                  {speechAnalysis && speechAnalysis.regions.map((reg, idx) => {
                    const barH = Math.max(6, Math.min(10, soundSubrowH - 6));
                    const barTop = (soundSubrowH - barH) / 2;
                    return (
                      <div
                        key={`speech-bar-${idx}-${reg.startSeconds}`}
                        className="studio-speech-block"
                        style={{
                          left: reg.startSeconds * scale,
                          width: Math.max(3, (reg.endSeconds - reg.startSeconds) * scale),
                          top: `${barTop}px`,
                          height: `${barH}px`,
                        }}
                        title={`Speech: ${formatTimecode(reg.startSeconds, project.frameRate, project.dropFrame)} - ${formatTimecode(reg.endSeconds, project.frameRate, project.dropFrame)}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSeek(reg.startSeconds);
                        }}
                      />
                    );
                  })}
                </div>

                {/* Sound Bottom Resize Handle */}
                <div
                  className={`studio-lane-resizer ${resizingTrack === "sound" ? "resizing" : ""}`}
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Resize Sound lane"
                  aria-valuenow={laneHeights.sound}
                  aria-valuemin={MIN_STUDIO_LANE_HEIGHTS.sound}
                  onPointerDown={(e) => handleResizePointerDown("sound", e)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerUp}
                  onDoubleClick={(e) => handleResizeDoubleClick("sound", e)}
                  onKeyDown={(e) => handleResizeKeyDown("sound", e)}
                >
                  <div className="studio-lane-resizer-line" />
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* River 1: Scenes & Dramatic Arc River (when enabled) */}
              {layers.scenes && visibleSequences.length > 0 && (
            <div className="lane-track scenes-river" aria-label="Dramatic scenes & sequences river">
              <div className="river-sticky-badge scenes-badge">
                <span className="river-badge-icon">🎬</span>
                <span className="river-badge-title">SCENES</span>
                <span className="river-badge-detail mono">{visibleSequences.length}</span>
              </div>
              {visibleSequences.map((scene, idx) => {
                const isMoment = (scene.kind ?? "passage") === "moment";
                const isSelected = selectedSequenceId === scene.id;
                if (isMoment) {
                  return (
                    <button
                      type="button"
                      key={scene.id || `scene-${idx}`}
                      className={`scene-marker scene-moment-marker ${isSelected ? "selected" : ""}`}
                      title={`Moment: ${scene.name} (${formatTimecode(scene.startSeconds, project.frameRate, project.dropFrame)})`}
                      style={{
                        left: scene.startSeconds * scale,
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectSequence?.(scene);
                        onSeek(scene.startSeconds);
                      }}
                    >
                      <span className="scene-moment-diamond">◇</span>
                      <span className="scene-marker-text">{scene.name}</span>
                    </button>
                  );
                }
                return (
                  <button
                    type="button"
                    key={scene.id || `scene-${idx}`}
                    className={`scene-marker ${isSelected ? "selected" : ""}`}
                    title={`${scene.name}: ${(scene.endSeconds - scene.startSeconds).toFixed(1)}s`}
                    style={{
                      left: scene.startSeconds * scale,
                      width: Math.max(2, (scene.endSeconds - scene.startSeconds) * scale),
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectSequence?.(scene);
                      onRangeChange({ start: scene.startSeconds, end: scene.endSeconds });
                    }}
                  >
                    <span className="scene-marker-text">{scene.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* River 2: Film Shot Track (V1) */}
          <div className="shot-track" aria-label="Video shot track">
            {!isStudio && (
              <div className="river-sticky-badge v1-badge">
                <span className="river-badge-icon">🎞️</span>
                <span className="river-badge-title">V1 FILM</span>
                <span className="river-badge-detail mono">{project.shots.length} shots</span>
              </div>
            )}
            {visibleShots.map((s) => {
              let startSec = s.startSeconds;
              let endSec = s.endSeconds;
              if (activeCutDrag) {
                if (s.id === activeCutDrag.outgoingId) {
                  endSec = activeCutDrag.currentTime;
                } else if (s.id === activeCutDrag.incomingId) {
                  startSec = activeCutDrag.currentTime;
                }
              }
              const effDur = Math.max(0, endSec - startSec);
              const w = effDur * scale;
              const reviewMatch = !reviewMatchIds || reviewMatchIds.includes(s.id);
              const colorGetter = (colorMappings[project.colorMode] || colorMappings.shotSize).color;
              const lumaVal = s.colorProfile?.luminance ?? 0.5;
              const lumaColor = `rgb(${Math.round(255 * lumaVal)}, ${Math.round(255 * lumaVal)}, ${Math.round(255 * lumaVal)})`;
              const isCoveredByStory = Boolean(
                (visibleRange && visibleRange.start !== undefined && visibleRange.end !== undefined && visibleRange.end > visibleRange.start && s.endSeconds > visibleRange.start && s.startSeconds < visibleRange.end) ||
                (selectedSequenceId && project.sequences?.some((seq) => seq.id === selectedSequenceId && (seq.kind ?? "passage") === "passage" && s.endSeconds > seq.startSeconds && s.startSeconds < seq.endSeconds))
              );
              return (
                <button
                  type="button"
                  key={s.id}
                  title={`${reviewReasonLabel(reviewReasons(s))} · Shot ${s.index} · ${s.shotSize} · ${effDur.toFixed(3)}s`}
                  aria-label={`Shot ${s.index}${reviewMatch ? "" : ", outside active review filter"}`}
                  className={`shot ${selected === s.id ? "selected" : ""} ${active === s.id ? "active" : ""} ${highlightedShotIds?.includes(s.id) ? "character-highlight" : ""} ${reviewMatch ? "review-match" : "review-dimmed"} ${squintMode ? "timeline-squint-shot" : ""} ${isCoveredByStory ? "shot-in-story-range" : ""}`}
                  style={
                    {
                      left: startSec * scale,
                      width: w,
                      "--size-color": squintMode ? lumaColor : colorGetter(s),
                    } as CSSProperties
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onShot(s);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onPlayShot(s);
                  }}
                >
                  {w > 58 && thumbnails[s.id] && (
                    <img
                      className={`shot-thumbnail ${squintMode ? "squint-active" : ""}`}
                      src={thumbnails[s.id]}
                      alt={`Shot ${s.index}`}
                      draggable={false}
                      style={squintMode ? { filter: getSquintFilter(squintLevel) } : undefined}
                    />
                  )}
                  {s.reviewStatus !== "Confirmed" && (
                    <i
                      className="review-marker"
                      aria-label="Unconfirmed tags"
                    />
                  )}
                </button>
              );
            })}
            {visibleCuts.map(({ incoming, outgoing }) => {
              const isBeingDragged = activeCutDrag?.incomingId === incoming.id;
              const cutPos = isBeingDragged
                ? activeCutDrag.currentTime * scale
                : incoming.startSeconds * scale;
              const cutEye = eyeTraceMap.get(`${outgoing.id}->${incoming.id}`);
              return (
                <div
                  key={`cut-${incoming.id}`}
                  className={`cut-boundary ${selectedCut === incoming.id ? "selected" : ""} ${isBeingDragged ? "dragging" : ""} ${cutEye ? `saccade-${cutEye.rating}` : ""}`}
                  style={{ left: cutPos }}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || event.shiftKey) return;
                    event.preventDefault();
                    event.stopPropagation();
                    suppressMapClick.current = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const minDur = Math.max(1 / actualRate(project.frameRate), 0.08);
                    dragCutRef.current = {
                      incomingId: incoming.id,
                      outgoingId: outgoing.id,
                      startX: event.clientX,
                      originalTime: incoming.startSeconds,
                      minTime: outgoing.startSeconds + minDur,
                      maxTime: incoming.endSeconds - minDur,
                      hasMoved: false,
                    };
                    setActiveCutDrag({
                      incomingId: incoming.id,
                      outgoingId: outgoing.id,
                      originalTime: incoming.startSeconds,
                      currentTime: incoming.startSeconds,
                    });
                  }}
                  onPointerMove={(event) => {
                    const drag = dragCutRef.current;
                    if (!drag) return;
                    if (Math.abs(event.clientX - drag.startX) > 2) {
                      drag.hasMoved = true;
                    }
                    const rawTime = drag.originalTime + (event.clientX - drag.startX) / scale;
                    let clamped = Math.max(drag.minTime, Math.min(drag.maxTime, rawTime));
                    if (snapToCuts) {
                      const thresholdSec = 10 / scale;
                      const snap = getSnapTime(clamped, snapPoints, thresholdSec);
                      if (snap.isSnapped && snap.snapTarget !== undefined && snap.snapTarget >= drag.minTime && snap.snapTarget <= drag.maxTime) {
                        clamped = snap.snapTarget;
                      }
                    }
                    const quantized = quantizeToFrame(clamped, project.frameRate);
                    setActiveCutDrag((prev) => prev ? { ...prev, currentTime: quantized } : null);
                    onScrub(quantized);
                  }}
                  onPointerUp={(event) => {
                    const drag = dragCutRef.current;
                    if (!drag) return;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    if (drag.hasMoved && activeCutDrag) {
                      onRollCut?.(drag.incomingId, activeCutDrag.currentTime);
                    } else {
                      onCut?.(incoming);
                    }
                    dragCutRef.current = null;
                    setActiveCutDrag(null);
                    setTimeout(() => {
                      suppressMapClick.current = false;
                    }, 50);
                  }}
                  onPointerCancel={() => {
                    dragCutRef.current = null;
                    setActiveCutDrag(null);
                    suppressMapClick.current = false;
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!dragCutRef.current?.hasMoved) {
                      onCut?.(incoming);
                    }
                  }}
                  role="slider"
                  tabIndex={0}
                  aria-label={`Cut between Shot ${outgoing.index} and Shot ${incoming.index}`}
                  aria-valuemin={outgoing.startSeconds}
                  aria-valuemax={incoming.endSeconds}
                  aria-valuenow={incoming.startSeconds}
                  aria-valuetext={formatTimecode(incoming.startSeconds, project.frameRate, project.dropFrame)}
                  title={`Drag cut left/right to roll edit · Left/Right arrow keys to nudge · Click to read cut (Shot ${outgoing.index} → Shot ${incoming.index})`}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") {
                      event.preventDefault();
                      event.stopPropagation();
                      onNudgeCut?.(incoming.id, -1);
                    } else if (event.key === "ArrowRight") {
                      event.preventDefault();
                      event.stopPropagation();
                      onNudgeCut?.(incoming.id, 1);
                    } else if (event.key === "Delete" || event.key === "Backspace") {
                      event.preventDefault();
                      event.stopPropagation();
                      onDeleteCut?.(incoming.id);
                    }
                  }}
                >
                  <div className="cut-grip-handle">
                    <span className="cut-indicator-line" />
                    {cutEye && (
                      <span
                        className={`cut-saccade-pip ${cutEye.rating} ${cutEye.momentum?.alignment === "momentum-collision" ? "collision" : ""}`}
                        title={`Saccade Hop: ${cutEye.jumpDistancePercent}% (${cutEye.rating})${cutEye.momentum?.alignment === "momentum-collision" ? " · Kinetic Collision" : ""}`}
                      />
                    )}
                  </div>

                  {isBeingDragged && activeCutDrag && (
                    <div className="cut-rolling-badge">
                      <span className="mono">
                        {formatTimecode(activeCutDrag.currentTime, project.frameRate, project.dropFrame)}
                      </span>
                      <small className="mono">
                        {(() => {
                          const deltaFrames = Math.round((activeCutDrag.currentTime - activeCutDrag.originalTime) * actualRate(project.frameRate));
                          const sign = deltaFrames > 0 ? "+" : "";
                          return `${sign}${deltaFrames}f (${sign}${(activeCutDrag.currentTime - activeCutDrag.originalTime).toFixed(2)}s)`;
                        })()}
                      </small>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* River 3: Pacing & Cutting Rhythm River (when enabled) */}
          {!isStudio && layers.pacing && project.shots.length > 0 && (
            <div className="lane-track pacing-river" aria-label="Pacing and cutting rhythm river">
              <div className="river-sticky-badge pacing-badge">
                <span className="river-badge-icon">🌊</span>
                <span className="river-badge-title">PACING</span>
                <span className="river-badge-detail mono">{currentPacing.rate.toFixed(1)} cuts/m · {pacingCategory}</span>
              </div>
              <svg
                className="pacing-river-canvas"
                width={canvasWidth}
                height={50}
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="pacingRiverGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.45" />
                    <stop offset="60%" stopColor="#f59e0b" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {pacingSvgArea && (
                  <path d={pacingSvgArea} fill="url(#pacingRiverGradient)" />
                )}
                {pacingSvgPath && (
                  <>
                    <path
                      d={pacingSvgPath}
                      fill="none"
                      stroke="rgba(245, 158, 11, 0.25)"
                      strokeWidth="4.5"
                      strokeLinecap="round"
                    />
                    <path
                      d={pacingSvgPath}
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </>
                )}
                {/* Sensory Shock spike indicators */}
                {cutShockData.filter((c) => c.shockScore >= 45).map((c, idx) => (
                  <g key={`shock-marker-${idx}`} transform={`translate(${c.time * scale}, 0)`}>
                    <line y1="10" y2="48" stroke="rgba(239, 68, 68, 0.7)" strokeWidth="1.5" strokeDasharray="2,2" />
                    <circle cx="0" cy="12" r="3" fill="#ef4444" />
                  </g>
                ))}
                {/* Playhead indicator dot */}
                {(() => {
                  const dotY = riverPacing.getYAtTime
                    ? riverPacing.getYAtTime(time)
                    : 44 - (currentPacing.rate / maxPacingRate) * 36;
                  return (
                    <g transform={`translate(${time * scale}, ${dotY})`}>
                      <circle r="7" fill="rgba(251, 191, 36, 0.22)" />
                      <circle r="3.5" fill="#ffffff" stroke="#f59e0b" strokeWidth="2" />
                    </g>
                  );
                })()}
              </svg>
            </div>
          )}

          {/* River 4: Framing Scale Elevation River (when enabled) */}
          {!isStudio && layers.framingArc && project.shots.length > 0 && (
            <div className="lane-track framing-arc-river" aria-label="Framing scale elevation river">
              <div className="river-sticky-badge framing-badge">
                <span className="river-badge-icon">📐</span>
                <span className="river-badge-title">FRAMING ARC</span>
                <span className="river-badge-detail mono">{currentShot?.shotSize || "—"}</span>
              </div>
              <div className="framing-river-canvas">
                {visibleShots.map((s) => {
                  const rank = framingRank(s);
                  const effectiveRank = rank === null ? 0 : rank;
                  const shotW = Math.max(3, s.duration * scale);
                  const shotX = s.startSeconds * scale;
                  const barH = Math.max(6, ((effectiveRank + 1) / 9) * 36);
                  const color = rank === null ? "#64748b" : sizeColors[s.shotSize] || "#64748b";
                  const isSelected = selected === s.id;
                  const isPlaying = time >= s.startSeconds && time <= s.endSeconds;

                  return (
                    <button
                      key={`framing-seg-${s.id}`}
                      type="button"
                      className={`framing-river-segment ${isSelected ? "selected" : ""} ${isPlaying ? "playing" : ""}`}
                      style={{
                        left: shotX,
                        width: shotW,
                        height: barH,
                        backgroundColor: color,
                      }}
                      title={`Shot ${s.index}: ${s.shotSize} (${s.duration.toFixed(2)}s)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onShot(s);
                        onSeek(s.startSeconds);
                      }}
                    >
                      {shotW > 28 && (
                        <span className="framing-river-tag">{s.shotSize}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* River 5: Motion Energy River (when enabled) */}
          {!isStudio && layers.motion && project.shots.length > 0 && (
            <div className="lane-track motion-river" aria-label="Motion energy river">
              <div className="river-sticky-badge motion-badge">
                <span className="river-badge-icon">⚡</span>
                <span className="river-badge-title">MOTION</span>
                <span className="river-badge-detail mono">{motionReadout}</span>
              </div>
              <div className="motion-river-canvas">
                {visibleShots.map((s) => {
                  const profile = s.motionProfile;
                  const shotW = Math.max(3, s.duration * scale);
                  const shotX = s.startSeconds * scale;
                  const isSelected = selected === s.id;
                  const isPlaying = time >= s.startSeconds && time <= s.endSeconds;

                  const hasProfile = Boolean(profile);
                  const totalEnergy = profile?.totalKineticEnergy ?? Math.max(12, Math.min(80, Math.round(65 - Math.min(s.duration, 12) * 4)));
                  const barH = Math.max(6, (totalEnergy / 100) * 36);
                  const tier = classifyKineticVelocity(totalEnergy);
                  const momentum = profile?.kineticDelta !== undefined ? classifyMomentumTransition(profile.kineticDelta) : null;

                  return (
                    <button
                      key={`motion-seg-${s.id}`}
                      type="button"
                      className={`motion-river-segment ${isSelected ? "selected" : ""} ${isPlaying ? "playing" : ""} ${hasProfile ? "scanned" : "estimated"}`}
                      style={{
                        left: shotX,
                        width: shotW,
                        height: barH,
                      }}
                      title={
                        hasProfile
                          ? `Shot ${s.index}: ${totalEnergy}% Flow (${tier})${
                              momentum && momentum.type !== "initial" ? ` · ${momentum.label}` : ""
                            }`
                          : `Shot ${s.index}: Est. dynamic baseline ~${totalEnergy}%`
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onShot(s);
                        onSeek(s.startSeconds);
                      }}
                    >
                      <div className="motion-layer flow-fill" style={{ height: "100%" }} />
                      {profile?.kineticDelta !== undefined && Math.abs(profile.kineticDelta) >= 25 && (
                        <div
                          className={`motion-momentum-indicator ${profile.kineticDelta > 0 ? "surge" : "drop"}`}
                          title={`Momentum: ${profile.kineticDelta > 0 ? "+" : ""}${profile.kineticDelta}%`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* River 6: Cast & Character Presence River (when enabled) */}
          {!isStudio && layers.characters && project.cast && project.cast.length > 0 && (
            <div className="lane-track cast-presence-river" aria-label="Cast presence river">
              <div className="river-sticky-badge cast-badge">
                <span className="river-badge-icon">👥</span>
                <span className="river-badge-title">CAST</span>
                <span className="river-badge-detail mono">{project.cast.length} ACTORS</span>
              </div>
              <div className="cast-swimlanes-wrap">
                {project.cast.map((member) => {
                  const intervals: Array<{
                    id: string;
                    start: number;
                    end: number;
                    type: "verified" | "suggested" | "shot-assigned";
                    shot: Shot;
                    label: string;
                  }> = [];

                  for (const s of visibleShots) {
                    const ca = s.characterAnalysis;
                    if (!ca) continue;

                    const hasManualReview = ca.manualReviewStatus === "Confirmed";
                    if (hasManualReview) {
                      if (ca.manualMemberIds?.includes(member.id)) {
                        intervals.push({
                          id: `${s.id}-${member.id}-manual`,
                          start: s.startSeconds,
                          end: s.endSeconds,
                          type: "shot-assigned",
                          shot: s,
                          label: `Shot ${s.index} (Manual)`,
                        });
                      }
                    } else {
                      const memberIntervals = ca.intervals?.filter((i) => i.memberId === member.id) ?? [];
                      for (const mi of memberIntervals) {
                        const isConfirmed = mi.reviewStatus === "Confirmed" || ca.reviewStatus === "Confirmed";
                        const start = mi.endSeconds > mi.startSeconds + 0.05 ? mi.startSeconds : s.startSeconds;
                        const end = mi.endSeconds > mi.startSeconds + 0.05 ? mi.endSeconds : s.endSeconds;
                        intervals.push({
                          id: `${s.id}-${member.id}-${mi.startSeconds}`,
                          start,
                          end,
                          type: isConfirmed ? "verified" : "suggested",
                          shot: s,
                          label: `Shot ${s.index} (${isConfirmed ? "Confirmed" : "Suggested"})`,
                        });
                      }
                    }
                  }

                  if (!intervals.length) return null;

                  const isCurrentActive = intervals.some(
                    (item) => time >= item.start && time <= item.end
                  );

                  const avatarImg = getCastAvatarSrc(member);

                  return (
                    <div key={`cast-lane-${member.id}`} className={`cast-swimlane-row ${isCurrentActive ? "active" : ""}`}>
                      <div className="cast-swimlane-header-pill" title={`${member.name}: ${intervals.length} appearances`}>
                        <div className="cast-swimlane-avatar">
                          {avatarImg ? (
                            <img src={avatarImg} alt="" className="cast-avatar-img" />
                          ) : (
                            <span className="cast-avatar-init">
                              {member.name.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <span className="cast-swimlane-name">{member.name}</span>
                        <span className="cast-swimlane-count mono">{intervals.length}</span>
                      </div>

                      <div className="cast-swimlane-track">
                        {intervals.map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            className={`cast-presence-bar ${item.type}`}
                            style={{
                              left: item.start * scale,
                              width: Math.max(6, (item.end - item.start) * scale),
                            }}
                            title={`${member.name}: ${item.label} (${(item.end - item.start).toFixed(2)}s)`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onShot(item.shot);
                              onSeek(item.start);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* River 7: Soundtrack & Sonic Rivers (when enabled) */}
          {!isStudio && layers.audio && (
            <div
              className={`audio-track sonic-river ${audioMode === "dme" && project.dmeWaveforms ? "dme-mode" : audioMode === "loudness" && activeLoudness ? "loudness-mode" : ""}`}
              aria-label="Soundtrack and sonic rivers"
            >
              <div className="river-sticky-badge sonic-badge">
                <span className="river-badge-icon">🔊</span>
                <span className="river-badge-title">SOUND</span>
                <div className="sonic-stream-modes" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={`sonic-stream-btn ${audioMode === "mixed" ? "active" : ""}`}
                    onClick={() => setAudioMode("mixed")}
                  >
                    Mixed
                  </button>
                  {project.dmeWaveforms && (
                    <button
                      type="button"
                      className={`sonic-stream-btn ${audioMode === "dme" ? "active" : ""}`}
                      onClick={() => setAudioMode("dme")}
                    >
                      DME 3-Stem
                    </button>
                  )}
                  {activeLoudness && (
                    <button
                      type="button"
                      className={`sonic-stream-btn ${audioMode === "loudness" ? "active" : ""}`}
                      onClick={() => setAudioMode("loudness")}
                    >
                      LUFS
                    </button>
                  )}
                </div>
              </div>

              {audioMode === "loudness" && activeLoudness ? (
                <div className="loudness-track-lane" aria-hidden="true">
                  <div
                    className="loudness-target-guide"
                    style={{ bottom: `${lufsToNormalized(-23, -60, 0) * 100}%` }}
                    title="EBU R128 -23 LUFS Target"
                  />
                  <div className="waveform loudness-waveform">
                    {activeLoudness.momentary.map((level, i) => {
                      const norm = lufsToNormalized(level, -60, 0);
                      const sLevel = activeLoudness.shortTerm[i] ?? level;
                      const levelClass =
                        level >= -12
                          ? "level-peak"
                          : level >= -18
                            ? "level-loud"
                            : level >= -26
                              ? "level-target"
                              : "level-quiet";
                      return (
                        <i
                          key={i}
                          className={levelClass}
                          style={{ height: `${Math.max(4, norm * 100)}%` }}
                          title={`Momentary: ${level.toFixed(1)} LUFS · Sustained: ${sLevel.toFixed(1)} LUFS`}
                        />
                      );
                    })}
                  </div>
                  {activeLoudness.transitions.map((t, index) => (
                    <button
                      key={`trans-${t.time}-${index}`}
                      type="button"
                      className={`loudness-timeline-marker ${t.type}`}
                      style={{ left: t.time * scale }}
                      title={`${t.type === "quiet-to-loud" ? "Quiet-to-Loud Jump" : "Loud-to-Quiet Drop"}: ${t.deltaLufs >= 0 ? "+" : ""}${t.deltaLufs.toFixed(1)} LUFS at ${formatTimecode(t.time, project.frameRate, project.dropFrame)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSeek(t.time);
                      }}
                    >
                      <span>{t.type === "quiet-to-loud" ? "▲" : "▼"}</span>
                    </button>
                  ))}
                </div>
              ) : audioMode === "dme" && project.dmeWaveforms ? (
                <div className="dme-stem-lanes" aria-hidden="true">
                  <div className="dme-lane dialogue" title="DX: Dialogue">
                    <span className="dme-lane-badge dx">DX</span>
                    <div className="waveform dme-waveform">
                      {project.dmeWaveforms.dialogue.map((level, i) => (
                        <i key={i} style={{ height: `${Math.max(4, level * 100)}%` }} />
                      ))}
                    </div>
                  </div>
                  <div className="dme-lane music" title="MX: Music">
                    <span className="dme-lane-badge mx">MX</span>
                    <div className="waveform dme-waveform">
                      {project.dmeWaveforms.music.map((level, i) => (
                        <i key={i} style={{ height: `${Math.max(4, level * 100)}%` }} />
                      ))}
                    </div>
                  </div>
                  <div className="dme-lane effects" title="FX: Effects">
                    <span className="dme-lane-badge fx">FX</span>
                    <div className="waveform dme-waveform">
                      {project.dmeWaveforms.effects.map((level, i) => (
                        <i key={i} style={{ height: `${Math.max(4, level * 100)}%` }} />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="waveform" aria-hidden="true">
                  {waveform.length ? (
                    waveform.map((level, index) => (
                      <i key={index} style={{ height: `${Math.max(4, level * 100)}%` }} />
                    ))
                  ) : (
                    <span>Relink a film to view its local waveform</span>
                  )}
                </div>
              )}

              {visibleSoundSpans.map((span) => (
                <button
                  type="button"
                  key={span.id}
                  className={`sound-span ${span.kind.toLowerCase()}`}
                  title={`${span.kind}: ${span.notes || "No observation"}`}
                  style={{
                    left: span.startSeconds * scale,
                    width: Math.max(2, (span.endSeconds - span.startSeconds) * scale),
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRangeChange({ start: span.startSeconds, end: span.endSeconds });
                  }}
                >
                  {span.kind}
                </button>
              ))}
              {speechAnalysis && (
                <div
                  className="speech-overlay"
                  aria-label="Speech and pause overlay"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const target = ((event.clientX - rect.left) / rect.width) * duration;
                    const item = [...speechAnalysis.regions, ...pauseRegions(speechAnalysis.regions)].find((region) => target >= region.startSeconds && target <= region.endSeconds);
                    if (item) {
                      event.stopPropagation();
                      onSeek(item.startSeconds);
                    }
                  }}
                >
                  {speechOverlay.map((region, index) => (
                    <i
                      key={`${region.kind}-${index}-${region.startSeconds}`}
                      className={region.kind}
                      style={{
                        left: region.startSeconds * scale,
                        width: Math.max(2, (region.endSeconds - region.startSeconds) * scale),
                      }}
                      title={`${region.kind === "speech" ? "Speech" : "Pause"}: ${formatTimecode(region.startSeconds, project.frameRate, project.dropFrame)}`}
                    />
                  ))}
                </div>
              )}
              {speechAnalysis && (
                <div className="speech-cut-markers" aria-label="Cut speech classification">
                  {speechCutOverlay.map((cut, index) => (
                    <button
                      type="button"
                      key={`${cut.time}-${index}`}
                      className={cut.kind.replaceAll(" ", "-")}
                      style={{ left: cut.time * scale }}
                      title={`Cut ${cut.kind}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSeek(cut.time);
                      }}
                    />
                  ))}
                </div>
              )}

              <div className="audio-caption-bar">
                <div className="audio-caption">
                  {audioMode === "loudness" && activeLoudness ? (
                    <>
                      EBU R128{" "}
                      <span>
                        LOUDNESS · I: {activeLoudness.integratedLoudness.toFixed(1)} LUFS · LRA:{" "}
                        {activeLoudness.loudnessRange.toFixed(1)} LU · TPK:{" "}
                        {activeLoudness.truePeak.toFixed(1)} dBTP
                      </span>
                    </>
                  ) : audioMode === "dme" && project.dmeWaveforms ? (
                    <>
                      DME <span>STEM SEPARATION (DX · MX · FX)</span>
                    </>
                  ) : (
                    <>
                      A1 <span>MIXED SOUNDTRACK</span>
                    </>
                  )}
                </div>

                <div className="audio-actions" onClick={(e) => e.stopPropagation()}>
                  {project.dmeWaveforms || activeLoudness ? (
                    <div className="dme-mode-pills">
                      <button
                        type="button"
                        className={`dme-pill-btn ${audioMode === "mixed" ? "active" : ""}`}
                        onClick={() => setAudioMode("mixed")}
                      >
                        Mixed
                      </button>
                      {project.dmeWaveforms && (
                        <button
                          type="button"
                          className={`dme-pill-btn ${audioMode === "dme" ? "active" : ""}`}
                          onClick={() => setAudioMode("dme")}
                        >
                          DME (3-Stem)
                        </button>
                      )}
                      {activeLoudness && (
                        <button
                          type="button"
                          className={`dme-pill-btn ${audioMode === "loudness" ? "active" : ""}`}
                          onClick={() => setAudioMode("loudness")}
                        >
                          Loudness (LUFS)
                        </button>
                      )}
                      {onSeparateDme && (
                        <button
                          type="button"
                          className="dme-rescan-btn"
                          title="Re-run DME separation"
                          disabled={!hasVideo}
                          onClick={isDmeSeparating ? onCancelDme : onSeparateDme}
                        >
                          {isDmeSeparating ? "Cancel separation" : "↻ Re-scan"}
                        </button>
                      )}
                    </div>
                  ) : onSeparateDme ? (
                    <button
                      type="button"
                      className="btn-dme-test"
                      onClick={isDmeSeparating ? onCancelDme : onSeparateDme}
                      disabled={!hasVideo}
                      title={!hasVideo ? "Connect a video file first to test DME separation" : "Separate Dialogue, Music, and Effects locally"}
                    >
                      {isDmeSeparating ? (
                        <>
                          <span className="dme-spinner" />
                          <span>{`${dmeSeparationStatus || "Separating DME..."} · Cancel`}</span>
                        </>
                      ) : (
                        <>🧪 Test DME Separation</>
                      )}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </>
      )}

          {/* Selected Time Range overlay */}
          {visibleRange && visibleRange.start !== undefined && visibleRange.end !== undefined && visibleRange.end > visibleRange.start && (
            <div
              className={`map-range ${isStudio ? "studio-range-overlay" : ""}`}
              style={{
                left: visibleRange.start * scale,
                width: Math.max(2, (visibleRange.end - visibleRange.start) * scale),
              }}
            >
              {isStudio && rangeInfo && (
                <div className="studio-range-card" onClick={(e) => e.stopPropagation()}>
                  <div className="studio-range-card-main">
                    <span className="studio-range-title">{rangeInfo.title}</span>
                    <span className="studio-range-meta">
                      {formatTimecode(rangeInfo.start, project.frameRate, project.dropFrame).slice(3, 8)} - {formatTimecode(rangeInfo.end, project.frameRate, project.dropFrame).slice(3, 8)} · {rangeInfo.shotCount} shots · {rangeInfo.descriptor}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="studio-range-compare-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (visibleRange.start !== undefined && visibleRange.end !== undefined) {
                        onRangeChange({ start: visibleRange.start, end: visibleRange.end });
                      }
                    }}
                    title="Compare sequence rhythm"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>
                    <span>Compare</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {!project.shots.length && (
            <div className="map-empty">
              Import an EDL or analyze film to reveal its structural map.
            </div>
          )}

          {/* Playhead */}
          <div
            className="playhead"
            role="slider"
            tabIndex={0}
            aria-label="Timeline playhead"
            aria-valuemin={0}
            aria-valuemax={project.duration}
            aria-valuenow={Math.min(time, project.duration)}
            aria-valuetext={formatTimecode(
              time,
              project.frameRate,
              project.dropFrame,
            )}
            style={{ left: Math.min(time, duration) * scale }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              if (e.button !== 0 || e.shiftKey) return;
              e.preventDefault();
              e.stopPropagation();
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              e.currentTarget.focus();
              scrubAt(e.clientX);
            }}
            onPointerMove={(e) => {
              if (dragging.current) {
                e.preventDefault();
                scrubAt(e.clientX);
              }
            }}
            onPointerUp={(e) => {
              if (!dragging.current) return;
              scrubAt(e.clientX);
              dragging.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
            onLostPointerCapture={() => {
              dragging.current = false;
            }}
            onKeyDown={(e) => {
              const delta = 1 / actualRate(project.frameRate);
              const target =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? project.duration
                    : e.key === "ArrowLeft"
                      ? time - delta
                      : e.key === "ArrowRight"
                        ? time + delta
                        : null;
              if (target !== null) {
                e.preventDefault();
                e.stopPropagation();
                onScrub(Math.max(0, Math.min(project.duration, target)));
              }
            }}
          >
            <i />
          </div>
        </div>
      </div>
    </div>

      {/* Whole-Film Overview Minimap (Prominent in Map Focus) */}
      {!isStudio && showMinimap && project.shots.length > 0 && (
        <div className={`minimap-section ${squintMode ? "minimap-squint-active" : ""}`}>
          <div className="minimap-header">
            <span className="eyebrow">FILM OVERVIEW (ENTIRE TIMELINE)</span>
            <span className="mono muted">
              00:00:00:00 → {formatTimecode(project.duration, project.frameRate, project.dropFrame)}
            </span>
          </div>
          <div
            className={`minimap-container ${isMinimapDragging ? "dragging" : ""}`}
            ref={minimapRef}
            onPointerDown={handleMinimapPointerDown}
            onPointerMove={handleMinimapPointerMove}
            onPointerUp={handleMinimapPointerUp}
            onPointerCancel={handleMinimapPointerUp}
            onLostPointerCapture={handleMinimapPointerUp}
            title="Click or drag to scroll timeline"
          >
            <div className="minimap-tracks-wrap">
              {project.shots.map((s) => {
                const color = (colorMappings[project.colorMode] || colorMappings.shotSize).color(s);
                const lumaVal = s.colorProfile?.luminance ?? 0.5;
                const barColor = squintMode
                  ? `rgb(${Math.round(255 * lumaVal)}, ${Math.round(255 * lumaVal)}, ${Math.round(255 * lumaVal)})`
                  : color;
                return (
                  <div
                    key={`mini-${s.id}`}
                    className={`minimap-shot-bar ${selected === s.id ? "selected" : ""}`}
                    style={{
                      left: `${(s.startSeconds / duration) * 100}%`,
                      width: `${Math.max(0.4, (s.duration / duration) * 100)}%`,
                      backgroundColor: barColor,
                    }}
                  />
                );
              })}
              {/* Active Playhead on minimap */}
              <div
                className="minimap-playhead-line"
                style={{ left: `${Math.min(100, (time / duration) * 100)}%` }}
              />
              {/* Viewport Box (highlight of current zoom / scroll window) */}
              <div
                className={`minimap-viewport-box ${isMinimapDragging ? "dragging" : ""}`}
                style={{
                  left: `${(scrollLeft / canvasWidth) * 100}%`,
                  width: `${Math.min(100, (width / canvasWidth) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Timeline Footer: Zoom Controls & Legend (non-Studio only; Studio has right-aligned navigation in toolbar) */}
      {!isStudio && (
        <div className="timeline-footer">
          <div className="timeline-zoom-controls">
            <button
              type="button"
              className="zoom-btn"
              onClick={() => changeZoom(1 / 1.5)}
              aria-label="Zoom out"
              title="Zoom out (Q)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <line x1="8" y1="11" x2="14" y2="11"></line>
              </svg>
            </button>
            <input
              type="range"
              className="zoom-slider"
              min="0"
              max="6"
              step="0.05"
              value={Math.log2(zoom)}
              onChange={(e) => setZoom(Math.pow(2, Number(e.target.value)))}
              aria-label="Timeline zoom slider"
              title={`Timeline Zoom: ${zoom.toFixed(1)}×`}
            />
            <button
              type="button"
              className="zoom-btn"
              onClick={() => changeZoom(1.5)}
              aria-label="Zoom in"
              title="Zoom in (W)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <line x1="11" y1="8" x2="11" y2="14"></line>
                <line x1="8" y1="11" x2="14" y2="11"></line>
              </svg>
            </button>
            <span className="mono zoom-label">{zoom.toFixed(1)}×</span>
            <div className="zoom-shortcuts" title="Keyboard shortcuts: Q to zoom out, W to zoom in, F to fit">
              <span className="shortcut-pill"><kbd>Q</kbd> Out</span>
              <span className="shortcut-pill"><kbd>W</kbd> In</span>
              <span className="shortcut-pill"><kbd>F</kbd> Fit</span>
            </div>
            <button
              type="button"
              className="zoom-fit-btn"
              onClick={() => {
                setZoom(1);
                if (viewport.current) viewport.current.scrollLeft = 0;
              }}
              aria-label="Fit film"
              title="Fit timeline to view full film (F)"
            >
              Fit
            </button>
          </div>

          <div className="legend">
            <span className="legend-hint">
              Click shot to inspect · Drag cut to roll edit · C to split shot · S to snap · Shift-drag for sequence
            </span>
            {Object.entries(sizeColors)
              .filter(([name]) =>
                [
                  "Extreme wide",
                  "Wide",
                  "Full",
                  "American",
                  "Medium",
                  "Medium close-up",
                  "Close",
                  "Extreme close",
                ].includes(name),
              )
              .map(([name, color]) => (
                <span key={name}>
                  <i style={{ background: color }} />
                  {name}
                </span>
              ))}
          </div>
        </div>
      )}
    </section>
  );
});
