import { memo, useMemo, useState, useRef, useCallback } from "react";
import type { Project, Shot } from "../models/project";
import { formatTimecode } from "../utils/timecode";
import {
  analyzeShotMotion,
  calculateKineticDeltas,
  classifyKineticVelocity,
  classifyMomentumTransition,
} from "../analysis/motion";
import { generateMotionFlowPathAndArea } from "../timeline/FullscreenMapVisualization";

const MotionEnergyArc = memo(function MotionEnergyArc({
  project,
  time,
  url,
  selected,
  onSelect,
  onSeek,
  onUpdateShots,
  onOpenCompare,
}: {
  project: Project;
  time: number;
  url?: string;
  selected?: string;
  onSelect: (shot: Shot) => void;
  onSeek?: (time: number) => void;
  onUpdateShots?: (updatedShots: Shot[]) => void;
  onOpenCompare?: (measure: "motion") => void;
}) {
  const [batchScanning, setBatchScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [hover, setHover] = useState<number | undefined>(undefined);

  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);

  const duration = Math.max(1, project.duration);

  // Ensure kinetic deltas are populated across sequential shots
  const shots = useMemo(() => calculateKineticDeltas(project.shots), [project.shots]);

  const seekFromPointer = useCallback(
    (clientX: number, target: HTMLElement) => {
      if (!onSeek || duration <= 0) return;
      const rect = target.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const targetTime = (x / rect.width) * duration;
      onSeek(targetTime);
      const clickedShot = shots.find(
        (s) => targetTime >= s.startSeconds && targetTime <= s.endSeconds,
      );
      if (clickedShot) {
        onSelect(clickedShot);
      }
    },
    [duration, onSeek, shots, onSelect],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !onSeek) return;
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    seekFromPointer(e.clientX, e.currentTarget);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(
      0,
      Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration),
    );
    setHover(t);
    if (isDraggingRef.current) {
      hasDraggedRef.current = true;
      seekFromPointer(e.clientX, e.currentTarget);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const analyzedCount = shots.filter(
    (s) => s.motionProfile !== undefined,
  ).length;

  const avgKinetic =
    analyzedCount > 0
      ? Math.round(
          shots.reduce(
            (acc, s) => acc + (s.motionProfile?.totalKineticEnergy ?? 0),
            0,
          ) / analyzedCount,
        )
      : 0;

  const highVelocityCount = shots.filter(
    (s) => (s.motionProfile?.totalKineticEnergy ?? 0) >= 50,
  ).length;

  const stillCount = shots.filter(
    (s) =>
      s.motionProfile !== undefined &&
      (s.motionProfile.totalKineticEnergy <= 15 ||
        s.cameraMovement === "Static" ||
        s.motionProfile.cameraEnergy < 8),
  ).length;

  const cutShockCount = shots.filter(
    (s) =>
      s.motionProfile?.kineticDelta !== undefined &&
      Math.abs(s.motionProfile.kineticDelta) >= 25,
  ).length;

  // Generate smooth Catmull-Rom spline wave matching timeline motion track
  const motionFlow = useMemo(() => {
    const scale = 1000 / duration;
    return generateMotionFlowPathAndArea(shots, duration, scale, 180);
  }, [shots, duration]);

  const activeTime = hover ?? time;
  const activeShot = useMemo(() => {
    return (
      shots.find((s) => activeTime >= s.startSeconds && activeTime <= s.endSeconds) ??
      shots[0]
    );
  }, [shots, activeTime]);

  const activeEnergy = activeShot?.motionProfile?.totalKineticEnergy ?? 0;
  const activeVelocityTier = classifyKineticVelocity(activeEnergy);
  const activeTierClass = activeVelocityTier.toLowerCase().replace(/\s+/g, "-");
  const activeMomentum =
    activeShot?.motionProfile?.kineticDelta !== undefined
      ? classifyMomentumTransition(activeShot.motionProfile.kineticDelta)
      : null;

  const selectedShot = useMemo(
    () => shots.find((s) => s.id === selected),
    [shots, selected],
  );

  const handleScanSequence = async () => {
    if (!url || !shots.length || batchScanning || !onUpdateShots) return;
    setBatchScanning(true);
    setScanProgress(0);

    const updated = [...shots];
    for (let i = 0; i < updated.length; i++) {
      const shot = updated[i];
      if (!shot.motionProfile) {
        try {
          const profile = await analyzeShotMotion(url, shot);
          updated[i] = {
            ...shot,
            motionProfile: profile,
            cameraMovement: shot.cameraMovement ?? profile.cameraMovement,
          };
        } catch {
          // Continue to next shot
        }
      }
      setScanProgress(Math.round(((i + 1) / updated.length) * 100));
    }

    const withDeltas = calculateKineticDeltas(updated);
    onUpdateShots(withDeltas);
    setBatchScanning(false);
  };

  return (
    <section className="panel motion-energy-arc">
      <div className="section-head motion-section-head">
        <span className="eyebrow motion-eyebrow">06 / MOTION ENERGY ARC</span>
        <div className="motion-arc-actions">
          {onOpenCompare && (
            <button
              type="button"
              className="panel-compare-launch-btn"
              onClick={() => onOpenCompare("motion")}
              title="Open analytical curve comparison with Motion energy"
              aria-label="Compare Motion energy with other measures"
            >
              Compare ↗
            </button>
          )}
          {url && onUpdateShots && (
            <button
              type="button"
              className="scan-sequence-motion-btn"
              onClick={handleScanSequence}
              disabled={batchScanning}
              title="Batch analyze motion energy across all shots in the sequence"
            >
              {batchScanning
                ? `Scanning sequence (${scanProgress}%)…`
                : "⚡ Scan Sequence Motion"}
            </button>
          )}
        </div>
      </div>

      <div className="motion-stats-bar">
        <div className="motion-stat">
          <span className="stat-label">Average Kinetic Energy</span>
          <b className="stat-value">{avgKinetic}%</b>
        </div>
        <div className="motion-stat">
          <span className="stat-label">Dynamic / Action Shots</span>
          <b className="stat-value">{highVelocityCount}</b>
        </div>
        <div className="motion-stat">
          <span className="stat-label">Still / Static Beats</span>
          <b className="stat-value">{stillCount}</b>
        </div>
        <div className="motion-stat">
          <span className="stat-label">Momentum Cut Shocks</span>
          <b className="stat-value">{cutShockCount}</b>
        </div>
        <div className="motion-stat">
          <span className="stat-label">Coverage Analyzed</span>
          <b className="stat-value">
            {analyzedCount} / {shots.length}
          </b>
        </div>
      </div>

      {!shots.length ? (
        <p className="rhythm-empty muted">
          Import an EDL to see the motion energy arc.
        </p>
      ) : (
        <>
          <div className="motion-hud-row">
            <div className="motion-hud-readout">
              <span className="motion-hud-time">
                {formatTimecode(activeTime, project.frameRate, project.dropFrame)}
              </span>
              <span className="motion-hud-stat">
                <span className="motion-hud-pip cyan" />
                <span className="motion-hud-name">Shot {activeShot?.index ?? 1}:</span>
                <b>{activeEnergy}%</b> Flow
              </span>
              <span className="motion-hud-sep">·</span>
              <span className="motion-hud-stat velocity">
                <span className={`velocity-tag tier-${activeTierClass}`}>
                  {activeVelocityTier}
                </span>
              </span>
              {activeMomentum && activeMomentum.type !== "initial" && (
                <>
                  <span className="motion-hud-sep">·</span>
                  <span className="motion-hud-stat momentum">
                    Cut Momentum: <b>{activeMomentum.label}</b>
                  </span>
                </>
              )}
            </div>

            <div className="motion-legend-inline">
              <span className="motion-legend-item">
                <span className="motion-legend-line cyan" />
                <span>Kinetic Energy Flow</span>
              </span>
              <span className="motion-legend-item">
                <span className="motion-legend-dot amber" />
                <span>Acceleration (≥+25%)</span>
              </span>
              <span className="motion-legend-item">
                <span className="motion-legend-dot blue" />
                <span>Drop (≤-25%)</span>
              </span>
            </div>
          </div>

          <div className="motion-arc-chart-container">
            <div className="motion-y-axis" aria-hidden="true">
              <span style={{ top: "8px" }}>100%</span>
              <span style={{ top: "50px" }}>75%</span>
              <span style={{ top: "92px" }}>50%</span>
              <span style={{ top: "134px" }}>25%</span>
              <span style={{ top: "176px" }}>0%</span>
            </div>

            <div className="motion-surface-container">
              <div
                className="motion-surface"
                role="slider"
                tabIndex={0}
                aria-label="Motion energy seek"
                aria-valuemin={0}
                aria-valuemax={project.duration}
                aria-valuenow={Math.min(time, project.duration)}
                aria-valuetext={formatTimecode(time, project.frameRate, project.dropFrame)}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onMouseLeave={() => setHover(undefined)}
              >
                <svg viewBox="0 0 1000 180" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="motionEnergyFlowGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.38" />
                      <stop offset="55%" stopColor="#38bdf8" stopOpacity="0.12" />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.00" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal reference grid lines matching 100%, 75%, 50%, 25%, 0% */}
                  <line x1="0" y1="8" x2="1000" y2="8" stroke="rgba(255, 255, 255, 0.08)" strokeDasharray="3 3" strokeWidth="1" />
                  <line x1="0" y1="50" x2="1000" y2="50" stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="3 3" strokeWidth="1" />
                  <line x1="0" y1="92" x2="1000" y2="92" stroke="rgba(255, 255, 255, 0.08)" strokeDasharray="3 3" strokeWidth="1" />
                  <line x1="0" y1="134" x2="1000" y2="134" stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="3 3" strokeWidth="1" />
                  <line x1="0" y1="176" x2="1000" y2="176" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="1" />

                  {/* Selected Shot highlight beam */}
                  {selectedShot && (
                    <rect
                      x={(selectedShot.startSeconds / duration) * 1000}
                      y={0}
                      width={Math.max(2, (selectedShot.duration / duration) * 1000)}
                      height={180}
                      fill="rgba(56, 189, 248, 0.10)"
                      stroke="rgba(56, 189, 248, 0.35)"
                      strokeWidth="1"
                    />
                  )}

                  {/* Cut boundary vertical guides */}
                  {shots.map((s, idx) => {
                    if (idx === 0) return null;
                    const x = (s.startSeconds / duration) * 1000;
                    return (
                      <line
                        key={`cut-${s.id}`}
                        x1={x}
                        y1={0}
                        x2={x}
                        y2={180}
                        stroke="rgba(255, 255, 255, 0.07)"
                        strokeDasharray="2 3"
                        strokeWidth="1"
                      />
                    );
                  })}

                  {/* Smooth Kinetic Motion Wave Area & Line */}
                  {motionFlow.hasData ? (
                    <>
                      {motionFlow.area && (
                        <path
                          d={motionFlow.area}
                          className="motion-energy-area"
                          fill="url(#motionEnergyFlowGrad)"
                        />
                      )}
                      {motionFlow.path && (
                        <path
                          d={motionFlow.path}
                          className="motion-energy-path"
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}
                    </>
                  ) : (
                    <line
                      x1="0"
                      y1="176"
                      x2="1000"
                      y2="176"
                      stroke="rgba(56, 189, 248, 0.3)"
                      strokeDasharray="4 4"
                      strokeWidth="1.5"
                    />
                  )}

                  {/* Momentum Cut Shock radar markers (cuts with >= 25% surge or drop) */}
                  {shots.map((s) => {
                    if (
                      s.motionProfile?.kineticDelta === undefined ||
                      Math.abs(s.motionProfile.kineticDelta) < 25
                    ) {
                      return null;
                    }
                    const x = (s.startSeconds / duration) * 1000;
                    const energy = s.motionProfile.totalKineticEnergy;
                    const y = 176 - (energy / 100) * 168;
                    const isSurge = s.motionProfile.kineticDelta > 0;
                    const color = isSurge ? "#fbbf24" : "#38bdf8";

                    return (
                      <g key={`shock-${s.id}`} className="motion-cut-shock-marker">
                        <line
                          x1={x}
                          y1={0}
                          x2={x}
                          y2={180}
                          stroke={color}
                          strokeDasharray="2 2"
                          strokeWidth="1.2"
                          opacity="0.65"
                        />
                        <circle cx={x} cy={y} r={4.5} fill={color} />
                        <circle
                          cx={x}
                          cy={y}
                          r={7.5}
                          fill="none"
                          stroke={color}
                          strokeWidth="1"
                          opacity="0.6"
                        />
                      </g>
                    );
                  })}

                  {/* Hover line and guide dot */}
                  {hover !== undefined && (
                    <g className="motion-hover-group" pointerEvents="none">
                      <line
                        x1={(hover / duration) * 1000}
                        y1={0}
                        x2={(hover / duration) * 1000}
                        y2={180}
                        stroke="rgba(255, 255, 255, 0.4)"
                        strokeDasharray="2 2"
                        strokeWidth="1"
                      />
                      <circle
                        cx={(hover / duration) * 1000}
                        cy={176 - (activeEnergy / 100) * 168}
                        r={4.5}
                        fill="#38bdf8"
                        stroke="#0c1015"
                        strokeWidth={1.5}
                      />
                    </g>
                  )}

                  {/* Current playhead line & indicator */}
                  <g className="motion-playhead-group" pointerEvents="none">
                    <line
                      x1={(time / duration) * 1000}
                      y1={0}
                      x2={(time / duration) * 1000}
                      y2={180}
                      stroke="#f43f5e"
                      strokeWidth="1.5"
                    />
                    <circle
                      cx={(time / duration) * 1000}
                      cy={176 - ((activeShot?.motionProfile?.totalKineticEnergy ?? 0) / 100) * 168}
                      r={5}
                      fill="#f43f5e"
                      stroke="#0c1015"
                      strokeWidth={1.5}
                    />
                    <polygon
                      points={`${(time / duration) * 1000 - 4},0 ${(time / duration) * 1000 + 4},0 ${(time / duration) * 1000},6`}
                      fill="#f43f5e"
                    />
                  </g>
                </svg>
              </div>

              {/* Shot Index Strip along the bottom */}
              <div className="motion-shot-strip" aria-label="Shot sequence strip">
                {shots.map((shot) => {
                  const isSelected = selected === shot.id;
                  const energy = shot.motionProfile?.totalKineticEnergy ?? 0;
                  return (
                    <button
                      key={shot.id}
                      type="button"
                      className={`motion-strip-pill ${isSelected ? "selected" : ""}`}
                      style={{
                        left: `${(100 * shot.startSeconds) / duration}%`,
                        width: `${Math.max(0.6, (100 * shot.duration) / duration)}%`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(shot);
                        onSeek?.(shot.startSeconds);
                      }}
                      title={`Shot ${shot.index} · ${
                        shot.motionProfile ? `${energy}% Kinetic Flow` : "Unscanned"
                      } · ${shot.duration.toFixed(2)}s`}
                    >
                      <span className="motion-strip-idx">{shot.index}</span>
                    </button>
                  );
                })}
              </div>

              {/* Timecode markers */}
              <div className="motion-timeline-times">
                <span>00:00:00:00</span>
                <span>
                  {formatTimecode(duration / 2, project.frameRate, project.dropFrame)}
                </span>
                <span>
                  {formatTimecode(duration, project.frameRate, project.dropFrame)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
});

export default MotionEnergyArc;
