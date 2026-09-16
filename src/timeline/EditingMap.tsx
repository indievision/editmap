import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Project, Shot, SpeechAnalysis, LoudnessAnalysis } from "../models/project";
import { classifyCut, pauseRegions } from "../analysis/speech";
import { lufsToNormalized } from "../analysis/loudness";
import { colorMappings, sizeColors } from "../analysis/colors";
import { actualRate, formatTimecode } from "../utils/timecode";
import { reviewReasonLabel, reviewReasons, type ReviewFilter } from "../analysis/review";
import { getSnapTime, quantizeToFrame } from "./timelineOps";
import { cutTimes, pacingCurve, pacingAt, computeCutShockData } from "../analysis/pacing";
import { framingRank } from "../analysis/framing";
import { getSquintFilter } from "../utils/squint";

export interface MapLayerState {
  framing: boolean;
  pacing: boolean;
  framingArc: boolean;
  motion: boolean;
  characters: boolean;
  audio: boolean;
  scenes: boolean;
}

export default memo(function EditingMap({
  project,
  thumbnails,
  time,
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
}: {
  project: Project;
  thumbnails: Record<string, string>;
  time: number;
  selected?: string;
  active?: string;
  onSeek: (t: number) => void;
  onScrub: (t: number) => void;
  onShot: (s: Shot) => void;
  onPlayShot: (s: Shot) => void;
  selectedCut?: string;
  onCut: (incoming: Shot) => void;
  range?: { start: number; end: number };
  onRangeChange: (range?: { start: number; end: number }) => void;
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
  workspaceMode?: "studio" | "map" | "review";
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
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const minimapDragging = useRef(false);
  const rangeAnchor = useRef<number | null>(null);
  const suppressMapClick = useRef(false);
  const [dragRange, setDragRange] = useState<{ start: number; end: number }>();
  const activeLoudness = loudnessAnalysis || project.loudnessAnalysis;
  const [audioMode, setAudioMode] = useState<"mixed" | "dme" | "loudness">(
    project.dmeWaveforms ? "dme" : activeLoudness ? "loudness" : "mixed"
  );

  // Layers visibility state
  const [layers, setLayers] = useState<MapLayerState>({
    framing: true,
    pacing: true,
    framingArc: true,
    motion: true,
    characters: true,
    audio: true,
    scenes: true,
  });

  const toggleLayer = (layer: keyof MapLayerState) => {
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
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
  const [snappedGuideTime, setSnappedGuideTime] = useState<number | null>(null);

  const [width, setWidth] = useState(1000),
    [zoom, setZoom] = useState(1),
    [scrollLeft, setScrollLeft] = useState(0);
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
      if (snappedGuideTime !== null) setSnappedGuideTime(null);
      return targetTime;
    }
    const thresholdSec = 12 / scale;
    const snap = getSnapTime(targetTime, snapPoints, thresholdSec);
    if (snap.isSnapped && snap.snapTarget !== undefined) {
      if (snappedGuideTime !== snap.snapTarget) {
        setSnappedGuideTime(snap.snapTarget);
      }
      return snap.snappedTime;
    }
    if (snappedGuideTime !== null) setSnappedGuideTime(null);
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
  const motionReadout = currentMotion
    ? `${currentMotion.totalKineticEnergy}% Kinetic (${currentShot?.cameraMovement || currentMotion.cameraMovement || "Dynamic"})`
    : "Ready to Scan";

  const cuts = useMemo(() => cutTimes(project.shots), [project.shots]);
  const cutShockData = useMemo(() => computeCutShockData(project.shots), [project.shots]);
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

  const pacingSvgPath = useMemo(() => {
    if (!pacingPoints.length || duration <= 0) return "";
    return pacingPoints
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"} ${(p.time * scale).toFixed(1)},${(44 - (p.rate / maxPacingRate) * 36).toFixed(1)}`
      )
      .join(" ");
  }, [pacingPoints, duration, scale, maxPacingRate]);

  const pacingSvgArea = useMemo(() => {
    if (!pacingSvgPath || duration <= 0) return "";
    return `${pacingSvgPath} L ${(duration * scale).toFixed(1)},48 L 0,48 Z`;
  }, [pacingSvgPath, duration, scale]);

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

  const allRiversOn = layers.pacing && layers.framingArc && layers.motion && layers.characters && layers.audio && layers.scenes;

  const toggleAllRivers = () => {
    const target = !allRiversOn;
    setLayers({
      framing: true,
      pacing: target,
      framingArc: target,
      motion: target,
      characters: target,
      audio: target,
      scenes: target,
    });
  };

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ob = new ResizeObserver(() => setWidth(el.clientWidth));
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  useEffect(() => {
    if (dragging.current) return;
    const el = viewport.current;
    if (!el) return;
    const x = time * scale;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 16)
      el.scrollLeft = Math.max(0, x - el.clientWidth * 0.25);
  }, [time, scale]);

  const changeZoom = (factor: number) =>
    setZoom((z) => Math.max(1, Math.min(128, z * factor)));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]"
        )
      ) {
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
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        onToggleSnap?.();
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
  }, [time, selectedCut, onSplitShot, onDeleteCut, onToggleSnap, onNudgeCut]);

  const pointAt = (clientX: number) =>
    Math.max(0, Math.min(project.duration, (clientX - canvas.current!.getBoundingClientRect().left) / scale));
  const visibleRange = dragRange ?? range;

  // Minimap interactions
  const handleMinimapInteraction = (clientX: number) => {
    const el = minimapRef.current;
    const vp = viewport.current;
    if (!el || !vp) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetCenter = ratio * canvasWidth;
    vp.scrollLeft = Math.max(0, Math.min(canvasWidth - width, targetCenter - width / 2));
  };

  return (
    <section className={`map panel mode-${workspaceMode}`}>
      <div className="section-head">
        <div className="map-title-group">
          <span className="eyebrow">EDITING MAP</span>
          <span className="muted">
            {project.shots.length} shots · duration-scaled
          </span>
        </div>

        {/* Toolbar: Color Mode & Layer Toggles & Zoom/Fit */}
        <div className="tools">
          {/* Rivers of Data Visibility Controls */}
          {(showLayersControl || workspaceMode === "map") && (
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

          {/* Color & Squint Mode Toggle */}
          <div className="view-toggle-group" role="group" aria-label="Timeline Color Mode">
            <button
              type="button"
              className={project.colorMode !== "palette" && !squintMode ? "active" : ""}
              onClick={() => {
                if (squintMode) onToggleSquint?.(false);
                onColorModeChange?.("shotSize");
              }}
              title="Color timeline blocks by shot framing size"
            >
              Framing Colors
            </button>
            <button
              type="button"
              className={project.colorMode === "palette" && !squintMode ? "active" : ""}
              onClick={() => {
                if (squintMode) onToggleSquint?.(false);
                onColorModeChange?.("palette");
              }}
              title="Color timeline blocks by extracted film palette"
            >
              Footage Palette
            </button>
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
        </div>
      </div>

      {tagBar && <div className="map-top-bar">{tagBar}</div>}

      {/* Main Scrollable Canvas */}
      <div
        className="map-scroll"
        ref={viewport}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
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
            setSnappedGuideTime(null);
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
              if (snappedGuideTime !== null) setSnappedGuideTime(null);
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              dragging.current = false;
              if (snappedGuideTime !== null) setSnappedGuideTime(null);
            }}
          >
            {rulerTicks.map(({ i, t, x }) => (
              <span key={i} style={{ left: x }}>
                {formatTimecode(t, project.frameRate, project.dropFrame)}
              </span>
            ))}
          </div>

          {/* River 1: Scenes & Dramatic Arc River (when enabled) */}
          {layers.scenes && visibleSequences.length > 0 && (
            <div className="lane-track scenes-river" aria-label="Dramatic scenes & sequences river">
              <div className="river-sticky-badge scenes-badge">
                <span className="river-badge-icon">🎬</span>
                <span className="river-badge-title">SCENES</span>
                <span className="river-badge-detail mono">{visibleSequences.length}</span>
              </div>
              {visibleSequences.map((scene, idx) => (
                <button
                  type="button"
                  key={scene.id || `scene-${idx}`}
                  className="scene-marker"
                  title={`${scene.name}: ${(scene.endSeconds - scene.startSeconds).toFixed(1)}s`}
                  style={{
                    left: scene.startSeconds * scale,
                    width: Math.max(2, (scene.endSeconds - scene.startSeconds) * scale),
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRangeChange({ start: scene.startSeconds, end: scene.endSeconds });
                  }}
                >
                  <span className="scene-marker-text">{scene.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* River 2: Film Shot Track (V1) */}
          <div className="shot-track" aria-label="Video shot track">
            <div className="river-sticky-badge v1-badge">
              <span className="river-badge-icon">🎞️</span>
              <span className="river-badge-title">V1 FILM</span>
              <span className="river-badge-detail mono">{project.shots.length} shots</span>
            </div>
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
              return (
                <button
                  type="button"
                  key={s.id}
                  title={`${reviewReasonLabel(reviewReasons(s))} · Shot ${s.index} · ${s.shotSize} · ${effDur.toFixed(3)}s`}
                  aria-label={`Shot ${s.index}${reviewMatch ? "" : ", outside active review filter"}`}
                  className={`shot ${selected === s.id ? "selected" : ""} ${active === s.id ? "active" : ""} ${highlightedShotIds?.includes(s.id) ? "character-highlight" : ""} ${reviewMatch ? "review-match" : "review-dimmed"} ${squintMode ? "timeline-squint-shot" : ""}`}
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
                  {w > 25 && (
                    <strong>{String(s.index).padStart(3, "0")}</strong>
                  )}
                  {w > 58 && (
                    <span>{s.shotSize === "Unknown" ? "—" : s.shotSize}</span>
                  )}
                  {w > 90 && <small>{effDur.toFixed(2)}s</small>}
                </button>
              );
            })}
            {visibleCuts.map(({ incoming, outgoing }) => {
              const isBeingDragged = activeCutDrag?.incomingId === incoming.id;
              const cutPos = isBeingDragged
                ? activeCutDrag.currentTime * scale
                : incoming.startSeconds * scale;
              return (
                <div
                  key={`cut-${incoming.id}`}
                  className={`cut-boundary ${selectedCut === incoming.id ? "selected" : ""} ${isBeingDragged ? "dragging" : ""}`}
                  style={{ left: cutPos }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
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
                      onCut(incoming);
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
                      onCut(incoming);
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
                    <span className="cut-bracket left">]</span>
                    <span className="cut-indicator-line" />
                    <span className="cut-bracket right">[</span>
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
          {layers.pacing && project.shots.length > 0 && (
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
                  <path
                    d={pacingSvgPath}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                )}
                {/* Sensory Shock spike indicators */}
                {cutShockData.filter((c) => c.shockScore >= 45).map((c, idx) => (
                  <g key={`shock-marker-${idx}`} transform={`translate(${c.time * scale}, 0)`}>
                    <line y1="10" y2="48" stroke="rgba(239, 68, 68, 0.7)" strokeWidth="1.5" strokeDasharray="2,2" />
                    <circle cx="0" cy="12" r="3" fill="#ef4444" />
                  </g>
                ))}
                {/* Playhead indicator dot */}
                <circle
                  cx={time * scale}
                  cy={44 - (currentPacing.rate / maxPacingRate) * 36}
                  r="4"
                  fill="#ffffff"
                  stroke="#f59e0b"
                  strokeWidth="2"
                />
              </svg>
            </div>
          )}

          {/* River 4: Framing Scale Elevation River (when enabled) */}
          {layers.framingArc && project.shots.length > 0 && (
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
          {layers.motion && project.shots.length > 0 && (
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
                  const camEnergy = profile?.cameraEnergy ?? Math.round(totalEnergy * 0.45);
                  const subEnergy = profile?.subjectEnergy ?? Math.round(totalEnergy * 0.55);
                  const barH = Math.max(6, (totalEnergy / 100) * 36);

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
                      title={`Shot ${s.index}: ${hasProfile ? `${s.cameraMovement || "Motion"}: ${totalEnergy}% (Cam: ${camEnergy}%, Sub: ${subEnergy}%)` : `Est. dynamic baseline: ~${totalEnergy}%`}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onShot(s);
                        onSeek(s.startSeconds);
                      }}
                    >
                      <div className="motion-layer subject" style={{ height: `${(subEnergy / (totalEnergy || 1)) * 100}%` }} />
                      <div className="motion-layer camera" style={{ height: `${(camEnergy / (totalEnergy || 1)) * 100}%` }} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* River 6: Cast & Character Presence River (when enabled) */}
          {layers.characters && project.cast && project.cast.length > 0 && (
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
                        intervals.push({
                          id: `${s.id}-${member.id}-${mi.startSeconds}`,
                          start: mi.startSeconds,
                          end: mi.endSeconds,
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

                  const avatarImg = member.references?.[0]?.image;

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
          {layers.audio && (
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

          {/* Selected Time Range overlay */}
          {visibleRange && (
            <div
              className="map-range"
              style={{
                left: visibleRange.start * scale,
                width: Math.max(2, (visibleRange.end - visibleRange.start) * scale),
              }}
            />
          )}

          {!project.shots.length && (
            <div className="map-empty">
              Import an EDL or analyze film to reveal its structural map.
            </div>
          )}

          {/* Magnetic Snap Guide Line */}
          {snappedGuideTime !== null && (
            <div
              className="snap-guide-line"
              style={{ left: snappedGuideTime * scale }}
              title={`Snapped to cut at ${formatTimecode(snappedGuideTime, project.frameRate, project.dropFrame)}`}
            />
          )}

          {/* Playhead */}
          <div
            className={`playhead ${snappedGuideTime !== null ? "snapped" : ""}`}
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
              if (snappedGuideTime !== null) setSnappedGuideTime(null);
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              dragging.current = false;
              if (snappedGuideTime !== null) setSnappedGuideTime(null);
            }}
            onLostPointerCapture={() => {
              dragging.current = false;
              if (snappedGuideTime !== null) setSnappedGuideTime(null);
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

      {/* Whole-Film Overview Minimap (Prominent in Map Focus and Studio) */}
      {showMinimap && project.shots.length > 0 && (
        <div className={`minimap-section ${squintMode ? "minimap-squint-active" : ""}`}>
          <div className="minimap-header">
            <span className="eyebrow">FILM OVERVIEW (ENTIRE TIMELINE)</span>
            <span className="mono muted">
              00:00:00:00 → {formatTimecode(project.duration, project.frameRate, project.dropFrame)}
            </span>
          </div>
          <div
            className="minimap-container"
            ref={minimapRef}
            onClick={(e) => handleMinimapInteraction(e.clientX)}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              minimapDragging.current = true;
              handleMinimapInteraction(e.clientX);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (minimapDragging.current) handleMinimapInteraction(e.clientX);
            }}
            onPointerUp={(e) => {
              minimapDragging.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
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
                className="minimap-viewport-box"
                style={{
                  left: `${(scrollLeft / canvasWidth) * 100}%`,
                  width: `${Math.min(100, (width / canvasWidth) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Timeline Footer: Zoom Controls & Legend */}
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
                "Wide",
                "Full",
                "Medium",
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
    </section>
  );
});
