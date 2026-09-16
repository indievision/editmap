import { useState } from "react";
import type { Shot } from "../models/project";
import { sizeColors } from "../analysis/colors";
import { formatTimecode } from "../utils/timecode";

export default function Rhythm({
  shots,
  selected,
  onSelect,
}: {
  shots: Shot[];
  selected?: string;
  onSelect: (s: Shot) => void;
}) {
  const [scale, setScale] = useState<"compressed" | "linear">("compressed");
  const [hovered, setHovered] = useState<string>();
  const durations = shots.map((s) => s.duration).sort((a, b) => a - b);
  const max = Math.max(1, durations.at(-1) ?? 1);
  const median = durations.length
    ? (durations[Math.floor((durations.length - 1) / 2)] +
        durations[Math.floor(durations.length / 2)]) /
      2
    : 0;
  const average =
    shots.reduce((sum, s) => sum + s.duration, 0) / Math.max(1, shots.length);

  const minLogVal = 0.1;
  const maxDecade = Math.max(100, Math.pow(10, Math.ceil(Math.log10(Math.max(max, 100)))));
  const logMin = Math.log10(minLogVal);
  const logMax = Math.log10(maxDecade);
  const logRange = logMax - logMin;

  const positionCompressed = (seconds: number) => {
    const clamped = Math.max(minLogVal, seconds);
    return Math.min(100, Math.max(0, ((Math.log10(clamped) - logMin) / logRange) * 100));
  };

  const positionLinear = (seconds: number) =>
    Math.min(100, Math.max(0, (seconds / max) * 100));

  const position = (seconds: number) =>
    scale === "compressed" ? positionCompressed(seconds) : positionLinear(seconds);

  const compressedTicks = (() => {
    const t: number[] = [];
    for (let exp = -1; exp <= logMax; exp++) {
      t.push(Number(Math.pow(10, exp).toFixed(1)));
    }
    return t;
  })();

  const linearTicks = [0, max * 0.25, max * 0.5, max * 0.75, max];
  const ticks = scale === "compressed" ? compressedTicks : linearTicks;

  const detail = shots.find((s) => s.id === (hovered ?? selected));
  const label = (n: number) =>
    scale === "compressed" ? `${n}` : `${n.toFixed(n < 10 && n > 0 ? 1 : 0)}s`;

  return (
    <section className="rhythm panel">
      {!shots.length ? (
        <p className="rhythm-empty muted">
          Import an EDL to see where the film cuts quickly and where it holds.
        </p>
      ) : (
        <>
          {/* Scale toggle (pill segmented control) */}
          <div className="rhythm-scale-toggle" role="group" aria-label="Duration scale">
            <button
              type="button"
              className={`rhythm-scale-btn ${scale === "compressed" ? "active" : ""}`}
              onClick={() => setScale("compressed")}
            >
              Compressed (log)
            </button>
            <button
              type="button"
              className={`rhythm-scale-btn ${scale === "linear" ? "active" : ""}`}
              onClick={() => setScale("linear")}
            >
              Linear
            </button>
            <select
              aria-label="Rhythm duration scale"
              value={scale}
              onChange={(e) => setScale(e.target.value as typeof scale)}
              className="sr-only"
              tabIndex={-1}
            >
              <option value="compressed">Compressed (log)</option>
              <option value="linear">Linear</option>
            </select>
          </div>

          {/* 3-Column Summary Metrics */}
          <div className="rhythm-summary rhythm-metrics-card">
            <div className="rhythm-metric-col">
              <span className="metric-label">Typical shot</span>
              <b className="metric-value">{median.toFixed(1)} sec</b>
              <span className="sr-only">Typical shot {median.toFixed(2)}s median</span>
            </div>
            <div className="rhythm-metric-col">
              <span className="metric-label">Average</span>
              <b className="metric-value">{average.toFixed(1)} sec</b>
              <span className="sr-only">Average {average.toFixed(2)}s</span>
            </div>
            <div className="rhythm-metric-col">
              <span className="metric-label">Longest</span>
              <b className="metric-value">{(durations.at(-1) ?? 0).toFixed(1)} sec</b>
              <span className="sr-only">Longest {(durations.at(-1) ?? 0).toFixed(2)}s</span>
            </div>
          </div>

          {/* Chart Section */}
          <div className="rhythm-chart-section">
            <div className="rhythm-chart-header">
              <span className="rhythm-chart-eyebrow">SHOT DURATION (SECONDS)</span>
            </div>

            <div className="rhythm-plot-layout">
              <div
                className="rhythm-y-axis"
                aria-label="Shot duration in seconds"
              >
                {ticks.map((t) => (
                  <span key={t} style={{ bottom: `${position(t)}%` }}>
                    {label(t)}
                  </span>
                ))}
              </div>

              <div className="rhythm-scroll">
                <div
                  className="rhythm-plot"
                  style={{ minWidth: Math.max(0, shots.length * 6) }}
                >
                  {ticks.map((t) => (
                    <div
                      key={t}
                      className="rhythm-grid"
                      style={{ bottom: `${position(t)}%` }}
                    />
                  ))}
                  <div
                    className="rhythm-median"
                    style={{ bottom: `${position(median)}%` }}
                  >
                    <span className="rhythm-median-tag">
                      Median {median.toFixed(1)}s
                    </span>
                  </div>
                  <div className="rhythm-columns">
                    {shots.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        aria-label={`Rhythm shot ${s.index}`}
                        aria-pressed={selected === s.id}
                        title={`Shot ${s.index} · ${s.duration.toFixed(2)}s · ${s.shotSize}`}
                        onMouseEnter={() => setHovered(s.id)}
                        onMouseLeave={() => setHovered(undefined)}
                        onFocus={() => setHovered(s.id)}
                        onBlur={() => setHovered(undefined)}
                        onClick={() => onSelect(s)}
                        style={{
                          height: `${position(s.duration)}%`,
                          background:
                            selected === s.id
                              ? "#fbbf24"
                              : s.shotSize === "Unknown"
                                ? "#525f6e"
                                : sizeColors[s.shotSize] || "#525f6e",
                        }}
                        className={`rhythm-bar ${selected === s.id ? "chosen" : ""}`}
                      />
                    ))}
                  </div>
                  <div className="rhythm-x-axis">
                    {shots.map((s, i) =>
                      shots.length <= 12 ||
                      i === 0 ||
                      i === shots.length - 1 ||
                      (s.index % 10 === 0 && i < shots.length - 3) ? (
                        <span
                          key={s.id}
                          style={{ left: `${((i + 0.5) / shots.length) * 100}%` }}
                        >
                          {s.index}
                        </span>
                      ) : null,
                    )}
                  </div>
                </div>
                <div className="rhythm-x-axis-title">SHOT ORDER</div>
              </div>
            </div>

            <div className="rhythm-action-hint">Click a bar to select and seek</div>
          </div>

          {/* Selected Shot Strip / Card */}
          <div className="rhythm-selected-shot-card" aria-live="polite">
            <span className={`selected-shot-bar ${detail ? "" : "empty"}`} />
            <span className="rhythm-detail">
              {detail ? (
                <>
                  {`Shot ${String(detail.index).padStart(3, "0")} · ${detail.duration.toFixed(1)} sec · ${detail.shotSize} · ${detail.startTimecode || formatTimecode(detail.startSeconds, 24)} → ${detail.endTimecode || formatTimecode(detail.endSeconds, 24)}`}
                  <span className="sr-only">
                    {`Shot ${String(detail.index).padStart(3, "0")} · ${detail.duration.toFixed(2)} sec · ${detail.shotSize} · ${detail.startTimecode} → ${detail.endTimecode}`}
                  </span>
                </>
              ) : (
                "Select a shot to inspect duration and timecode"
              )}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

