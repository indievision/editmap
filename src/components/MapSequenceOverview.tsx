import { useMemo } from "react";
import type { Project, Shot } from "../models/project";
import { colorMappings } from "../analysis/colors";
import MapRhythmOverview from "./charts/MapRhythmOverview";

export default function MapSequenceOverview({
  project,
  selectedShot,
  time,
  waveform,
  onSelectShot,
  onSeek,
}: {
  project: Project;
  selectedShot?: Shot;
  time: number;
  waveform: number[];
  onSelectShot: (shot: Shot) => void;
  onSeek: (t: number) => void;
}) {
  const { totalShots, avgDuration, maxDuration, minDuration, shortestShot, longestShot } = useMemo(() => {
    if (!project.shots.length) {
      return { totalShots: 0, avgDuration: 0, maxDuration: 0, minDuration: 0, shortestShot: null, longestShot: null };
    }
    const durations = project.shots.map((s) => s.duration);
    const sum = durations.reduce((a, b) => a + b, 0);
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    return {
      totalShots: project.shots.length,
      avgDuration: sum / project.shots.length,
      maxDuration: max,
      minDuration: min,
      shortestShot: project.shots.find((s) => s.duration === min) ?? null,
      longestShot: project.shots.find((s) => s.duration === max) ?? null,
    };
  }, [project.shots]);

  const tempoClassification = useMemo(() => {
    if (avgDuration <= 0) return "No Shots";
    if (avgDuration < 3.0) return "Rapid Montage (ASL < 3s)";
    if (avgDuration < 5.5) return "Dynamic Kinetic Pace (ASL 3-5.5s)";
    if (avgDuration < 9.0) return "Narrative Continuity (ASL 5.5-9s)";
    return "Contemplative Extended Takes (ASL > 9s)";
  }, [avgDuration]);

  const passages = useMemo(
    () => (project.sequences ?? []).filter((seq) => (seq.kind ?? "passage") === "passage"),
    [project.sequences],
  );

  // Current sequence if time falls inside one
  const currentSequence = useMemo(() => {
    if (!passages.length) return null;
    return (
      passages.find(
        (seq) => time >= seq.startSeconds && time <= seq.endSeconds
      ) ?? null
    );
  }, [passages, time]);

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

      {/* Rhythm Intelligence Banner */}
      <div className="rhythm-insight-banner">
        <div className="rhythm-insight-badge">
          <span className="insight-pulse-dot" />
          <span className="insight-tempo-name">{tempoClassification}</span>
        </div>
        <div className="rhythm-insight-meta mono">
          <span>{totalShots} Shots</span>
          <span className="meta-sep">·</span>
          <span>{passages.length} Sequences</span>
          {shortestShot && (
            <>
              <span className="meta-sep">·</span>
              <span>Min: Shot {shortestShot.index} ({shortestShot.duration.toFixed(2)}s)</span>
            </>
          )}
          {longestShot && (
            <>
              <span className="meta-sep">·</span>
              <span>Max: Shot {longestShot.index} ({longestShot.duration.toFixed(2)}s)</span>
            </>
          )}
        </div>
      </div>

      {/* Sequence Header Blocks (if passages defined) */}
      {passages.length > 0 && (
        <div className="sequence-ruler-blocks">
          {passages.map((seq, idx) => {
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

      <div className="map-overview-chart-section">
        <div className="map-overview-chart-head">
          <span className="eyebrow">CUT DENSITY / AUDIO INTENSITY</span>
          <span className="muted">Linked film-time overview</span>
        </div>
        <MapRhythmOverview
          project={project}
          waveform={waveform}
          currentTime={time}
          onSeek={onSeek}
        />
      </div>

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
                  backgroundColor: barColor,
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
