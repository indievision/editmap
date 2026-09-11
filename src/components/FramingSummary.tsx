import { useMemo } from "react";
import type { Shot } from "../models/project";
import { framingSummary } from "../analysis/framing";
import { sizeColors } from "../analysis/colors";

export default function FramingSummary({ shots }: { shots: Shot[] }) {
  const summary = useMemo(() => framingSummary(shots), [shots]);
  if (!shots.length)
    return (
      <p className="rhythm-empty muted">Import an EDL to explore framing.</p>
    );
  const percent = (seconds: number) =>
    summary.total ? (100 * seconds) / summary.total : 0;
  return (
    <section className="framing-summary">
      <div className="rhythm-summary">
        <span>
          Recognized framing <b>{percent(summary.known).toFixed(1)}%</b> of shot
          time
        </span>
        <span>
          Confirmed <b>{percent(summary.confirmed).toFixed(1)}%</b>
        </span>
        <span>
          Uncertain <b>{percent(summary.uncertain).toFixed(1)}%</b>
        </span>
      </div>
      <p className="rhythm-explanation">
        Current tags only. Screen-time percentages include unknown, exempt and
        legacy tags; timeline gaps are excluded.
      </p>
      <div className="framing-distribution">
        {summary.bins
          .filter(
            (bin) =>
              bin.count || !["Unknown", "Not applicable"].includes(bin.size),
          )
          .map((bin) => (
            <div className="framing-bin" key={bin.size}>
              <span>{bin.size}</span>
              <div className="framing-meter">
                <i
                  style={{
                    width: `${percent(bin.seconds)}%`,
                    background: sizeColors[bin.size],
                  }}
                />
              </div>
              <span>{bin.count} shots</span>
              <span>{bin.seconds.toFixed(1)}s</span>
              <strong>{percent(bin.seconds).toFixed(1)}%</strong>
            </div>
          ))}
      </div>
    </section>
  );
}
