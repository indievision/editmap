import { useState, useMemo, useRef, useCallback } from "react";
import { usePlayhead } from "../playback/playhead";
import type { Project, Shot, HarmonyType } from "../models/project";
import { formatTimecode } from "../utils/timecode";
export interface ColorDrawerProps {
  project: Project;
  shot?: Shot;
  thumbnails?: Record<string, string>;
  selected?: string;
  onSelect: (shotId: string) => void;
  /** False while the component is hidden, so it stops following the playback clock. */
  active?: boolean;
  onSeek: (seconds: number) => void;
  onClose: () => void;
  onOpenCompare?: (measure: "luminance") => void;
}

export type ColorDrawerView = "script" | "lighting";

export default function ColorDrawer({
  project,
  shot,
  thumbnails = {},
  selected,
  onSelect,
  onSeek,
  active = true,
  onClose,
  onOpenCompare,
}: ColorDrawerProps) {
  const time = usePlayhead(active);
  const [activeView, setActiveView] = useState<ColorDrawerView>("script");
  const [hoveredShot, setHoveredShot] = useState<Shot | null>(null);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [filterTab, setFilterTab] = useState<"harmony" | "mood">("harmony");
  const [activeMoodFilter, setActiveMoodFilter] = useState<string | null>(null);
  const [activeHarmonyFilter, setActiveHarmonyFilter] = useState<HarmonyType | null>(null);

  const duration = Math.max(project.duration, 1);
  const shots = project.shots;

  // Selected shot or active shot fallback
  const activeShot = shot || (selected ? shots.find((s) => s.id === selected) : shots[0]);
  const activeShotId = activeShot?.id;

  // Real statistics from scanned shots
  const stats = useMemo(() => {
    let warmCount = 0;
    let coolCount = 0;
    let lowKeyCount = 0;
    let highKeyCount = 0;
    const moodCounts: Record<string, number> = {};
    const harmonyCounts: Record<HarmonyType, number> = {
      "teal-orange": 0,
      complementary: 0,
      analogous: 0,
      monochromatic: 0,
      triadic: 0,
      neutral: 0,
    };

    shots.forEach((s) => {
      const p = s.colorProfile;
      if (!p) return;
      if (p.temperature > 0.1) warmCount++;
      else if (p.temperature < -0.1) coolCount++;

      if (p.luminance < 0.25) lowKeyCount++;
      else if (p.luminance > 0.7) highKeyCount++;

      if (p.mood) {
        moodCounts[p.mood] = (moodCounts[p.mood] || 0) + 1;
      }

      if (p.harmony?.type) {
        harmonyCounts[p.harmony.type] = (harmonyCounts[p.harmony.type] || 0) + 1;
      }
    });

    const scannedCount = shots.filter((s) => s.colorProfile).length;
    const denominator = scannedCount || 1;

    return {
      scannedCount,
      warmPct: Math.round((warmCount / denominator) * 100),
      coolPct: Math.round((coolCount / denominator) * 100),
      lowKeyPct: Math.round((lowKeyCount / denominator) * 100),
      highKeyPct: Math.round((highKeyCount / denominator) * 100),
      tealOrangePct: Math.round((harmonyCounts["teal-orange"] / denominator) * 100),
      moodCounts,
      harmonyCounts,
    };
  }, [shots]);

  // SVG curve points for Luminance and Temperature
  const curvePoints = useMemo(() => {
    if (!shots.length) return { lumaPath: "", tempPath: "", points: [], timeTicks: [] };

    const svgWidth = 800;
    const svgHeight = 150;
    const paddingLeft = 20;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 20;
    const chartHeight = svgHeight - paddingTop - paddingBottom;
    const chartWidth = svgWidth - paddingLeft - paddingRight;

    const points = shots.map((s) => {
      const midTime = (s.startSeconds + s.endSeconds) / 2;
      const x = paddingLeft + (midTime / duration) * chartWidth;

      const luma = s.colorProfile?.luminance ?? 0.5;
      const lumaY = paddingTop + (1 - luma) * chartHeight;

      const temp = s.colorProfile?.temperature ?? 0;
      const normalizedTemp = (temp + 1) / 2;
      const tempY = paddingTop + (1 - normalizedTemp) * chartHeight;

      return { x, lumaY, tempY, shot: s, luma, temp };
    });

    const lumaPath = points.reduce((acc, p, idx) => {
      return `${acc} ${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.lumaY.toFixed(1)}`;
    }, "");

    const tempPath = points.reduce((acc, p, idx) => {
      return `${acc} ${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.tempY.toFixed(1)}`;
    }, "");

    // 5 time ticks across duration
    const timeTicks = [0, 0.25, 0.5, 0.75, 1.0].map((ratio) => {
      const sec = ratio * duration;
      return {
        sec,
        label: formatTimecode(sec, project.frameRate, project.dropFrame),
      };
    });

    return { lumaPath, tempPath, points, timeTicks };
  }, [shots, duration, project.frameRate, project.dropFrame]);

  // Synchronized playhead line position
  const playheadRatio = duration > 0 ? Math.max(0, Math.min(duration, time)) / duration : 0;
  const playheadSvgX = 20 + playheadRatio * 760;

  // Pointer-capture drag seeking for lighting curves
  const isDraggingLightingRef = useRef(false);

  const seekFromLightingClientX = useCallback(
    (clientX: number, containerEl: HTMLElement) => {
      if (duration <= 0) return;
      const rect = containerEl.getBoundingClientRect();
      const margin = (20 / 800) * rect.width;
      const curveWidth = (760 / 800) * rect.width;
      const x = clientX - rect.left - margin;
      const ratio = Math.max(0, Math.min(1, x / Math.max(1, curveWidth)));
      onSeek(ratio * duration);
    },
    [duration, onSeek],
  );

  const handleLightingPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    isDraggingLightingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    seekFromLightingClientX(e.clientX, e.currentTarget);
  };

  const handleLightingPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingLightingRef.current) return;
    seekFromLightingClientX(e.clientX, e.currentTarget);
  };

  const handleLightingPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingLightingRef.current) return;
    isDraggingLightingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // Pointer-capture drag seeking for barcode track
  const isDraggingBarcodeRef = useRef(false);
  const hasDraggedBarcodeRef = useRef(false);

  const seekFromBarcodeClientX = useCallback(
    (clientX: number, containerEl: HTMLElement) => {
      if (duration <= 0) return;
      const rect = containerEl.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      onSeek(ratio * duration);
    },
    [duration, onSeek],
  );

  const handleBarcodePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    isDraggingBarcodeRef.current = true;
    hasDraggedBarcodeRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    seekFromBarcodeClientX(e.clientX, e.currentTarget);
  };

  const handleBarcodePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingBarcodeRef.current) return;
    hasDraggedBarcodeRef.current = true;
    seekFromBarcodeClientX(e.clientX, e.currentTarget);
  };

  const handleBarcodePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingBarcodeRef.current) return;
    isDraggingBarcodeRef.current = false;
    // The strip captured the pointer on press, so the browser sends the click to
    // the strip and never to the slice under the cursor. For a plain click (not a
    // drag), select the shot at that position here so the reading follows it.
    if (e.type === "pointerup" && !hasDraggedBarcodeRef.current && duration > 0 && shots.length) {
      const rect = e.currentTarget.getBoundingClientRect();
      const time = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))) * duration;
      const hit = shots.find((s) => time >= s.startSeconds && time < s.endSeconds) ?? shots[shots.length - 1];
      if (hit) onSelect(hit.id);
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  return (
    <div className="color-drawer panel" aria-label="Color reading drawer">
      {/* 1. Header */}
      <div className="color-drawer-head">
        <div className="color-drawer-title-group">
          <p className="color-drawer-subtitle">Palette, light, and tonal structure</p>
        </div>
        <button
          type="button"
          className="color-drawer-close-btn"
          onClick={onClose}
          aria-label="Close color drawer"
          title="Close color drawer (Esc)"
        >
          ✕
        </button>
      </div>

      {/* 2. Subtabs Navigation */}
      <div className="color-drawer-tabs" role="tablist" aria-label="Color reading views">
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "script"}
          className={`color-drawer-tab ${activeView === "script" ? "active" : ""}`}
          onClick={() => setActiveView("script")}
        >
          Color script
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "lighting"}
          className={`color-drawer-tab ${activeView === "lighting" ? "active" : ""}`}
          onClick={() => setActiveView("lighting")}
        >
          Lighting
        </button>
      </div>

      {/* 3. Drawer Scrollable Body */}
      <div className="color-drawer-body">
        {/* VIEW 1: COLOR SCRIPT (Default) */}
        {activeView === "script" && (
          <div className="color-view-script">
            {/* Selected Shot Card & Palette Swatches */}
            <div className="color-selected-card">
              <div className="color-card-thumb-wrap">
                {activeShot && thumbnails[activeShot.id] ? (
                  <img
                    src={thumbnails[activeShot.id]}
                    alt={`Shot ${activeShot.index}`}
                    className="color-card-thumb"
                  />
                ) : (
                  <div className="color-card-thumb-empty">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <circle cx="8.5" cy="10.5" r="2" />
                      <path d="M21 16l-5-5-4 4-2-2-6 6" />
                    </svg>
                  </div>
                )}
              </div>

              <div className="color-card-info">
                <div className="color-card-meta">
                  {activeShot ? (
                    <span className="color-card-title">
                      Shot {String(activeShot.index).padStart(3, "0")} ·{" "}
                      {formatTimecode(activeShot.startSeconds, project.frameRate, project.dropFrame)} ·{" "}
                      {activeShot.duration.toFixed(1)}s
                    </span>
                  ) : (
                    <span className="color-card-title muted">No shot selected</span>
                  )}
                </div>

                {activeShot?.colorProfile?.palette && activeShot.colorProfile.palette.length > 0 ? (
                  <div className="color-swatches-grid">
                    {activeShot.colorProfile.palette.map((hex, idx) => (
                      <div key={idx} className="color-swatch-item">
                        <div
                          className="color-swatch-box"
                          style={{ backgroundColor: hex }}
                          title={`Hex: ${hex}`}
                        />
                        <span className="color-swatch-hex">{hex.toUpperCase()}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="color-swatches-empty">
                    <span className="muted">No sampled palette for this shot.</span>
                  </div>
                )}
                {activeShot?.colorProfile?.temporal && (
                  <p className="muted">
                    {activeShot.colorProfile.temporal.changed
                      ? `Interior colour change ${Math.round(activeShot.colorProfile.temporal.changeScore * 100)}% · ${activeShot.colorProfile.temporal.samples.length} samples`
                      : `Interior colour stable · ${activeShot.colorProfile.temporal.samples.length} samples`}
                  </p>
                )}
              </div>
            </div>

            {/* Movie Color Script Barcode */}
            <div className="color-section-block">
              <div className="color-section-header">
                <h3 className="color-section-title">Movie Color Script</h3>
                <span className="color-section-subtitle">Proportional shot palette barcode</span>
              </div>

              <div
                className="color-barcode-strip"
                role="region"
                aria-label="Movie Color Script Barcode"
                style={{ cursor: "ew-resize", touchAction: "none", userSelect: "none" }}
                onPointerDown={handleBarcodePointerDown}
                onPointerMove={handleBarcodePointerMove}
                onPointerUp={handleBarcodePointerUp}
                onPointerCancel={handleBarcodePointerUp}
              >
                {shots.map((s) => {
                  const widthPct = (s.duration / duration) * 100;
                  const primaryColor = s.colorProfile?.palette[0] || "#2a2f3a";
                  const isSelected = activeShotId === s.id;
                  const isFilteredOut =
                    (activeMoodFilter && s.colorProfile?.mood !== activeMoodFilter) ||
                    (activeHarmonyFilter && s.colorProfile?.harmony?.type !== activeHarmonyFilter);

                  return (
                    <div
                      key={s.id}
                      className={`barcode-slice ${isSelected ? "selected" : ""} ${isFilteredOut ? "dimmed" : ""}`}
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: primaryColor,
                      }}
                      onMouseEnter={() => setHoveredShot(s)}
                      onMouseLeave={() => setHoveredShot(null)}
                      onClick={() => {
                        if (hasDraggedBarcodeRef.current) return;
                        onSelect(s.id);
                        onSeek(s.startSeconds);
                      }}
                      title={`Shot ${s.index} · ${formatTimecode(s.startSeconds, project.frameRate, project.dropFrame)}`}
                    />
                  );
                })}
              </div>
              <p className="barcode-caption">Click or drag along the strip to seek in time.</p>
            </div>

            {/* Lighting & Temperature Rhythm (Integrated preview in Script view) */}
            <div className="color-section-block">
              <div className="color-section-header">
                <h3 className="color-section-title">Lighting & temperature rhythm</h3>
                <div className="curve-legend-inline">
                  <span className="curve-legend-item luma">
                    <span className="legend-line white" /> Luminance
                  </span>
                  <span className="curve-legend-item temp">
                    <span className="legend-line gold" /> Temperature
                  </span>
                  {onOpenCompare && (
                    <button
                      type="button"
                      className="panel-compare-launch-btn"
                      onClick={() => onOpenCompare("luminance")}
                      title="Open analytical curve comparison with Luminance"
                      aria-label="Compare Luminance with other measures"
                    >
                      Compare ↗
                    </button>
                  )}
                </div>
              </div>

              <div className="lighting-chart-wrap">
                <div className="lighting-y-labels">
                  <span className="y-label top">Bright</span>
                  <span className="y-label bottom">Dark</span>
                </div>

                <div
                  className="lighting-svg-container"
                  style={{ cursor: "ew-resize", touchAction: "none", userSelect: "none" }}
                  onPointerDown={handleLightingPointerDown}
                  onPointerMove={handleLightingPointerMove}
                  onPointerUp={handleLightingPointerUp}
                  onPointerCancel={handleLightingPointerUp}
                >
                  <svg viewBox="0 0 800 150" preserveAspectRatio="none" className="lighting-svg">
                    {/* Grid lines */}
                    <line x1="20" y1="20" x2="780" y2="20" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                    <line x1="20" y1="75" x2="780" y2="75" stroke="rgba(255,255,255,0.1)" />
                    <line x1="20" y1="130" x2="780" y2="130" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />

                    {/* Temperature Curve */}
                    {curvePoints.tempPath && (
                      <path
                        d={curvePoints.tempPath}
                        fill="none"
                        stroke="url(#colorDrawerTempGrad)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}

                    {/* Luminance Curve */}
                    {curvePoints.lumaPath && (
                      <path
                        d={curvePoints.lumaPath}
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}

                    {/* Golden Playhead Needle */}
                    <line
                      x1={playheadSvgX}
                      y1="8"
                      x2={playheadSvgX}
                      y2="142"
                      stroke="#fbbf24"
                      strokeWidth="2"
                    />

                    <defs>
                      <linearGradient id="colorDrawerTempGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#e5a444" />
                        <stop offset="50%" stopColor="#888888" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#3498db" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </div>

              {/* Timecode X-Axis */}
              <div className="lighting-x-axis">
                {curvePoints.timeTicks.map((tick, i) => (
                  <span key={i} className="time-tick-label">
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Filter Palette Reading (Secondary Expandable Control) */}
            <div className="color-filter-accordion">
              <div
                className="color-filter-bar"
                onClick={() => setFilterExpanded(!filterExpanded)}
              >
                <div className="color-filter-left">
                  <span className={`color-filter-caret ${filterExpanded ? "expanded" : ""}`}>
                    ›
                  </span>
                  <span className="color-filter-title">Filter palette reading</span>
                </div>

                <div className="color-filter-tabs" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={`filter-tab-pill ${filterTab === "harmony" ? "active" : ""}`}
                    onClick={() => {
                      setFilterTab("harmony");
                      setFilterExpanded(true);
                    }}
                  >
                    Harmony
                  </button>
                  <button
                    type="button"
                    className={`filter-tab-pill ${filterTab === "mood" ? "active" : ""}`}
                    onClick={() => {
                      setFilterTab("mood");
                      setFilterExpanded(true);
                    }}
                  >
                    Mood
                  </button>
                </div>
              </div>

              {filterExpanded && (
                <div className="color-filter-content">
                  {filterTab === "harmony" && (
                    <div className="filter-chips-row" role="group" aria-label="Color harmony filters">
                      <button
                        type="button"
                        className={`filter-chip ${activeHarmonyFilter === null ? "active" : ""}`}
                        onClick={() => setActiveHarmonyFilter(null)}
                      >
                        All Schemes ({shots.length})
                      </button>
                      {(
                        [
                          ["teal-orange", "Teal & Orange"],
                          ["complementary", "Complementary"],
                          ["analogous", "Analogous"],
                          ["monochromatic", "Monochromatic"],
                          ["triadic", "Triadic"],
                          ["neutral", "Neutral"],
                        ] as const
                      ).map(([type, label]) => {
                        const count = stats.harmonyCounts[type] || 0;
                        if (!count) return null;
                        return (
                          <button
                            key={type}
                            type="button"
                            className={`filter-chip ${activeHarmonyFilter === type ? "active" : ""}`}
                            onClick={() =>
                              setActiveHarmonyFilter(activeHarmonyFilter === type ? null : type)
                            }
                          >
                            {label} ({count})
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {filterTab === "mood" && (
                    <div className="filter-chips-row" role="group" aria-label="Color mood filters">
                      <button
                        type="button"
                        className={`filter-chip ${activeMoodFilter === null ? "active" : ""}`}
                        onClick={() => setActiveMoodFilter(null)}
                      >
                        All Moods ({shots.length})
                      </button>
                      {Object.entries(stats.moodCounts).map(([mood, count]) => (
                        <button
                          key={mood}
                          type="button"
                          className={`filter-chip ${activeMoodFilter === mood ? "active" : ""}`}
                          onClick={() =>
                            setActiveMoodFilter(activeMoodFilter === mood ? null : mood)
                          }
                        >
                          {mood} ({count})
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: LIGHTING VIEW */}
        {activeView === "lighting" && (
          <div className="color-view-lighting">
            {/* Selected Shot Lighting Metrics */}
            <div className="lighting-selected-card">
              <div className="lighting-meta-item">
                <span className="meta-label">Selected Shot</span>
                <span className="meta-value">
                  {activeShot ? `Shot ${String(activeShot.index).padStart(3, "0")}` : "None"}
                </span>
              </div>
              <div className="lighting-meta-item">
                <span className="meta-label">Luminance</span>
                <span className="meta-value">
                  {activeShot?.colorProfile?.luminance !== undefined
                    ? `${Math.round(activeShot.colorProfile.luminance * 100)}%`
                    : "—"}
                </span>
              </div>
              <div className="lighting-meta-item">
                <span className="meta-label">Temperature</span>
                <span className="meta-value">
                  {activeShot?.colorProfile?.temperature !== undefined
                    ? activeShot.colorProfile.temperature > 0.05
                      ? "Warm"
                      : activeShot.colorProfile.temperature < -0.05
                      ? "Cool"
                      : "Neutral"
                    : "—"}
                </span>
              </div>
              <div className="lighting-meta-item">
                <span className="meta-label">Mood / Key</span>
                <span className="meta-value">
                  {activeShot?.colorProfile?.mood || "Unanalyzed"}
                </span>
              </div>
            </div>

            {/* Detailed Lighting Curve */}
            <div className="color-section-block">
              <div className="color-section-header">
                <h3 className="color-section-title">Luminance & temperature progression</h3>
                <div className="curve-legend-inline">
                  <span className="curve-legend-item luma">
                    <span className="legend-line white" /> Luminance
                  </span>
                  <span className="curve-legend-item temp">
                    <span className="legend-line gold" /> Temperature
                  </span>
                  {onOpenCompare && (
                    <button
                      type="button"
                      className="panel-compare-launch-btn"
                      onClick={() => onOpenCompare("luminance")}
                      title="Open analytical curve comparison with Luminance"
                      aria-label="Compare Luminance with other measures"
                    >
                      Compare ↗
                    </button>
                  )}
                </div>
              </div>

              <div className="lighting-chart-wrap enlarged">
                <div className="lighting-y-labels">
                  <span className="y-label top">Bright</span>
                  <span className="y-label mid">Mid</span>
                  <span className="y-label bottom">Dark</span>
                </div>

                <div
                  className="lighting-svg-container"
                  style={{ cursor: "ew-resize", touchAction: "none", userSelect: "none" }}
                  onPointerDown={handleLightingPointerDown}
                  onPointerMove={handleLightingPointerMove}
                  onPointerUp={handleLightingPointerUp}
                  onPointerCancel={handleLightingPointerUp}
                >
                  <svg viewBox="0 0 800 180" preserveAspectRatio="none" className="lighting-svg">
                    <line x1="20" y1="20" x2="780" y2="20" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                    <line x1="20" y1="90" x2="780" y2="90" stroke="rgba(255,255,255,0.1)" />
                    <line x1="20" y1="160" x2="780" y2="160" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />

                    {curvePoints.tempPath && (
                      <path
                        d={curvePoints.tempPath}
                        fill="none"
                        stroke="url(#colorDrawerTempGradDetailed)"
                        strokeWidth="2.5"
                      />
                    )}

                    {curvePoints.lumaPath && (
                      <path
                        d={curvePoints.lumaPath}
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth="2"
                      />
                    )}

                    {/* Nodes for each shot */}
                    {curvePoints.points.map(({ x, lumaY, shot: s }) => (
                      <circle
                        key={s.id}
                        cx={x}
                        cy={lumaY}
                        r={activeShotId === s.id ? "5" : "3"}
                        fill={activeShotId === s.id ? "#fbbf24" : "#ffffff"}
                        stroke={activeShotId === s.id ? "#ffffff" : "none"}
                        strokeWidth="1.5"
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          onSelect(s.id);
                          onSeek(s.startSeconds);
                        }}
                      >
                        <title>{`Shot ${s.index}: ${Math.round((s.colorProfile?.luminance ?? 0) * 100)}% luma`}</title>
                      </circle>
                    ))}

                    {/* Golden Playhead Needle */}
                    <line
                      x1={playheadSvgX}
                      y1="10"
                      x2={playheadSvgX}
                      y2="170"
                      stroke="#fbbf24"
                      strokeWidth="2"
                    />

                    <defs>
                      <linearGradient id="colorDrawerTempGradDetailed" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#e5a444" />
                        <stop offset="50%" stopColor="#888888" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#3498db" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </div>

              <div className="lighting-x-axis">
                {curvePoints.timeTicks.map((tick, i) => (
                  <span key={i} className="time-tick-label">
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Tonal Ratio Breakdown */}
            <div className="color-section-block">
              <div className="color-section-header">
                <h3 className="color-section-title">Tonal ratios across scanned shots</h3>
              </div>
              <div className="tonal-metrics-grid">
                <div className="tonal-metric-card">
                  <span className="metric-num">{stats.warmPct}%</span>
                  <span className="metric-label">Warm shots</span>
                </div>
                <div className="tonal-metric-card">
                  <span className="metric-num">{stats.coolPct}%</span>
                  <span className="metric-label">Cool shots</span>
                </div>
                <div className="tonal-metric-card">
                  <span className="metric-num">{stats.lowKeyPct}%</span>
                  <span className="metric-label">Low-key (dark)</span>
                </div>
                <div className="tonal-metric-card">
                  <span className="metric-num">{stats.highKeyPct}%</span>
                  <span className="metric-label">High-key (bright)</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
