import { useState } from "react";
import type { Shot } from "../models/project";
import { sizeColors } from "../analysis/colors";

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
  const position = (seconds: number) =>
    100 *
    (scale === "compressed"
      ? Math.log1p(seconds) / Math.log1p(max)
      : seconds / max);
  const ticks =
    scale === "compressed"
      ? [
          0,
          ...[0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600].filter(
            (t) => t < max && position(max) - position(t) > 8,
          ),
          max,
        ].reduce<number[]>((visible, t) => {
          if (!visible.length || position(t) - position(visible[visible.length - 1]) > 8) visible.push(t);
          return visible;
        }, [])
      : [0, max / 4, max / 2, (max * 3) / 4, max];
  const detail = shots.find((s) => s.id === (hovered ?? selected));
  const label = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}s`;
  return (
    <section className="rhythm panel">
      <div className="section-head">
        <span className="eyebrow">02 / RHYTHM</span>
        <div className="tools">
          <label>
            Duration scale{" "}
            <select
              aria-label="Rhythm duration scale"
              value={scale}
              onChange={(e) => setScale(e.target.value as typeof scale)}
            >
              <option value="compressed">Compressed (log)</option>
              <option value="linear">Linear</option>
            </select>
          </label>
        </div>
      </div>
      {!shots.length ? (
        <p className="rhythm-empty muted">
          Import an EDL to see where the film cuts quickly and where it holds.
        </p>
      ) : (
        <>
          <div className="rhythm-summary">
            <span>
              Typical shot <b>{median.toFixed(2)}s</b> <small>median</small>
            </span>
            <span>
              Average <b>{average.toFixed(2)}s</b>
            </span>
            <span>
              Longest <b>{durations.at(-1)!.toFixed(2)}s</b>
            </span>
            <span className="muted">
              Higher = longer holds · Lower = quicker cuts
            </span>
          </div>
          <div className="rhythm-explanation">
            {scale === "compressed"
              ? "Logarithmic scale keeps short shots readable alongside long holds. No durations are clipped."
              : "Linear scale: bar height is proportional to shot duration."}{" "}
            Dashed line = typical shot.
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
                />
                <div className="rhythm-columns">
                  {shots.map((s) => (
                    <button
                      key={s.id}
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
                          s.shotSize === "Unknown"
                            ? "#8a9ba6"
                            : sizeColors[s.shotSize],
                      }}
                      className={selected === s.id ? "chosen" : ""}
                    />
                  ))}
                </div>
                <div className="rhythm-x-axis">
                  {shots.map((s, i) =>
                    shots.length <= 8 || i === 0 ||
                    i === shots.length - 1 ||
                    (shots.length > 8 &&
                      i % Math.ceil(shots.length / 6) === 0) ? (
                      <span
                        key={s.id}
                        style={{ left: `${((i + 0.5) / shots.length) * 100}%` }}
                      >
                        #{s.index}
                      </span>
                    ) : null,
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="rhythm-bottom">
            <span className="muted">
              SHOT ORDER → · Scroll horizontally for dense films
            </span>
            <span className="rhythm-detail" aria-live="polite">
              {detail
                ? `Shot ${String(detail.index).padStart(3, "0")} · ${detail.duration.toFixed(2)} sec · ${detail.shotSize} · ${detail.startTimecode} → ${detail.endTimecode}`
                : "Hover or focus a bar for details · Click to select and seek"}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
