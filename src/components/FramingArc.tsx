import type { Project, Shot } from "../models/project";
import { framingRank, framingSizes } from "../analysis/framing";
import { sizeColors } from "../analysis/colors";
import { formatTimecode } from "../utils/timecode";

export default function FramingArc({
  project,
  time,
  selected,
  onSelect,
}: {
  project: Project;
  time: number;
  selected?: string;
  onSelect: (shot: Shot) => void;
}) {
  const duration = Math.max(1, project.duration);
  return (
    <section className="framing-arc">
      <p className="rhythm-explanation">
        Wide → close over film time. Each segment spans one shot; faded segments
        are unconfirmed or uncertain. Unknown, exempt and legacy sizes occupy
        the — lane. Click a segment to select and seek.
      </p>
      {!project.shots.length ? (
        <p className="rhythm-empty muted">
          Import an EDL to see the framing arc.
        </p>
      ) : (
        <div className="framing-arc-layout">
          <div className="framing-labels">
            {[...framingSizes].reverse().map((size) => (
              <span key={size}>{size}</span>
            ))}
            <span>—</span>
          </div>
          <div className="framing-arc-scroll">
            <div
              className="framing-arc-plot"
              style={{ minWidth: Math.max(500, project.shots.length * 4) }}
            >
              {project.shots.map((shot) => {
                const rank = framingRank(shot);
                return (
                  <button
                    key={shot.id}
                    aria-label={`Framing shot ${shot.index}`}
                    aria-pressed={selected === shot.id}
                    title={`Shot ${shot.index} · ${shot.shotSize} · ${shot.duration.toFixed(2)}s · ${shot.reviewStatus ?? "Unreviewed"}${shot.uncertain ? " · Uncertain" : ""}`}
                    className="framing-segment"
                    onClick={() => onSelect(shot)}
                    style={{
                      left: `${(100 * shot.startSeconds) / duration}%`,
                      width: `${(100 * shot.duration) / duration}%`,
                      top: `${(rank === null ? 8 : 7 - rank) * 24 + 6}px`,
                      background:
                        rank === null ? "#626970" : sizeColors[shot.shotSize],
                      opacity:
                        shot.reviewStatus === "Confirmed" && !shot.uncertain
                          ? 1
                          : 0.55,
                    }}
                  />
                );
              })}
              <div
                className="pacing-marker"
                style={{ left: `${100 * Math.min(time / duration, 1)}%` }}
              />
              <div className="pacing-times">
                {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                  <span key={f}>
                    {formatTimecode(
                      f * project.duration,
                      project.frameRate,
                      project.dropFrame,
                    )}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
