import { useState, useMemo } from "react";
import type { Project, Shot, HarmonyType } from "../models/project";
import { formatTimecode } from "../utils/timecode";
import { getSquintFilter } from "../utils/squint";

export interface ColorReadingProps {
  project: Project;
  thumbnails?: Record<string, string>;
  selected?: string;
  onSelect: (shotId: string) => void;
  onSeek: (seconds: number) => void;
  squintMode?: boolean;
  onSquintModeChange?: (active: boolean) => void;
  squintLevel?: number;
  onSquintLevelChange?: (level: number) => void;
}

export default function ColorReading({
  project,
  thumbnails = {},
  selected,
  onSelect,
  onSeek,
  squintMode: propSquintMode,
  onSquintModeChange,
  squintLevel: propSquintLevel,
  onSquintLevelChange,
}: ColorReadingProps) {
  const [hoveredShot, setHoveredShot] = useState<Shot | null>(null);
  const [activeMoodFilter, setActiveMoodFilter] = useState<string | null>(null);
  const [activeHarmonyFilter, setActiveHarmonyFilter] = useState<HarmonyType | null>(null);
  const [internalSquintMode, setInternalSquintMode] = useState(false);
  const [internalSquintLevel, setInternalSquintLevel] = useState(4);

  const squintMode = propSquintMode !== undefined ? propSquintMode : internalSquintMode;
  const squintLevel = propSquintLevel !== undefined ? propSquintLevel : internalSquintLevel;

  const setSquintMode = (active: boolean) => {
    setInternalSquintMode(active);
    onSquintModeChange?.(active);
  };

  const setSquintLevel = (lvl: number) => {
    setInternalSquintLevel(lvl);
    onSquintLevelChange?.(lvl);
  };

  const duration = Math.max(project.duration, 1);
  const shots = project.shots;

  // Visual Tone, Mood & Color Harmony Statistics
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

    const totalScanned = shots.filter((s) => s.colorProfile).length || 1;

    return {
      warmPct: Math.round((warmCount / totalScanned) * 100),
      coolPct: Math.round((coolCount / totalScanned) * 100),
      lowKeyPct: Math.round((lowKeyCount / totalScanned) * 100),
      highKeyPct: Math.round((highKeyCount / totalScanned) * 100),
      tealOrangePct: Math.round((harmonyCounts["teal-orange"] / totalScanned) * 100),
      moodCounts,
      harmonyCounts,
      totalScanned,
    };
  }, [shots]);

  // Generate SVG curve points for Luminance & Temperature across duration
  const curvePoints = useMemo(() => {
    if (!shots.length) return { lumaPath: "", tempPath: "", points: [] };

    const svgWidth = 800;
    const svgHeight = 160;
    const padding = 20;
    const chartHeight = svgHeight - padding * 2;
    const chartWidth = svgWidth - padding * 2;

    const points = shots.map((shot) => {
      const midTime = (shot.startSeconds + shot.endSeconds) / 2;
      const x = padding + (midTime / duration) * chartWidth;

      const luma = shot.colorProfile?.luminance ?? 0.5;
      const lumaY = padding + (1 - luma) * chartHeight;

      const temp = shot.colorProfile?.temperature ?? 0;
      const normalizedTemp = (temp + 1) / 2;
      const tempY = padding + (1 - normalizedTemp) * chartHeight;

      return { x, lumaY, tempY, shot, luma, temp };
    });

    const lumaPath = points.reduce((acc, p, idx) => {
      return `${acc} ${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.lumaY.toFixed(1)}`;
    }, "");

    const tempPath = points.reduce((acc, p, idx) => {
      return `${acc} ${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.tempY.toFixed(1)}`;
    }, "");

    return { lumaPath, tempPath, points };
  }, [shots, duration]);

  const filteredShots = useMemo(() => {
    return shots.filter((s) => {
      if (activeMoodFilter && s.colorProfile?.mood !== activeMoodFilter) return false;
      if (activeHarmonyFilter && s.colorProfile?.harmony?.type !== activeHarmonyFilter) return false;
      return true;
    });
  }, [shots, activeMoodFilter, activeHarmonyFilter]);

  return (
    <div className="color-reading-panel">
      <div className="section-head">
        <span className="eyebrow">COLOR READING & HARMONY DETECTION</span>
        <span className="muted">
          Movie Color Script, Color Wheel Harmony & Lighting Curves
        </span>
      </div>

      {/* 1. MOVIE COLOR SCRIPT (BARCODE RIBBON) */}
      <div className="color-script-section">
        <div className="subhead">
          <h3>Movie Color Script</h3>
          <span className="muted">Proportional Shot Palette Barcode</span>
        </div>

        <div className="color-barcode-ribbon" role="region" aria-label="Movie Color Barcode Ribbon">
          {shots.map((s) => {
            const widthPct = (s.duration / duration) * 100;
            const primaryColor = s.colorProfile?.palette[0] || "#4a7cc2";
            const isSelected = selected === s.id;
            const isFilteredOut =
              (activeMoodFilter && s.colorProfile?.mood !== activeMoodFilter) ||
              (activeHarmonyFilter && s.colorProfile?.harmony?.type !== activeHarmonyFilter);

            return (
              <div
                key={s.id}
                className={`barcode-block ${isSelected ? "selected" : ""} ${isFilteredOut ? "dimmed" : ""}`}
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: primaryColor,
                }}
                onMouseEnter={() => setHoveredShot(s)}
                onMouseLeave={() => setHoveredShot(null)}
                onClick={() => {
                  onSeek(s.startSeconds);
                  onSelect(s.id);
                }}
              >
                {widthPct > 3 && (
                  <span className="block-label">{String(s.index).padStart(3, "0")}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Hover Shot Tooltip Card */}
        {hoveredShot && (
          <div className="color-tooltip-card">
            {thumbnails[hoveredShot.id] && (
              <img
                src={thumbnails[hoveredShot.id]}
                alt={`Shot ${hoveredShot.index}`}
                className="tooltip-thumb"
              />
            )}
            <div className="tooltip-meta">
              <strong>Shot {String(hoveredShot.index).padStart(3, "0")}</strong>
              <span>{formatTimecode(hoveredShot.startSeconds, project.frameRate, project.dropFrame)} ({hoveredShot.duration.toFixed(2)}s)</span>
              {hoveredShot.colorProfile && (
                <>
                  <span className="tooltip-mood">
                    {hoveredShot.colorProfile.mood}
                    {hoveredShot.colorProfile.harmony?.label && (
                      <strong style={{ marginLeft: 6, color: "#93c5fd" }}>
                        · {hoveredShot.colorProfile.harmony.label} ({hoveredShot.colorProfile.harmony.dominantHue}°)
                      </strong>
                    )}
                  </span>
                  <div className="tooltip-swatches">
                    {hoveredShot.colorProfile.palette.map((hex, i) => (
                      <span key={i} className="swatch-micro" style={{ backgroundColor: hex }} title={hex} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. LUMINANCE & TEMPERATURE RHYTHM CURVE */}
      <div className="color-curve-section">
        <div className="subhead">
          <h3>Lighting & Temperature Rhythm</h3>
          <div className="curve-legend">
            <span className="legend-item luma"><i /> Brightness (Luma)</span>
            <span className="legend-item warm"><i /> Warm Amber</span>
            <span className="legend-item cool"><i /> Cool Blue</span>
          </div>
        </div>

        <div className="curve-graph-container">
          <svg viewBox="0 0 800 160" preserveAspectRatio="none" className="curve-svg">
            <line x1="20" y1="20" x2="780" y2="20" stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
            <line x1="20" y1="80" x2="780" y2="80" stroke="rgba(255,255,255,0.15)" />
            <line x1="20" y1="140" x2="780" y2="140" stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />

            {curvePoints.tempPath && (
              <path
                d={curvePoints.tempPath}
                fill="none"
                stroke="url(#tempGradient)"
                strokeWidth="2.5"
              />
            )}

            {curvePoints.lumaPath && (
              <path
                d={curvePoints.lumaPath}
                fill="none"
                stroke="#e2e8f0"
                strokeWidth="2"
                strokeDasharray="2 2"
              />
            )}

            {curvePoints.points.map(({ x, lumaY, tempY, shot }) => (
              <g key={shot.id} className="graph-node" onClick={() => { onSeek(shot.startSeconds); onSelect(shot.id); }}>
                <circle cx={x} cy={lumaY} r="3" fill="#ffffff">
                  <title>{`Shot ${shot.index} Luma: ${Math.round((shot.colorProfile?.luminance || 0) * 100)}%`}</title>
                </circle>
                <circle cx={x} cy={tempY} r="3" fill={shot.colorProfile?.temperature && shot.colorProfile.temperature > 0 ? "#e5a444" : "#3498db"} />
              </g>
            ))}

            <defs>
              <linearGradient id="tempGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#e5a444" />
                <stop offset="50%" stopColor="#888888" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#3498db" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>

      {/* 3. PALETTE, MOOD & HARMONY SUMMARY */}
      <div className="color-summary-section">
        <div className="subhead">
          <h3>Visual Tone & Color Harmony Breakdown</h3>
        </div>

        <div className="tone-metrics">
          <div className="metric-box">
            <span className="metric-val">{stats.warmPct}%</span>
            <span className="metric-lbl">Warm Shots</span>
          </div>
          <div className="metric-box">
            <span className="metric-val">{stats.coolPct}%</span>
            <span className="metric-lbl">Cool Shots</span>
          </div>
          <div className="metric-box">
            <span className="metric-val">{stats.tealOrangePct}%</span>
            <span className="metric-lbl">Teal & Orange</span>
          </div>
          <div className="metric-box">
            <span className="metric-val">{stats.lowKeyPct}%</span>
            <span className="metric-lbl">Low-Key (Dark)</span>
          </div>
          <div className="metric-box">
            <span className="metric-val">{stats.highKeyPct}%</span>
            <span className="metric-lbl">High-Key (Bright)</span>
          </div>
        </div>

        {/* Color Harmony Filter Chips */}
        <div className="mood-filter-chips" style={{ marginBottom: 8 }}>
          <span className="chip-label">Filter Harmony:</span>
          <button
            className={`mood-chip ${activeHarmonyFilter === null ? "active" : ""}`}
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
                className={`mood-chip ${activeHarmonyFilter === type ? "active" : ""}`}
                onClick={() => setActiveHarmonyFilter(activeHarmonyFilter === type ? null : type)}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>

        {/* Mood Filter Chips */}
        <div className="mood-filter-chips">
          <span className="chip-label">Filter Mood:</span>
          <button
            className={`mood-chip ${activeMoodFilter === null ? "active" : ""}`}
            onClick={() => setActiveMoodFilter(null)}
          >
            All Moods ({shots.length})
          </button>
          {Object.entries(stats.moodCounts).map(([mood, count]) => (
            <button
              key={mood}
              className={`mood-chip ${activeMoodFilter === mood ? "active" : ""}`}
              onClick={() => setActiveMoodFilter(activeMoodFilter === mood ? null : mood)}
            >
              {mood} ({count})
            </button>
          ))}
        </div>
      </div>

      {/* 3. THE SQUINT TEST (SEQUENCE TONAL VALUE STRIP) */}
      <div className="squint-test-section">
        <div className="subhead squint-subhead">
          <div>
            <h3>The Squint Test (Tonal Value Strip)</h3>
            <span className="muted">
              Composite optical engine: diffraction blur, rod desaturation, highlight bloom & chiaroscuro value massing (Notan).
            </span>
          </div>

          <div className="squint-controls">
            <div className="squint-toggle-group">
              <button
                type="button"
                className={`squint-mode-btn ${!squintMode ? "active" : ""}`}
                onClick={() => setSquintMode(false)}
              >
                🖼 Normal Color
              </button>
              <button
                type="button"
                className={`squint-mode-btn ${squintMode ? "active" : ""}`}
                onClick={() => setSquintMode(true)}
              >
                😑 Squint Mode (Values)
              </button>
            </div>

            {squintMode && (
              <label className="squint-depth-slider">
                <span>Squint Depth: <b>Level {squintLevel}</b></span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={squintLevel}
                  onChange={(e) => setSquintLevel(Number(e.target.value))}
                />
              </label>
            )}
          </div>
        </div>

        <div className="squint-contact-sheet">
          {shots.map((s) => {
            const thumb = thumbnails[s.id];
            const isSelected = selected === s.id;
            const luma = s.colorProfile?.luminance !== undefined ? Math.round(s.colorProfile.luminance * 100) : null;

            return (
              <div
                key={s.id}
                className={`squint-card ${isSelected ? "selected" : ""}`}
                onClick={() => {
                  onSeek(s.startSeconds);
                  onSelect(s.id);
                }}
                title={`Shot ${s.index} · ${s.shotSize} · ${formatTimecode(s.startSeconds, project.frameRate, project.dropFrame)} · ${luma !== null ? `${luma}% Luma` : ""}`}
              >
                <div className="squint-thumb-wrapper">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={`Shot ${s.index}`}
                      className={`squint-img ${squintMode ? "squint-active" : ""}`}
                      style={
                        squintMode
                          ? {
                              filter: getSquintFilter(squintLevel),
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <div className="squint-empty">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="M7 8h10M7 12h10M7 16h10" strokeDasharray="2 2" />
                      </svg>
                      <span>Shot {String(s.index).padStart(3, "0")}</span>
                    </div>
                  )}
                  {luma !== null && (
                    <span className={`squint-luma-badge ${luma < 25 ? "dark" : luma > 70 ? "bright" : "mid"}`}>
                      {luma}%
                    </span>
                  )}
                </div>
                <div className="squint-card-footer">
                  <span className="squint-card-idx">Shot {String(s.index).padStart(3, "0")}</span>
                  <span className="squint-card-size">{s.shotSize}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
