import { useRef, useState } from "react";
import type { ScreeningMark } from "../models/project";
import { formatTimecode } from "../utils/timecode";

export type ScreeningSeekBarProps = {
  currentTime: number;
  duration: number;
  frameRate: number;
  dropFrame?: boolean;
  marks?: ScreeningMark[];
  onSeek: (time: number) => void;
  onSelectMark?: (mark: ScreeningMark) => void;
  className?: string;
  disabled?: boolean;
};

export default function ScreeningSeekBar({
  currentTime,
  duration,
  frameRate,
  dropFrame = false,
  marks = [],
  onSeek,
  onSelectMark,
  className = "",
  disabled = false,
}: ScreeningSeekBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const safeDuration = Math.max(0.001, duration || 0);
  const progressPercent = Math.min(
    100,
    Math.max(0, (currentTime / safeDuration) * 100),
  );

  const getTimeFromEvent = (clientX: number) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const fraction = Math.min(
      1,
      Math.max(0, (clientX - rect.left) / rect.width),
    );
    return fraction * safeDuration;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    const target = getTimeFromEvent(e.clientX);
    onSeek(target);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!barRef.current || disabled) return;
    if (isDragging) {
      e.preventDefault();
    }
    const rect = barRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.min(
      1,
      Math.max(0, (e.clientX - rect.left) / rect.width),
    );
    setHoverFraction(fraction);
    if (isDragging) {
      onSeek(fraction * safeDuration);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer capture may have already been released
      }
    }
  };

  const handlePointerLeave = () => {
    if (!isDragging) {
      setHoverFraction(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const frameStep = 1 / (frameRate || 24);
    const largeStep = e.shiftKey ? 1.0 : frameStep;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSeek(Math.max(0, currentTime - largeStep));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(Math.min(safeDuration, currentTime + largeStep));
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(safeDuration);
    }
  };

  const hoverTime = hoverFraction !== null ? hoverFraction * safeDuration : 0;
  const hoverPercent = hoverFraction !== null ? hoverFraction * 100 : 0;

  return (
    <div
      ref={barRef}
      className={`sr-seek-bar ${isDragging ? "is-dragging" : ""} ${className}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Screening seek bar"
      aria-valuemin={0}
      aria-valuemax={safeDuration}
      aria-valuenow={currentTime}
      aria-valuetext={formatTimecode(currentTime, frameRate, dropFrame)}
      aria-disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
    >
      <div className="sr-seek-track">
        {/* Hover ghost preview */}
        {hoverFraction !== null && (
          <div
            className="sr-seek-hover"
            style={{ width: `${hoverPercent}%` }}
          />
        )}

        {/* Playback elapsed fill */}
        <div
          className="sr-seek-progress"
          style={{ width: `${progressPercent}%` }}
        />

        {/* Screening mark pips along the timeline */}
        {marks.map((m, i) => {
          const markTime = m.anchorTime ?? m.time;
          const markPercent = Math.min(
            100,
            Math.max(0, (markTime / safeDuration) * 100),
          );
          return (
            <span
              key={m.id}
              role="button"
              tabIndex={0}
              className={`sr-seek-pip ${m.resolved ? "resolved" : ""} ${m.incomingId ? "anchored" : ""}`}
              style={{ left: `${markPercent}%` }}
              title={`Mark ${i + 1} · ${formatTimecode(markTime, frameRate, dropFrame)}${m.notes ? ` · ${m.notes}` : ""}`}
              aria-label={`Jump to mark ${i + 1}`}
              onClick={(e) => {
                e.stopPropagation();
                if (onSelectMark) {
                  onSelectMark(m);
                } else {
                  onSeek(markTime);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  if (onSelectMark) {
                    onSelectMark(m);
                  } else {
                    onSeek(markTime);
                  }
                }
              }}
            />
          );
        })}

        {/* Playhead thumb */}
        <div
          className="sr-seek-thumb"
          style={{ left: `${progressPercent}%` }}
        />
      </div>

      {/* Floating hover timecode tooltip */}
      {hoverFraction !== null && (
        <div
          className="sr-seek-tooltip"
          style={{
            left: `clamp(28px, ${hoverPercent}%, calc(100% - 28px))`,
          }}
        >
          {formatTimecode(hoverTime, frameRate, dropFrame)}
        </div>
      )}
    </div>
  );
}
