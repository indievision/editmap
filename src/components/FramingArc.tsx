import { useRef, useCallback } from "react";
import type { Project, Shot } from "../models/project";
import { framingRank, framingSizes } from "../analysis/framing";
import { sizeColors } from "../analysis/colors";
import { formatTimecode } from "../utils/timecode";
import { usePlayhead } from "../playback/playhead";

export default function FramingArc({
  project,
  active = true,
  selected,
  onSelect,
  onSeek,
}: {
  project: Project;
  /** False while hidden, so it stops following the playback clock. */
  active?: boolean;
  selected?: string;
  onSelect: (shot: Shot) => void;
  onSeek?: (time: number) => void;
}) {
  const time = usePlayhead(active);
  const duration = Math.max(1, project.duration);
  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const seekFromPointer = useCallback(
    (clientX: number, target: HTMLElement) => {
      if (!onSeek || duration <= 0) return;
      const rect = target.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const targetTime = (x / rect.width) * duration;
      onSeek(targetTime);
    },
    [duration, onSeek],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !onSeek) return;
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    seekFromPointer(e.clientX, e.currentTarget);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    if (dragStartPosRef.current) {
      const dist = Math.hypot(e.clientX - dragStartPosRef.current.x, e.clientY - dragStartPosRef.current.y);
      if (dist > 3) hasDraggedRef.current = true;
    }
    seekFromPointer(e.clientX, e.currentTarget);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    dragStartPosRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  return (
    <section className="framing-arc">
      {!project.shots.length ? (
        <p className="rhythm-empty muted">
          Import an EDL to see the framing arc.
        </p>
      ) : (
        <div className="framing-arc-layout">
          <div className="framing-labels">
            {[...framingSizes].reverse().map((size) => (
              <span key={size}>{size}</span>
            ))}
            <span>—</span>
          </div>
          <div className="framing-arc-scroll">
            <div
              className="framing-arc-plot"
              style={{
                minWidth: Math.max(500, project.shots.length * 4),
                cursor: onSeek ? "ew-resize" : "default",
                userSelect: "none",
                touchAction: "none",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {project.shots.map((shot) => {
                const rank = framingRank(shot);
                return (
                  <button
                    key={shot.id}
                    type="button"
                    aria-label={`Framing shot ${shot.index}`}
                    aria-pressed={selected === shot.id}
                    title={`Shot ${shot.index} · ${shot.shotSize} · ${shot.duration.toFixed(2)}s · ${shot.reviewStatus ?? "Unreviewed"}${shot.uncertain ? " · Uncertain" : ""}`}
                    className="framing-segment"
                    onClick={() => {
                      if (hasDraggedRef.current) return;
                      onSelect(shot);
                      onSeek?.(shot.startSeconds);
                    }}
                    style={{
                      left: `${(100 * shot.startSeconds) / duration}%`,
                      width: `${(100 * shot.duration) / duration}%`,
                      top: `${(rank === null ? 8 : 7 - rank) * 24 + 6}px`,
                      background:
                        rank === null ? "#626970" : sizeColors[shot.shotSize],
                      opacity:
                        shot.reviewStatus === "Confirmed" && !shot.uncertain
                          ? 1
                          : 0.55,
                    }}
                  />
                );
              })}
              <div
                className="pacing-marker"
                style={{
                  left: `${100 * Math.min(time / duration, 1)}%`,
                  cursor: "ew-resize",
                  pointerEvents: "auto",
                }}
                title={`Playhead: ${formatTimecode(time, project.frameRate, project.dropFrame)} (drag to seek)`}
              />
              <div className="pacing-times">
                {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                  <span key={f}>
                    {formatTimecode(
                      f * project.duration,
                      project.frameRate,
                      project.dropFrame,
                    )}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
