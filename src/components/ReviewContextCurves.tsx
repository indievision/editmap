import { useMemo } from "react";
import type { Project } from "../models/project";
import { cutTimes, pacingAt } from "../analysis/pacing";

/** Small shared-time readings using the same pacing and motion evidence as Studio. */
export default function ReviewContextCurves({
  project,
  start,
  end,
  time,
  anchor,
  onSeek,
}: {
  project: Project;
  start: number;
  end: number;
  time: number;
  anchor: number;
  onSeek: (time: number) => void;
}) {
  const data = useMemo(() => {
    const cuts = cutTimes(project.shots);
    const points = Array.from({ length: 81 }, (_, i) => {
      const t = start + ((end - start) * i) / 80;
      return { t, rate: pacingAt(cuts, project.duration, 10, t).rate };
    });
    return {
      points,
      max: Math.max(1, ...points.map((p) => p.rate)),
      shots: project.shots.filter(
        (s) => s.endSeconds > start && s.startSeconds < end,
      ),
    };
  }, [project.shots, project.duration, start, end]);
  const x = (t: number) =>
    Math.max(
      0,
      Math.min(600, (600 * (t - start)) / Math.max(0.001, end - start)),
    );
  const hasMotion = data.shots.some(
    (s) => s.motionProfile && s.motionProfile.confidence > 0,
  );
  return (
    <section
      className="sr-context-curves"
      aria-label="Context rhythm and motion curves"
    >
      <div className="sr-section-heading">
        <h2>Rhythm through the seam</h2>
        <span>Gold: anchor · White: playback</span>
      </div>
      <div className="sr-curve-row">
        <span>
          Cut rate<small>0–{data.max.toFixed(0)} / min · 10s</small>
        </span>
        <svg
          viewBox="0 0 600 45"
          preserveAspectRatio="none"
          aria-label="Local cut-rate curve"
          role="img"
        >
          <path
            d={data.points
              .map(
                (p, i) =>
                  `${i ? "L" : "M"}${x(p.t)},${42 - (38 * p.rate) / data.max}`,
              )
              .join(" ")}
            fill="none"
            stroke="#8aa6b4"
            strokeWidth="1.5"
          />
          <line x1={x(anchor)} x2={x(anchor)} y1="0" y2="45" stroke="#cfb778" />
          {time >= start && time <= end && (
            <line x1={x(time)} x2={x(time)} y1="0" y2="45" stroke="#eee" />
          )}
        </svg>
      </div>
      <div className="sr-curve-row">
        <span>
          Motion<small>0–100 · shot estimates</small>
        </span>
        {hasMotion ? (
          <svg
            viewBox="0 0 600 45"
            preserveAspectRatio="none"
            aria-label="Local motion estimates"
            role="img"
          >
            {data.shots.map((s) =>
              s.motionProfile && s.motionProfile.confidence > 0 ? (
                <path
                  key={s.id}
                  d={`M${x(s.startSeconds)},${42 - 0.38 * s.motionProfile.totalKineticEnergy}H${x(s.endSeconds)}`}
                  stroke="#8da99e"
                  strokeWidth="2"
                  fill="none"
                />
              ) : null,
            )}
            <line
              x1={x(anchor)}
              x2={x(anchor)}
              y1="0"
              y2="45"
              stroke="#cfb778"
            />
            {time >= start && time <= end && (
              <line x1={x(time)} x2={x(time)} y1="0" y2="45" stroke="#eee" />
            )}
          </svg>
        ) : (
          <small className="sr-curve-missing">
            Motion not analyzed for this passage.
          </small>
        )}
      </div>
      <input
        type="range"
        aria-label="Seek within review context"
        min={start}
        max={end}
        step={1 / project.frameRate}
        value={Math.max(start, Math.min(end, time))}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
    </section>
  );
}
