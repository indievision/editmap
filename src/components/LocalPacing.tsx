import { memo, useMemo, useState } from "react";
import type { Project } from "../models/project";
import {
  cutTimes,
  pacingAt,
  pacingCurve,
  sensoryShockAt,
  sensoryShockCurve,
  computeCutShockData,
} from "../analysis/pacing";
import { formatTimecode } from "../utils/timecode";
import { framingAt, framingRank } from "../analysis/framing";
import PacingChart from "./charts/PacingChart";

const LocalPacing = memo(function LocalPacing({
  project,
  time,
  onSeek,
  onOpenCompare,
}: {
  project: Project;
  time: number;
  onSeek: (time: number) => void;
  onOpenCompare?: (measure: "cutRate") => void;
}) {
  const [window, setWindow] = useState(30);

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

  const duration = project.duration || 1;
  const inspected = pacingAt(cuts, project.duration, window, time);
  const inspectedShock = sensoryShockAt(
    cutShockData,
    project.duration,
    window,
    time,
  );
  const framing = framingAt(
    project.shots,
    project.duration,
    window,
    time,
  );

  const hasFramingCoverage = useMemo(
    () => project.shots.some((s) => framingRank(s) !== null),
    [project.shots],
  );

  const closePoints = useMemo(() => {
    return points.map((point) => {
      const share = hasFramingCoverage
        ? framingAt(project.shots, project.duration, window, point.time).closeShare
        : null;
      return {
        time: point.time,
        value: share === null ? null : share * 100,
      };
    });
  }, [points, project.shots, project.duration, window, hasFramingCoverage]);

  const tc = (t: number) =>
    formatTimecode(t, project.frameRate, project.dropFrame);

  return (
    <section className="pacing pacing-glance panel">
      <div className="pacing-glance-head">
        <div className="pacing-glance-title-group">
          <h3 className="pacing-glance-title">PACING AT A GLANCE</h3>
          <p className="pacing-glance-subtitle">Three measures, one moment in the film.</p>
        </div>
        <div className="pacing-glance-controls">
          <div
            className="pacing-window-selector"
            role="radiogroup"
            aria-label="Moving window duration"
          >
            {[10, 30, 60].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={window === n}
                className={`pacing-window-btn ${window === n ? "active" : ""}`}
                onClick={() => setWindow(n)}
              >
                {n}s
              </button>
            ))}
          </div>
          {onOpenCompare && (
            <button
              type="button"
              className="panel-compare-launch-btn"
              onClick={() => onOpenCompare("cutRate")}
              title="Open analytical curve comparison with Cut rate"
              aria-label="Compare Cut rate with other measures"
            >
              Compare ↗
            </button>
          )}
        </div>
        <select
          aria-label="Pacing window"
          className="sr-only"
          value={window}
          onChange={(e) => setWindow(Number(e.target.value))}
        >
          {[10, 30, 60].map((n) => (
            <option key={n} value={n}>
              {n} seconds
            </option>
          ))}
        </select>
      </div>

      {!project.shots.length ? (
        <p className="rhythm-empty muted">
          Import an EDL to see how the cutting rate, close framing, and visual change interact through the film.
        </p>
      ) : (
        <>
          <div className="rhythm-summary sr-only" aria-live="polite">
            <span>
              At {tc(time)} <b>{inspected.rate.toFixed(1)} cuts/min</b>
            </span>
            <span>
              Close framing{" "}
              <b>
                {framing.closeShare === null
                  ? "—"
                  : `${(framing.closeShare * 100).toFixed(1)}%`}
              </b>{" "}
              of framing time
            </span>
          </div>
          <div className="pacing-current-window-strip">
            <span className="pacing-strip-label">Current window</span>
            <span className="pacing-strip-bullet">·</span>
            <span className="pacing-strip-range">
              {tc(inspected.start)} – {tc(inspected.end)}
            </span>
            <span className="pacing-strip-bullet">·</span>
            <span className="pacing-strip-cuts">
              <b>{inspected.count}</b> {inspected.count === 1 ? "cut" : "cuts"}
            </span>
          </div>

          <PacingChart
            pacing={points.map((point) => ({ time: point.time, value: point.rate }))}
            close={closePoints}
            visualDelta={shockPoints.map((point) => ({
              time: point.time,
              avgDeltaV: point.avgDeltaV,
              shockScore: point.shockScore,
            }))}
            hasFramingData={hasFramingCoverage}
            currentTime={time}
            duration={duration}
            windowStart={inspected.start}
            windowEnd={inspected.end}
            currentValues={{
              cutRate: inspected.rate,
              closeShare: hasFramingCoverage ? framing.closeShare : null,
              avgDeltaV: inspectedShock.avgDeltaV,
            }}
            frameRate={project.frameRate}
            dropFrame={project.dropFrame}
            onSeek={onSeek}
          />

          <div className="pacing-glance-footer">
            <span className="pacing-footer-left">
              Hard-cut boundaries in a centered window · Click to seek.
            </span>
            <span className="pacing-footer-right">
              Cut rate measures edit frequency, not dramatic intensity.
            </span>
          </div>
        </>
      )}
    </section>
  );
});

export default LocalPacing;
