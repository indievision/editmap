import React, { useState, useEffect, useRef } from "react";
import type { EyeTraceCutReading, FocalPoint } from "../models/project";
import { calculateEyeTrace } from "../analysis/cuts";

export type CutViewMode = "split" | "fusion" | "wipe";

interface SaccadicCutFlowProps {
  outgoingFrame: string;
  incomingFrame: string;
  eyeTrace: EyeTraceCutReading;
  viewMode: CutViewMode;
  onViewModeChange: (mode: CutViewMode) => void;
  squint?: boolean;
  onUpdateEyeTrace?: (updated: EyeTraceCutReading) => void;
  onRescanEyeTrace?: () => void;
  isRescanning?: boolean;
}

export function SaccadicCutFlow({
  outgoingFrame,
  incomingFrame,
  eyeTrace,
  viewMode,
  onViewModeChange,
  squint = false,
  onUpdateEyeTrace,
  onRescanEyeTrace,
  isRescanning = false,
}: SaccadicCutFlowProps) {
  const [blend, setBlend] = useState(0.5); // 0 = 100% out, 1 = 100% in
  const [wipePos, setWipePos] = useState(0.5);
  const [isDraggingWipe, setIsDraggingWipe] = useState(false);
  const [draggingAnchor, setDraggingAnchor] = useState<"outgoing" | "incoming" | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simStep, setSimStep] = useState<"out" | "cut" | "in">("in");
  const [simProgress, setSimProgress] = useState(0); // 0 to 1 along vector

  const containerRef = useRef<HTMLDivElement>(null);

  const outP = eyeTrace.outgoingFocalPoint;
  const inP = eyeTrace.incomingFocalPoint;

  // Degrees of visual angle calculation (assuming standard 35° theatrical FOV)
  const degrees = ((eyeTrace.jumpDistancePercent / 100) * 35).toFixed(1);

  // SVG dimensions for high-resolution vector calculations (16:9 ratio)
  const W = 1000;
  const H = 562.5;

  const x1 = outP.x * W;
  const y1 = outP.y * H;
  const x2 = inP.x * W;
  const y2 = inP.y * H;

  // Calculate arched bezier control point for natural eye travel
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);

  // Vector trajectory angle in screen degrees (0° = eastward / rightward)
  const angleRad = Math.atan2(dy, dx);
  let angleDeg = Math.round((angleRad * 180) / Math.PI);
  if (angleDeg < 0) angleDeg += 360;

  const arrowSymbol =
    angleDeg >= 337.5 || angleDeg < 22.5
      ? "➔"
      : angleDeg >= 22.5 && angleDeg < 67.5
      ? "➘"
      : angleDeg >= 67.5 && angleDeg < 112.5
      ? "↓"
      : angleDeg >= 112.5 && angleDeg < 157.5
      ? "↙"
      : angleDeg >= 157.5 && angleDeg < 202.5
      ? "←"
      : angleDeg >= 202.5 && angleDeg < 247.5
      ? "↖"
      : angleDeg >= 247.5 && angleDeg < 292.5
      ? "↑"
      : "↗";

  // Perpendicular curvature offset (arcs slightly upward or natural curve)
  const curvature = Math.min(60, dist * 0.15);
  // Control point
  const cx = (x1 + x2) / 2 - (dy / (dist || 1)) * curvature;
  const cy = (y1 + y2) / 2 + (dx / (dist || 1)) * curvature;

  // Midpoint on quadratic bezier at t=0.5
  const midX = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
  const midY = 0.25 * y1 + 0.5 * cy + 0.25 * y2;

  // Point along curve for simulation animation
  const t = simProgress;
  const simX = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2;
  const simY = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;

  // Color mappings based on Option A rating
  const isAnchored = eyeTrace.rating === "anchored" || eyeTrace.rating === "smooth";
  const isShifted = eyeTrace.rating === "shifted" || eyeTrace.rating === "natural";

  const ratingColor = isAnchored
    ? "#10b981" // emerald
    : isShifted
    ? "#f59e0b" // amber
    : "#ef4444"; // crimson

  const ratingGlow = isAnchored
    ? "rgba(16, 185, 129, 0.45)"
    : isShifted
    ? "rgba(245, 158, 11, 0.45)"
    : "rgba(239, 68, 68, 0.55)";

  // Saccade simulation trigger
  const runSimulation = () => {
    if (isSimulating) return;
    setIsSimulating(true);
    setSimStep("out");
    setSimProgress(0);

    // Timeline of simulation:
    // 0ms - 400ms: Focus on Out frame (Point A)
    // 400ms: Flash cut to In frame
    // 400ms - 750ms: Saccadic jump travels along curve
    // 750ms - 1300ms: Arrival ripple on Point B
    setTimeout(() => {
      setSimStep("cut");
      const startTime = performance.now();
      const duration = 380; // 380ms saccade transit

      const animateTransit = (now: number) => {
        const elapsed = now - startTime;
        const p = Math.min(1, elapsed / duration);
        // Easing for saccadic burst
        const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        setSimProgress(eased);

        if (p < 1) {
          requestAnimationFrame(animateTransit);
        } else {
          setSimStep("in");
          setTimeout(() => {
            setIsSimulating(false);
          }, 600);
        }
      };
      requestAnimationFrame(animateTransit);
    }, 450);
  };

  // Pointer drag handler for Wipe mode
  const handlePointerDown = (e: React.PointerEvent) => {
    if (viewMode !== "wipe") return;
    setIsDraggingWipe(true);
    updateWipeFromPointer(e);
  };

  const updateWipeFromPointer = (e: React.PointerEvent | PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pos = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
    setWipePos(pos);
  };

  useEffect(() => {
    if (!isDraggingWipe) return;
    const onMove = (e: PointerEvent) => updateWipeFromPointer(e);
    const onUp = () => setIsDraggingWipe(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDraggingWipe]);

  // Pointer drag handler for interactive Reticle Anchors (OUT and IN)
  const updateAnchorFromPointer = (e: MouseEvent | PointerEvent, anchor: "outgoing" | "incoming") => {
    if (!containerRef.current) return;
    const canvasEl = containerRef.current.querySelector(".saccadic-canvas-container");
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const nx = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0.02, Math.min(0.98, (e.clientY - rect.top) / rect.height));

    const newPoint: FocalPoint = {
      x: Number(nx.toFixed(3)),
      y: Number(ny.toFixed(3)),
      type: "eyes",
      confidence: 1.0,
    };

    const newOut = anchor === "outgoing" ? newPoint : outP;
    const newIn = anchor === "incoming" ? newPoint : inP;
    const newTrace = calculateEyeTrace(newOut, newIn, eyeTrace.momentum);
    if (onUpdateEyeTrace) {
      onUpdateEyeTrace(newTrace);
    }
  };

  useEffect(() => {
    if (!draggingAnchor) return;
    const onMove = (e: PointerEvent) => updateAnchorFromPointer(e, draggingAnchor);
    const onUp = () => setDraggingAnchor(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [draggingAnchor, outP, inP, eyeTrace.momentum, onUpdateEyeTrace]);

  return (
    <div className="saccadic-flow-root" ref={containerRef}>
      {/* 1. View Mode Segmented Controls & Actions */}
      <div className="saccadic-flow-toolbar">
        <div className="saccadic-mode-selector" role="group" aria-label="Vector Cut Flow View Mode">
          <button
            type="button"
            className={`saccadic-mode-btn ${viewMode === "split" ? "active" : ""}`}
            onClick={() => onViewModeChange("split")}
            title="Split Cards View: Compare outgoing and incoming frames side-by-side"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="9" height="16" rx="1" />
              <rect x="13" y="4" width="9" height="16" rx="1" />
            </svg>
            <span>Split Cards</span>
          </button>

          <button
            type="button"
            className={`saccadic-mode-btn ${viewMode === "fusion" ? "active" : ""}`}
            onClick={() => onViewModeChange("fusion")}
            title="Vector Fusion Mode: Cross-dissolve overlay with glowing saccadic trajectory"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="8" cy="12" r="6" strokeDasharray="3 2" />
              <circle cx="16" cy="12" r="6" />
              <path d="M8 12 L16 12" strokeWidth="2.5" />
            </svg>
            <span>Vector Fusion</span>
          </button>

          <button
            type="button"
            className={`saccadic-mode-btn ${viewMode === "wipe" ? "active" : ""}`}
            onClick={() => onViewModeChange("wipe")}
            title="A/B Wipe Mode: Interactive split-slider revealing cut spatial alignment"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="1" />
              <line x1="12" y1="4" x2="12" y2="20" strokeWidth="2" />
            </svg>
            <span>A/B Wipe</span>
          </button>
        </div>

        {/* Right side: Simulation & Blend slider */}
        <div className="saccadic-actions">
          {viewMode === "fusion" && (
            <div className="saccadic-blend-ctrl" title="Cross-dissolve blend between outgoing and incoming frames">
              <span className="saccadic-blend-label">OUT</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={blend}
                onChange={(e) => setBlend(parseFloat(e.target.value))}
                className="saccadic-slider"
                aria-label="Cross-dissolve frame blend"
              />
              <span className="saccadic-blend-label">IN</span>
            </div>
          )}

          {onRescanEyeTrace && (
            <button
              type="button"
              className={`saccadic-sim-btn ${isRescanning ? "playing" : ""}`}
              onClick={onRescanEyeTrace}
              disabled={isRescanning}
              title="Auto-detect actor eyes and re-align saccadic vector via AI vision"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>{isRescanning ? "Detecting…" : "Auto-Detect Eyes"}</span>
            </button>
          )}

          <button
            type="button"
            className={`saccadic-sim-btn ${isSimulating ? "playing" : ""}`}
            onClick={runSimulation}
            disabled={isSimulating}
            title="Simulate audience eye travel and focal acquisition across this cut"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>{isSimulating ? "Simulating…" : "Replay Saccade"}</span>
          </button>
        </div>
      </div>

      {/* 2. Unified Canvas Area (Only for Fusion or Wipe mode) */}
      {(viewMode === "fusion" || viewMode === "wipe") && (
        <div
          className={`saccadic-canvas-container ${squint ? "cut-squint-active" : ""}`}
          onPointerDown={handlePointerDown}
        >
          {/* Frame Layers */}
          {viewMode === "fusion" ? (
            <div className="saccadic-layers">
              {/* Outgoing Base Image */}
              <img
                src={outgoingFrame}
                alt="Outgoing cut frame"
                className="saccadic-layer outgoing"
                style={{
                  opacity: isSimulating
                    ? simStep === "out"
                      ? 1
                      : 0
                    : 1 - blend * 0.75,
                }}
              />
              {/* Incoming Blend Image */}
              <img
                src={incomingFrame}
                alt="Incoming cut frame"
                className="saccadic-layer incoming"
                style={{
                  opacity: isSimulating
                    ? simStep === "out"
                      ? 0
                      : 1
                    : blend * 0.9 + 0.1,
                }}
              />
            </div>
          ) : (
            /* Wipe Mode */
            <div className="saccadic-wipe-view">
              <img src={incomingFrame} alt="Incoming frame" className="saccadic-layer incoming" />
              <div
                className="saccadic-wipe-clip"
                style={{ width: `${wipePos * 100}%` }}
              >
                <img
                  src={outgoingFrame}
                  alt="Outgoing frame"
                  className="saccadic-layer outgoing"
                  style={{ width: `${(1 / (wipePos || 0.001)) * 100}%` }}
                />
              </div>
              <div
                className="saccadic-wipe-handle"
                style={{ left: `${wipePos * 100}%` }}
              >
                <div className="wipe-line" />
                <div className="wipe-knob">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6" />
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </div>
            </div>
          )}

          {/* Saccadic Vector SVG Overlay */}
          <svg
            className="saccadic-vector-svg"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              {/* Glowing Arrowhead Filter */}
              <filter id="vector-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              {/* Dynamic Gradient for the Vector Stream */}
              <linearGradient
                id="vector-stream-grad"
                gradientUnits="userSpaceOnUse"
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
              >
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
                <stop offset="45%" stopColor={ratingColor} stopOpacity="1" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.95" />
              </linearGradient>

              {/* Arrowhead Marker */}
              <marker
                id="saccade-arrowhead"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={ratingColor} />
              </marker>

              {/* Momentum Lead-In Arrowhead */}
              <marker
                id="momentum-arrowhead"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 1.5 L 8 5 L 0 8.5 z"
                  fill={eyeTrace.momentum?.alignment === "momentum-collision" ? "#f43f5e" : "#06b6d4"}
                />
              </marker>
            </defs>

            {/* Murch 2° Foveal Comfort Zones (dashed rings, radius ~45px) */}
            <circle
              cx={x1}
              cy={y1}
              r="45"
              fill="rgba(34, 211, 238, 0.06)"
              stroke="rgba(34, 211, 238, 0.35)"
              strokeWidth="1.2"
              strokeDasharray="4 3"
              className="foveal-cone outgoing"
            />
            <circle
              cx={x2}
              cy={y2}
              r="45"
              fill="rgba(245, 158, 11, 0.06)"
              stroke="rgba(245, 158, 11, 0.35)"
              strokeWidth="1.2"
              strokeDasharray="4 3"
              className="foveal-cone incoming"
            />

            {/* Background Halo Path for High Contrast Glow */}
            <path
              d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
              fill="none"
              stroke={ratingGlow}
              strokeWidth="8"
              strokeLinecap="round"
              opacity="0.8"
            />

            {/* Main Curved Trajectory Line */}
            <path
              d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
              fill="none"
              stroke="url(#vector-stream-grad)"
              strokeWidth="2.5"
              strokeLinecap="round"
              markerEnd="url(#saccade-arrowhead)"
              filter="url(#vector-glow)"
              className="saccade-path-stream"
            />

            {/* Animated Flow Dashes (Saccadic Velocity Stream) */}
            <path
              d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              strokeDasharray="8 14"
              strokeLinecap="round"
              className="saccade-flow-particles"
              opacity="0.9"
            />

            {/* Optical Flow Gaze Momentum Trail (Phase 2) */}
            {eyeTrace.momentum && eyeTrace.momentum.velocity > 5 && (
              <g className="kinetic-gaze-trail">
                <line
                  x1={x1 - eyeTrace.momentum.vx * 80}
                  y1={y1 - eyeTrace.momentum.vy * 80}
                  x2={x1}
                  y2={y1}
                  stroke={eyeTrace.momentum.alignment === "momentum-collision" ? "#f43f5e" : "#06b6d4"}
                  strokeWidth="2.5"
                  strokeDasharray="6 4"
                  className="momentum-stream-particles"
                  markerEnd="url(#momentum-arrowhead)"
                />
                <circle
                  cx={x1 - eyeTrace.momentum.vx * 80}
                  cy={y1 - eyeTrace.momentum.vy * 80}
                  r="3.5"
                  fill={eyeTrace.momentum.alignment === "momentum-collision" ? "#f43f5e" : "#06b6d4"}
                />
                <text
                  x={x1 - eyeTrace.momentum.vx * 85}
                  y={y1 - eyeTrace.momentum.vy * 85 - 6}
                  textAnchor="middle"
                  className="svg-momentum-label"
                >
                  PRE-CUT GAZE VELOCITY: {eyeTrace.momentum.velocity}%
                </text>
              </g>
            )}

            {/* Point A: Outgoing Reticle Anchor */}
            <g
              className={`focal-anchor outgoing ${draggingAnchor === "outgoing" ? "dragging" : ""}`}
              transform={`translate(${x1}, ${y1})`}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setDraggingAnchor("outgoing");
              }}
              style={{ cursor: draggingAnchor === "outgoing" ? "grabbing" : "grab", pointerEvents: "all" }}
            >
              <title>Drag OUT reticle to position on actor eyes / focal subject</title>
              {/* Invisible larger hit target for easy grabbing */}
              <circle r="30" fill="transparent" />
              <circle r="12" fill="none" stroke="#22d3ee" strokeWidth="1.8" />
              <circle r="3.5" fill="#22d3ee" />
              <line x1="-16" y1="0" x2="-6" y2="0" stroke="#22d3ee" strokeWidth="1.2" />
              <line x1="6" y1="0" x2="16" y2="0" stroke="#22d3ee" strokeWidth="1.2" />
              <line x1="0" y1="-16" x2="0" y2="-6" stroke="#22d3ee" strokeWidth="1.2" />
              <line x1="0" y1="6" x2="0" y2="16" stroke="#22d3ee" strokeWidth="1.2" />
              <text x="0" y="26" textAnchor="middle" className="svg-anchor-label out-label">
                OUT: {outP.type.toUpperCase()}
              </text>
            </g>

            {/* Point B: Incoming Reticle Anchor */}
            <g
              className={`focal-anchor incoming ${draggingAnchor === "incoming" ? "dragging" : ""}`}
              transform={`translate(${x2}, ${y2})`}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setDraggingAnchor("incoming");
              }}
              style={{ cursor: draggingAnchor === "incoming" ? "grabbing" : "grab", pointerEvents: "all" }}
            >
              <title>Drag IN reticle to position on actor eyes / focal subject</title>
              {/* Invisible larger hit target for easy grabbing */}
              <circle r="30" fill="transparent" />
              <circle r="14" fill="none" stroke="#f59e0b" strokeWidth="2" className="arrival-radar-ping" />
              <circle r="4" fill="#f59e0b" />
              <line x1="-18" y1="0" x2="-7" y2="0" stroke="#f59e0b" strokeWidth="1.2" />
              <line x1="7" y1="0" x2="18" y2="0" stroke="#f59e0b" strokeWidth="1.2" />
              <line x1="0" y1="-18" x2="0" y2="-7" stroke="#f59e0b" strokeWidth="1.2" />
              <line x1="0" y1="7" x2="0" y2="18" stroke="#f59e0b" strokeWidth="1.2" />
              <text x="0" y="28" textAnchor="middle" className="svg-anchor-label in-label">
                IN: {inP.type.toUpperCase()}
              </text>
            </g>

            {/* Simulation Photon / Eye Gaze Indicator */}
            {isSimulating && (
              <g transform={`translate(${simX}, ${simY})`}>
                <circle r="16" fill="rgba(255, 255, 255, 0.25)" filter="url(#vector-glow)" />
                <circle r="8" fill="#ffffff" filter="url(#vector-glow)" />
                <circle r="3" fill={ratingColor} />
              </g>
            )}

            {/* Midpoint Saccadic Vector Metric Badge */}
            <g transform={`translate(${midX}, ${midY - 14})`}>
              <rect
                x="-70"
                y="-14"
                width="140"
                height="28"
                rx="14"
                fill="rgba(10, 14, 18, 0.92)"
                stroke={ratingColor}
                strokeWidth="1.5"
                filter="url(#vector-glow)"
              />
              <text x="0" y="2" textAnchor="middle" className="svg-badge-text">
                {arrowSymbol} {eyeTrace.jumpDistancePercent}% hop · {degrees}° arc
              </text>
              <title>
                {`Saccadic jump: ${eyeTrace.jumpDistancePercent}% of screen · Visual arc: ${degrees}° · Trajectory angle: ${angleDeg}° (${arrowSymbol})`}
              </title>
            </g>
          </svg>

          {/* Screen Direction Vector Banner */}
          <div className="saccadic-vector-status">
            <span className={`saccadic-status-pill ${eyeTrace.rating}`}>
              {isAnchored ? "ANCHORED GAZE" : isShifted ? "SHIFTED GAZE" : "SCATTERED GAZE"}
            </span>

            {/* 180° Axis Clash Warning */}
            {eyeTrace.axisClash && (
              <span className="saccadic-axis-clash-pill" title={eyeTrace.axisClashDetail || "180° axis clash: eyelines clash across the edit boundary"}>
                ⚠️ 180° AXIS CLASH
              </span>
            )}

            {/* Character Replacement / Jump-Cut Collision */}
            {eyeTrace.characterReplacement && (
              <span className="saccadic-replacement-pill" title={eyeTrace.characterReplacementDetail || "Subject substituted in same retinal position"}>
                ⚡ POSITION COLLISION
              </span>
            )}

            {/* Depth Accommodation Shift */}
            {eyeTrace.depthShift && eyeTrace.depthShift.shift !== "constant" && (
              <span className="saccadic-depth-pill" title={`Depth accommodation: ${eyeTrace.depthShift.shift} (${eyeTrace.depthShift.magnitude})`}>
                👁️ {eyeTrace.depthShift.shift === "near-to-far" ? "NEAR ➔ FAR DEPTH" : "FAR ➔ NEAR DEPTH"}
              </span>
            )}

            {eyeTrace.momentum && (
              <span className={`saccadic-momentum-pill ${eyeTrace.momentum.alignment}`}>
                {eyeTrace.momentum.alignment === "momentum-match"
                  ? `FLOW MATCH (${(eyeTrace.momentum.cosineScore ?? 0.8) > 0 ? "+" : ""}${eyeTrace.momentum.cosineScore ?? 0.8})`
                  : eyeTrace.momentum.alignment === "momentum-collision"
                  ? `KINETIC COLLISION (${eyeTrace.momentum.cosineScore ?? -0.7})`
                  : eyeTrace.momentum.alignment === "neutral"
                  ? "ORTHOGONAL FLOW"
                  : "STEADY GAZE"}
              </span>
            )}
            <span className="saccadic-direction-pill">
              {eyeTrace.screenDirection === "left-to-right"
                ? "LEFT ➔ RIGHT FLOW"
                : eyeTrace.screenDirection === "right-to-left"
                ? "RIGHT ➔ LEFT FLOW"
                : "CENTER ANCHORED"}
            </span>
            <span className="saccadic-hint-pill">
              Drag reticles to calibrate eyes
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Ghosted reticle rendered inside traditional Split Cards to bridge spatial context.
 */
export function GhostFocalReticle({
  point,
  role,
  label,
}: {
  point: FocalPoint;
  role: "origin" | "target";
  label: string;
}) {
  return (
    <div
      className={`ghost-focal-reticle ghost-${role}`}
      style={{
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
      }}
      title={`Eye-Trace ${role === "target" ? "Destination in incoming shot" : "Origin in outgoing shot"}: ${point.type}`}
    >
      <div className="ghost-ring" />
      <div className="ghost-dot" />
      <div className="ghost-label">
        <span className="ghost-arrow">{role === "target" ? "➔" : "⯇"}</span>
        <span className="ghost-text">{label}</span>
      </div>
    </div>
  );
}
