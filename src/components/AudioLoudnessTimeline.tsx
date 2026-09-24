import { memo, useMemo, useRef, useState, useCallback, useEffect } from "react";
import type { Project, Shot, LoudnessAnalysis, SpeechAnalysis, SoundSpan } from "../models/project";
import type { TimeRange } from "./SequenceReading";
import { lufsToNormalized } from "../analysis/loudness";
import { formatTimecode } from "../utils/timecode";

export interface AudioLoudnessTimelineProps {
  project: Project;
  loudnessAnalysis?: LoudnessAnalysis;
  speechAnalysis?: SpeechAnalysis;
  currentTime: number;
  range?: TimeRange;
  selectedShot?: Shot;
  onSeek: (time: number) => void;
  onRangeChange: (range?: TimeRange) => void;
  onSelectSpan?: (span: SoundSpan) => void;
  onScanLoudness?: () => void;
  onScanSpeech?: () => void;
  isLoudnessScanning?: boolean;
  isSpeechScanning?: boolean;
}

const MIN_LUFS = -60;
const MAX_LUFS = 0;
const LUFS_RANGE = MAX_LUFS - MIN_LUFS; // 60
const TARGET_LUFS = -23;

export const AudioLoudnessTimeline = memo(function AudioLoudnessTimeline({
  project,
  loudnessAnalysis,
  speechAnalysis,
  currentTime,
  range,
  selectedShot,
  onSeek,
  onRangeChange,
  onSelectSpan,
  onScanLoudness,
  onScanSpeech,
  isLoudnessScanning = false,
  isSpeechScanning = false,
}: AudioLoudnessTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);

  const duration = Math.max(0.001, project.duration || project.videoMetadata?.duration || 1);
  const tc = useCallback(
    (t: number) => formatTimecode(t, project.frameRate, project.dropFrame),
    [project.frameRate, project.dropFrame],
  );

  const formatTickTime = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const pad = (n: number) => n.toString().padStart(2, "0");
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return `${pad(h)}:${pad(remM)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  }, []);

  // Time ticks calculation for clean X-axis markers
  const timeTicks = useMemo(() => {
    let interval = 60; // default 1 min
    if (duration <= 30) interval = 5;
    else if (duration <= 60) interval = 10;
    else if (duration <= 180) interval = 30;
    else if (duration <= 600) interval = 60;
    else if (duration <= 1800) interval = 120;
    else if (duration <= 3600) interval = 300;
    else interval = 600;

    const ticks: number[] = [];
    for (let t = 0; t <= duration; t += interval) {
      ticks.push(t);
    }
    if (ticks[ticks.length - 1] < duration - interval * 0.4) {
      ticks.push(duration);
    }
    return ticks;
  }, [duration]);

  // Current playhead loudness interpolation
  const currentLoudness = useMemo(() => {
    if (!loudnessAnalysis || !loudnessAnalysis.momentary || !loudnessAnalysis.momentary.length) {
      return null;
    }
    const count = loudnessAnalysis.binCount || loudnessAnalysis.momentary.length;
    const binDuration = duration / count;
    const bin = Math.max(0, Math.min(count - 1, Math.floor(currentTime / binDuration)));

    const sVal = loudnessAnalysis.shortTerm?.[bin] ?? loudnessAnalysis.momentary[bin] ?? -70;
    const mVal = loudnessAnalysis.momentary[bin] ?? -70;
    const tpVal = loudnessAnalysis.truePeaks?.[bin] ?? -70;

    return {
      shortTerm: Number.isFinite(sVal) ? sVal : -70,
      momentary: Number.isFinite(mVal) ? mVal : -70,
      truePeak: Number.isFinite(tpVal) ? tpVal : -70,
    };
  }, [loudnessAnalysis, currentTime, duration]);

  // Memoized SVG paths for Loudness Contour Chart
  // viewBox: 0 0 1000 200
  const svgPaths = useMemo(() => {
    if (!loudnessAnalysis || !loudnessAnalysis.momentary || !loudnessAnalysis.momentary.length) {
      return null;
    }
    const count = loudnessAnalysis.binCount || loudnessAnalysis.momentary.length;
    const momentary = loudnessAnalysis.momentary;
    const shortTerm = loudnessAnalysis.shortTerm && loudnessAnalysis.shortTerm.length
      ? loudnessAnalysis.shortTerm
      : momentary;

    if (count === 1) {
      const normM = lufsToNormalized(momentary[0] ?? -70, MIN_LUFS, MAX_LUFS);
      const yM = 200 - normM * 200;
      const normS = lufsToNormalized(shortTerm[0] ?? -70, MIN_LUFS, MAX_LUFS);
      const yS = 200 - normS * 200;
      return {
        momentary: `M0,${yM.toFixed(1)} L1000,${yM.toFixed(1)}`,
        momentaryArea: `M0,${yM.toFixed(1)} L1000,${yM.toFixed(1)} L1000,200 L0,200 Z`,
        shortTerm: `M0,${yS.toFixed(1)} L1000,${yS.toFixed(1)}`,
        targetY: 200 - lufsToNormalized(TARGET_LUFS, MIN_LUFS, MAX_LUFS) * 200,
      };
    }

    const mPoints = momentary.map((val, i) => {
      const x = (i / (count - 1)) * 1000;
      const sanitized = Number.isFinite(val) ? val : -70;
      const norm = lufsToNormalized(sanitized, MIN_LUFS, MAX_LUFS);
      const y = 200 - norm * 200;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const sPoints = shortTerm.map((val, i) => {
      const x = (i / (count - 1)) * 1000;
      const sanitized = Number.isFinite(val) ? val : -70;
      const norm = lufsToNormalized(sanitized, MIN_LUFS, MAX_LUFS);
      const y = 200 - norm * 200;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const targetNorm = lufsToNormalized(TARGET_LUFS, MIN_LUFS, MAX_LUFS);
    const targetY = 200 - targetNorm * 200;

    return {
      momentary: mPoints.join(" "),
      momentaryArea: `${mPoints.join(" ")} L 1000,200 L 0,200 Z`,
      shortTerm: sPoints.join(" "),
      targetY,
    };
  }, [loudnessAnalysis]);

  // Playhead percentage (0 to 100%)
  const playheadPct = Math.max(0, Math.min(100, (currentTime / duration) * 100));

  // Playhead Y position on the short-term curve
  const playheadY = useMemo(() => {
    if (!currentLoudness) return 100;
    const norm = lufsToNormalized(currentLoudness.shortTerm, MIN_LUFS, MAX_LUFS);
    return (1 - norm) * 100; // in %
  }, [currentLoudness]);

  // Selection range normalized percentages
  const selectionBounds = useMemo(() => {
    if (!range) return null;
    const start = Math.max(0, Math.min(range.start, range.end));
    const end = Math.min(duration, Math.max(range.start, range.end));
    return {
      startPct: (start / duration) * 100,
      widthPct: Math.max(0.1, ((end - start) / duration) * 100),
    };
  }, [range, duration]);

  // Mouse & Touch Interaction handlers for seeking & passage selecting
  const getTimeFromClientX = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Primary button only
      if (e.button !== 0) return;
      const time = getTimeFromClientX(e.clientX);
      dragStartRef.current = time;
      isDraggingRef.current = false;

      const handlePointerMove = (moveEvt: PointerEvent) => {
        if (dragStartRef.current === null) return;
        const currentT = getTimeFromClientX(moveEvt.clientX);
        const diff = Math.abs(currentT - dragStartRef.current);
        // If moved more than small threshold, initiate drag range selection
        if (diff > 0.2 || isDraggingRef.current) {
          isDraggingRef.current = true;
          onRangeChange({
            start: Math.min(dragStartRef.current, currentT),
            end: Math.max(dragStartRef.current, currentT),
          });
        }
      };

      const handlePointerUp = (upEvt: PointerEvent) => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);

        if (!isDraggingRef.current && dragStartRef.current !== null) {
          // Simple click => seek
          onSeek(dragStartRef.current);
        }
        dragStartRef.current = null;
        isDraggingRef.current = false;
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [getTimeFromClientX, onRangeChange, onSeek],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onSeek(Math.max(0, currentTime - step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onSeek(Math.min(duration, currentTime + step));
      } else if (e.key === "Home") {
        e.preventDefault();
        onSeek(0);
      } else if (e.key === "End") {
        e.preventDefault();
        onSeek(duration);
      }
    },
    [currentTime, duration, onSeek],
  );

  return (
    <div
      className="audio-loudness-timeline"
      tabIndex={0}
      role="slider"
      aria-label="Audio and loudness timeline"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={currentTime}
      onKeyDown={handleKeyDown}
    >
      {/* Left Column: Fixed Gutter for Y-Axis and Lane Labels */}
      <div className="alt-left-gutter">
        {/* Graph Y-Axis Labels */}
        <div className="alt-graph-y-axis">
          <span className="alt-axis-title">LUFS</span>
          <span className="alt-axis-val val-10">-10</span>
          <span className="alt-axis-val val-20">-20</span>
          <span className="alt-axis-val val-30">-30</span>
          <span className="alt-axis-val val-40">-40</span>
          <span className="alt-axis-val val-60">-60</span>
        </div>

        {/* X-Axis Spacer */}
        <div className="alt-time-axis-spacer" />

        {/* Lane 1 Label: Sound Spans */}
        <div className="alt-lane-label">
          <span className="alt-lane-title">Sound spans</span>
          <span className="alt-lane-sub">Your annotations</span>
        </div>

        {/* Lane 2 Label: Speech */}
        <div className="alt-lane-label">
          <span className="alt-lane-title">Speech</span>
          <span className="alt-lane-sub">Detected activity</span>
        </div>
      </div>

      {/* Right Column: Time-Synchronized Track Area */}
      <div
        className="alt-track-area"
        ref={trackRef}
        onPointerDown={handlePointerDown}
      >
        {/* Graph Area */}
        <div className="alt-graph-wrap">
          {/* Legend in top right */}
          <div className="alt-graph-legend">
            <span className="alt-legend-item short-term">
              <span className="alt-swatch gold-line" /> Short-term
            </span>
            <span className="alt-legend-item momentary">
              <span className="alt-swatch gray-line" /> Momentary
            </span>
          </div>

          {/* SVG Loudness Graph */}
          {svgPaths ? (
            <svg
              viewBox="0 0 1000 200"
              preserveAspectRatio="none"
              className="alt-loudness-svg"
            >
              <defs>
                <linearGradient id="altGoldGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.22" />
                  <stop offset="60%" stopColor="#f59e0b" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid Lines */}
              <line x1="0" y1="33.33" x2="1000" y2="33.33" className="alt-grid-line" />
              <line x1="0" y1="66.67" x2="1000" y2="66.67" className="alt-grid-line" />
              <line x1="0" y1="100.00" x2="1000" y2="100.00" className="alt-grid-line" />
              <line x1="0" y1="133.33" x2="1000" y2="133.33" className="alt-grid-line" />
              <line x1="0" y1="200.00" x2="1000" y2="200.00" className="alt-grid-line" />

              {/* Vertical Time Grid Lines */}
              {timeTicks.map((t) => {
                const x = (t / duration) * 1000;
                return (
                  <line
                    key={t}
                    x1={x}
                    y1="0"
                    x2={x}
                    y2="200"
                    className="alt-time-grid-line"
                  />
                );
              })}

              {/* Subtle -23 LUFS Target Reference Line */}
              <line
                x1="0"
                y1={svgPaths.targetY}
                x2="1000"
                y2={svgPaths.targetY}
                className="alt-target-reference-line"
              />

              {/* Shaded Area Under Momentary/Short-term Curve */}
              <path d={svgPaths.momentaryArea} fill="url(#altGoldGradient)" />

              {/* Momentary Contour Line */}
              <path d={svgPaths.momentary} className="alt-momentary-path" />

              {/* Short-Term Restrained Gold Contour */}
              <path d={svgPaths.shortTerm} className="alt-short-term-path" />
            </svg>
          ) : (
            <div className="alt-unscanned-placeholder">
              {isLoudnessScanning ? (
                <div className="alt-scanning-state">
                  <span className="dme-spinner" />
                  <span>Measuring EBU R128 loudness contour…</span>
                </div>
              ) : (
                <div className="alt-empty-prompt">
                  <span>No loudness analysis available yet.</span>
                  {onScanLoudness && (
                    <button
                      type="button"
                      className="alt-btn-scan-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onScanLoudness();
                      }}
                      disabled={!project.videoMetadata}
                    >
                      Scan Loudness (EBU R128)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Reference label text placed on the right */}
          <div
            className="alt-reference-label"
            style={{
              top: `${(1 - lufsToNormalized(TARGET_LUFS, MIN_LUFS, MAX_LUFS)) * 100}%`,
            }}
          >
            —23 reference
          </div>

          {/* Playhead Dot and Tooltip Pill on the graph */}
          {currentLoudness && (
            <div
              className={`alt-playhead-tooltip ${playheadPct > 80 ? "flip-left" : ""}`}
              style={{
                left: `${playheadPct}%`,
                top: `${playheadY}%`,
              }}
            >
              <div className="alt-playhead-dot" />
              <div className="alt-tooltip-pill">
                {currentLoudness.shortTerm > -70
                  ? `${currentLoudness.shortTerm.toFixed(1)} LUFS`
                  : "— LUFS"}
              </div>
            </div>
          )}
        </div>

        {/* Time Axis (X-Axis) */}
        <div className="alt-time-axis">
          {timeTicks.map((t) => {
            const pct = (t / duration) * 100;
            const isFirst = t === 0;
            const isLast = Math.abs(t - duration) < 0.1;
            const transform = isFirst
              ? "translateX(0)"
              : isLast
                ? "translateX(-100%)"
                : "translateX(-50%)";
            return (
              <div
                key={t}
                className="alt-tick"
                style={{ left: `${pct}%`, transform }}
              >
                <div className="alt-tick-mark" />
                <span className="alt-tick-label">{formatTickTime(t)}</span>
              </div>
            );
          })}
        </div>

        {/* Lane 1: Sound Spans Track */}
        <div className="alt-lane alt-spans-lane">
          {project.soundSpans && project.soundSpans.length > 0 ? (
            project.soundSpans.map((span) => {
              const startPct = (span.startSeconds / duration) * 100;
              const widthPct = Math.max(
                0.8,
                ((span.endSeconds - span.startSeconds) / duration) * 100,
              );
              const isSelected =
                range &&
                Math.abs(range.start - span.startSeconds) < 0.1 &&
                Math.abs(range.end - span.endSeconds) < 0.1;

              return (
                <button
                  key={span.id}
                  type="button"
                  className={`alt-span-box ${isSelected ? "selected" : ""}`}
                  style={{
                    left: `${startPct}%`,
                    width: `${widthPct}%`,
                  }}
                  title={`${span.kind} (${tc(span.startSeconds)} — ${tc(span.endSeconds)}): ${span.notes || "No observation"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRangeChange({
                      start: span.startSeconds,
                      end: span.endSeconds,
                    });
                    onSeek(span.startSeconds);
                    onSelectSpan?.(span);
                  }}
                >
                  <span className="alt-span-text">{span.kind}</span>
                </button>
              );
            })
          ) : (
            <div className="alt-lane-empty-hint">
              <span>No sound spans annotated yet</span>
            </div>
          )}
        </div>

        {/* Lane 2: Speech Activity Track */}
        <div className="alt-lane alt-speech-lane">
          {speechAnalysis && speechAnalysis.regions && speechAnalysis.regions.length > 0 ? (
            speechAnalysis.regions.map((region, idx) => {
              const startPct = (region.startSeconds / duration) * 100;
              const widthPct = Math.max(
                0.2,
                ((region.endSeconds - region.startSeconds) / duration) * 100,
              );
              return (
                <div
                  key={`${region.startSeconds}-${idx}`}
                  className="alt-speech-bar"
                  style={{
                    left: `${startPct}%`,
                    width: `${widthPct}%`,
                  }}
                  title={`Speech: ${tc(region.startSeconds)} — ${tc(region.endSeconds)}`}
                />
              );
            })
          ) : isSpeechScanning ? (
            <div className="alt-lane-empty-hint">
              <span className="dme-spinner" />
              <span>Detecting speech activity…</span>
            </div>
          ) : speechAnalysis ? (
            <div className="alt-lane-empty-hint">
              <span>No speech detected in soundtrack</span>
            </div>
          ) : (
            <div className="alt-lane-empty-hint">
              <span>Speech analysis not yet run</span>
              {onScanSpeech && (
                <button
                  type="button"
                  className="alt-btn-scan-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    onScanSpeech();
                  }}
                  disabled={!project.videoMetadata}
                >
                  Scan speech
                </button>
              )}
            </div>
          )}
        </div>

        {/* Selection Range Overlay spanning both graph and lanes */}
        {selectionBounds && (
          <div
            className="alt-selection-overlay"
            style={{
              left: `${selectionBounds.startPct}%`,
              width: `${selectionBounds.widthPct}%`,
            }}
          >
            <div className="alt-selection-handle left" />
            <div className="alt-selection-handle right" />
          </div>
        )}

        {/* Unified Synchronized Playhead Line spanning graph, time axis, and both lanes */}
        <div
          className="alt-playhead-line"
          style={{ left: `${playheadPct}%` }}
        />
      </div>
    </div>
  );
});

export default AudioLoudnessTimeline;
