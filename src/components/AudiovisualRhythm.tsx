import { memo, useMemo, useState } from "react";
import type { Project } from "../models/project";
import {
  cutTimes,
  pacingAt,
  pacingCurve,
  calculatePearsonCorrelation,
  getDynamicClassification,
  detectImpactCuts,
} from "../analysis/pacing";
import { audioIntensityCurve } from "../analysis/audio";
import { formatTimecode } from "../utils/timecode";

const AudiovisualRhythm = memo(function AudiovisualRhythm({
  project,
  time,
  waveform,
  onSeek,
}: {
  project: Project;
  time: number;
  waveform: number[];
  onSeek: (time: number) => void;
}) {
  const [window, setWindow] = useState(30);
  const [hover, setHover] = useState<number>();
  const [stemMode, setStemMode] = useState<"mixed" | "dialogue" | "music" | "effects">("mixed");

  const duration = project.duration || 1;
  const cuts = useMemo(() => cutTimes(project.shots), [project.shots]);

  const activeWaveform = useMemo(() => {
    if (stemMode === "dialogue" && project.dmeWaveforms?.dialogue) {
      return project.dmeWaveforms.dialogue;
    }
    if (stemMode === "music" && project.dmeWaveforms?.music) {
      return project.dmeWaveforms.music;
    }
    if (stemMode === "effects" && project.dmeWaveforms?.effects) {
      return project.dmeWaveforms.effects;
    }
    return waveform;
  }, [stemMode, project.dmeWaveforms, waveform]);

  const pacingPoints = useMemo(
    () => pacingCurve(cuts, project.duration, window),
    [cuts, project.duration, window],
  );

  const audioPoints = useMemo(
    () => audioIntensityCurve(activeWaveform, project.duration, window),
    [activeWaveform, project.duration, window],
  );

  const impactCutsList = useMemo(
    () => detectImpactCuts(cuts, activeWaveform, project.duration),
    [cuts, activeWaveform, project.duration],
  );

  const maxRate = Math.max(
    10,
    Math.ceil(Math.max(...pacingPoints.map((p) => p.rate), 0) / 10) * 10,
  );

  const pacingPath = useMemo(
    () =>
      pacingPoints
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${(p.time / duration) * 1000},${180 - (p.rate / maxRate) * 180}`,
        )
        .join(" "),
    [pacingPoints, duration, maxRate],
  );

  const pacingArea = useMemo(
    () => (pacingPath ? `${pacingPath} L 1000,180 L 0,180 Z` : ""),
    [pacingPath],
  );

  const audioPath = useMemo(
    () =>
      audioPoints
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${(p.time / duration) * 1000},${180 - p.normalized * 180}`,
        )
        .join(" "),
    [audioPoints, duration],
  );

  const audioArea = useMemo(
    () => (audioPath ? `${audioPath} L 1000,180 L 0,180 Z` : ""),
    [audioPath],
  );

  const correlation = useMemo(() => {
    if (!pacingPoints.length || !audioPoints.length) return 0;
    const rates = pacingPoints.map((p) => p.rate);
    const dbs = audioPoints.map((p) => p.db);
    return calculatePearsonCorrelation(rates, dbs);
  }, [pacingPoints, audioPoints]);

  const dynamicClassification = getDynamicClassification(correlation);

  const activeTime = hover ?? time;
  const inspectedPacing = pacingAt(cuts, project.duration, window, activeTime);

  const inspectedAudioIndex = Math.min(
    audioPoints.length - 1,
    Math.max(0, Math.floor((activeTime / duration) * (audioPoints.length - 1))),
  );
  const inspectedAudio = audioPoints[inspectedAudioIndex] ?? {
    time: activeTime,
    db: -48,
    normalized: 0,
  };

  const tc = (t: number) =>
    formatTimecode(t, project.frameRate, project.dropFrame);

  const correlationClass =
    correlation >= 0.35
      ? "sync"
      : correlation <= -0.35
        ? "counterpoint"
        : "neutral";

  const metricLabel =
    stemMode === "music"
      ? "Music Sync Index"
      : stemMode === "dialogue"
        ? "Dialogue Velocity Correlation"
        : stemMode === "effects"
          ? "SFX Impact Alignment"
          : "Dynamic Index";

  return (
    <section className="panel audiovisual-rhythm">
      <div className="section-head">
        <span className="eyebrow">05 / AUDIOVISUAL RHYTHM</span>

        <div className="av-head-controls">
          <div className="av-stem-selector" role="group" aria-label="Audio stem to analyze">
            <button
              type="button"
              className={`av-stem-btn ${stemMode === "mixed" ? "active" : ""}`}
              onClick={() => setStemMode("mixed")}
            >
              Mixed Track
            </button>
            <button
              type="button"
              className={`av-stem-btn dx ${stemMode === "dialogue" ? "active" : ""}`}
              disabled={!project.dmeWaveforms?.dialogue}
              onClick={() => setStemMode("dialogue")}
              title={!project.dmeWaveforms ? "Separate DME stems on timeline first" : "Isolate Dialogue Track"}
            >
              DX (Dialogue)
            </button>
            <button
              type="button"
              className={`av-stem-btn mx ${stemMode === "music" ? "active" : ""}`}
              disabled={!project.dmeWaveforms?.music}
              onClick={() => setStemMode("music")}
              title={!project.dmeWaveforms ? "Separate DME stems on timeline first" : "Isolate Music Score"}
            >
              MX (Music)
            </button>
            <button
              type="button"
              className={`av-stem-btn fx ${stemMode === "effects" ? "active" : ""}`}
              disabled={!project.dmeWaveforms?.effects}
              onClick={() => setStemMode("effects")}
              title={!project.dmeWaveforms ? "Separate DME stems on timeline first" : "Isolate Sound Effects & Foley"}
            >
              FX (Effects)
            </button>
          </div>

          <label>
            Window{" "}
            <select
              aria-label="AV window duration"
              value={window}
              onChange={(e) => setWindow(Number(e.target.value))}
            >
              {[10, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n}s
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {!project.shots.length ? (
        <p className="rhythm-empty muted">
          Import an EDL and video file to analyze audiovisual correlation and impact cuts.
        </p>
      ) : (
        <>
          <div className="rhythm-summary av-summary">
            <span>
              At {tc(activeTime)}{" "}
              <b>{inspectedPacing.rate.toFixed(1)} cuts/min</b> | {stemMode.toUpperCase()}{" "}
              <b>{inspectedAudio.db.toFixed(1)} dBFS</b>
            </span>

            <span className={`av-correlation-badge ${correlationClass}`}>
              <span className="av-badge-dot" />
              {metricLabel}: <b>{dynamicClassification}</b> (r ={" "}
              {correlation >= 0 ? `+${correlation.toFixed(2)}` : correlation.toFixed(2)})
            </span>

            <span className="av-impact-badge">
              Impact Cuts: <b>{impactCutsList.length}</b>
            </span>
          </div>

          <div className="rhythm-explanation av-explanation">
            Correlates editing velocity with soundtrack loudness (dBFS).
            <span className="av-legend-item cutting-rate-legend">
              <span className="legend-swatch blue" /> Cutting Rate (left axis, 0–{maxRate} cuts/min)
            </span>
            <span className="av-legend-item audio-intensity-legend">
              <span
                className={`legend-swatch ${
                  stemMode === "dialogue"
                    ? "cyan"
                    : stemMode === "music"
                      ? "gold"
                      : stemMode === "effects"
                        ? "coral"
                        : "amber"
                }`}
              />{" "}
              {stemMode === "dialogue"
                ? "Dialogue (DX)"
                : stemMode === "music"
                  ? "Music (MX)"
                  : stemMode === "effects"
                    ? "Effects (FX)"
                    : "Audio Loudness"}{" "}
              (right axis, -48 to 0 dBFS)
            </span>
            <span className="av-legend-item impact-cut-legend">
              <span className="legend-swatch red" /> Impact Cut (&gt;8 dB audio spike at cut boundary)
            </span>
          </div>

          <div className="pacing-chart audiovisual-chart">
            <div className="pacing-axis left-axis">
              {[0, 0.5, 1].map((f) => (
                <span key={f} style={{ bottom: `${f * 100}%` }}>
                  {Math.round(maxRate * f)}
                </span>
              ))}
            </div>
            <div className="pacing-axis right-axis">
              {[0, 0.5, 1].map((f) => (
                <span key={f} style={{ bottom: `${f * 100}%` }}>
                  {Math.round(-48 + 48 * f)} dB
                </span>
              ))}
            </div>

            <div
              className="pacing-surface"
              role="slider"
              tabIndex={0}
              aria-label="Audiovisual rhythm seek"
              aria-valuemin={0}
              aria-valuemax={project.duration}
              aria-valuenow={Math.min(time, project.duration)}
              aria-valuetext={tc(time)}
              onKeyDown={(e) => {
                let target = time;
                if (e.key === "ArrowRight") target += 1;
                else if (e.key === "ArrowLeft") target -= 1;
                else if (e.key === "Home") target = 0;
                else if (e.key === "End") target = project.duration;
                else return;
                e.preventDefault();
                onSeek(Math.max(0, Math.min(project.duration, target)));
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const t = Math.max(
                  0,
                  Math.min(
                    project.duration,
                    ((e.clientX - rect.left) / rect.width) * project.duration,
                  ),
                );
                setHover(t);
              }}
              onMouseLeave={() => setHover(undefined)}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const t = Math.max(
                  0,
                  Math.min(
                    project.duration,
                    ((e.clientX - rect.left) / rect.width) * project.duration,
                  ),
                );
                onSeek(t);
              }}
            >
              <svg viewBox="0 0 1000 180" preserveAspectRatio="none">
                {/* Audio fill & path */}
                {audioArea && <path d={audioArea} className={`av-audio-fill ${stemMode}`} />}
                {audioPath && <path d={audioPath} className={`av-audio-path ${stemMode}`} />}

                {/* Cutting rate fill & path (Cyan / Blue) */}
                {pacingArea && <path d={pacingArea} className="av-pacing-fill" />}
                {pacingPath && <path d={pacingPath} className="av-pacing-path" />}

                {/* Impact Cut markers */}
                {impactCutsList.map((ic, i) => {
                  const x = (ic.time / duration) * 1000;
                  return (
                    <g key={i} className="impact-cut-marker">
                      <line
                        x1={x}
                        y1={0}
                        x2={x}
                        y2={180}
                        stroke="#e63946"
                        strokeDasharray="3 3"
                        strokeWidth="1.5"
                      />
                      <circle cx={x} cy={12} r={3.5} fill="#e63946" />
                    </g>
                  );
                })}

                {/* Hover line */}
                {hover !== undefined && (
                  <line
                    x1={(hover / duration) * 1000}
                    y1={0}
                    x2={(hover / duration) * 1000}
                    y2={180}
                    className="pacing-hover-line"
                  />
                )}

                {/* Current playhead line */}
                <line
                  x1={(time / duration) * 1000}
                  y1={0}
                  x2={(time / duration) * 1000}
                  y2={180}
                  className="pacing-playhead-line"
                />
              </svg>
            </div>
          </div>
        </>
      )}
    </section>
  );
});

export default AudiovisualRhythm;
