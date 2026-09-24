import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  Project,
  Shot,
  SpeechAnalysis,
  LoudnessAnalysis,
  CastMember,
} from "../models/project";
import { cutTimes, pacingCurve } from "../analysis/pacing";
import { framingRank } from "../analysis/framing";
import { actualRate } from "../utils/timecode";
import type { MapLayerState } from "./EditingMap";

export interface FullscreenMapVisualizationProps {
  project: Project;
  time: number;
  playing: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onScrub: (time: number) => void;
  selected?: string;
  onSelectShot: (shot: Shot) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  scrollLeft: number;
  onScrollChange: (scrollLeft: number) => void;
  layers?: MapLayerState;
  waveform?: number[];
  speechAnalysis?: SpeechAnalysis;
  loudnessAnalysis?: LoudnessAnalysis;
  onClose: () => void;
}

const SEQUENCE_PALETTE = [
  "rgba(71, 85, 105, 0.45)",
  "rgba(88, 28, 135, 0.38)",
  "rgba(22, 101, 52, 0.38)",
  "rgba(120, 53, 15, 0.4)",
  "rgba(30, 58, 138, 0.42)",
];

const CAST_PALETTE = [
  "#f59e0b",
  "#38bdf8",
  "#c084fc",
  "#fb7185",
  "#34d399",
  "#f97316",
];

/**
 * Generate a clean symmetrical audio waveform SVG path (undulating above & below centerline)
 */
export function generateSymmetricalWaveformPath(
  levels: number[],
  duration: number,
  scale: number,
  height: number,
  boostQuiet: boolean = false,
): string {
  if (!levels.length || duration <= 0 || scale <= 0) return "";
  const count = levels.length;
  const centerY = height / 2;
  const maxAmp = Math.max(2, (height - 4) / 2);
  const totalWidth = duration * scale;

  let top = "";
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1)) * totalWidth;
    let val = Math.max(0.04, Math.min(1, levels[i]));
    if (boostQuiet && val > 0) {
      val = Math.pow(val, 0.58);
    }
    val = Math.max(0.04, Math.min(1, val));
    const y = centerY - val * maxAmp;
    top += `${i === 0 ? "M" : " L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }

  let bottom = "";
  for (let i = count - 1; i >= 0; i--) {
    const x = (i / (count - 1)) * totalWidth;
    let val = Math.max(0.04, Math.min(1, levels[i]));
    if (boostQuiet && val > 0) {
      val = Math.pow(val, 0.58);
    }
    val = Math.max(0.04, Math.min(1, val));
    const y = centerY + val * maxAmp;
    bottom += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }

  return `${top}${bottom} Z`;
}

/**
 * Generate pale cyan stepped line for framing elevation across shot boundaries
 */
export function generateSteppedFramingPath(
  shots: Shot[],
  scale: number,
  height: number,
): string {
  if (!shots.length || scale <= 0) return "";
  const validShots = shots.filter((s) => framingRank(s) !== null);
  if (!validShots.length) return "";

  const baseY = height - 6;
  const rankRange = height - 12;

  let d = "";
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const rank = framingRank(s) ?? 0;
    const y = baseY - (rank / 8) * rankRange;
    const startX = s.startSeconds * scale;
    const endX = s.endSeconds * scale;

    if (i === 0) {
      d += `M ${startX.toFixed(1)} ${y.toFixed(1)} H ${endX.toFixed(1)}`;
    } else {
      d += ` V ${y.toFixed(1)} H ${endX.toFixed(1)}`;
    }
  }
  return d;
}

/**
 * Generate smooth gold pacing path and gradient area
 */
export function generatePacingPathAndArea(
  shots: Shot[],
  duration: number,
  scale: number,
  height: number,
): { path: string; area: string } {
  if (!shots.length || duration <= 0 || scale <= 0) {
    return { path: "", area: "" };
  }
  const cuts = cutTimes(shots);
  const points = pacingCurve(cuts, duration, 30);
  if (!points.length) return { path: "", area: "" };

  const maxRate = Math.max(
    12,
    Math.ceil(Math.max(...points.map((p) => p.rate), 0) / 5) * 5,
  );
  const baselineY = height - 4;
  const amplitude = height - 10;

  const path = points
    .map((p, i) => {
      const x = p.time * scale;
      const y = baselineY - (p.rate / maxRate) * amplitude;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const area = `${path} L ${(duration * scale).toFixed(1)} ${baselineY.toFixed(1)} L 0 ${baselineY.toFixed(1)} Z`;
  return { path, area };
}

/**
 * Generate smooth unified kinetic motion flow curve and gradient area across shots
 */
export function generateMotionFlowPathAndArea(
  shots: Shot[],
  duration: number,
  scale: number,
  height: number,
): { path: string; area: string; hasData: boolean } {
  if (!shots.length || duration <= 0 || scale <= 0) {
    return { path: "", area: "", hasData: false };
  }
  const hasMotion = shots.some(
    (s) => s.motionProfile && s.motionProfile.totalKineticEnergy !== undefined,
  );
  if (!hasMotion) {
    return { path: "", area: "", hasData: false };
  }

  const baselineY = height - 4;
  const amplitude = height - 12;

  interface Point {
    x: number;
    y: number;
  }
  const points: Point[] = [];

  const firstShot = shots[0];
  const firstEnergy = firstShot.motionProfile?.totalKineticEnergy ?? 0;
  const firstY = baselineY - (firstEnergy / 100) * amplitude;
  points.push({ x: 0, y: firstY });

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const energy = s.motionProfile?.totalKineticEnergy ?? 0;
    const y = baselineY - (energy / 100) * amplitude;
    const startX = s.startSeconds * scale;
    const midX = (s.startSeconds + s.duration * 0.5) * scale;
    const endX = s.endSeconds * scale;

    points.push({ x: startX, y });
    points.push({ x: midX, y });
    points.push({ x: endX, y });
  }

  const lastShot = shots[shots.length - 1];
  const lastEnergy = lastShot.motionProfile?.totalKineticEnergy ?? 0;
  const lastY = baselineY - (lastEnergy / 100) * amplitude;
  const finalX = duration * scale;
  points.push({ x: finalX, y: lastY });

  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  const area = `${path} L ${finalX.toFixed(1)} ${baselineY.toFixed(1)} L 0 ${baselineY.toFixed(1)} Z`;
  return { path, area, hasData: true };
}

export default memo(function FullscreenMapVisualization({
  project,
  time,
  playing,
  onTogglePlay,
  onSeek,
  onScrub,
  selected,
  onSelectShot,
  zoom,
  onZoomChange,
  scrollLeft,
  onScrollChange,
  layers = {
    framing: true,
    pacing: true,
    framingArc: true,
    motion: true,
    characters: true,
    audio: true,
    scenes: true,
  },
  waveform = [],
  speechAnalysis,
  loudnessAnalysis,
  onClose,
}: FullscreenMapVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const isMinimapDragging = useRef(false);

  // Minimal exit affordance: fades in on pointer move, then fades out
  const [showExit, setShowExit] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetExitTimer = useCallback(() => {
    setShowExit(true);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    exitTimerRef.current = setTimeout(() => {
      setShowExit(false);
    }, 2500);
  }, []);

  // Request browser fullscreen when opening, fallback to fixed overlay
  useEffect(() => {
    const el = containerRef.current;
    if (el && !document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {
        // graceful in-app fixed overlay fallback
      });
    }

    const handleFsChange = () => {
      if (!document.fullscreenElement) {
        onClose();
      }
    };
    document.addEventListener("fullscreenchange", handleFsChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [onClose]);

  const handleExit = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    onClose();
  }, [onClose]);

  // Viewport width measurement
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 1200,
  );

  useEffect(() => {
    const vp = scrollViewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportWidth(entry.contentRect.width);
      }
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  const duration = Math.max(project.duration, 1);
  const canvasWidth = Math.max(viewportWidth, viewportWidth * zoom);
  const scale = canvasWidth / duration;

  // Synchronize incoming scrollLeft to DOM viewport
  useEffect(() => {
    const vp = scrollViewportRef.current;
    if (!vp || isDragging.current || isMinimapDragging.current) return;
    if (Math.abs(vp.scrollLeft - scrollLeft) > 2) {
      vp.scrollLeft = scrollLeft;
    }
  }, [scrollLeft]);

  // Keep playhead in view during playback
  useEffect(() => {
    if (!playing || isDragging.current || isMinimapDragging.current) return;
    const vp = scrollViewportRef.current;
    if (!vp) return;
    const playheadX = time * scale;
    const currentScroll = vp.scrollLeft;
    const buffer = viewportWidth * 0.15;
    if (playheadX > currentScroll + viewportWidth - buffer || playheadX < currentScroll) {
      const targetScroll = Math.max(0, playheadX - viewportWidth * 0.25);
      vp.scrollLeft = targetScroll;
      onScrollChange(targetScroll);
    }
  }, [time, playing, scale, viewportWidth, onScrollChange]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleExit();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        onTogglePlay();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const delta = 1 / actualRate(project.frameRate);
        onSeek(Math.max(0, time - delta));
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const delta = 1 / actualRate(project.frameRate);
        onSeek(Math.min(duration, time + delta));
        return;
      }
      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        onZoomChange(Math.max(1, Math.min(128, zoom / 1.25)));
        return;
      }
      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        onZoomChange(Math.max(1, Math.min(128, zoom * 1.25)));
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        onZoomChange(1);
        if (scrollViewportRef.current) scrollViewportRef.current.scrollLeft = 0;
        onScrollChange(0);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [duration, handleExit, onSeek, onTogglePlay, onZoomChange, onScrollChange, project.frameRate, time, zoom]);

  // Scrubbing & seeking on main canvas
  const scrubFromClientX = useCallback(
    (clientX: number) => {
      const vp = scrollViewportRef.current;
      if (!vp) return;
      const rect = vp.getBoundingClientRect();
      const rawX = clientX - rect.left + vp.scrollLeft;
      const targetTime = Math.max(0, Math.min(duration, rawX / scale));
      onScrub(targetTime);
    },
    [duration, onScrub, scale],
  );

  // Minimap pan / drag
  const handleMinimapInteraction = useCallback(
    (clientX: number) => {
      const mm = minimapRef.current;
      const vp = scrollViewportRef.current;
      if (!mm || !vp) return;
      const rect = mm.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetScroll = Math.max(
        0,
        Math.min(canvasWidth - viewportWidth, ratio * canvasWidth - viewportWidth / 2),
      );
      vp.scrollLeft = targetScroll;
      onScrollChange(targetScroll);
    },
    [canvasWidth, onScrollChange, viewportWidth],
  );

  // --------------------------------------------------------------------------
  // Real Layer Sources (Truthful data integrity - no fabricated visuals)
  // --------------------------------------------------------------------------

  // Layer 1: Sequences
  const sequences = useMemo(() => {
    if (!layers.scenes || !project.sequences || project.sequences.length === 0) {
      return null;
    }
    const passages = project.sequences.filter((s) => (s.kind ?? "passage") === "passage");
    return passages.length > 0 ? passages : null;
  }, [layers.scenes, project.sequences]);

  // Layer 2: Shots
  const showShots = layers.framing && project.shots.length > 0;

  // Layer 3: Pacing curve
  const pacingData = useMemo(() => {
    if (!layers.pacing || project.shots.length === 0) return null;
    const { path, area } = generatePacingPathAndArea(project.shots, duration, scale, 100);
    if (!path) return null;
    return { path, area };
  }, [layers.pacing, project.shots, duration, scale]);

  // Layer 4: Framing elevation
  const framingData = useMemo(() => {
    if (!layers.framingArc || project.shots.length === 0) return null;
    const path = generateSteppedFramingPath(project.shots, scale, 100);
    if (!path) return null;
    return path;
  }, [layers.framingArc, project.shots, scale]);

  // Layer 5: Motion kinetic energy flow
  const motionData = useMemo(() => {
    if (!layers.motion || project.shots.length === 0) return null;
    const flow = generateMotionFlowPathAndArea(project.shots, duration, scale, 100);
    return flow.hasData ? flow : null;
  }, [layers.motion, project.shots, duration, scale]);

  // Layer 6: Audio waveforms
  const audioData = useMemo(() => {
    if (!layers.audio) return null;
    const dme = project.dmeWaveforms;
    if (dme && dme.dialogue?.length && dme.music?.length && dme.effects?.length) {
      return {
        type: "dme" as const,
        dxPath: generateSymmetricalWaveformPath(dme.dialogue, duration, scale, 100, true),
        mxPath: generateSymmetricalWaveformPath(dme.music, duration, scale, 100, true),
        fxPath: generateSymmetricalWaveformPath(dme.effects, duration, scale, 100, true),
      };
    }
    const rawWave = waveform || [];
    if (rawWave.length) {
      return {
        type: "mixed" as const,
        path: generateSymmetricalWaveformPath(rawWave, duration, scale, 100, true),
      };
    }
    return null;
  }, [layers.audio, project.dmeWaveforms, waveform, duration, scale]);

  // Speech regions for dialogue highlighting
  const speechRegions = useMemo(() => {
    if (!speechAnalysis || !speechAnalysis.regions || speechAnalysis.regions.length === 0) {
      return null;
    }
    return speechAnalysis.regions;
  }, [speechAnalysis]);

  // Layer 7: Cast presence (only confirmed/verified appearances)
  const castData = useMemo(() => {
    if (!layers.characters || !project.cast || project.cast.length === 0) return null;
    const membersWithData: Array<{
      member: CastMember;
      color: string;
      intervals: Array<{ start: number; end: number; isSingle: boolean }>;
    }> = [];

    project.cast.forEach((member, idx) => {
      const intervals: Array<{ start: number; end: number; isSingle: boolean }> = [];
      for (const s of project.shots) {
        const ca = s.characterAnalysis;
        if (!ca) continue;
        if (ca.manualReviewStatus === "Confirmed") {
          if (ca.manualMemberIds?.includes(member.id)) {
            intervals.push({
              start: s.startSeconds,
              end: s.endSeconds,
              isSingle: s.duration < 1.0,
            });
          }
        } else if (ca.intervals) {
          for (const mi of ca.intervals) {
            if (
              mi.memberId === member.id &&
              (mi.reviewStatus === "Confirmed" || ca.reviewStatus === "Confirmed")
            ) {
              const start = mi.endSeconds > mi.startSeconds + 0.05 ? mi.startSeconds : s.startSeconds;
              const end = mi.endSeconds > mi.startSeconds + 0.05 ? mi.endSeconds : s.endSeconds;
              intervals.push({
                start,
                end,
                isSingle: end - start < 1.0,
              });
            }
          }
        }
      }

      if (intervals.length > 0) {
        membersWithData.push({
          member,
          color: CAST_PALETTE[idx % CAST_PALETTE.length],
          intervals,
        });
      }
    });

    return membersWithData.length > 0 ? membersWithData : null;
  }, [layers.characters, project.cast, project.shots]);

  // Minimap background waveform / density
  const minimapPath = useMemo(() => {
    const rawWave =
      project.dmeWaveforms?.music ||
      project.dmeWaveforms?.dialogue ||
      waveform;
    if (rawWave && rawWave.length && duration > 0) {
      return generateSymmetricalWaveformPath(rawWave, duration, viewportWidth / duration, 28);
    }
    return "";
  }, [project.dmeWaveforms, waveform, duration, viewportWidth]);

  // Proportional vertical layout distribution among active layers
  const gridTemplateRows = useMemo(() => {
    const rows: string[] = [];
    if (sequences) rows.push("minmax(28px, 7fr)");
    if (showShots) rows.push("minmax(60px, 13fr)");
    if (pacingData) rows.push("minmax(80px, 17fr)");
    if (framingData) rows.push("minmax(40px, 9fr)");
    if (motionData) rows.push("minmax(60px, 16fr)");
    if (audioData) rows.push(audioData.type === "dme" ? "minmax(90px, 24fr)" : "minmax(60px, 18fr)");
    if (castData) rows.push(`minmax(${castData.length * 28}px, ${Math.min(20, castData.length * 5)}fr)`);
    return rows.join(" ");
  }, [sequences, showShots, pacingData, framingData, motionData, audioData, castData]);

  // Minimap visible range box
  const minimapBoxLeft = `${(scrollLeft / canvasWidth) * 100}%`;
  const minimapBoxWidth = `${Math.min(100, (viewportWidth / canvasWidth) * 100)}%`;

  return (
    <div
      ref={containerRef}
      className="fullscreen-graph-container"
      onPointerMove={resetExitTimer}
      onClick={resetExitTimer}
    >
      {/* Minimal hover-only exit affordance */}
      <button
        type="button"
        className={`fullscreen-exit-btn ${showExit ? "visible" : ""}`}
        onClick={handleExit}
        aria-label="Exit Fullscreen"
        title="Exit Fullscreen (Esc)"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Main Scrollable Canvas */}
      <div
        ref={scrollViewportRef}
        className="fullscreen-scroll-viewport"
        onScroll={(e) => onScrollChange(e.currentTarget.scrollLeft)}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            onZoomChange(Math.max(1, Math.min(128, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          isDragging.current = true;
          scrubFromClientX(e.clientX);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {}
        }}
        onPointerMove={(e) => {
          if (isDragging.current) {
            scrubFromClientX(e.clientX);
          }
        }}
        onPointerUp={(e) => {
          if (isDragging.current) {
            scrubFromClientX(e.clientX);
            isDragging.current = false;
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {}
          }
        }}
        onPointerCancel={() => {
          isDragging.current = false;
        }}
      >
        <div
          className="fullscreen-score-canvas"
          style={{
            width: canvasWidth,
            gridTemplateRows,
          }}
        >
          {/* Layer 1: Scene / Sequence Ranges */}
          {sequences && (
            <div className="fullscreen-layer fullscreen-sequence-track" style={{ width: canvasWidth }}>
              {sequences.map((seq, i) => (
                <div
                  key={seq.id || `seq-${i}`}
                  className="fullscreen-seq-band"
                  style={{
                    left: seq.startSeconds * scale,
                    width: Math.max(2, (seq.endSeconds - seq.startSeconds) * scale),
                    backgroundColor: SEQUENCE_PALETTE[i % SEQUENCE_PALETTE.length],
                  }}
                />
              ))}
            </div>
          )}

          {/* Layer 2: Shot Blocks (Tiered framing elevation blocks) */}
          {showShots && (
            <div className="fullscreen-layer fullscreen-shot-track" style={{ width: canvasWidth }}>
              {project.shots.map((s) => {
                const rank = framingRank(s) ?? 2;
                const row = rank >= 3 ? 0 : rank === 2 ? 1 : 2;
                const isSelected = selected === s.id;
                const isCurrent = time >= s.startSeconds && time <= s.endSeconds;

                let blockBg = "#2e3f53";
                if (project.colorMode === "palette" && s.colorProfile?.palette?.[0]) {
                  blockBg = s.colorProfile.palette[0];
                } else if (rank <= 1) {
                  blockBg = "#253342";
                } else if (rank <= 3) {
                  blockBg = "#33455a";
                } else if (rank <= 5) {
                  blockBg = "#425872";
                } else {
                  blockBg = "#506988";
                }

                return (
                  <div
                    key={s.id}
                    className={`fullscreen-shot-block tier-${row} ${isSelected ? "selected" : ""} ${isCurrent ? "current" : ""}`}
                    style={
                      {
                        left: s.startSeconds * scale,
                        width: Math.max(2, s.duration * scale),
                        backgroundColor: blockBg,
                      } as CSSProperties
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectShot(s);
                      onSeek(s.startSeconds);
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* Layer 3: Pacing & Cutting Density Curve */}
          {pacingData && (
            <div className="fullscreen-layer fullscreen-pacing-track" style={{ width: canvasWidth }}>
              <svg
                width={canvasWidth}
                height="100%"
                viewBox={`0 0 ${canvasWidth} 100`}
                preserveAspectRatio="none"
                className="fullscreen-pacing-svg"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="fsPacingGradient" x1="0" y1="0" x2="0" y2="100%">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.55" />
                    <stop offset="35%" stopColor="#f59e0b" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {/* Horizontal reference grid lines */}
                <line x1="0" y1="25" x2={canvasWidth} y2="25" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                <line x1="0" y1="50" x2={canvasWidth} y2="50" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                <line x1="0" y1="75" x2={canvasWidth} y2="75" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
                <line x1="0" y1="96" x2={canvasWidth} y2="96" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                <path d={pacingData.area} fill="url(#fsPacingGradient)" />
                <path
                  d={pacingData.path}
                  vectorEffect="non-scaling-stroke"
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}

          {/* Layer 4: Framing Elevation Stepped Cyan Line */}
          {framingData && (
            <div className="fullscreen-layer fullscreen-framing-track" style={{ width: canvasWidth }}>
              <svg
                width={canvasWidth}
                height="100%"
                viewBox={`0 0 ${canvasWidth} 100`}
                preserveAspectRatio="none"
                className="fullscreen-framing-svg"
                aria-hidden="true"
              >
                {/* Guidelines */}
                <line x1="0" y1="20" x2={canvasWidth} y2="20" stroke="rgba(56,189,248,0.06)" strokeWidth="1" strokeDasharray="4,4" />
                <line x1="0" y1="50" x2={canvasWidth} y2="50" stroke="rgba(56,189,248,0.06)" strokeWidth="1" strokeDasharray="4,4" />
                <line x1="0" y1="80" x2={canvasWidth} y2="80" stroke="rgba(56,189,248,0.07)" strokeWidth="1" />
                <path
                  d={framingData}
                  vectorEffect="non-scaling-stroke"
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}

          {/* Layer 5: Kinetic Motion Energy River */}
          {motionData && (
            <div className="fullscreen-layer fullscreen-motion-track" style={{ width: canvasWidth }}>
              <svg
                width={canvasWidth}
                height="100%"
                viewBox={`0 0 ${canvasWidth} 100`}
                preserveAspectRatio="none"
                className="fullscreen-motion-svg"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="fsMotionGradient" x1="0" y1="0" x2="0" y2="100%">
                    <stop offset="0%" stopColor="#c084fc" stopOpacity="0.65" />
                    <stop offset="35%" stopColor="#a855f7" stopOpacity="0.35" />
                    <stop offset="75%" stopColor="#6366f1" stopOpacity="0.12" />
                    <stop offset="100%" stopColor="#4338ca" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {/* Horizontal reference grid lines */}
                <line x1="0" y1="25" x2={canvasWidth} y2="25" stroke="rgba(192, 132, 252, 0.08)" strokeWidth="1" strokeDasharray="3,3" />
                <line x1="0" y1="50" x2={canvasWidth} y2="50" stroke="rgba(192, 132, 252, 0.06)" strokeWidth="1" strokeDasharray="3,3" />
                <line x1="0" y1="75" x2={canvasWidth} y2="75" stroke="rgba(192, 132, 252, 0.04)" strokeWidth="1" />
                <line x1="0" y1="96" x2={canvasWidth} y2="96" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" />
                <path d={motionData.area} fill="url(#fsMotionGradient)" />
                <path
                  d={motionData.path}
                  vectorEffect="non-scaling-stroke"
                  fill="none"
                  stroke="#c084fc"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}

          {/* Layer 6: Audio Waveforms (DME 3-Stem or Mixed) */}
          {audioData && (
            <div className="fullscreen-layer fullscreen-audio-track" style={{ width: canvasWidth }}>
              {audioData.type === "dme" ? (
                <>
                  {/* DX (Dialogue - Sage Green with visually distinct speech regions) */}
                  <div className="audio-river-stream dx-stream">
                    <svg width={canvasWidth} height="100%" viewBox={`0 0 ${canvasWidth} 100`} preserveAspectRatio="none" className="waveform-svg" aria-hidden="true">
                      <defs>
                        {speechRegions && (
                          <clipPath id="fsSpeechClip">
                            {speechRegions.map((reg, idx) => (
                              <rect
                                key={`clip-${idx}`}
                                x={reg.startSeconds * scale}
                                y={0}
                                width={Math.max(2, (reg.endSeconds - reg.startSeconds) * scale)}
                                height={100}
                              />
                            ))}
                          </clipPath>
                        )}
                      </defs>
                      <line x1="0" y1="50" x2={canvasWidth} y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                      {/* Base dialogue wave (calm sage green) */}
                      <path d={audioData.dxPath} fill="rgba(74, 222, 128, 0.42)" />
                      {/* Speech-highlighted dialogue wave */}
                      {speechRegions && (
                        <path d={audioData.dxPath} fill="#86efac" clipPath="url(#fsSpeechClip)" />
                      )}
                    </svg>
                  </div>

                  {/* MX (Music - Slate Blue) */}
                  <div className="audio-river-stream mx-stream">
                    <svg width={canvasWidth} height="100%" viewBox={`0 0 ${canvasWidth} 100`} preserveAspectRatio="none" className="waveform-svg" aria-hidden="true">
                      <line x1="0" y1="50" x2={canvasWidth} y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                      <path d={audioData.mxPath} fill="rgba(96, 165, 250, 0.7)" />
                    </svg>
                  </div>

                  {/* FX (Effects - Muted Purple) */}
                  <div className="audio-river-stream fx-stream">
                    <svg width={canvasWidth} height="100%" viewBox={`0 0 ${canvasWidth} 100`} preserveAspectRatio="none" className="waveform-svg" aria-hidden="true">
                      <line x1="0" y1="50" x2={canvasWidth} y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                      <path d={audioData.fxPath} fill="rgba(192, 132, 252, 0.65)" />
                    </svg>
                  </div>
                </>
              ) : (
                /* Mixed Audio Waveform */
                <div className="audio-river-stream mixed-stream">
                  <svg width={canvasWidth} height="100%" viewBox={`0 0 ${canvasWidth} 100`} preserveAspectRatio="none" className="waveform-svg" aria-hidden="true">
                    <line x1="0" y1="50" x2={canvasWidth} y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                    <path d={audioData.path} fill="rgba(56, 189, 248, 0.6)" />
                  </svg>
                </div>
              )}
            </div>
          )}

          {/* Layer 7: Cast Presence (Intervals & Diamonds) */}
          {castData && (
            <div className="fullscreen-layer fullscreen-cast-track" style={{ width: canvasWidth }}>
              {castData.map(({ member, color, intervals }) => {
                const avatarImg = member.references?.[0]?.image;
                return (
                  <div key={`cast-${member.id}`} className="fullscreen-cast-row">
                    {/* Sticky Left Avatar */}
                    <div
                      className="fullscreen-cast-avatar"
                      style={{ borderColor: color }}
                    >
                      {avatarImg ? (
                        <img src={avatarImg} alt="" className="avatar-img" />
                      ) : (
                        <svg className="avatar-silhouette" width="12" height="12" viewBox="0 0 24 24" fill={color} aria-hidden="true">
                          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                        </svg>
                      )}
                    </div>

                    {/* Horizontal Presence Track */}
                    <div className="fullscreen-cast-lane" style={{ width: canvasWidth }}>
                      <div className="cast-lane-guide" />
                      {intervals.map((item, i) => (
                        <div key={`int-${i}`}>
                          <div
                            className="cast-interval-bar"
                            style={{
                              left: item.start * scale,
                              width: Math.max(4, (item.end - item.start) * scale),
                              backgroundColor: color,
                            }}
                          />
                          <div
                            className="cast-diamond-marker"
                            style={{
                              left: `${((item.start + item.end) / 2) * scale}px`,
                              backgroundColor: color,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Antique-Gold Playhead Beam */}
          <div
            className="fullscreen-playhead"
            style={{
              transform: `translateX(${Math.min(duration, Math.max(0, time)) * scale}px)`,
            }}
          >
            <div className="playhead-bead" />
            <div className="playhead-beam" />
          </div>
        </div>
      </div>

      {/* Layer 8: Wordless Minimap at the bottom */}
      <div
        ref={minimapRef}
        className="fullscreen-minimap"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          isMinimapDragging.current = true;
          handleMinimapInteraction(e.clientX);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {}
        }}
        onPointerMove={(e) => {
          if (isMinimapDragging.current) {
            handleMinimapInteraction(e.clientX);
          }
        }}
        onPointerUp={(e) => {
          if (isMinimapDragging.current) {
            isMinimapDragging.current = false;
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {}
          }
        }}
        onPointerCancel={() => {
          isMinimapDragging.current = false;
        }}
      >
        {/* Full-film density wave */}
        {minimapPath && (
          <svg width={viewportWidth} height={32} className="minimap-svg" aria-hidden="true">
            <path d={minimapPath} fill="rgba(148, 163, 184, 0.22)" />
          </svg>
        )}

        {/* Visible-range window */}
        <div
          className="fullscreen-minimap-window"
          style={{
            left: minimapBoxLeft,
            width: minimapBoxWidth,
          }}
        >
          <div className="window-handle left" />
          <div className="window-handle right" />
        </div>

        {/* Minimap Playhead Indicator */}
        <div
          className="fullscreen-minimap-playhead"
          style={{ left: `${(Math.min(duration, Math.max(0, time)) / duration) * 100}%` }}
        />
      </div>
    </div>
  );
});
