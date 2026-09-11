import { memo, useMemo, useState } from "react";
import type { Project } from "../models/project";
import { cutTimes, pacingAt, pacingCurve, sensoryShockAt, sensoryShockCurve, computeCutShockData } from "../analysis/pacing";
import { formatTimecode } from "../utils/timecode";
import { framingAt } from "../analysis/framing";

const LocalPacing = memo(function LocalPacing({
  project,
  time,
  onSeek,
}: {
  project: Project;
  time: number;
  onSeek: (time: number) => void;
}) {
  const [window, setWindow] = useState(30),
    [hover, setHover] = useState<number>();
  const cuts = useMemo(() => cutTimes(project.shots), [project.shots]);
  const cutShockData = useMemo(
    () => computeCutShockData(project.shots),
    [project.shots],
  );
  const points = useMemo(
    () => pacingCurve(cuts, project.duration, window),
    [cuts, project.duration, window],
  );
  const shockPoints = useMemo(
    () => sensoryShockCurve(cutShockData, project.duration, window),
    [cutShockData, project.duration, window],
  );

  const max = Math.max(
    10,
    Math.ceil(Math.max(...points.map((p) => p.rate), 0) / 10) * 10,
  );
  const duration = project.duration || 1;

  const path = useMemo(
    () =>
      points
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${(p.time / duration) * 1000},${180 - (p.rate / max) * 180}`,
        )
        .join(" "),
    [points, duration, max],
  );

  const shockPath = useMemo(
    () =>
      shockPoints
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${(p.time / duration) * 1000},${180 - (p.shockScore / 100) * 180}`,
        )
        .join(" "),
    [shockPoints, duration],
  );

  const inspected = pacingAt(cuts, project.duration, window, hover ?? time);
  const inspectedShock = sensoryShockAt(cutShockData, project.duration, window, hover ?? time);
  const framing = framingAt(
    project.shots,
    project.duration,
    window,
    hover ?? time,
  );

  const closePath = useMemo(() => {
    let connected = false;
    return points
      .map((point) => {
        const value = framingAt(
          project.shots,
          project.duration,
          window,
          point.time,
        ).closeShare;
        if (value === null) {
          connected = false;
          return "";
        }
        const command = connected ? "L" : "M";
        connected = true;
        return `${command}${(point.time / duration) * 1000},${180 - value * 180}`;
      })
      .join(" ");
  }, [points, project.shots, project.duration, window, duration]);

  const tc = (t: number) =>
    formatTimecode(t, project.frameRate, project.dropFrame);

  return (
    <section className="pacing panel">
      <div className="section-head">
        <span className="eyebrow">03 / LOCAL PACING & SENSORY SHOCK</span>
        <label>
          Moving window{" "}
          <select
            aria-label="Pacing window"
            value={window}
            onChange={(e) => setWindow(Number(e.target.value))}
          >
            {[10, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} seconds
              </option>
            ))}
          </select>
        </label>
      </div>
      {!project.shots.length ? (
        <p className="rhythm-empty muted">
          Import an EDL to see how the cutting rate and sensory shock change through the film.
        </p>
      ) : (
        <>
          <div className="rhythm-summary">
            <span>
              At {tc(hover ?? time)} <b>{inspected.rate.toFixed(1)} cuts/min</b>
            </span>
            <span className="muted">
              Sensory Shock: <b style={{ color: "#c084fc" }}>{inspectedShock.shockScore} / 100</b> (Avg ΔV: {inspectedShock.avgDeltaV.toFixed(2)})
            </span>
            <span>
              CU / ECU{" "}
              <b>
                {framing.closeShare === null
                  ? "—"
                  : `${(framing.closeShare * 100).toFixed(1)}%`}
              </b>{" "}
              of framing time
            </span>
            <span className="muted">
              Framing coverage{" "}
              {framing.total
                ? ((100 * framing.known) / framing.total).toFixed(1)
                : "0.0"}
              %
            </span>
          </div>
          <div className="rhythm-explanation">
            Hard-cut boundaries in a centered window. Blue = cuts/min (left axis). Gold = CU/ECU share (right axis). Purple = Sensory Shock Index (0-100 visual contrast & cut frequency disruption).
          </div>
          <div className="pacing-chart">
            <div className="pacing-axis">
              {[0, 0.5, 1].map((f) => (
                <span key={f} style={{ bottom: `${f * 100}%` }}>
                  {max * f}
                </span>
              ))}
            </div>
            <div
              className="pacing-surface"
              role="slider"
              tabIndex={0}
              aria-label="Local pacing seek"
              aria-valuemin={0}
              aria-valuemax={project.duration}
              aria-valuenow={Math.min(time, project.duration)}
              aria-valuetext={tc(time)}
              onKeyDown={(e) => {
                let target = time;
                if (e.key === "ArrowRight") target += 1;
                else if (e.key === "ArrowLeft") target -= 1;
                else if (e.key === "Home") target = 0;
                else if (e.key === "End") target = duration;
                else return;
                e.preventDefault();
                onSeek(Math.max(0, Math.min(duration, target)));
              }}
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setHover(
                  Math.max(
                    0,
                    Math.min(
                      duration,
                      ((e.clientX - r.left) / r.width) * duration,
                    ),
                  ),
                );
              }}
              onMouseLeave={() => setHover(undefined)}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onSeek(
                  Math.max(
                    0,
                    Math.min(
                      duration,
                      ((e.clientX - r.left) / r.width) * duration,
                    ),
                  ),
                );
              }}
            >
              <svg
                viewBox="0 0 1000 180"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {[0, 90, 180].map((y) => (
                  <line
                    key={y}
                    x1="0"
                    x2="1000"
                    y1={y}
                    y2={y}
                    stroke="#ffffff16"
                  />
                ))}
                <path d={`${path} L1000,180 L0,180 Z`} fill="#83a9b518" />
                {/* Pacing rate curve */}
                <path
                  d={path}
                  fill="none"
                  stroke="#91b7c4"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                {/* CU/ECU share curve */}
                <path
                  d={closePath}
                  fill="none"
                  stroke="#dfc578"
                  strokeWidth="2"
                  strokeDasharray="5 3"
                  vectorEffect="non-scaling-stroke"
                />
                {/* Sensory Shock curve */}
                <path
                  d={shockPath}
                  fill="none"
                  stroke="#c084fc"
                  strokeWidth="2"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <div
                className="pacing-marker"
                style={{ left: `${Math.min(time / duration, 1) * 100}%` }}
              />
              {hover !== undefined && (
                <div
                  className="pacing-hover"
                  style={{ left: `${(hover / duration) * 100}%` }}
                />
              )}
              <div className="pacing-times">
                {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                  <span key={f}>{tc(f * duration)}</span>
                ))}
              </div>
            </div>
            <div
              className="pacing-axis framing-percent-axis"
              aria-label="Close framing percentage axis"
            >
              {[0, 0.5, 1].map((f) => (
                <span key={f} style={{ bottom: `${f * 100}%` }}>
                  {f * 100}%
                </span>
              ))}
            </div>
          </div>
          <div className="rhythm-bottom">
            <span className="muted">CUTS / MINUTE · SENSORY SHOCK (0-100) · FILM TIME →</span>
            <span className="rhythm-detail">
              {inspected.count} cuts /{" "}
              {Math.max(0, inspected.end - inspected.start).toFixed(1)}s window
              · Click to seek · Arrow keys ±1s
            </span>
          </div>
        </>
      )}
    </section>
  );
});

export default LocalPacing;
