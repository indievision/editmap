import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SequenceMarker, Shot } from "../../models/project";
import {
  calculateZoomScrollAnchor,
  findPassageSegmentAtLocalTime,
  getIntersectingPassageShots,
  type PassageShotSegment,
} from "../../analysis/passageComparison";

interface CompareTimelineProps {
  side: "A" | "B";
  passage: SequenceMarker;
  shots: Shot[];
  localTime: number; // 0 .. passageDuration
  thumbnails: Record<string, string>;
  onSeekLocalTime: (time: number) => void;
  zoom: number;
  onZoomChange: (newZoom: number) => void;
  scrollLeft: number;
  onScrollChange: (newScrollLeft: number) => void;
}

export default function CompareTimeline({
  side,
  passage,
  shots,
  localTime,
  thumbnails,
  onSeekLocalTime,
  zoom,
  onZoomChange,
  scrollLeft,
  onScrollChange,
}: CompareTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const duration = Math.max(0.001, passage.endSeconds - passage.startSeconds);

  // Intersecting shot segments in original editorial order
  const segments: PassageShotSegment[] = useMemo(() => {
    return getIntersectingPassageShots(shots, passage);
  }, [shots, passage]);

  // Active segment at current local playhead time
  const activeSegment = useMemo(() => {
    return findPassageSegmentAtLocalTime(segments, localTime);
  }, [segments, localTime]);

  const activeSegmentIndex = useMemo(() => {
    if (!activeSegment) return -1;
    return segments.findIndex((s) => s.shot.id === activeSegment.shot.id);
  }, [segments, activeSegment]);

  // Sync scrollLeft prop to container DOM element
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (el && Math.abs(el.scrollLeft - scrollLeft) > 1) {
      el.scrollLeft = scrollLeft;
    }
  }, [scrollLeft]);

  // Handle native scroll events from user dragging horizontal scrollbar
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const currentScroll = e.currentTarget.scrollLeft;
    if (Math.abs(currentScroll - scrollLeft) > 1) {
      onScrollChange(currentScroll);
    }
  };

  // Zoom adjustment with playhead-anchored scrolling
  const handleZoomUpdate = useCallback(
    (nextZoomRaw: number) => {
      const clampedNextZoom = Math.max(1, Math.min(5, Math.round(nextZoomRaw * 100) / 100));
      if (Math.abs(clampedNextZoom - zoom) < 0.001) return;

      const container = scrollContainerRef.current;
      const viewportWidth = container ? container.clientWidth : 600;
      const currentScroll = container ? container.scrollLeft : scrollLeft;

      const newScrollLeft = calculateZoomScrollAnchor(
        zoom,
        clampedNextZoom,
        currentScroll,
        viewportWidth,
        localTime,
        duration,
      );

      onZoomChange(clampedNextZoom);
      onScrollChange(newScrollLeft);
    },
    [zoom, scrollLeft, localTime, duration, onZoomChange, onScrollChange],
  );

  const handleZoomStep = (delta: number) => {
    handleZoomUpdate(zoom + delta);
  };

  // Format timecode for ruler ticks (MM:SS)
  const formatRulerTick = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  };

  // Calculate dynamic ruler ticks based on zoom level and duration
  const rulerTicks = useMemo(() => {
    const container = scrollContainerRef.current;
    const viewportWidth = container ? container.clientWidth : 600;
    const contentWidth = viewportWidth * zoom;
    const pixelsPerSecond = contentWidth / duration;

    // Target tick spacing between 50px and 120px
    const candidateSteps = [0.5, 1, 2, 3, 5, 10, 15, 30, 60];
    let chosenStep = 10;
    for (const step of candidateSteps) {
      const px = step * pixelsPerSecond;
      if (px >= 50) {
        chosenStep = step;
        break;
      }
    }

    const ticks: number[] = [];
    for (let t = 0; t <= duration; t += chosenStep) {
      ticks.push(t);
    }
    // Include final endpoint if reasonably separated
    const lastTick = ticks[ticks.length - 1];
    if (lastTick !== undefined && duration - lastTick > chosenStep * 0.4) {
      ticks.push(duration);
    }
    return ticks;
  }, [duration, zoom]);

  // Pointer dragging and seeking on timeline track
  const seekFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || duration <= 0) return;

      const rect = track.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      const targetLocalTime = Math.max(0, Math.min(duration, ratio * duration));
      onSeekLocalTime(targetLocalTime);
    },
    [duration, onSeekLocalTime],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    seekFromClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    seekFromClientX(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const isA = side === "A";
  const accentColor = isA ? "#d3ba7c" : "#38bdf8";

  // Playhead percent within content width
  const playheadPercent = duration > 0 ? (localTime / duration) * 100 : 0;

  return (
    <div className={`compare-timeline-wrap side-${side.toLowerCase()}`}>
      {/* TIMELINE HEADER: TITLE + ICON-ONLY ZOOM CONTROLS */}
      <div className="compare-timeline-header">
        <div className="compare-timeline-title">
          <span className="compare-timeline-side-prefix" style={{ color: accentColor }}>
            {side} ·{" "}
          </span>
          <span className="compare-timeline-title-text">SEQUENCE TIMELINE</span>
        </div>

        {/* COMPACT ICON-ONLY ZOOM CONTROL */}
        <div
          className="compare-zoom-controls"
          role="group"
          aria-label={`${side} timeline zoom controls`}
        >
          <button
            type="button"
            className="compare-zoom-btn"
            onClick={() => handleZoomStep(-0.5)}
            disabled={zoom <= 1.01}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <input
            type="range"
            min="1"
            max="5"
            step="0.05"
            value={zoom}
            onChange={(e) => handleZoomUpdate(parseFloat(e.target.value))}
            className={`compare-zoom-slider slider-${side.toLowerCase()}`}
            aria-label="Timeline zoom"
            title="Timeline zoom"
          />

          <button
            type="button"
            className="compare-zoom-btn"
            onClick={() => handleZoomStep(0.5)}
            disabled={zoom >= 4.99}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* HORIZONTALLY SCROLLABLE TIMELINE CONTAINER */}
      <div
        ref={scrollContainerRef}
        className="compare-timeline-scroll-container"
        onScroll={handleScroll}
        tabIndex={0}
        aria-label={`${side} timeline track`}
      >
        <div
          ref={trackRef}
          className="compare-timeline-content"
          style={{ width: zoom > 1 ? `${zoom * 100}%` : "100%" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* TIME RULER TICKS */}
          <div className="compare-timeline-ruler" aria-hidden="true">
            {rulerTicks.map((tick) => {
              const tickLeftPercent = (tick / duration) * 100;
              return (
                <div
                  key={`tick-${tick}`}
                  className="compare-ruler-mark"
                  style={{ left: `${tickLeftPercent}%` }}
                >
                  <div className="compare-ruler-notch" />
                  <span className="compare-ruler-label">{formatRulerTick(tick)}</span>
                </div>
              );
            })}
          </div>

          {/* FILMSTRIP SHOT SEGMENTS */}
          <div className="compare-segments-track">
            {segments.map((segment, idx) => {
              const segmentWidthPercent = (segment.visibleDuration / duration) * 100;
              const isActive = activeSegment?.shot.id === segment.shot.id;
              const thumbSrc = thumbnails[segment.shot.id];

              return (
                <div
                  key={`seg-${segment.shot.id}-${idx}`}
                  className={`compare-segment-block ${isActive ? "active" : ""}`}
                  style={{
                    width: `${segmentWidthPercent}%`,
                    borderColor: isActive ? accentColor : undefined,
                  }}
                  title={`Shot ${segment.shot.index} (${segment.visibleDuration.toFixed(1)}s visible)`}
                >
                  {thumbSrc ? (
                    <img
                      src={thumbSrc}
                      alt=""
                      className="compare-segment-thumb"
                      loading="lazy"
                    />
                  ) : (
                    <div className="compare-segment-placeholder" />
                  )}

                  {/* Shot index badge */}
                  <span className="compare-segment-index-badge">
                    {segment.shot.index}
                  </span>

                  {/* Cut divider seam */}
                  {idx > 0 && <div className="compare-cut-seam" />}
                </div>
              );
            })}

            {/* PLAYHEAD */}
            <div
              className={`compare-playhead playhead-${side.toLowerCase()}`}
              style={{
                left: `${playheadPercent}%`,
                borderColor: accentColor,
              }}
              aria-hidden="true"
            >
              <div
                className="compare-playhead-thumb"
                style={{ backgroundColor: accentColor }}
              />
              <div
                className="compare-playhead-line"
                style={{ backgroundColor: accentColor }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER: SHOT COUNT / CURRENT SELECTION */}
      <div className="compare-timeline-footer">
        <span className="compare-shot-index-text">
          {activeSegmentIndex >= 0
            ? `Shot ${activeSegmentIndex + 1} of ${segments.length}`
            : segments.length > 0
            ? `${segments.length} shots`
            : "No intersecting shots"}
        </span>
      </div>
    </div>
  );
}
