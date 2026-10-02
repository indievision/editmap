import { memo, useMemo, useRef, useCallback } from "react";
import type { Project, Shot, LoudnessAnalysis } from "../models/project";
import { classifyDynamicContrast, getShotLoudness, lufsToNormalized } from "../analysis/loudness";
import { formatTimecode } from "../utils/timecode";

interface LoudnessReadingProps {
  project: Project;
  analysis?: LoudnessAnalysis;
  currentTime: number;
  selectedShot?: Shot;
  isScanning: boolean;
  status: string;
  onScan: () => void;
  onCancel: () => void;
  onSeek: (time: number) => void;
}

export default memo(function LoudnessReading({
  project,
  analysis,
  currentTime,
  selectedShot,
  isScanning,
  status,
  onScan,
  onCancel,
  onSeek,
}: LoudnessReadingProps) {
  const duration = project.duration || 1;
  const tc = (t: number) => formatTimecode(t, project.frameRate, project.dropFrame);

  const dynamicContrast = useMemo(() => {
    if (!analysis) return null;
    return classifyDynamicContrast(analysis.loudnessRange);
  }, [analysis]);

  const selectedShotMetrics = useMemo(() => {
    if (!analysis || !selectedShot) return null;
    const shotIndex = project.shots.findIndex((s) => s.id === selectedShot.id);
    const prevShot = shotIndex > 0 ? project.shots[shotIndex - 1] : undefined;
    return getShotLoudness(selectedShot, analysis, prevShot);
  }, [analysis, selectedShot, project.shots]);

  // Current playhead loudness interpolation
  const currentLoudness = useMemo(() => {
    if (!analysis || !analysis.momentary.length) return null;
    const binDuration = duration / analysis.binCount;
    const bin = Math.max(
      0,
      Math.min(analysis.binCount - 1, Math.floor(currentTime / binDuration)),
    );
    return {
      momentary: analysis.momentary[bin] ?? -70,
      shortTerm: analysis.shortTerm[bin] ?? -70,
      truePeak: analysis.truePeaks[bin] ?? -70,
    };
  }, [analysis, currentTime, duration]);

  // SVG mini-contour for program loudness
  const svgPaths = useMemo(() => {
    if (!analysis || !analysis.momentary.length) return null;
    const count = analysis.binCount;
    const mPoints = analysis.momentary.map((lufs, i) => {
      const x = (i / (count - 1)) * 1000;
      const norm = lufsToNormalized(lufs, -60, 0);
      const y = 140 - norm * 130;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const sPoints = analysis.shortTerm.map((lufs, i) => {
      const x = (i / (count - 1)) * 1000;
      const norm = lufsToNormalized(lufs, -60, 0);
      const y = 140 - norm * 130;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const targetY = 140 - lufsToNormalized(-23, -60, 0) * 130;

    return {
      momentary: mPoints.join(" "),
      momentaryArea: `${mPoints.join(" ")} L 1000,140 L 0,140 Z`,
      shortTerm: sPoints.join(" "),
      targetY,
    };
  }, [analysis]);

  return (
    <section className="loudness-reading panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">LOUDNESS & DYNAMIC CONTRAST</span>
          <span className="muted">
            ITU-R BS.1770 / EBU R128 measurement: Momentary, short-term, loudness range (LRA), and true peaks.
          </span>
        </div>
        <div className="loudness-actions">
          {isScanning ? (
            <div className="loudness-scanning-indicator">
              <span className="dme-spinner" />
              <span>{status || "Measuring loudness…"}</span>
              <button type="button" onClick={onCancel} className="btn-cancel">
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={analysis ? "btn-secondary" : "btn-primary"}
              onClick={onScan}
              disabled={!project.videoMetadata}
              title={
                !project.videoMetadata
                  ? "Connect a video file first"
                  : analysis
                    ? "Re-run EBU R128 loudness scan"
                    : "Analyze film loudness and dynamic contrast"
              }
            >
              {analysis ? "↻ Re-scan Loudness" : "Scan Loudness (EBU R128)"}
            </button>
          )}
        </div>
      </div>

      {!analysis ? (
        <div className="loudness-empty muted">
          <p>
            Raw waveform height reflects unweighted peak voltage, which obscures human loudness perception.
          </p>
          <p>
            Scan with <b>EBU R128</b> to reveal <b>momentary spikes</b>, <b>sustained short-term intensity</b>, <b>loudness range (LRA)</b>, and <b>true peaks</b> across cuts and scenes.
          </p>
        </div>
      ) : (
        <div className="loudness-body">
          {/* Top Metric Cards */}
          <div className="loudness-grid">
            <div className="loudness-card">
              <div className="loudness-card-label">Integrated Loudness (I)</div>
              <div className="loudness-card-value">
                {analysis.integratedLoudness.toFixed(1)} <span className="unit">LUFS</span>
              </div>
              <div className="loudness-card-sub">
                Reference: <b>-23.0 LUFS</b> (
                {analysis.integratedLoudness >= -23.5 && analysis.integratedLoudness <= -22.5
                  ? "At reference ±0.5 LU"
                  : `${(analysis.integratedLoudness - -23.0).toFixed(1)} LU from reference`}
                )
              </div>
            </div>

            <div className="loudness-card">
              <div className="loudness-card-label">Dynamic Contrast (LRA)</div>
              <div className="loudness-card-value">
                {analysis.loudnessRange.toFixed(1)} <span className="unit">LU</span>
              </div>
              <div className="loudness-card-sub">
                <span className={`dynamic-contrast-badge ${dynamicContrast?.badgeClass}`}>
                  {dynamicContrast?.level}
                </span>{" "}
                Span: {analysis.lraLow.toFixed(1)} to {analysis.lraHigh.toFixed(1)} LUFS
              </div>
            </div>

            <div className="loudness-card">
              <div className="loudness-card-label">Max True Peak (TPK)</div>
              <div
                className={`loudness-card-value ${
                  analysis.truePeak > -1.0 ? "warning-peak" : ""
                }`}
              >
                {analysis.truePeak.toFixed(1)} <span className="unit">dBTP</span>
              </div>
              <div className="loudness-card-sub">
                {analysis.truePeak <= -1.0 ? (
                  <span className="text-safe">✓ Inter-sample ceiling safe (≤ -1.0 dBTP)</span>
                ) : (
                  <span className="text-warn">⚠ Risk of inter-sample clipping (&gt; -1.0 dBTP)</span>
                )}
              </div>
            </div>

            <div className="loudness-card">
              <div className="loudness-card-label">Peak Intensity</div>
              <div className="loudness-card-value">
                {analysis.maxShortTerm.toFixed(1)} <span className="unit">LUFS</span>
              </div>
              <div className="loudness-card-sub">
                Max Momentary: <b>{analysis.maxMomentary.toFixed(1)} LUFS</b>
              </div>
            </div>
          </div>

          {/* Interactive Program Contour Chart */}
          <div className="loudness-chart-container">
            <div className="loudness-chart-header">
              <div className="loudness-chart-legend">
                <span className="legend-item short-term">
                  <span className="swatch amber-thick" /> Sustained Short-Term (3s, LUFS)
                </span>
                <span className="legend-item momentary">
                  <span className="swatch amber-light" /> Momentary (400ms, LUFS)
                </span>
                <span className="legend-item target-line">
                  <span className="swatch target-dash" /> -23 LUFS Reference
                </span>
              </div>

              {currentLoudness && (
                <div className="loudness-cursor-readout">
                  At {tc(currentTime)}: Momentary <b>{currentLoudness.momentary.toFixed(1)} LUFS</b> · Short-Term <b>{currentLoudness.shortTerm.toFixed(1)} LUFS</b> · Peak <b>{currentLoudness.truePeak.toFixed(1)} dBTP</b>
                </div>
              )}
            </div>

            {svgPaths && (
              <div
                className="loudness-svg-surface"
                style={{ cursor: "ew-resize", touchAction: "none", userSelect: "none" }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // ignore
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  const targetTime = ((e.clientX - rect.left) / rect.width) * duration;
                  onSeek(Math.max(0, Math.min(duration, targetTime)));
                }}
                onPointerMove={(e) => {
                  if (e.buttons === 1) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const targetTime = ((e.clientX - rect.left) / rect.width) * duration;
                    onSeek(Math.max(0, Math.min(duration, targetTime)));
                  }
                }}
                onPointerUp={(e) => {
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {
                    // ignore
                  }
                }}
              >
                <svg viewBox="0 0 1000 140" preserveAspectRatio="none" className="loudness-svg">
                  {/* Target line (-23 LUFS) */}
                  <line
                    x1="0"
                    y1={svgPaths.targetY}
                    x2="1000"
                    y2={svgPaths.targetY}
                    className="target-reference-line"
                  />
                  {/* Momentary area and line */}
                  <path d={svgPaths.momentaryArea} className="momentary-area" />
                  <path d={svgPaths.momentary} className="momentary-path" />
                  {/* Short-term line (sustained intensity) */}
                  <path d={svgPaths.shortTerm} className="short-term-path" />

                  {/* Playhead indicator */}
                  <line
                    x1={(currentTime / duration) * 1000}
                    y1="0"
                    x2={(currentTime / duration) * 1000}
                    y2="140"
                    className="playhead-line"
                  />
                </svg>
                <div className="loudness-axis-labels">
                  <span>0 LUFS</span>
                  <span style={{ top: `${(svgPaths.targetY / 140) * 100}%` }}>-23 LUFS</span>
                  <span>-60 LUFS</span>
                </div>
              </div>
            )}
          </div>

          {/* Selected Shot Loudness Inspection */}
          {selectedShot && selectedShotMetrics && (
            <div className="loudness-shot-panel">
              <div className="shot-panel-title">
                <b>Shot #{selectedShot.index} Loudness:</b> {tc(selectedShot.startSeconds)} – {tc(selectedShot.endSeconds)} ({selectedShot.duration.toFixed(2)}s)
              </div>
              <div className="shot-metrics-row">
                <span>Avg Momentary: <b>{selectedShotMetrics.avgMomentary.toFixed(1)} LUFS</b></span>
                <span>Max Short-Term: <b>{selectedShotMetrics.maxShortTerm.toFixed(1)} LUFS</b></span>
                <span>True Peak: <b>{selectedShotMetrics.peakTruePeak.toFixed(1)} dBTP</b></span>
                {selectedShotMetrics.entranceDelta !== undefined && (
                  <span
                    className={
                      selectedShotMetrics.isQuietToLoudTransition
                        ? "text-loud-jump"
                        : "text-neutral-jump"
                    }
                  >
                    Cut Entrance: <b>{selectedShotMetrics.entranceDelta >= 0 ? `+${selectedShotMetrics.entranceDelta}` : selectedShotMetrics.entranceDelta} LU</b>
                    {selectedShotMetrics.isQuietToLoudTransition && " (Quiet-to-Loud Cut)"}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Transitions List */}
          {analysis.transitions.length > 0 && (
            <div className="loudness-transitions-list">
              <div className="transitions-head">
                <b>Quiet-to-Loud Transitions & Dynamic Shifts ({analysis.transitions.length})</b>
                <span className="muted">Jumps &gt; 6 LUFS indicating sudden sound arrival or abrupt cut transitions.</span>
              </div>
              <div className="transitions-table-wrap">
                <table className="transitions-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Type</th>
                      <th>Jump (Δ LUFS)</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.transitions.map((t, idx) => (
                      <tr key={`${t.time}-${idx}`}>
                        <td className="mono">{tc(t.time)}</td>
                        <td>
                          <span
                            className={`transition-type-badge ${
                              t.type === "quiet-to-loud" ? "jump" : "drop"
                            }`}
                          >
                            {t.type === "quiet-to-loud" ? "↑ Quiet → Loud" : "↓ Loud → Quiet"}
                          </span>
                        </td>
                        <td className="mono font-bold">
                          {t.deltaLufs >= 0 ? `+${t.deltaLufs.toFixed(1)}` : t.deltaLufs.toFixed(1)} LU
                        </td>
                        <td className="mono">{t.fromLufs.toFixed(1)} LUFS</td>
                        <td className="mono">{t.toLufs.toFixed(1)} LUFS</td>
                        <td>
                          <button
                            type="button"
                            className="btn-seek-mini"
                            onClick={() => onSeek(t.time)}
                          >
                            Seek
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
});
