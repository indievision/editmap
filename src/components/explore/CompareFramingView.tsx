import React, { useMemo, useState } from "react";
import type { SequenceMarker } from "../../models/project";
import type { PassageShotSegment } from "../../analysis/passageComparison";
import {
  computeFramingBreakdown,
  getTemporalFramingBlocks,
  type FramingBreakdownCategory,
} from "../../analysis/compareViews";
import { framingSizes } from "../../analysis/framing";
import { sizeColors } from "../../analysis/colors";

interface CompareFramingViewProps {
  passageA?: SequenceMarker;
  passageB?: SequenceMarker;
  segmentsA: PassageShotSegment[];
  segmentsB: PassageShotSegment[];
  onSeek: (side: "A" | "B", target: { passageId: string; localTime: number; sourceTime: number }) => void;
}

export default function CompareFramingView({
  passageA,
  passageB,
  segmentsA,
  segmentsB,
  onSeek,
}: CompareFramingViewProps) {
  const [breakdownMode, setBreakdownMode] = useState<"time" | "shots">("time");

  // Compute breakdowns
  const breakdownA = useMemo(() => {
    if (!passageA) return null;
    return computeFramingBreakdown(passageA, segmentsA, breakdownMode);
  }, [passageA, segmentsA, breakdownMode]);

  const breakdownB = useMemo(() => {
    if (!passageB) return null;
    return computeFramingBreakdown(passageB, segmentsB, breakdownMode);
  }, [passageB, segmentsB, breakdownMode]);

  // Compute temporal blocks
  const temporalBlocksA = useMemo(() => getTemporalFramingBlocks(segmentsA), [segmentsA]);
  const temporalBlocksB = useMemo(() => getTemporalFramingBlocks(segmentsB), [segmentsB]);

  const durA = Math.max(0.001, (passageA?.endSeconds ?? 0) - (passageA?.startSeconds ?? 0));
  const durB = Math.max(0.001, (passageB?.endSeconds ?? 0) - (passageB?.startSeconds ?? 0));

  const formatClock = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  };

  // Full legend categories
  const legendCategories: FramingBreakdownCategory[] = [
    ...framingSizes,
    "Not applicable",
    "Unknown",
  ];

  return (
    <div className="compare-framing-view" data-testid="compare-framing-view">
      {/* 1. FRAMING BREAKDOWN (100% STACKED BARS) */}
      <div className="compare-view-block">
        <div className="compare-block-header-row">
          <div className="compare-block-title-group">
            <h5 className="compare-block-title">Framing breakdown</h5>
            <span className="compare-block-subtitle">
              Relative proportions across all eight scale categories, text and unknown
            </span>
          </div>

          {/* TIME / SHOTS SWITCH */}
          <div className="compare-mode-toggle" role="group" aria-label="Breakdown metric selection">
            <button
              type="button"
              className={`compare-toggle-btn ${breakdownMode === "time" ? "active" : ""}`}
              onClick={() => setBreakdownMode("time")}
              aria-pressed={breakdownMode === "time"}
            >
              Time
            </button>
            <button
              type="button"
              className={`compare-toggle-btn ${breakdownMode === "shots" ? "active" : ""}`}
              onClick={() => setBreakdownMode("shots")}
              aria-pressed={breakdownMode === "shots"}
            >
              Shots
            </button>
          </div>
        </div>

        {/* 100% STACKED BARS */}
        <div className="compare-stacked-bars-section">
          {/* Passage A stacked row */}
          <div className="compare-stacked-row">
            <div className="compare-stacked-side-badge">
              <span className="order-badge badge-a">A</span>
              <span className="order-side-title">{passageA?.name ?? "Passage A"}</span>
            </div>

            <div className="compare-stacked-bar-track">
              {breakdownA?.items.map((item) => {
                if (item.percentage <= 0) return null;
                const showLabel = item.percentage >= 5;
                const tooltip = `${item.category}: ${item.percentage.toFixed(1)}% (${
                  breakdownMode === "time" ? `${item.seconds.toFixed(1)}s` : `${item.count} shots`
                })`;

                return (
                  <div
                    key={`a-${item.category}`}
                    className={`compare-stacked-slice ${item.category === "Unknown" ? "slice-unknown" : ""}`}
                    style={{
                      width: `${item.percentage}%`,
                      backgroundColor: item.color,
                    }}
                    title={tooltip}
                  >
                    {showLabel && (
                      <span className="stacked-slice-label mono">
                        {Math.round(item.percentage)}%
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Uncovered passage gap in Time mode */}
              {breakdownMode === "time" && breakdownA && breakdownA.gapSeconds > 0.05 && (
                <div
                  className="compare-stacked-slice slice-gap"
                  style={{
                    width: `${(breakdownA.gapSeconds / breakdownA.totalDuration) * 100}%`,
                  }}
                  title={`Uncovered passage gap: ${breakdownA.gapSeconds.toFixed(1)}s (${(
                    (breakdownA.gapSeconds / breakdownA.totalDuration) *
                    100
                  ).toFixed(1)}%)`}
                >
                  <span className="stacked-slice-label mono">Gap</span>
                </div>
              )}
            </div>
          </div>

          {/* Passage B stacked row */}
          <div className="compare-stacked-row">
            <div className="compare-stacked-side-badge">
              <span className="order-badge badge-b">B</span>
              <span className="order-side-title">{passageB?.name ?? "Passage B"}</span>
            </div>

            <div className="compare-stacked-bar-track">
              {breakdownB?.items.map((item) => {
                if (item.percentage <= 0) return null;
                const showLabel = item.percentage >= 5;
                const tooltip = `${item.category}: ${item.percentage.toFixed(1)}% (${
                  breakdownMode === "time" ? `${item.seconds.toFixed(1)}s` : `${item.count} shots`
                })`;

                return (
                  <div
                    key={`b-${item.category}`}
                    className={`compare-stacked-slice ${item.category === "Unknown" ? "slice-unknown" : ""}`}
                    style={{
                      width: `${item.percentage}%`,
                      backgroundColor: item.color,
                    }}
                    title={tooltip}
                  >
                    {showLabel && (
                      <span className="stacked-slice-label mono">
                        {Math.round(item.percentage)}%
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Uncovered passage gap in Time mode */}
              {breakdownMode === "time" && breakdownB && breakdownB.gapSeconds > 0.05 && (
                <div
                  className="compare-stacked-slice slice-gap"
                  style={{
                    width: `${(breakdownB.gapSeconds / breakdownB.totalDuration) * 100}%`,
                  }}
                  title={`Uncovered passage gap: ${breakdownB.gapSeconds.toFixed(1)}s (${(
                    (breakdownB.gapSeconds / breakdownB.totalDuration) *
                    100
                  ).toFixed(1)}%)`}
                >
                  <span className="stacked-slice-label mono">Gap</span>
                </div>
              )}
            </div>
          </div>

          {/* Ruler % scale */}
          <div className="compare-stacked-scale">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </div>

          {/* Denominator explanation label */}
          <div className="compare-breakdown-caption">
            <span>
              Breakdown uses all passage {breakdownMode === "time" ? "duration" : "shots"} (including unknown & not applicable).
            </span>{" "}
            <span className="coverage-sublabel">
              Known-data coverage: A: {breakdownA?.knownPercent.toFixed(0)}% (
              {breakdownMode === "time"
                ? `${breakdownA?.knownSeconds.toFixed(1)}s / ${breakdownA?.totalDuration.toFixed(1)}s`
                : `${breakdownA?.knownCount} / ${breakdownA?.totalCount} shots`}
              ) · B: {breakdownB?.knownPercent.toFixed(0)}% (
              {breakdownMode === "time"
                ? `${breakdownB?.knownSeconds.toFixed(1)}s / ${breakdownB?.totalDuration.toFixed(1)}s`
                : `${breakdownB?.knownCount} / ${breakdownB?.totalCount} shots`}
              ). Headline close/wide shares use known framing time.
            </span>
          </div>
        </div>

        {/* LEGEND */}
        <div className="compare-framing-legend">
          {legendCategories.map((cat) => (
            <span key={cat} className="legend-item">
              <span
                className={`legend-swatch ${cat === "Unknown" ? "swatch-unknown" : ""}`}
                style={{ backgroundColor: sizeColors[cat] ?? "#626970" }}
              />
              <span className="legend-text">{cat}</span>
            </span>
          ))}
          <span className="legend-item">
            <span className="legend-swatch swatch-gap" />
            <span className="legend-text">Coverage gap</span>
          </span>
        </div>
      </div>

      {/* 2. FRAMING THROUGH THE PASSAGE (TEMPORAL STRIPS) */}
      <div className="compare-view-block">
        <div className="compare-block-header-row">
          <div className="compare-block-title-group">
            <h5 className="compare-block-title">Framing through the passage</h5>
            <span className="compare-block-subtitle">
              Temporal distribution along passage timeline · Width proportional to shot duration · Click to seek
            </span>
          </div>
        </div>

        {/* STRIP A */}
        <div className="compare-temporal-strip-row">
          <div className="compare-temporal-side-badge">
            <span className="order-badge badge-a">A</span>
            <span className="order-side-title">{passageA?.name ?? "Passage A"}</span>
          </div>

          <div className="compare-temporal-strip-track">
            {temporalBlocksA.map((block, i) => {
              const widthPct = (block.visibleDuration / durA) * 100;
              const tooltip = `Shot ${block.shotIndex}: ${block.category}${
                block.isUncertain ? " (Uncertain / Review)" : ""
              }\nDuration: ${block.visibleDuration.toFixed(1)}s\nLocal: ${formatClock(
                block.localStart,
              )} – ${formatClock(block.localEnd)}\nSource: ${formatClock(
                block.visibleStart,
              )} – ${formatClock(block.visibleEnd)}\nClick to seek A`;

              return (
                <button
                  key={`temp-a-${block.shotId}-${i}`}
                  type="button"
                  className={`compare-temporal-block-btn ${
                    block.isUncertain ? "block-uncertain" : ""
                  } ${block.category === "Unknown" ? "block-unknown" : ""}`}
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: block.color,
                  }}
                  onClick={() => {
                    if (!passageA) return;
                    onSeek("A", {
                      passageId: passageA.id,
                      localTime: block.localStart,
                      sourceTime: block.visibleStart,
                    });
                  }}
                  title={tooltip}
                  aria-label={`Passage A, Shot ${block.shotIndex}, ${block.category}, duration ${block.visibleDuration.toFixed(1)} seconds. Click to seek.`}
                >
                  {widthPct >= 6 && (
                    <span className="temporal-block-tag mono">{block.shotIndex}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* STRIP B */}
        <div className="compare-temporal-strip-row">
          <div className="compare-temporal-side-badge">
            <span className="order-badge badge-b">B</span>
            <span className="order-side-title">{passageB?.name ?? "Passage B"}</span>
          </div>

          <div className="compare-temporal-strip-track">
            {temporalBlocksB.map((block, i) => {
              const widthPct = (block.visibleDuration / durB) * 100;
              const tooltip = `Shot ${block.shotIndex}: ${block.category}${
                block.isUncertain ? " (Uncertain / Review)" : ""
              }\nDuration: ${block.visibleDuration.toFixed(1)}s\nLocal: ${formatClock(
                block.localStart,
              )} – ${formatClock(block.localEnd)}\nSource: ${formatClock(
                block.visibleStart,
              )} – ${formatClock(block.visibleEnd)}\nClick to seek B`;

              return (
                <button
                  key={`temp-b-${block.shotId}-${i}`}
                  type="button"
                  className={`compare-temporal-block-btn ${
                    block.isUncertain ? "block-uncertain" : ""
                  } ${block.category === "Unknown" ? "block-unknown" : ""}`}
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: block.color,
                  }}
                  onClick={() => {
                    if (!passageB) return;
                    onSeek("B", {
                      passageId: passageB.id,
                      localTime: block.localStart,
                      sourceTime: block.visibleStart,
                    });
                  }}
                  title={tooltip}
                  aria-label={`Passage B, Shot ${block.shotIndex}, ${block.category}, duration ${block.visibleDuration.toFixed(1)} seconds. Click to seek.`}
                >
                  {widthPct >= 6 && (
                    <span className="temporal-block-tag mono">{block.shotIndex}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="compare-temporal-scale">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
        <div className="compare-temporal-caption">
          Relative progress across each passage · Click any shot to inspect its framing
        </div>
      </div>
    </div>
  );
}
