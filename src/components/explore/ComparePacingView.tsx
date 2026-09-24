import React, { useMemo, useState } from "react";
import type { SequenceMarker } from "../../models/project";
import type { PassageShotSegment } from "../../analysis/passageComparison";
import {
  computeMeanSegmentDuration,
  computePacingHistogram,
  PACING_HISTOGRAM_BINS,
} from "../../analysis/compareViews";

interface ComparePacingViewProps {
  passageA?: SequenceMarker;
  passageB?: SequenceMarker;
  segmentsA: PassageShotSegment[];
  segmentsB: PassageShotSegment[];
  aslA: number | null;
  aslB: number | null;
  onSeek: (side: "A" | "B", target: { passageId: string; localTime: number; sourceTime: number }) => void;
}

export default function ComparePacingView({
  passageA,
  passageB,
  segmentsA,
  segmentsB,
  aslA,
  aslB,
  onSeek,
}: ComparePacingViewProps) {
  // 1. Histogram calculations memoized on segments
  const histogramA = useMemo(() => computePacingHistogram(segmentsA), [segmentsA]);
  const histogramB = useMemo(() => computePacingHistogram(segmentsB), [segmentsB]);

  // Determine max histogram percentage for shared Y axis
  const maxHistPct = useMemo(() => {
    let max = 40;
    for (const b of histogramA.bins) if (b.percentage > max) max = b.percentage;
    for (const b of histogramB.bins) if (b.percentage > max) max = b.percentage;
    return Math.min(100, Math.ceil(max / 20) * 20); // Round up to nearest 20%
  }, [histogramA, histogramB]);

  // 2. Shot lengths in editing order calculations
  const meanDurA = useMemo(() => computeMeanSegmentDuration(segmentsA), [segmentsA]);
  const meanDurB = useMemo(() => computeMeanSegmentDuration(segmentsB), [segmentsB]);

  // Shared seconds scale for editing order charts
  const maxSecs = useMemo(() => {
    let max = 10;
    for (const s of segmentsA) if (s.visibleDuration > max) max = s.visibleDuration;
    for (const s of segmentsB) if (s.visibleDuration > max) max = s.visibleDuration;
    return Math.max(10, Math.ceil(max / 5) * 5); // Round up to nearest 5s
  }, [segmentsA, segmentsB]);

  const [activeTooltip, setActiveTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

  const formatClock = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  };

  return (
    <div className="compare-pacing-view" data-testid="compare-pacing-view">
      {/* 1. SHOT-DURATION DISTRIBUTION (HISTOGRAM) */}
      <div className="compare-view-block">
        <div className="compare-block-header-row">
          <div className="compare-block-title-group">
            <h5 className="compare-block-title">Shot-duration distribution</h5>
            <span className="compare-block-subtitle">
              Percentage of passage shot segments in standard duration bins
            </span>
          </div>

          <div className="compare-chart-legend">
            <span className="legend-item">
              <span className="legend-swatch swatch-a" />
              <span>{passageA?.name ?? "Passage A"}</span>
            </span>
            <span className="legend-item">
              <span className="legend-swatch swatch-b" />
              <span>{passageB?.name ?? "Passage B"}</span>
            </span>
          </div>
        </div>

        {/* HISTOGRAM SVG CHART */}
        <div className="compare-histogram-container">
          <div className="compare-histogram-y-axis">
            <span className="y-axis-label">% of shots</span>
            <div className="y-axis-ticks">
              <span>{maxHistPct}%</span>
              <span>{Math.round(maxHistPct / 2)}%</span>
              <span>0%</span>
            </div>
          </div>

          <div className="compare-histogram-bars-wrapper">
            {PACING_HISTOGRAM_BINS.map((bin, idx) => {
              const resA = histogramA.bins[idx];
              const resB = histogramB.bins[idx];

              const heightPctA = maxHistPct > 0 ? (resA.percentage / maxHistPct) * 100 : 0;
              const heightPctB = maxHistPct > 0 ? (resB.percentage / maxHistPct) * 100 : 0;

              return (
                <div key={bin.label} className="compare-hist-bin-group">
                  <div className="compare-hist-pair">
                    {/* Bar A */}
                    <div
                      className="compare-hist-bar bar-a"
                      style={{ height: `${heightPctA}%` }}
                      title={`${passageA?.name ?? "Passage A"}: ${resA.count} of ${
                        histogramA.totalSegments
                      } shots (${resA.percentage.toFixed(1)}%) in range ${bin.rangeLabel}`}
                    >
                      {resA.count > 0 && (
                        <span className="hist-bar-count mono">{resA.count}</span>
                      )}
                    </div>

                    {/* Bar B */}
                    <div
                      className="compare-hist-bar bar-b"
                      style={{ height: `${heightPctB}%` }}
                      title={`${passageB?.name ?? "Passage B"}: ${resB.count} of ${
                        histogramB.totalSegments
                      } shots (${resB.percentage.toFixed(1)}%) in range ${bin.rangeLabel}`}
                    >
                      {resB.count > 0 && (
                        <span className="hist-bar-count mono">{resB.count}</span>
                      )}
                    </div>
                  </div>

                  <span className="compare-hist-bin-label mono">{bin.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2. SHOT LENGTHS IN EDITING ORDER */}
      <div className="compare-view-block">
        <div className="compare-block-header-row">
          <div className="compare-block-title-group">
            <h5 className="compare-block-title">Shot lengths in editing order</h5>
            <span className="compare-block-subtitle">
              Equal-width bars on a shared seconds scale · Click any bar to seek matching player
            </span>
          </div>
        </div>

        {/* SIDE A EDITING ORDER ROW */}
        <div className="compare-order-chart-row">
          <div className="compare-order-side-badge">
            <span className="order-badge badge-a">A</span>
            <span className="order-side-title">{passageA?.name ?? "Passage A"}</span>
          </div>

          <div className="compare-order-bars-container">
            <div className="compare-order-y-axis">
              <span className="order-y-label">Seconds</span>
              <div className="order-y-ticks">
                <span>{maxSecs}s</span>
                <span>{Math.round(maxSecs / 2)}s</span>
                <span>0s</span>
              </div>
            </div>

            <div className="compare-order-track">
              {/* Reference Mean / ASL Line */}
              {meanDurA !== null && (
                <div
                  className="compare-order-ref-line"
                  style={{ bottom: `${(meanDurA / maxSecs) * 100}%` }}
                >
                  <span className="order-ref-tag mono">
                    Mean {meanDurA.toFixed(1)}s{aslA && Math.abs(aslA - meanDurA) > 0.05 ? ` (ASL ${aslA.toFixed(1)}s)` : ""}
                  </span>
                </div>
              )}

              {/* Bars */}
              <div className="compare-order-bars-flex">
                {segmentsA.map((seg, i) => {
                  const hPct = Math.min(100, (seg.visibleDuration / maxSecs) * 100);
                  const isClipped = seg.isClippedStart || seg.isClippedEnd;
                  const clipLabel = seg.isClippedStart && seg.isClippedEnd
                    ? "Clipped at In & Out"
                    : seg.isClippedStart
                    ? "Clipped at In boundary"
                    : seg.isClippedEnd
                    ? "Clipped at Out boundary"
                    : "";

                  const tooltipText = `Shot ${seg.shot.index ?? i + 1} · ${seg.visibleDuration.toFixed(1)}s${
                    clipLabel ? ` (${clipLabel})` : ""
                  }\nLocal: ${formatClock(seg.localStart)} – ${formatClock(seg.localEnd)}\nSource: ${formatClock(
                    seg.visibleStart,
                  )} – ${formatClock(seg.visibleEnd)}\nClick to seek A`;

                  return (
                    <button
                      key={`a-${seg.shot.id}-${i}`}
                      type="button"
                      className="compare-order-bar-btn"
                      onClick={() => {
                        if (!passageA) return;
                        onSeek("A", {
                          passageId: passageA.id,
                          localTime: seg.localStart,
                          sourceTime: seg.visibleStart,
                        });
                      }}
                      title={tooltipText}
                      aria-label={`Passage A, Shot ${seg.shot.index ?? i + 1}, duration ${seg.visibleDuration.toFixed(1)} seconds. Click to seek.`}
                    >
                      <div
                        className={`compare-order-bar-fill fill-a ${isClipped ? "clipped-bar" : ""}`}
                        style={{ height: `${hPct}%` }}
                      />
                      <span className="order-x-index mono">{seg.shot.index ?? i + 1}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* SIDE B EDITING ORDER ROW */}
        <div className="compare-order-chart-row">
          <div className="compare-order-side-badge">
            <span className="order-badge badge-b">B</span>
            <span className="order-side-title">{passageB?.name ?? "Passage B"}</span>
          </div>

          <div className="compare-order-bars-container">
            <div className="compare-order-y-axis">
              <span className="order-y-label">Seconds</span>
              <div className="order-y-ticks">
                <span>{maxSecs}s</span>
                <span>{Math.round(maxSecs / 2)}s</span>
                <span>0s</span>
              </div>
            </div>

            <div className="compare-order-track">
              {/* Reference Mean / ASL Line */}
              {meanDurB !== null && (
                <div
                  className="compare-order-ref-line"
                  style={{ bottom: `${(meanDurB / maxSecs) * 100}%` }}
                >
                  <span className="order-ref-tag mono">
                    Mean {meanDurB.toFixed(1)}s{aslB && Math.abs(aslB - meanDurB) > 0.05 ? ` (ASL ${aslB.toFixed(1)}s)` : ""}
                  </span>
                </div>
              )}

              {/* Bars */}
              <div className="compare-order-bars-flex">
                {segmentsB.map((seg, i) => {
                  const hPct = Math.min(100, (seg.visibleDuration / maxSecs) * 100);
                  const isClipped = seg.isClippedStart || seg.isClippedEnd;
                  const clipLabel = seg.isClippedStart && seg.isClippedEnd
                    ? "Clipped at In & Out"
                    : seg.isClippedStart
                    ? "Clipped at In boundary"
                    : seg.isClippedEnd
                    ? "Clipped at Out boundary"
                    : "";

                  const tooltipText = `Shot ${seg.shot.index ?? i + 1} · ${seg.visibleDuration.toFixed(1)}s${
                    clipLabel ? ` (${clipLabel})` : ""
                  }\nLocal: ${formatClock(seg.localStart)} – ${formatClock(seg.localEnd)}\nSource: ${formatClock(
                    seg.visibleStart,
                  )} – ${formatClock(seg.visibleEnd)}\nClick to seek B`;

                  return (
                    <button
                      key={`b-${seg.shot.id}-${i}`}
                      type="button"
                      className="compare-order-bar-btn"
                      onClick={() => {
                        if (!passageB) return;
                        onSeek("B", {
                          passageId: passageB.id,
                          localTime: seg.localStart,
                          sourceTime: seg.visibleStart,
                        });
                      }}
                      title={tooltipText}
                      aria-label={`Passage B, Shot ${seg.shot.index ?? i + 1}, duration ${seg.visibleDuration.toFixed(1)} seconds. Click to seek.`}
                    >
                      <div
                        className={`compare-order-bar-fill fill-b ${isClipped ? "clipped-bar" : ""}`}
                        style={{ height: `${hPct}%` }}
                      />
                      <span className="order-x-index mono">{seg.shot.index ?? i + 1}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="compare-order-x-caption">
          <span className="x-axis-title">Shot order</span>
          <span className="x-axis-note">Boundary shots use their duration inside the passage.</span>
        </div>
      </div>
    </div>
  );
}
