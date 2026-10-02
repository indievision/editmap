import { memo, useMemo, useState, useRef, useCallback } from "react";
import type { Project } from "../models/project";
import {
  cutTimes,
  pacingAt,
  pacingCurve,
  calculatePearsonCorrelation,
  getDynamicClassification,
  detectImpactCuts,
} from "../analysis/pacing";
import { audioIntensityCurve, type AudioPoint } from "../analysis/audio";
import { lufsToNormalized } from "../analysis/loudness";
import { formatTimecode } from "../utils/timecode";
import PolyphonicScore from "./PolyphonicScore";

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
  const [viewMode, setViewMode] = useState<"correlation" | "polyphony">("correlation");
  const [window, setWindow] = useState<number>(15);
  const [hover, setHover] = useState<number>();
  const [stemMode, setStemMode] = useState<"mixed" | "loudness" | "dialogue" | "music" | "effects">("mixed");

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

  const audioPoints: AudioPoint[] = useMemo(() => {
    if (stemMode === "loudness" && project.loudnessAnalysis) {
      const { shortTerm, binCount, duration: loudDur } = project.loudnessAnalysis;
      const count = 601;
      return Array.from({ length: count }, (_, i) => {
        const time = project.duration > 0 ? (i * project.duration) / Math.max(1, count - 1) : 0;
        const bin = Math.min(binCount - 1, Math.floor((time / (loudDur || project.duration || 1)) * binCount));
        const lufs = shortTerm[bin] ?? -60;
        const normalized = lufsToNormalized(lufs, -60, 0);
        return { time, db: lufs, normalized, peakDb: lufs, peakNormalized: normalized };
      });
    }
    return audioIntensityCurve(activeWaveform, project.duration, window);
  }, [stemMode, project.loudnessAnalysis, activeWaveform, project.duration, window]);

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

  const audioPeakPath = useMemo(() => {
    const hasPeaks = audioPoints.some(
      (p) => p.peakNormalized !== undefined && p.peakNormalized > p.normalized + 0.04,
    );
    if (!hasPeaks) return "";
    return audioPoints
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${(p.time / duration) * 1000},${180 - (p.peakNormalized ?? p.normalized) * 180}`,
      )
      .join(" ");
  }, [audioPoints, duration]);

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
          : stemMode === "loudness"
            ? "EBU R128 Loudness Correlation"
            : "Dynamic Index";

  const stemColor =
    stemMode === "dialogue"
      ? "#22d3ee"
      : stemMode === "effects"
        ? "#f97316"
        : stemMode === "loudness"
          ? "#a855f7"
          : "#f59e0b";

  return (
    <section className="panel audiovisual-rhythm">
      <div className="section-head av-section-head">
        <span className="eyebrow av-eyebrow">05 / AUDIOVISUAL RHYTHM</span>
        <div className="av-viewmode-selector" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "correlation"}
            className={`av-viewmode-btn ${viewMode === "correlation" ? "active" : ""}`}
            onClick={() => setViewMode("correlation")}
          >
            Pacing Correlation
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "polyphony"}
            className={`av-viewmode-btn ${viewMode === "polyphony" ? "active" : ""}`}
            onClick={() => setViewMode("polyphony")}
          >
            <span>🎼</span> Vertical Montage
          </button>
        </div>
      </div>

      {viewMode === "correlation" && (
        <div className="av-controls-bar">
          <div className="av-stem-selector" role="group" aria-label="Audio stem to analyze">
            <button
              type="button"
              className={`av-stem-btn ${stemMode === "mixed" ? "active" : ""}`}
              onClick={() => setStemMode("mixed")}
            >
              Mixed
            </button>
            <button
              type="button"
              className={`av-stem-btn lufs ${stemMode === "loudness" ? "active" : ""}`}
              disabled={!project.loudnessAnalysis}
              onClick={() => setStemMode("loudness")}
              title={!project.loudnessAnalysis ? "Scan EBU R128 loudness first" : "Correlate cuts with EBU R128 sustained loudness"}
            >
              EBU R128
            </button>
            <button
              type="button"
              className={`av-stem-btn dx ${stemMode === "dialogue" ? "active" : ""}`}
              disabled={!project.dmeWaveforms?.dialogue}
              onClick={() => setStemMode("dialogue")}
              title={!project.dmeWaveforms ? "Separate DME stems on timeline first" : "Isolate Dialogue Track"}
            >
              DX
            </button>
            <button
              type="button"
              className={`av-stem-btn mx ${stemMode === "music" ? "active" : ""}`}
              disabled={!project.dmeWaveforms?.music}
              onClick={() => setStemMode("music")}
              title={!project.dmeWaveforms ? "Separate DME stems on timeline first" : "Isolate Music Score"}
            >
              MX
            </button>
            <button
              type="button"
              className={`av-stem-btn fx ${stemMode === "effects" ? "active" : ""}`}
              disabled={!project.dmeWaveforms?.effects}
              onClick={() => setStemMode("effects")}
              title={!project.dmeWaveforms ? "Separate DME stems on timeline first" : "Isolate Sound Effects & Foley"}
            >
              FX
            </button>
          </div>

          <label className="av-window-label">
            <span>Window</span>
            <select
              aria-label="AV window duration"
              value={window}
              onChange={(e) => setWindow(Number(e.target.value))}
              className="av-window-select"
            >
              <option value={5}>5s (Fast)</option>
              <option value={10}>10s</option>
              <option value={15}>15s (Balanced)</option>
              <option value={30}>30s (Broad)</option>
              <option value={60}>60s</option>
            </select>
          </label>
        </div>
      )}

      {viewMode === "polyphony" ? (
        <PolyphonicScore
          project={project}
          time={time}
          onSeek={onSeek}
        />
      ) : !project.shots.length ? (
        <p className="rhythm-empty muted">
          Import an EDL and video file to analyze audiovisual correlation and impact cuts.
        </p>
      ) : (
        <>
          <div className="av-hud-row">
            <div className="av-hud-readout">
              <span className="av-hud-time">{tc(activeTime)}</span>
              <span className="av-hud-stat pacing">
                <span className="av-stat-pip blue" />
                <span className="av-stat-name">Cut Rate:</span>
                <b>{inspectedPacing.rate.toFixed(1)}</b> cuts/min
              </span>
              <span className="av-hud-sep">·</span>
              <span className="av-hud-stat audio">
                <span className="av-stat-pip" style={{ background: stemColor, boxShadow: `0 0 5px ${stemColor}` }} />
                <span className="av-stat-name">{stemMode === "loudness" ? "EBU R128" : `${stemMode.toUpperCase()}`}:</span>
                <b>{inspectedAudio.db.toFixed(1)}</b> {stemMode === "loudness" ? "LUFS" : "dBFS"}
              </span>
            </div>

            <div className={`av-correlation-badge ${correlationClass}`}>
              <span className="av-badge-dot" />
              <span className="av-badge-title">{metricLabel}:</span>
              <b>{dynamicClassification}</b>
              <span className="av-badge-r">
                (r = {correlation >= 0 ? `+${correlation.toFixed(2)}` : correlation.toFixed(2)})
              </span>
            </div>

            <div className="av-impact-badge" title="Shots cutting precisely on a >8 dB audio transient spike">
              <span className="av-impact-icon">⚡</span>
              <span>Impact Cuts:</span>
              <b>{impactCutsList.length}</b>
            </div>
          </div>

          <div className="av-legend-row">
            <span className="av-legend-item cutting-rate-legend">
              <span className="legend-line blue" />
              <span>Cutting Rate (0–{maxRate} cuts/min)</span>
            </span>
            <span className="av-legend-item audio-intensity-legend">
              <span className={`legend-line ${stemMode === "dialogue" ? "cyan" : stemMode === "music" ? "gold" : stemMode === "effects" ? "coral" : stemMode === "loudness" ? "purple" : "amber"}`} />
              <span>
                {stemMode === "loudness"
                  ? "EBU R128 Loudness (-60 to 0 LUFS)"
                  : `${stemMode === "mixed" ? "Mixed" : stemMode.toUpperCase()} Loudness (-48 to 0 dBFS)`}
              </span>
            </span>
            {audioPeakPath && (
              <span className="av-legend-item audio-peak-legend">
                <span className={`legend-dash peak ${stemMode}`} />
                <span>Peak Transients</span>
              </span>
            )}
            <span className="av-legend-item impact-cut-legend">
              <span className="legend-dash red" />
              <span>Impact Cut (&gt;8 dB audio spike at cut)</span>
            </span>
          </div>

          <div className="audiovisual-chart">
            <div className="av-axis av-axis-left" aria-hidden="true">
              <div className="av-axis-header">
                <span className="av-axis-unit-badge left">cuts/min</span>
              </div>
              <div className="av-axis-ticks">
                {[1, 0.75, 0.5, 0.25, 0].map((f) => (
                  <span
                    key={f}
                    className={`av-axis-tick ${f === 1 ? "top" : f === 0 ? "bottom" : "mid"}`}
                    style={{ top: `${(1 - f) * 100}%` }}
                  >
                    {Math.round(maxRate * f)}
                  </span>
                ))}
              </div>
            </div>

            <div className="av-surface-wrap">
              <div className="av-surface-header-spacer" />
              <div
                className="pacing-surface av-surface"
                role="slider"
                tabIndex={0}
                aria-label="Audiovisual rhythm scrub surface"
                aria-valuemin={0}
                aria-valuemax={project.duration}
                aria-valuenow={Math.min(time, project.duration)}
                aria-valuetext={tc(time)}
                style={{ cursor: "ew-resize", touchAction: "none", userSelect: "none" }}
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
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // ignore
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  const t = Math.max(
                    0,
                    Math.min(
                      project.duration,
                      ((e.clientX - rect.left) / rect.width) * project.duration,
                    ),
                  );
                  setHover(t);
                  onSeek(t);
                }}
                onPointerMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const t = Math.max(
                    0,
                    Math.min(
                      project.duration,
                      ((e.clientX - rect.left) / rect.width) * project.duration,
                    ),
                  );
                  setHover(t);
                  if (e.buttons === 1) {
                    onSeek(t);
                  }
                }}
                onPointerUp={(e) => {
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {
                    // ignore
                  }
                }}
                onMouseLeave={() => setHover(undefined)}
              >
                <svg viewBox="0 0 1000 180" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="avAudioGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.32" />
                      <stop offset="65%" stopColor="#f59e0b" stopOpacity="0.08" />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.00" />
                    </linearGradient>
                    <linearGradient id="avAudioGradDx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.32" />
                      <stop offset="65%" stopColor="#22d3ee" stopOpacity="0.08" />
                      <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.00" />
                    </linearGradient>
                    <linearGradient id="avAudioGradMx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.32" />
                      <stop offset="65%" stopColor="#f59e0b" stopOpacity="0.08" />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.00" />
                    </linearGradient>
                    <linearGradient id="avAudioGradFx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f97316" stopOpacity="0.32" />
                      <stop offset="65%" stopColor="#f97316" stopOpacity="0.08" />
                      <stop offset="100%" stopColor="#f97316" stopOpacity="0.00" />
                    </linearGradient>
                    <linearGradient id="avAudioGradLufs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity="0.32" />
                      <stop offset="65%" stopColor="#a855f7" stopOpacity="0.08" />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity="0.00" />
                    </linearGradient>
                    <linearGradient id="avPacingGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" />
                      <stop offset="65%" stopColor="#38bdf8" stopOpacity="0.07" />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.00" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal reference grid lines at 0%, 25%, 50%, 75%, 100% */}
                  <line x1="0" y1="0" x2="1000" y2="0" stroke="rgba(255, 255, 255, 0.08)" strokeDasharray="3 3" strokeWidth="1" />
                  <line x1="0" y1="45" x2="1000" y2="45" stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="3 3" strokeWidth="1" />
                  <line x1="0" y1="90" x2="1000" y2="90" stroke="rgba(255, 255, 255, 0.08)" strokeDasharray="3 3" strokeWidth="1" />
                  <line x1="0" y1="135" x2="1000" y2="135" stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="3 3" strokeWidth="1" />
                  <line x1="0" y1="180" x2="1000" y2="180" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="1" />

                  {/* Audio fill & path */}
                  {audioArea && <path d={audioArea} className={`av-audio-fill ${stemMode}`} />}
                  {audioPeakPath && <path d={audioPeakPath} className={`av-audio-peak-path ${stemMode}`} />}
                  {audioPath && <path d={audioPath} className={`av-audio-path ${stemMode}`} />}

                  {/* Cutting rate fill & path (Cyan / Blue) */}
                  {pacingArea && <path d={pacingArea} className="av-pacing-fill" />}
                  {pacingPath && <path d={pacingPath} className="av-pacing-path" />}

                  {/* Impact Cut markers with concentric radar aesthetic */}
                  {impactCutsList.map((ic, i) => {
                    const x = (ic.time / duration) * 1000;
                    return (
                      <g key={i} className="impact-cut-marker">
                        <line
                          x1={x}
                          y1={0}
                          x2={x}
                          y2={180}
                          stroke="#f43f5e"
                          strokeDasharray="3 3"
                          strokeWidth="1.2"
                          opacity="0.85"
                        />
                        <circle cx={x} cy={10} r={4.5} fill="#f43f5e" />
                        <circle cx={x} cy={10} r={7.5} fill="none" stroke="#f43f5e" strokeWidth="1" opacity="0.6" />
                      </g>
                    );
                  })}

                  {/* Hover line and guide dots */}
                  {hover !== undefined && (
                    <g className="av-hover-group" pointerEvents="none">
                      <line
                        x1={(hover / duration) * 1000}
                        y1={0}
                        x2={(hover / duration) * 1000}
                        y2={180}
                        className="pacing-hover-line"
                      />
                      <circle
                        cx={(hover / duration) * 1000}
                        cy={180 - (inspectedPacing.rate / maxRate) * 180}
                        r={4}
                        fill="#38bdf8"
                        stroke="#0c1015"
                        strokeWidth={1.5}
                      />
                      <circle
                        cx={(hover / duration) * 1000}
                        cy={180 - inspectedAudio.normalized * 180}
                        r={4}
                        fill={stemColor}
                        stroke="#0c1015"
                        strokeWidth={1.5}
                      />
                    </g>
                  )}

                  {/* Current playhead line & indicator */}
                  <g className="av-playhead-group" pointerEvents="none">
                    <line
                      x1={(time / duration) * 1000}
                      y1={0}
                      x2={(time / duration) * 1000}
                      y2={180}
                      className="pacing-playhead-line"
                    />
                    <polygon
                      points={`${(time / duration) * 1000 - 4},0 ${(time / duration) * 1000 + 4},0 ${(time / duration) * 1000},6`}
                      fill="#f8fafc"
                    />
                  </g>
                </svg>
              </div>
            </div>

            <div className={`av-axis av-axis-right ${stemMode}`} aria-hidden="true">
              <div className="av-axis-header">
                <span className={`av-axis-unit-badge right ${stemMode}`}>
                  {stemMode === "loudness" ? "LUFS" : "dBFS"}
                </span>
              </div>
              <div className="av-axis-ticks">
                {[1, 0.75, 0.5, 0.25, 0].map((f) => (
                  <span
                    key={f}
                    className={`av-axis-tick ${f === 1 ? "top" : f === 0 ? "bottom" : "mid"}`}
                    style={{ top: `${(1 - f) * 100}%` }}
                  >
                    {stemMode === "loudness"
                      ? `${Math.round(-60 + 60 * f)}`
                      : `${Math.round(-48 + 48 * f)}`}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
});

export default AudiovisualRhythm;
