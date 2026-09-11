import { useMemo } from "react";
import type { Project, Shot } from "../models/project";
import { colorMappings } from "../analysis/colors";

export default function MapSequenceOverview({
  project,
  selectedShot,
  time,
  onSelectShot,
  onSeek,
}: {
  project: Project;
  selectedShot?: Shot;
  time: number;
  onSelectShot: (shot: Shot) => void;
  onSeek: (t: number) => void;
}) {
  const { totalShots, avgDuration, maxDuration, minDuration } = useMemo(() => {
    if (!project.shots.length) {
      return { totalShots: 0, avgDuration: 0, maxDuration: 0, minDuration: 0 };
    }
    const durations = project.shots.map((s) => s.duration);
    const sum = durations.reduce((a, b) => a + b, 0);
    return {
      totalShots: project.shots.length,
      avgDuration: sum / project.shots.length,
      maxDuration: Math.max(...durations),
      minDuration: Math.min(...durations),
    };
  }, [project.shots]);

  // Current sequence if time falls inside one
  const currentSequence = useMemo(() => {
    if (!project.sequences?.length) return null;
    return (
      project.sequences.find(
        (seq) => time >= seq.startSeconds && time <= seq.endSeconds
      ) ?? null
    );
  }, [project.sequences, time]);

  return (
    <div className="map-sequence-overview panel">
      <div className="section-head seq-head">
        <div className="seq-head-title">
          <span className="eyebrow">SEQUENCE & RHYTHM OVERVIEW</span>
          {currentSequence && (
            <span className="current-seq-badge">
              Active: {currentSequence.name}
            </span>
          )}
        </div>
        <div className="seq-head-metrics mono">
          <span>Avg: <b>{avgDuration.toFixed(1)}s</b></span>
          <span className="meta-sep">·</span>
          <span>Max: <b>{maxDuration.toFixed(1)}s</b></span>
          <span className="meta-sep">·</span>
          <span>Min: <b>{minDuration.toFixed(1)}s</b></span>
        </div>
      </div>

      {/* Sequence Header Blocks (if sequences defined) */}
      {project.sequences && project.sequences.length > 0 && (
        <div className="sequence-ruler-blocks">
          {project.sequences.map((seq, idx) => {
            const widthPct =
              ((seq.endSeconds - seq.startSeconds) / (project.duration || 1)) * 100;
            const isCurrent =
              time >= seq.startSeconds && time <= seq.endSeconds;
            return (
              <div
                key={seq.id || idx}
                className={`seq-block-item ${isCurrent ? "active" : ""}`}
                style={{ width: `${Math.max(8, widthPct)}%` }}
                title={`${seq.name} (${(seq.endSeconds - seq.startSeconds).toFixed(1)}s)`}
                onClick={() => onSeek(seq.startSeconds)}
              >
                <span className="seq-item-num">{idx + 1}.</span>
                <span className="seq-item-name">{seq.name}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Chronological Shot Duration Chart */}
      <div className="map-duration-chart-container" role="img" aria-label="Chronological shot duration chart">
        <div className="chart-bars-wrap">
          {project.shots.map((s) => {
            const isSelected = selectedShot?.id === s.id;
            const isPlaying = time >= s.startSeconds && time <= s.endSeconds;
            const heightPercent = maxDuration > 0
              ? Math.max(12, (s.duration / maxDuration) * 100)
              : 20;
            const colorGetter = (colorMappings[project.colorMode] || colorMappings.shotSize).color;
            const barColor = colorGetter(s);

            return (
              <button
                type="button"
                key={s.id}
                className={`chart-bar-btn ${isSelected ? "selected" : ""} ${
                  isPlaying ? "playing" : ""
                }`}
                style={{
                  height: `${heightPercent}%`,
                  backgroundColor: isSelected ? "#c4ad77" : barColor,
                }}
                title={`Shot ${s.index}: ${s.duration.toFixed(2)}s (${s.shotSize || "Unknown"})`}
                onClick={() => {
                  onSelectShot(s);
                  onSeek(s.startSeconds);
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="map-chart-footer">
        <span className="muted">
          {totalShots} chronological shots · click bar to seek & inspect
        </span>
        {selectedShot && (
          <span className="selected-shot-meta mono">
            Shot {selectedShot.index} ({selectedShot.duration.toFixed(2)}s · {selectedShot.shotSize})
          </span>
        )}
      </div>
    </div>
  );
}
