import { memo, useState } from "react";
import type { Project, Shot } from "../models/project";
import { formatTimecode } from "../utils/timecode";
import { analyzeShotMotion } from "../analysis/motion";

const MotionEnergyArc = memo(function MotionEnergyArc({
  project,
  time,
  url,
  selected,
  onSelect,
  onUpdateShots,
}: {
  project: Project;
  time: number;
  url?: string;
  selected?: string;
  onSelect: (shot: Shot) => void;
  onUpdateShots?: (updatedShots: Shot[]) => void;
}) {
  const [batchScanning, setBatchScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  const duration = Math.max(1, project.duration);
  const shots = project.shots;

  const analyzedCount = shots.filter((s) => s.motionProfile !== undefined).length;
  const avgKinetic =
    analyzedCount > 0
      ? Math.round(
          shots.reduce((acc, s) => acc + (s.motionProfile?.totalKineticEnergy ?? 0), 0) /
            analyzedCount
        )
      : 0;

  const highVelocityCount = shots.filter(
    (s) => (s.motionProfile?.totalKineticEnergy ?? 0) >= 50
  ).length;

  const staticCount = shots.filter(
    (s) =>
      (s.cameraMovement ?? s.motionProfile?.cameraMovement) === "Static" ||
      (s.motionProfile?.cameraEnergy ?? 0) < 8
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

    onUpdateShots(updated);
    setBatchScanning(false);
  };

  return (
    <section className="motion-energy-arc">
      <div className="motion-arc-header">
        <p className="rhythm-explanation">
          <b>Kinetic Energy Arc</b>: Visualizes macro motion energy across the sequence.
          Layered bars represent <span className="legend-camera">■ Camera Motion</span> (global frame move)
          and <span className="legend-subject">■ Subject Motion</span> (internal actor/action energy).
        </p>
        <div className="motion-arc-actions">
          {url && onUpdateShots && (
            <button
              type="button"
              className="scan-sequence-motion-btn"
              onClick={handleScanSequence}
              disabled={batchScanning}
              title="Batch analyze motion energy across all shots in the sequence"
            >
              {batchScanning ? `Scanning sequence (${scanProgress}%)…` : "⚡ Scan Sequence Motion"}
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
          <span className="stat-label">Static Camera Shots</span>
          <b className="stat-value">{staticCount}</b>
        </div>
        <div className="motion-stat">
          <span className="stat-label">Coverage Analyzed</span>
          <b className="stat-value">
            {analyzedCount} / {shots.length}
          </b>
        </div>
      </div>

      {!shots.length ? (
        <p className="rhythm-empty muted">Import an EDL to see the motion energy arc.</p>
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
                const camEnergy = profile?.cameraEnergy ?? 0;
                const subEnergy = profile?.subjectEnergy ?? 0;
                const totalEnergy = profile?.totalKineticEnergy ?? 0;
                const isSelected = selected === shot.id;
                const movement = shot.cameraMovement ?? profile?.cameraMovement ?? "Unclassified";

                return (
                  <button
                    key={shot.id}
                    type="button"
                    aria-label={`Motion shot ${shot.index}`}
                    aria-pressed={isSelected}
                    title={`Shot ${shot.index} · ${movement} · Total: ${totalEnergy}% (Camera: ${camEnergy}%, Subject: ${subEnergy}%) · ${shot.duration.toFixed(2)}s`}
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
                      <div className="bar-energy-stack">
                        {/* Subject energy layer (top/amber) */}
                        <div
                          className="bar-layer subject"
                          style={{ height: `${subEnergy}%` }}
                        />
                        {/* Camera energy layer (bottom/cyan) */}
                        <div
                          className="bar-layer camera"
                          style={{ height: `${camEnergy}%` }}
                        />
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
                <span>{formatTimecode(duration / 2, project.frameRate, project.dropFrame)}</span>
                <span>{formatTimecode(duration, project.frameRate, project.dropFrame)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});

export default MotionEnergyArc;
