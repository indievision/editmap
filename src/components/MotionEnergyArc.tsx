import { memo, useMemo, useState } from "react";
import type { Project, Shot } from "../models/project";
import { formatTimecode } from "../utils/timecode";
import {
  analyzeShotMotion,
  calculateKineticDeltas,
  classifyKineticVelocity,
  classifyMomentumTransition,
} from "../analysis/motion";

const MotionEnergyArc = memo(function MotionEnergyArc({
  project,
  time,
  url,
  selected,
  onSelect,
  onUpdateShots,
  onOpenCompare,
}: {
  project: Project;
  time: number;
  url?: string;
  selected?: string;
  onSelect: (shot: Shot) => void;
  onUpdateShots?: (updatedShots: Shot[]) => void;
  onOpenCompare?: (measure: "motion") => void;
}) {
  const [batchScanning, setBatchScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  const duration = Math.max(1, project.duration);
  // Ensure kinetic deltas are populated across sequential shots
  const shots = useMemo(() => calculateKineticDeltas(project.shots), [project.shots]);

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
    <section className="motion-energy-arc">
      <div className="motion-arc-header">
        <p className="rhythm-explanation">
          <b>Kinetic Energy Arc</b>: Visualizes macro motion energy and movement flow across the
          sequence. Shaded bars represent unified visual velocity, tracking where visual rhythm
          accelerates, sustains momentum, or drops into still contemplative breath.
        </p>
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
        <div className="motion-arc-chart-container">
          <div className="motion-y-axis">
            <span>100%</span>
            <span>75%</span>
            <span>50%</span>
            <span>25%</span>
            <span>0%</span>
          </div>

          <div className="motion-timeline-scroll">
            <div
              className="motion-timeline-track"
              style={{ minWidth: Math.max(600, shots.length * 6) }}
            >
              {shots.map((shot) => {
                const profile = shot.motionProfile;
                const totalEnergy = profile?.totalKineticEnergy ?? 0;
                const isSelected = selected === shot.id;
                const velocityTier = classifyKineticVelocity(totalEnergy);
                const momentum =
                  profile?.kineticDelta !== undefined
                    ? classifyMomentumTransition(profile.kineticDelta)
                    : null;

                const tierClass = velocityTier.toLowerCase().replace(/\s+/g, "-");

                return (
                  <button
                    key={shot.id}
                    type="button"
                    aria-label={`Motion shot ${shot.index}`}
                    aria-pressed={isSelected}
                    title={`Shot ${shot.index} · ${velocityTier} (${totalEnergy}% Flow)${
                      momentum && momentum.type !== "initial" ? ` · Cut Momentum: ${momentum.label}` : ""
                    } · ${shot.duration.toFixed(2)}s`}
                    className={`motion-shot-bar ${isSelected ? "selected" : ""} ${
                      profile ? "analyzed" : "unscanned"
                    }`}
                    onClick={() => onSelect(shot)}
                    style={{
                      left: `${(100 * shot.startSeconds) / duration}%`,
                      width: `${Math.max(0.4, (100 * shot.duration) / duration)}%`,
                    }}
                  >
                    {profile ? (
                      <div
                        className={`bar-energy-unified tier-${tierClass}`}
                        style={{ height: `${Math.max(3, totalEnergy)}%` }}
                      >
                        {profile.kineticDelta !== undefined &&
                          Math.abs(profile.kineticDelta) >= 25 && (
                            <div
                              className={`bar-momentum-dot ${
                                profile.kineticDelta > 0 ? "surge" : "drop"
                              }`}
                              title={momentum ? momentum.label : ""}
                            />
                          )}
                      </div>
                    ) : (
                      <div className="bar-energy-unscanned" />
                    )}

                    <span className="bar-shot-idx">{shot.index}</span>
                  </button>
                );
              })}

              {/* Playhead Marker */}
              <div
                className="pacing-marker motion-marker"
                style={{ left: `${100 * Math.min(time / duration, 1)}%` }}
              />

              <div className="pacing-times">
                <span>00:00:00</span>
                <span>
                  {formatTimecode(
                    duration / 2,
                    project.frameRate,
                    project.dropFrame,
                  )}
                </span>
                <span>
                  {formatTimecode(
                    duration,
                    project.frameRate,
                    project.dropFrame,
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});

export default MotionEnergyArc;
