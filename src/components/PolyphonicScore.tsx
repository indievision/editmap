import React, { memo, useMemo, useState, useRef, useCallback } from "react";
import type { Project, Shot } from "../models/project";
import {
  generatePolyphonicScore,
  computePolyphonicChordAt,
  type PolyphonicSummary,
  type PolyphonicChord,
} from "../analysis/polyphony";
import { formatTimecode } from "../utils/timecode";

interface PolyphonicScoreProps {
  project: Project;
  time: number;
  onSeek: (time: number) => void;
  onSelectShot?: (shot: Shot) => void;
}

export const PolyphonicScore = memo(function PolyphonicScore({
  project,
  time,
  onSeek,
  onSelectShot,
}: PolyphonicScoreProps) {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [selectedClimaxId, setSelectedClimaxId] = useState<string | null>(null);
  const [selectedCounterpointId, setSelectedCounterpointId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const duration = project.duration || 1;

  // Generate the polyphonic score
  const score = useMemo(() => {
    return generatePolyphonicScore(project, 250, 20);
  }, [project]);

  // Compute live chord at playhead
  const liveChord: PolyphonicChord = useMemo(() => {
    // If chords already exist, find closest chord or compute precisely
    if (!score.chords.length) {
      return {
        time,
        cutRate: 0,
        cutRateNorm: 0,
        framingElevation: 50,
        motionEnergy: 30,
        shockEnergy: 0,
        visualVoltage: 40,
        loudnessNorm: 45,
        speechActive: false,
        acousticVoltage: 45,
        totalVoltage: 42,
        counterpointDivergence: 5,
        mode: "parallel-flow",
      };
    }
    const idx = Math.min(
      score.chords.length - 1,
      Math.max(0, Math.floor((time / duration) * (score.chords.length - 1)))
    );
    return score.chords[idx];
  }, [score, time, duration]);

  // Handle timeline SVG scrubbing with pointer drag
  const isDraggingRef = useRef(false);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (!svgRef.current || duration <= 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const targetTime = (x / rect.width) * duration;
      onSeek(targetTime);
    },
    [duration, onSeek]
  );

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    seekFromClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || duration <= 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const targetTime = (x / rect.width) * duration;
    setHoverTime(targetTime);
    if (isDraggingRef.current) {
      seekFromClientX(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleSvgMouseLeave = useCallback(() => {
    setHoverTime(null);
  }, []);

  // SVG dimensions
  const svgWidth = 1000;
  const svgHeight = 160;
  const paddingY = 12;
  const chartHeight = svgHeight - paddingY * 2;

  // Build SVG Paths for Visual & Acoustic Voltage
  const {
    visualPath,
    visualArea,
    acousticPath,
    acousticArea,
    counterpointArea,
  } = useMemo(() => {
    if (!score.chords.length) {
      return { visualPath: "", visualArea: "", acousticPath: "", acousticArea: "", counterpointArea: "" };
    }

    const chords = score.chords;
    const n = chords.length;

    const pointsVisual: [number, number][] = [];
    const pointsAcoustic: [number, number][] = [];

    for (let i = 0; i < n; i++) {
      const c = chords[i];
      const x = (c.time / duration) * svgWidth;
      const yV = paddingY + chartHeight * (1 - c.visualVoltage / 100);
      const yA = paddingY + chartHeight * (1 - c.acousticVoltage / 100);
      pointsVisual.push([x, yV]);
      pointsAcoustic.push([x, yA]);
    }

    // Build smooth line paths
    const buildPath = (pts: [number, number][]) => {
      if (!pts.length) return "";
      let p = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        p += ` L ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
      }
      return p;
    };

    const vPath = buildPath(pointsVisual);
    const aPath = buildPath(pointsAcoustic);

    const vArea = pointsVisual.length
      ? `${vPath} L ${svgWidth} ${svgHeight - paddingY} L 0 ${svgHeight - paddingY} Z`
      : "";

    const aArea = pointsAcoustic.length
      ? `${aPath} L ${svgWidth} ${svgHeight - paddingY} L 0 ${svgHeight - paddingY} Z`
      : "";

    // Counterpoint divergence area (strip between visual and acoustic lines)
    let cpArea = "";
    if (pointsVisual.length && pointsAcoustic.length) {
      cpArea = `M ${pointsVisual[0][0].toFixed(1)} ${pointsVisual[0][1].toFixed(1)}`;
      for (let i = 1; i < pointsVisual.length; i++) {
        cpArea += ` L ${pointsVisual[i][0].toFixed(1)} ${pointsVisual[i][1].toFixed(1)}`;
      }
      for (let i = pointsAcoustic.length - 1; i >= 0; i--) {
        cpArea += ` L ${pointsAcoustic[i][0].toFixed(1)} ${pointsAcoustic[i][1].toFixed(1)}`;
      }
      cpArea += " Z";
    }

    return {
      visualPath: vPath,
      visualArea: vArea,
      acousticPath: aPath,
      acousticArea: aArea,
      counterpointArea: cpArea,
    };
  }, [score.chords, duration, chartHeight, svgWidth, svgHeight, paddingY]);

  // Current playhead X in SVG coordinates
  const playheadX = (time / duration) * svgWidth;
  const hoverX = hoverTime !== null ? (hoverTime / duration) * svgWidth : null;

  return (
    <div className="polyphonic-score-container" style={{ padding: "16px", color: "var(--color-text, #fff)" }}>
      {/* Header & Theory Quote */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "18px" }}>🎼</span>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600, letterSpacing: "0.5px" }}>
              Eisenstein's Vertical Montage
            </h3>
            <span
              style={{
                fontSize: "11px",
                background: "rgba(139, 92, 246, 0.2)",
                color: "#c084fc",
                padding: "2px 8px",
                borderRadius: "12px",
                border: "1px solid rgba(139, 92, 246, 0.4)",
              }}
            >
              Unified Polyphonic Score
            </span>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--color-text-muted, #94a3b8)", maxWidth: "600px", lineHeight: "1.4" }}>
            Synthesizes image velocity, framing elevation, kinetic motion, and sensory shock with loudness and acoustic stems into an audiovisual conductor's score.
          </p>
        </div>

        {/* Global Tension Metrics */}
        <div style={{ display: "flex", gap: "16px" }}>
          <div style={{ background: "rgba(255,255,255,0.04)", padding: "6px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)", textAlign: "center" }}>
            <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>Avg Voltage</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#38bdf8" }}>{score.averageVoltage}%</div>
          </div>
          <div style={{ background: "rgba(234, 179, 8, 0.1)", padding: "6px 12px", borderRadius: "8px", border: "1px solid rgba(234, 179, 8, 0.25)", textAlign: "center" }}>
            <div style={{ fontSize: "10px", color: "#facc15", textTransform: "uppercase", letterSpacing: "0.5px" }}>Climaxes</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#fef08a" }}>
              {score.climaxes.length} <span style={{ fontSize: "11px", fontWeight: 400, opacity: 0.8 }}>({score.climaxSharePercent}%)</span>
            </div>
          </div>
          <div style={{ background: "rgba(244, 63, 94, 0.1)", padding: "6px 12px", borderRadius: "8px", border: "1px solid rgba(244, 63, 94, 0.25)", textAlign: "center" }}>
            <div style={{ fontSize: "10px", color: "#fb7185", textTransform: "uppercase", letterSpacing: "0.5px" }}>Counterpoint</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#fda4af" }}>
              {score.counterpoints.length} <span style={{ fontSize: "11px", fontWeight: 400, opacity: 0.8 }}>({score.counterpointSharePercent}%)</span>
            </div>
          </div>
          <div style={{ background: "rgba(34, 197, 94, 0.08)", padding: "6px 12px", borderRadius: "8px", border: "1px solid rgba(34, 197, 94, 0.2)", textAlign: "center" }}>
            <div style={{ fontSize: "10px", color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.5px" }}>Breathing</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#86efac" }}>{score.breathingSharePercent}%</div>
          </div>
        </div>
      </div>

      {/* Orchestral Conductor Waveform Ribbon */}
      <div
        style={{
          position: "relative",
          background: "linear-gradient(180deg, rgba(15, 23, 42, 0.9) 0%, rgba(10, 15, 29, 0.95) 100%)",
          borderRadius: "10px",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          overflow: "hidden",
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          marginBottom: "16px",
        }}
      >
        {/* Track Legend Overlay */}
        <div
          style={{
            position: "absolute",
            top: "8px",
            left: "12px",
            display: "flex",
            gap: "14px",
            fontSize: "11px",
            zIndex: 2,
            background: "rgba(0,0,0,0.5)",
            padding: "3px 8px",
            borderRadius: "6px",
            backdropFilter: "blur(4px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#a855f7", display: "inline-block", boxShadow: "0 0 6px #a855f7" }} />
            <span style={{ color: "#d8b4fe" }}>Visual Voltage (Eye)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#eab308", display: "inline-block", boxShadow: "0 0 6px #eab308" }} />
            <span style={{ color: "#fde047" }}>Acoustic Voltage (Ear)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "rgba(244, 63, 94, 0.4)", display: "inline-block" }} />
            <span style={{ color: "#fda4af" }}>Counterpoint Tension</span>
          </div>
        </div>

        {/* SVG Ribbon */}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio="none"
          style={{
            width: "100%",
            height: "160px",
            display: "block",
            cursor: "ew-resize",
            touchAction: "none",
            userSelect: "none",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onMouseLeave={handleSvgMouseLeave}
        >
          <defs>
            {/* Visual Gradient */}
            <linearGradient id="poly-visual-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c084fc" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.05" />
            </linearGradient>

            {/* Acoustic Gradient */}
            <linearGradient id="poly-acoustic-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fde047" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#ca8a04" stopOpacity="0.05" />
            </linearGradient>

            {/* Counterpoint Gradient */}
            <linearGradient id="poly-counterpoint-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.08" />
            </linearGradient>
          </defs>

          {/* Reference Grid Lines */}
          <line x1="0" y1={paddingY + chartHeight * 0.25} x2={svgWidth} y2={paddingY + chartHeight * 0.25} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
          <line x1="0" y1={paddingY + chartHeight * 0.5} x2={svgWidth} y2={paddingY + chartHeight * 0.5} stroke="rgba(255,255,255,0.08)" />
          <line x1="0" y1={paddingY + chartHeight * 0.75} x2={svgWidth} y2={paddingY + chartHeight * 0.75} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />

          {/* Counterpoint Zone Highlights (vertical translucent bands) */}
          {score.counterpoints.map((cp) => {
            const x1 = (cp.startTime / duration) * svgWidth;
            const x2 = (cp.endTime / duration) * svgWidth;
            const w = Math.max(2, x2 - x1);
            const isFury = cp.type === "visual-fury-sonic-calm";
            return (
              <rect
                key={cp.id}
                x={x1}
                y={paddingY}
                width={w}
                height={chartHeight}
                fill={isFury ? "rgba(168, 85, 247, 0.12)" : "rgba(234, 179, 8, 0.12)"}
                stroke={isFury ? "rgba(168, 85, 247, 0.3)" : "rgba(234, 179, 8, 0.3)"}
                strokeWidth="1"
                strokeDasharray="2 2"
              />
            );
          })}

          {/* Counterpoint Tension Area between Visual & Acoustic */}
          {counterpointArea && <path d={counterpointArea} fill="url(#poly-counterpoint-grad)" />}

          {/* Visual Track Area & Line */}
          {visualArea && <path d={visualArea} fill="url(#poly-visual-grad)" />}
          {visualPath && <path d={visualPath} fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 3px rgba(168,85,247,0.7))" }} />}

          {/* Acoustic Track Area & Line */}
          {acousticArea && <path d={acousticArea} fill="url(#poly-acoustic-grad)" />}
          {acousticPath && <path d={acousticPath} fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 3px rgba(234,179,8,0.7))" }} />}

          {/* Climax Pulse Markers */}
          {score.climaxes.map((climax) => {
            const cx = (climax.peakTime / duration) * svgWidth;
            return (
              <g key={climax.id} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onSeek(climax.peakTime); }}>
                <circle cx={cx} cy={paddingY + 8} r="6" fill="#facc15" stroke="#fff" strokeWidth="1.5" style={{ filter: "drop-shadow(0 0 6px #facc15)" }} />
                <line x1={cx} y1={paddingY} x2={cx} y2={svgHeight - paddingY} stroke="#facc15" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
              </g>
            );
          })}

          {/* Hover Playhead Line */}
          {hoverX !== null && (
            <line x1={hoverX} y1={0} x2={hoverX} y2={svgHeight} stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="3 3" pointerEvents="none" />
          )}

          {/* Active Playhead Line */}
          <line x1={playheadX} y1={0} x2={playheadX} y2={svgHeight} stroke="#38bdf8" strokeWidth="2" pointerEvents="none" style={{ filter: "drop-shadow(0 0 4px #38bdf8)" }} />
          <polygon
            points={`${playheadX - 5},0 ${playheadX + 5},0 ${playheadX},7`}
            fill="#38bdf8"
            pointerEvents="none"
          />
        </svg>

        {/* Hover Readout Tooltip */}
        {hoverTime !== null && (
          <div
            style={{
              position: "absolute",
              bottom: "6px",
              right: "12px",
              background: "rgba(0,0,0,0.75)",
              padding: "4px 8px",
              borderRadius: "4px",
              fontSize: "11px",
              color: "#e2e8f0",
              pointerEvents: "none",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            Seek to {formatTimecode(hoverTime, 24)}
          </div>
        )}
      </div>

      {/* Master Chord Breakdown HUD at Playhead */}
      <div
        style={{
          background: "rgba(15, 23, 42, 0.7)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "10px",
          padding: "16px",
          display: "grid",
          gridTemplateColumns: "1fr 1.2fr 1fr",
          gap: "16px",
          marginBottom: "16px",
        }}
      >
        {/* Left: Visual Track Stems */}
        <div style={{ background: "rgba(168, 85, 247, 0.05)", border: "1px solid rgba(168, 85, 247, 0.2)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#d8b4fe", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Visual Stems (Eye)
            </span>
            <span style={{ fontSize: "15px", fontWeight: 700, color: "#c084fc" }}>
              {liveChord.visualVoltage}%
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
              <span>Cut Velocity (Pacing)</span>
              <span style={{ color: "#e2e8f0" }}>{liveChord.cutRate} cuts/min ({liveChord.cutRateNorm}%)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
              <span>Framing Elevation</span>
              <span style={{ color: "#e2e8f0" }}>{liveChord.framingElevation}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
              <span>Kinetic Motion Energy</span>
              <span style={{ color: "#e2e8f0" }}>{liveChord.motionEnergy}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
              <span>Cut Delta Shock Decay</span>
              <span style={{ color: "#e2e8f0" }}>{liveChord.shockEnergy}%</span>
            </div>
          </div>
        </div>

        {/* Center: Eisenstein Counterpoint Synthesis & Mode Indicator */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "8px" }}>
          <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
            Current Polyphonic Mode
          </div>

          {/* Mode Badge */}
          {liveChord.mode === "polyphonic-climax" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(234, 179, 8, 0.2)", border: "1px solid #facc15", color: "#fef08a", padding: "4px 12px", borderRadius: "16px", fontWeight: 700, fontSize: "13px", marginBottom: "8px" }}>
              <span>🔥</span> Polyphonic Climax
            </div>
          )}
          {liveChord.mode === "sensory-counterpoint" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(244, 63, 94, 0.2)", border: "1px solid #f43f5e", color: "#fda4af", padding: "4px 12px", borderRadius: "16px", fontWeight: 700, fontSize: "13px", marginBottom: "8px" }}>
              <span>⚡</span> Sensory Counterpoint
            </div>
          )}
          {liveChord.mode === "parallel-flow" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(56, 189, 248, 0.15)", border: "1px solid #38bdf8", color: "#bae6fd", padding: "4px 12px", borderRadius: "16px", fontWeight: 600, fontSize: "13px", marginBottom: "8px" }}>
              <span>〰️</span> Parallel Flow
            </div>
          )}
          {liveChord.mode === "breathing-valley" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(34, 197, 94, 0.15)", border: "1px solid #22c55e", color: "#bbf7d0", padding: "4px 12px", borderRadius: "16px", fontWeight: 600, fontSize: "13px", marginBottom: "8px" }}>
              <span>🌿</span> Breathing Valley
            </div>
          )}

          {/* Total Voltage & Divergence Meter */}
          <div style={{ display: "flex", gap: "16px", margin: "6px 0" }}>
            <div>
              <div style={{ fontSize: "10px", color: "#94a3b8" }}>Total Voltage</div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#fff" }}>{liveChord.totalVoltage}%</div>
            </div>
            <div style={{ width: "1px", background: "rgba(255,255,255,0.1)" }} />
            <div>
              <div style={{ fontSize: "10px", color: "#94a3b8" }}>Counterpoint Δ</div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: liveChord.counterpointDivergence >= 36 ? "#fb7185" : "#94a3b8" }}>
                {liveChord.counterpointDivergence}%
              </div>
            </div>
          </div>

          {/* Description of dynamic state */}
          <div style={{ fontSize: "11px", color: "#94a3b8", lineHeight: "1.3", maxWidth: "260px" }}>
            {liveChord.counterpointType === "visual-fury-sonic-calm" && (
              <span style={{ color: "#c084fc" }}>Visual Fury / Sonic Calm: Rapid montage held over quiet soundscape (Baptism effect).</span>
            )}
            {liveChord.counterpointType === "visual-still-sonic-dread" && (
              <span style={{ color: "#facc15" }}>Visual Stillness / Sonic Dread: Static shot sustained under heavy acoustic build (Sicario effect).</span>
            )}
            {!liveChord.counterpointType && (
              <span>Sight and sound are moving in balanced dramatic synchrony.</span>
            )}
          </div>
        </div>

        {/* Right: Acoustic Track Stems */}
        <div style={{ background: "rgba(234, 179, 8, 0.05)", border: "1px solid rgba(234, 179, 8, 0.2)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#fde047", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Acoustic Stems (Ear)
            </span>
            <span style={{ fontSize: "15px", fontWeight: 700, color: "#eab308" }}>
              {liveChord.acousticVoltage}%
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
              <span>Loudness (Momentary LUFS)</span>
              <span style={{ color: "#e2e8f0" }}>{liveChord.loudnessNorm}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
              <span>Dialogue Presence</span>
              <span style={{ color: liveChord.speechActive ? "#4ade80" : "#94a3b8" }}>
                {liveChord.speechActive ? "Speech Active" : "No Speech"}
              </span>
            </div>
            {liveChord.dmeLevels ? (
              <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
                <span>DME Stem Balance</span>
                <span style={{ color: "#e2e8f0" }}>
                  D:{Math.round(liveChord.dmeLevels.dialogue * 100)}% M:{Math.round(liveChord.dmeLevels.music * 100)}% E:{Math.round(liveChord.dmeLevels.effects * 100)}%
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
                <span>DME Stems</span>
                <span style={{ color: "#64748b" }}>Stem analysis available</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
              <span>Sonic Tension Weight</span>
              <span style={{ color: "#e2e8f0" }}>Composite Acoustic</span>
            </div>
          </div>
        </div>
      </div>

      {/* Climaxes & Counterpoint Sequences Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Polyphonic Climaxes */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
            <span>🔥</span>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#facc15", textTransform: "uppercase" }}>
              Polyphonic Climaxes ({score.climaxes.length})
            </span>
          </div>
          {score.climaxes.length === 0 ? (
            <div style={{ fontSize: "11px", color: "#64748b", fontStyle: "italic", padding: "8px 0" }}>
              No full audiovisual convergence peaks (&ge;75% simultaneous tension) detected.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "160px", overflowY: "auto" }}>
              {score.climaxes.map((c) => (
                <div
                  key={c.id}
                  onClick={() => onSeek(c.peakTime)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    background: "rgba(234, 179, 8, 0.08)",
                    border: "1px solid rgba(234, 179, 8, 0.2)",
                    cursor: "pointer",
                    fontSize: "11px",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(234, 179, 8, 0.16)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(234, 179, 8, 0.08)")}
                >
                  <div>
                    <span style={{ fontWeight: 600, color: "#fef08a", marginRight: "6px" }}>
                      {formatTimecode(c.peakTime, 24)}
                    </span>
                    <span style={{ color: "#94a3b8" }}>{c.duration}s duration</span>
                  </div>
                  <div style={{ fontWeight: 700, color: "#facc15" }}>
                    {c.peakVoltage}% peak
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Counterpoint Zones */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
            <span>⚡</span>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#fb7185", textTransform: "uppercase" }}>
              Sensory Counterpoint Zones ({score.counterpoints.length})
            </span>
          </div>
          {score.counterpoints.length === 0 ? (
            <div style={{ fontSize: "11px", color: "#64748b", fontStyle: "italic", padding: "8px 0" }}>
              No extreme sensory divergence (&ge;36% divergence between eye and ear) detected.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "160px", overflowY: "auto" }}>
              {score.counterpoints.map((cp) => (
                <div
                  key={cp.id}
                  onClick={() => onSeek(cp.startTime)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    background: cp.type === "visual-fury-sonic-calm" ? "rgba(168, 85, 247, 0.08)" : "rgba(234, 179, 8, 0.08)",
                    border: cp.type === "visual-fury-sonic-calm" ? "1px solid rgba(168, 85, 247, 0.2)" : "1px solid rgba(234, 179, 8, 0.2)",
                    cursor: "pointer",
                    fontSize: "11px",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = cp.type === "visual-fury-sonic-calm" ? "rgba(168, 85, 247, 0.16)" : "rgba(234, 179, 8, 0.16)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = cp.type === "visual-fury-sonic-calm" ? "rgba(168, 85, 247, 0.08)" : "rgba(234, 179, 8, 0.08)")}
                >
                  <div>
                    <span style={{ fontWeight: 600, color: cp.type === "visual-fury-sonic-calm" ? "#c084fc" : "#fde047", marginRight: "6px" }}>
                      {formatTimecode(cp.startTime, 24)}
                    </span>
                    <span style={{ color: "#94a3b8" }}>{cp.label}</span>
                  </div>
                  <div style={{ fontWeight: 700, color: "#fb7185" }}>
                    Δ {cp.avgDivergence}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default PolyphonicScore;
