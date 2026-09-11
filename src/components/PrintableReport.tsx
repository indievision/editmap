import React, { useMemo } from "react";
import type { Project, Shot } from "../models/project";
import { cutTimes, pacingCurve, computeCutShockData, sensoryShockCurve } from "../analysis/pacing";
import { framingSummary, framingSizes } from "../analysis/framing";
import { formatTimecode } from "../utils/timecode";

export interface ReportSectionConfig {
  summary: boolean;
  rhythm: boolean;
  pacing: boolean;
  framing: boolean;
  color: boolean;
  cast: boolean;
  notes: boolean;
}

export interface PrintableReportProps {
  project: Project;
  theme: "ink-saver" | "dark";
  format: "A4 Landscape" | "A4 Portrait" | "Letter";
  sections: ReportSectionConfig;
}

export function formatDurationSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0s";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 10);
  if (m > 0) return `${m}m ${s}s`;
  if (s >= 10 || ms === 0 || ms === 10) return `${s + (ms === 10 ? 1 : 0)}s`;
  return `${s}.${ms}s`;
}

export default function PrintableReport({
  project,
  theme,
  format,
  sections,
}: PrintableReportProps) {
  const shots = project.shots || [];
  const duration = project.duration || 0;
  const shotCount = shots.length;

  // Basic Stats (memoized)
  const { durations, sortedDurations, asl, medianHold, shortest, longest } = useMemo(() => {
    const durs = shots.map((s) => s.duration).filter((d) => d > 0);
    const sorted = [...durs].sort((a, b) => a - b);
    const average = shotCount > 0 ? duration / shotCount : 0;
    const median =
      sorted.length > 0
        ? sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
          : sorted[Math.floor(sorted.length / 2)]!
        : 0;
    const min = sorted.length > 0 ? sorted[0]! : 0;
    const max = sorted.length > 0 ? sorted[sorted.length - 1]! : 0;
    return { durations: durs, sortedDurations: sorted, asl: average, medianHold: median, shortest: min, longest: max };
  }, [shots, duration, shotCount]);

  const cuts = useMemo(() => cutTimes(shots), [shots]);
  const cutRate = duration > 0 ? (cuts.length * 60) / duration : 0;

  // Cut Shock & Sensory Shock Index
  const cutShockData = useMemo(() => computeCutShockData(shots), [shots]);
  const avgSensoryShock = useMemo(() => {
    if (!cutShockData.length) return 0;
    return Math.round(cutShockData.reduce((sum, c) => sum + c.shockScore, 0) / cutShockData.length);
  }, [cutShockData]);

  // Format CSS class
  const formatClass =
    format === "A4 Portrait"
      ? "format-a4-portrait"
      : format === "Letter"
        ? "format-letter"
        : "format-a4-landscape";

  const themeClass =
    theme === "dark" ? "report-theme-dark" : "report-theme-ink-saver";

  // Histogram Bins for Rhythm (Shot Hold)
  const bins = useMemo(
    () => [
      { label: "<1s", min: 0, max: 1 },
      { label: "1-2s", min: 1, max: 2 },
      { label: "2-3s", min: 2, max: 3 },
      { label: "3-4s", min: 3, max: 4 },
      { label: "4-5s", min: 4, max: 5 },
      { label: "5-7s", min: 5, max: 7 },
      { label: "7-10s", min: 7, max: 10 },
      { label: ">10s", min: 10, max: Infinity },
    ],
    [],
  );
  const binCounts = useMemo(
    () => bins.map((b) => durations.filter((d) => d >= b.min && d < b.max).length),
    [bins, durations],
  );
  const maxBinCount = Math.max(...binCounts, 1);

  // Local Pacing & Sensory Shock Curve Data
  const windowSec = Math.min(60, Math.max(10, duration / 10));
  const pacingData = useMemo(() => pacingCurve(cuts, duration, windowSec), [cuts, duration, windowSec]);
  const maxPacingRate = Math.max(...pacingData.map((p) => p.rate), 5);
  const shockData = useMemo(
    () => sensoryShockCurve(cutShockData, duration, windowSec),
    [cutShockData, duration, windowSec],
  );

  // Framing Distribution
  const framing = useMemo(() => framingSummary(shots), [shots]);
  const totalFramingSeconds = framing.total || 1;

  // Color Chronology
  const shotsWithColor = useMemo(() => shots.filter((s) => s.colorProfile), [shots]);
  const representativeShots = useMemo(() => {
    if (shotsWithColor.length <= 6) return shotsWithColor;
    const maxSamples = 6;
    const step = (shotsWithColor.length - 1) / (maxSamples - 1);
    return Array.from({ length: maxSamples }, (_, i) => shotsWithColor[Math.round(i * step)]);
  }, [shotsWithColor]);

  // Cast Screen Time
  const castMembers = project.cast || [];
  const castStats = useMemo(() => {
    return castMembers.map((member) => {
      let appearances = 0;
      let memberSeconds = 0;
      shots.forEach((shot) => {
        const charAnalysis = shot.characterAnalysis;
        if (charAnalysis) {
          const present = charAnalysis.intervals?.some((inv) => inv.memberId === member.id);
          const manualPresent = charAnalysis.manualMemberIds?.includes(member.id);
          if (present || manualPresent) {
            appearances++;
            memberSeconds += shot.duration;
          }
        }
      });
      return {
        member,
        appearances,
        seconds: memberSeconds,
        percent: duration > 0 ? (memberSeconds / duration) * 100 : 0,
      };
    });
  }, [castMembers, shots, duration]);

  // Sequences and Shot Notes
  const sequenceList = project.sequences || [];
  const annotatedShots = useMemo(
    () => shots.filter((s) => s.notes && s.notes.trim() !== ""),
    [shots],
  );

  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className={`printable-report-root ${formatClass} ${themeClass}`}>
      {/* Header */}
      <header className="report-header">
        <div className="report-header-left">
          <h1>{project.name || "Untitled Film"}</h1>
          <div className="report-meta-pills">
            <span className="report-meta-pill">
              <strong>Shots:</strong> {shotCount}
            </span>
            <span className="report-meta-pill">
              <strong>Duration:</strong> {formatTimecode(duration, project.frameRate)}
            </span>
            <span className="report-meta-pill">
              <strong>Frame Rate:</strong> {project.frameRate} fps
            </span>
            <span className="report-meta-pill">
              <strong>ASL:</strong> {asl.toFixed(2)}s
            </span>
          </div>
        </div>
        <div className="report-header-right">
          <div><strong>EDITMAP Film Analysis Report</strong></div>
          <div>{currentDate}</div>
        </div>
      </header>

      {/* Grid of Sections */}
      <div className="report-grid">
        {/* Section 1: Executive Summary & Stats */}
        {sections.summary && (
          <div className="report-card">
            <div className="report-card-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              Executive Summary & Stats
            </div>
            <div className="stats-grid">
              <div className="stat-box">
                <div className="stat-label">Total Shots</div>
                <div className="stat-value">{shotCount}</div>
                <div className="stat-sub">{cuts.length} cuts</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Average Shot Length</div>
                <div className="stat-value">{asl.toFixed(2)}s</div>
                <div className="stat-sub">ASL metric</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Median Shot Hold</div>
                <div className="stat-value">{medianHold.toFixed(2)}s</div>
                <div className="stat-sub">50th percentile</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Shortest Shot</div>
                <div className="stat-value">{shortest.toFixed(2)}s</div>
                <div className="stat-sub">Min duration</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Longest Shot</div>
                <div className="stat-value">{longest.toFixed(2)}s</div>
                <div className="stat-sub">Max duration</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Pacing Cut Rate</div>
                <div className="stat-value">{cutRate.toFixed(1)}</div>
                <div className="stat-sub">Cuts / minute</div>
              </div>
            </div>
          </div>
        )}

        {/* Section 2: Rhythm & Shot Hold Histogram */}
        {sections.rhythm && (
          <div className="report-card">
            <div className="report-card-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
              </svg>
              Rhythm & Shot Hold Histogram
            </div>
            <div style={{ height: "150px", width: "100%" }}>
              <svg width="100%" height="100%" viewBox="0 0 400 140" preserveAspectRatio="none">
                {/* Y Grid */}
                {[0.25, 0.5, 0.75, 1].map((ratio) => (
                  <line
                    key={ratio}
                    x1="30"
                    y1={120 - ratio * 100}
                    x2="390"
                    y2={120 - ratio * 100}
                    stroke="var(--report-chart-grid)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                ))}

                {/* Histogram Bars */}
                {binCounts.map((count, i) => {
                  const barWidth = 35;
                  const x = 40 + i * 44;
                  const barHeight = (count / maxBinCount) * 100;
                  const y = 120 - barHeight;
                  return (
                    <g key={i}>
                      <rect
                        x={x}
                        y={y}
                        width={barWidth}
                        height={barHeight}
                        fill="var(--report-bar-bg)"
                        rx="2"
                      />
                      {count > 0 && (
                        <text
                          x={x + barWidth / 2}
                          y={y - 4}
                          fill="var(--report-text-muted)"
                          fontSize="9"
                          textAnchor="middle"
                          fontWeight="600"
                        >
                          {count}
                        </text>
                      )}
                      <text
                        x={x + barWidth / 2}
                        y="134"
                        fill="var(--report-text-secondary)"
                        fontSize="9"
                        textAnchor="middle"
                      >
                        {bins[i].label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        )}

        {/* Section 3: Local Pacing Curve */}
        {sections.pacing && (
          <div className="report-card">
            <div className="report-card-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
              </svg>
              Local Pacing Curve (Cuts/min)
            </div>
            <div style={{ height: "150px", width: "100%" }}>
              <svg width="100%" height="100%" viewBox="0 0 400 140" preserveAspectRatio="none">
                {/* Horizontal Grid */}
                {[0, 0.33, 0.66, 1].map((ratio) => (
                  <g key={ratio}>
                    <line
                      x1="30"
                      y1={120 - ratio * 100}
                      x2="390"
                      y2={120 - ratio * 100}
                      stroke="var(--report-chart-grid)"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                    <text
                      x="25"
                      y={123 - ratio * 100}
                      fill="var(--report-text-muted)"
                      fontSize="8"
                      textAnchor="end"
                    >
                      {Math.round(ratio * maxPacingRate)}
                    </text>
                  </g>
                ))}

                {/* Pacing Curve Area & Line */}
                {pacingData.length > 1 && (() => {
                  const points = pacingData.map((pt, i) => {
                    const x = 30 + (i / (pacingData.length - 1)) * 360;
                    const y = 120 - (pt.rate / maxPacingRate) * 100;
                    return { x, y };
                  });
                  const pathD = points.reduce((acc, pt, i) => {
                    return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
                  }, "");
                  const areaD = `${pathD} L 390 120 L 30 120 Z`;

                  return (
                    <g>
                      <path d={areaD} fill="var(--report-chart-fill)" />
                      <path
                        d={pathD}
                        fill="none"
                        stroke="var(--report-chart-line)"
                        strokeWidth="2"
                      />
                    </g>
                  );
                })()}

                {/* Sensory Shock Overlay Curve */}
                {shockData.length > 1 && (() => {
                  const points = shockData.map((pt, i) => {
                    const x = 30 + (i / (shockData.length - 1)) * 360;
                    const y = 120 - (pt.shockScore / 100) * 100;
                    return { x, y };
                  });
                  const shockPathD = points.reduce((acc, pt, i) => {
                    return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
                  }, "");
                  return (
                    <path
                      d={shockPathD}
                      fill="none"
                      stroke="#c084fc"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                  );
                })()}

                {/* X Axis Time Labels */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                  const sec = ratio * duration;
                  const x = 30 + ratio * 360;
                  return (
                    <text
                      key={ratio}
                      x={x}
                      y="134"
                      fill="var(--report-text-secondary)"
                      fontSize="9"
                      textAnchor="middle"
                    >
                      {formatTimecode(sec, project.frameRate)}
                    </text>
                  );
                })}
              </svg>
            </div>
            <div style={{ display: "flex", gap: "14px", fontSize: "10px", marginTop: "6px", color: "var(--report-text-muted)" }}>
              <span><span style={{ display: "inline-block", width: "12px", height: "3px", backgroundColor: "var(--report-chart-line)", marginRight: "5px", verticalAlign: "middle" }} />Cuts / min (left axis)</span>
              <span><span style={{ display: "inline-block", width: "12px", height: "3px", backgroundColor: "#c084fc", marginRight: "5px", verticalAlign: "middle" }} />Sensory Shock 0-100 (dashed)</span>
            </div>
          </div>
        )}

        {/* Section 4: Framing Scale Distribution */}
        {sections.framing && (
          <div className="report-card">
            <div className="report-card-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              Framing Scale Distribution
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {framing.bins
                .filter((b) => b.count > 0 || framingSizes.includes(b.size as any))
                .slice(0, 7)
                .map((b) => {
                  const percent = (b.seconds / totalFramingSeconds) * 100;
                  return (
                    <div key={b.size} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px" }}>
                      <div style={{ width: "40px", fontWeight: "600", color: "var(--report-text-primary)" }}>
                        {b.size}
                      </div>
                      <div style={{ flex: 1, background: "var(--report-card-border)", height: "12px", borderRadius: "3px", overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(0, percent))}%`,
                            height: "100%",
                            background: "var(--report-bar-bg)",
                            borderRadius: "3px",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                      <div style={{ width: "65px", textAlign: "right", color: "var(--report-text-muted)" }}>
                        {b.count} ({percent.toFixed(1)}%)
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Section 5: Color Chronology */}
        {sections.color && (
          <div className="report-card full-width">
            <div className="report-card-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 2a7 7 0 1 0 10 10"></path>
              </svg>
              Color Chronology & Dominant Palettes
            </div>
            {shotsWithColor.length > 0 ? (
              <div>
                <div style={{ display: "flex", width: "100%", height: "24px", borderRadius: "6px", overflow: "hidden", border: "1px solid var(--report-card-border)", marginBottom: "12px" }}>
                  {shots.map((shot) => {
                    const widthPercent = duration > 0 ? (shot.duration / duration) * 100 : 100 / Math.max(1, shots.length);
                    const topColor = shot.colorProfile?.palette?.[0] || "#3b4145";
                    return (
                      <div
                        key={shot.id}
                        style={{
                          width: `${widthPercent}%`,
                          height: "100%",
                          backgroundColor: topColor,
                        }}
                        title={`Shot #${shot.index + 1}: ${shot.colorProfile?.mood || "Unscanned"}`}
                      />
                    );
                  })}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "8px" }}>
                  {representativeShots.map((shot) => (
                    <div key={shot.id} style={{ background: "var(--report-bg)", border: "1px solid var(--report-card-border)", borderRadius: "6px", padding: "8px" }}>
                      <div style={{ fontSize: "10px", fontWeight: "600", color: "var(--report-text-primary)", marginBottom: "4px" }}>
                        Shot #{shot.index + 1} ({formatDurationSeconds(shot.duration)})
                      </div>
                      <div style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                        {shot.colorProfile?.palette?.slice(0, 4).map((c, i) => (
                          <div key={i} style={{ width: "16px", height: "16px", borderRadius: "3px", backgroundColor: c, border: "1px solid rgba(0,0,0,0.1)" }} />
                        ))}
                      </div>
                      <div style={{ fontSize: "9px", color: "var(--report-text-muted)" }}>
                        {shot.colorProfile?.mood || "Extracted profile"}{shot.colorProfile?.harmony?.label ? ` · ${shot.colorProfile.harmony.label}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: "var(--report-text-muted)", fontStyle: "italic" }}>
                No extracted color profiles in current project. Run color analysis to include chromatic chronology.
              </div>
            )}
          </div>
        )}

        {/* Section 6: Cast Screen Time */}
        {sections.cast && (
          <div className="report-card full-width">
            <div className="report-card-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              Cast Screen Time & Appearances
            </div>
            {castStats.length > 0 ? (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Character</th>
                    <th>Appearances</th>
                    <th>Estimated Screen Time</th>
                    <th>% of Total Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {castStats.map((item) => (
                    <tr key={item.member.id}>
                      <td style={{ fontWeight: "600" }}>{item.member.name}</td>
                      <td>{item.appearances} shots</td>
                      <td>{formatDurationSeconds(item.seconds)}</td>
                      <td>{item.percent.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize: "12px", color: "var(--report-text-muted)", fontStyle: "italic" }}>
                No cast members defined in project cast gallery.
              </div>
            )}
          </div>
        )}

        {/* Section 7: Sequence & Editorial Notes */}
        {sections.notes && (
          <div className="report-card full-width">
            <div className="report-card-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              Sequence Markers & Editorial Notes
            </div>
            {sequenceList.length > 0 || annotatedShots.length > 0 ? (
              <div>
                {sequenceList.length > 0 && (
                  <table className="report-table" style={{ marginBottom: "12px" }}>
                    <thead>
                      <tr>
                        <th>Sequence Name</th>
                        <th>Start - End Time</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sequenceList.map((seq) => (
                        <tr key={seq.id}>
                          <td style={{ fontWeight: "600" }}>{seq.name}</td>
                          <td>
                            {formatTimecode(seq.startSeconds, project.frameRate)} -{" "}
                            {formatTimecode(seq.endSeconds, project.frameRate)}
                          </td>
                          <td>{seq.notes || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {annotatedShots.length > 0 && (
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--report-text-secondary)", marginBottom: "4px" }}>
                      Annotated Shots
                    </div>
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th>Shot #</th>
                          <th>Timecode</th>
                          <th>Framing</th>
                          <th>Editorial Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {annotatedShots.map((shot) => (
                          <tr key={shot.id}>
                            <td style={{ fontWeight: "600" }}>#{shot.index + 1}</td>
                            <td>{shot.startTimecode}</td>
                            <td>{shot.shotSize}</td>
                            <td>{shot.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: "var(--report-text-muted)", fontStyle: "italic" }}>
                No sequence markers or shot notes present in project.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
