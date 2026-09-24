import { useCallback, useRef } from "react";
import type { ArrangeMeasure, ExploreSequence, ExploreSequenceEntry } from "../../models/explore";
import { formatTimecode } from "../../utils/timecode";
import { clampSequenceTime } from "../../analysis/explorePlayback";
import { getArrangeDescription } from "../../analysis/explore";

interface ExploreTimelineProps {
  sequence: ExploreSequence;
  activeSequenceTime: number;
  activeEntryIndex: number;
  thumbnails: Record<string, string>;
  frameRate: number;
  dropFrame: boolean;
  onSeekSequenceTime: (time: number) => void;
  onSelectEntry: (index: number) => void;
  onSaveSequence: () => void;
  onResetSequence: () => void;
  onSelectArrangeMeasure?: (measure: ArrangeMeasure) => void;
}

export default function ExploreTimeline({
  sequence,
  activeSequenceTime,
  activeEntryIndex,
  thumbnails,
  frameRate,
  dropFrame,
  onSeekSequenceTime,
  onSelectEntry,
  onSaveSequence,
  onResetSequence,
  onSelectArrangeMeasure,
}: ExploreTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const totalDuration = Math.max(0.1, sequence.totalDuration);

  // Time ruler ticks (e.g. every 10s or dynamic interval)
  const rulerTicks = (() => {
    if (totalDuration <= 0) return [];
    const interval = totalDuration > 120 ? 30 : totalDuration > 60 ? 15 : 10;
    const ticks: number[] = [];
    for (let t = 0; t <= totalDuration; t += interval) {
      ticks.push(t);
    }
    if (ticks[ticks.length - 1] < totalDuration - 2) {
      ticks.push(totalDuration);
    }
    return ticks;
  })();

  const formatRulerTime = (secs: number) => {
    const s = Math.round(secs);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!trackRef.current || sequence.entries.length === 0) return;
    isDraggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    seekFromPointer(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    seekFromPointer(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || sequence.entries.length === 0) return;

      const rect = track.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      const targetSeqTime = clampSequenceTime(ratio * totalDuration, totalDuration);

      onSeekSequenceTime(targetSeqTime);
    },
    [sequence.entries.length, totalDuration, onSeekSequenceTime],
  );

  // Calculate playhead position percentage
  const playheadPercent = Math.max(
    0,
    Math.min(100, (activeSequenceTime / totalDuration) * 100),
  );

  return (
    <section className="explore-timeline-section" aria-label="Explore Sequence Timeline">
      <div className="explore-timeline-header">
        <div className="header-left-cluster">
          <h3 className="timeline-title">EXPLORE SEQUENCE</h3>
          <span className="sequence-desc-tag mono">{sequence.name}</span>
        </div>

        <span className="timeline-hint">
          Playback follows this order. Original edit stays unchanged.
        </span>

        <div className="header-right-actions">
          <button
            type="button"
            className="timeline-action-btn"
            onClick={onSaveSequence}
            disabled={sequence.entries.length === 0}
            title="Save this sequence to the project"
          >
            <span className="btn-icon">💾</span>
            <span>Save sequence</span>
          </button>

          <button
            type="button"
            className="timeline-action-btn"
            onClick={onResetSequence}
            title="Reset filters and arrange to defaults"
          >
            <span>Reset</span>
          </button>
        </div>
      </div>

      {sequence.entries.length === 0 ? (
        <div className="explore-empty-timeline">
          {sequence.missingMeasureReason ? (
            <>
              <p className="empty-title">
                No data available for {getArrangeDescription(sequence.arrange)}
              </p>
              <small className="empty-reason">{sequence.missingMeasureReason}</small>
              <div className="empty-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onSelectArrangeMeasure?.("original")}
                >
                  View in original order
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onSelectArrangeMeasure?.("duration")}
                >
                  Arrange by duration
                </button>
              </div>
            </>
          ) : (
            <>
              <p>No shots match the current filter criteria.</p>
              <small>Adjust filters or click "Reset" to include all shots.</small>
              <div className="empty-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onResetSequence}
                >
                  Reset filters
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="explore-timeline-viewport">
          {/* SEQUENCE TIME RULER */}
          <div className="explore-ruler" aria-hidden="true">
            {rulerTicks.map((t) => {
              const leftPct = (t / totalDuration) * 100;
              return (
                <div
                  key={t}
                  className="ruler-tick"
                  style={{ left: `${leftPct}%` }}
                >
                  <span className="tick-line" />
                  <span className="tick-label mono">{formatRulerTime(t)}</span>
                </div>
              );
            })}
          </div>

          {/* PLAYABLE SHOT TRACK */}
          <div
            ref={trackRef}
            className="explore-shot-track"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            role="slider"
            aria-label="Explore sequence playhead"
            aria-valuemin={0}
            aria-valuemax={totalDuration}
            aria-valuenow={activeSequenceTime}
            tabIndex={0}
          >
            {/* Single moving playhead across the entire sequence */}
            <div
              className="explore-playhead-line"
              style={{ left: `${playheadPercent}%` }}
              aria-hidden="true"
            >
              <div className="playhead-cap" />
            </div>

            {/* Shot Cards */}
            {sequence.entries.map((entry, index) => {
              const widthPct = (entry.duration / totalDuration) * 100;
              const isActive = index === activeEntryIndex;
              const thumbUrl = thumbnails[entry.shotId];

              // Source timecode formatted MM:SS
              const srcM = Math.floor(entry.sourceStart / 60);
              const srcS = Math.floor(entry.sourceStart % 60);
              const srcFormatted = `${srcM.toString().padStart(2, "0")}:${srcS
                .toString()
                .padStart(2, "0")}`;

              return (
                <div
                  key={`${entry.shotId}-${index}`}
                  className={`explore-shot-card ${isActive ? "active" : ""}`}
                  style={{ flex: `${entry.duration} 0 ${Math.max(80, widthPct * 8)}px` }}
                  title={`Sequence #${index + 1} · Shot ${entry.originalIndex} (${entry.duration.toFixed(1)}s)`}
                >
                  <div
                    className="card-top-bar"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEntry(index);
                      onSeekSequenceTime(entry.sequenceStart);
                    }}
                    title="Click to jump to start of shot"
                  >
                    <span className="shot-ordinal mono">
                      {index + 1} · Shot {entry.originalIndex.toString().padStart(3, "0")}
                    </span>
                  </div>

                  <div className="card-thumb-wrapper">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={`Shot ${entry.originalIndex}`}
                        className="card-thumb-img"
                        loading="lazy"
                      />
                    ) : (
                      <div className="card-thumb-placeholder" />
                    )}

                    {/* Metric badge bottom-left */}
                    {entry.metric && (
                      <span className="card-metric-badge mono">
                        {entry.metric.formatted}
                      </span>
                    )}

                    {/* Duration bottom-right */}
                    <span className="card-duration-badge mono">
                      {entry.duration.toFixed(1)}s
                    </span>
                  </div>

                  <div className="card-footer-bar">
                    <span className="source-ref mono">
                      Source {srcFormatted}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
