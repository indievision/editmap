import React, { useMemo, useState } from "react";
import type { SequenceMarker, SpeechAnalysis } from "../../models/project";
import type { PassageShotSegment } from "../../analysis/passageComparison";
import {
  getLuminanceSteps,
  getMotionEnergySteps,
  getSpeechOverTimeSeries,
  getTemporalFramingBlocks,
  type NumericStepSegment,
} from "../../analysis/compareViews";

type OverTimeMeasure = "motion" | "luminance" | "speech" | "framing";
type TimeMappingMode = "actual" | "relative";

interface CompareOverTimeViewProps {
  passageA?: SequenceMarker;
  passageB?: SequenceMarker;
  segmentsA: PassageShotSegment[];
  segmentsB: PassageShotSegment[];
  speechAnalysis?: SpeechAnalysis;
  mediaSignature?: string;
  filmDuration?: number;
  playheadA: { localTime: number; sourceTime: number };
  playheadB: { localTime: number; sourceTime: number };
  playingSide: "A" | "B" | null;
  onSeek: (side: "A" | "B", target: { passageId: string; localTime: number; sourceTime: number }) => void;
}

export default function CompareOverTimeView({
  passageA,
  passageB,
  segmentsA,
  segmentsB,
  speechAnalysis,
  mediaSignature,
  filmDuration,
  playheadA,
  playheadB,
  playingSide,
  onSeek,
}: CompareOverTimeViewProps) {
  const [selectedMeasure, setSelectedMeasure] = useState<OverTimeMeasure>("motion");
  const [timeMode, setTimeMode] = useState<TimeMappingMode>("relative");

  const durA = Math.max(0.001, (passageA?.endSeconds ?? 0) - (passageA?.startSeconds ?? 0));
  const durB = Math.max(0.001, (passageB?.endSeconds ?? 0) - (passageB?.startSeconds ?? 0));
  const maxActualDuration = Math.max(durA, durB);

  // Derived step data memoized by analytical inputs, NOT by playback position
  const motionA = useMemo(() => getMotionEnergySteps(segmentsA), [segmentsA]);
  const motionB = useMemo(() => getMotionEnergySteps(segmentsB), [segmentsB]);

  const lumaA = useMemo(() => getLuminanceSteps(segmentsA), [segmentsA]);
  const lumaB = useMemo(() => getLuminanceSteps(segmentsB), [segmentsB]);

  const speechA = useMemo(() => {
    if (!passageA) return { isValid: false, isEmpty: false, regions: [] };
    return getSpeechOverTimeSeries(passageA, speechAnalysis, mediaSignature, filmDuration);
  }, [passageA, speechAnalysis, mediaSignature, filmDuration]);

  const speechB = useMemo(() => {
    if (!passageB) return { isValid: false, isEmpty: false, regions: [] };
    return getSpeechOverTimeSeries(passageB, speechAnalysis, mediaSignature, filmDuration);
  }, [passageB, speechAnalysis, mediaSignature, filmDuration]);

  const framingA = useMemo(() => getTemporalFramingBlocks(segmentsA), [segmentsA]);
  const framingB = useMemo(() => getTemporalFramingBlocks(segmentsB), [segmentsB]);

  const formatClock = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  };

  // Convert click on a side's graph to target localTime and sourceTime
  const handleGraphClick = (
    side: "A" | "B",
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    const passage = side === "A" ? passageA : passageB;
    if (!passage) return;
    const dur = side === "A" ? durA : durB;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = rect.width > 0 ? clickX / rect.width : 0;

    let targetLocal = 0;
    if (timeMode === "relative") {
      targetLocal = ratio * dur;
    } else {
      // Actual time mode: graph width spans maxActualDuration
      const targetSecs = ratio * maxActualDuration;
      targetLocal = Math.min(dur, targetSecs);
    }

    const pIn = passage.startSeconds;
    const targetSource = pIn + targetLocal;

    onSeek(side, {
      passageId: passage.id,
      localTime: targetLocal,
      sourceTime: targetSource,
    });
  };

  // Playhead position % calculation
  const playheadPercentA = useMemo(() => {
    if (timeMode === "relative") {
      return durA > 0 ? (playheadA.localTime / durA) * 100 : 0;
    }
    return maxActualDuration > 0 ? (playheadA.localTime / maxActualDuration) * 100 : 0;
  }, [timeMode, playheadA.localTime, durA, maxActualDuration]);

  const playheadPercentB = useMemo(() => {
    if (timeMode === "relative") {
      return durB > 0 ? (playheadB.localTime / durB) * 100 : 0;
    }
    return maxActualDuration > 0 ? (playheadB.localTime / maxActualDuration) * 100 : 0;
  }, [timeMode, playheadB.localTime, durB, maxActualDuration]);

  // Width % of passage on graph in Actual time mode
  const passageWidthPctA = timeMode === "actual" ? (durA / maxActualDuration) * 100 : 100;
  const passageWidthPctB = timeMode === "actual" ? (durB / maxActualDuration) * 100 : 100;

  // Active playhead value lookup
  const getActiveNumericValue = (
    side: "A" | "B",
    steps: NumericStepSegment[],
    localTime: number,
  ) => {
    const seg = steps.find((s) => localTime >= s.localStart && localTime < s.localEnd);
    if (!seg) {
      const last = steps[steps.length - 1];
      if (last && localTime >= last.localStart) return last.value;
      return null;
    }
    return seg.value;
  };

  const activeValA = useMemo(() => {
    if (selectedMeasure === "motion") {
      return getActiveNumericValue("A", motionA, playheadA.localTime);
    }
    if (selectedMeasure === "luminance") {
      return getActiveNumericValue("A", lumaA, playheadA.localTime);
    }
    return null;
  }, [selectedMeasure, motionA, lumaA, playheadA.localTime]);

  const activeValB = useMemo(() => {
    if (selectedMeasure === "motion") {
      return getActiveNumericValue("B", motionB, playheadB.localTime);
    }
    if (selectedMeasure === "luminance") {
      return getActiveNumericValue("B", lumaB, playheadB.localTime);
    }
    return null;
  }, [selectedMeasure, motionB, lumaB, playheadB.localTime]);

  return (
    <div className="compare-over-time-view" data-testid="compare-over-time-view">
      {/* 1. HEADER CONTROLS: MEASURE SELECTOR + ACTUAL/RELATIVE TOGGLE */}
      <div className="compare-block-header-row">
        <div className="compare-block-title-group">
          <h5 className="compare-block-title">Where changes happen</h5>
          <span className="compare-block-subtitle">
            {timeMode === "relative"
              ? "Relative progress aligns duration, not events. Per-shot estimates · Click to seek matching player"
              : `Actual time aligns passage-local zero on a common seconds axis (0–${maxActualDuration.toFixed(
                  0,
                )}s). Shorter passage ends naturally.`}
          </span>
        </div>

        <div className="compare-overtime-controls">
          {/* Measure selection dropdown / pills */}
          <div className="compare-select-wrapper">
            <select
              aria-label="Analytical measurement over time"
              className="compare-measure-select"
              value={selectedMeasure}
              onChange={(e) => setSelectedMeasure(e.target.value as OverTimeMeasure)}
            >
              <option value="motion">Motion energy</option>
              <option value="luminance">Luminance</option>
              <option value="speech">Detected speech</option>
              <option value="framing">Framing</option>
            </select>
            <span className="compare-select-caret" aria-hidden="true">▾</span>
          </div>

          {/* Time mode toggle */}
          <div className="compare-mode-toggle" role="group" aria-label="Time scale mapping">
            <button
              type="button"
              className={`compare-toggle-btn ${timeMode === "actual" ? "active" : ""}`}
              onClick={() => setTimeMode("actual")}
              aria-pressed={timeMode === "actual"}
            >
              Actual time
            </button>
            <button
              type="button"
              className={`compare-toggle-btn ${timeMode === "relative" ? "active" : ""}`}
              onClick={() => setTimeMode("relative")}
              aria-pressed={timeMode === "relative"}
            >
              Relative progress
            </button>
          </div>
        </div>
      </div>

      {/* 2. OVER-TIME CHARTS: PASSAGE A & PASSAGE B */}
      <div className="compare-overtime-stage">
        {/* ROW A */}
        <div className="compare-overtime-row">
          <div className="compare-overtime-side-badge">
            <span className="order-badge badge-a">A</span>
            <span className="order-side-title">{passageA?.name ?? "Passage A"}</span>
          </div>

          <div className="compare-overtime-graph-container">
            {/* Numeric Y-Axis (0 - 100) */}
            {selectedMeasure !== "framing" && (
              <div className="compare-order-y-axis">
                <span className="order-y-label">
                  {selectedMeasure === "motion"
                    ? "Energy"
                    : selectedMeasure === "luminance"
                    ? "Luma %"
                    : "Speech"}
                </span>
                <div className="order-y-ticks">
                  <span>100</span>
                  <span>50</span>
                  <span>0</span>
                </div>
              </div>
            )}

            {/* Clickable Graph Surface */}
            <div
              className="compare-overtime-track"
              onClick={(e) => handleGraphClick("A", e)}
              title="Click to seek Passage A"
            >
              {/* Inner passage container sized according to actual / relative duration */}
              <div
                className="compare-overtime-inner"
                style={{ width: `${passageWidthPctA}%` }}
              >
                {/* A. MOTION ENERGY STEP CHART */}
                {selectedMeasure === "motion" && (
                  <div className="compare-step-graph">
                    {motionA.map((step, idx) => {
                      const segWidthPct = (step.visibleDuration / durA) * 100;
                      if (step.isUnavailable) {
                        return (
                          <div
                            key={`m-a-${step.shotId}-${idx}`}
                            className="compare-step-unavailable"
                            style={{ width: `${segWidthPct}%` }}
                            title={`Shot ${step.shotIndex}: Motion unavailable`}
                          >
                            <span className="step-unavailable-text">Unavailable</span>
                          </div>
                        );
                      }

                      const topPct = 100 - (step.value ?? 0);
                      return (
                        <div
                          key={`m-a-${step.shotId}-${idx}`}
                          className="compare-step-block"
                          style={{ width: `${segWidthPct}%` }}
                          title={`Shot ${step.shotIndex}: Motion energy ${step.value}`}
                        >
                          <div
                            className="compare-step-line line-a"
                            style={{ top: `${topPct}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* B. LUMINANCE STEP CHART */}
                {selectedMeasure === "luminance" && (
                  <div className="compare-step-graph">
                    {lumaA.map((step, idx) => {
                      const segWidthPct = (step.visibleDuration / durA) * 100;
                      if (step.isUnavailable) {
                        return (
                          <div
                            key={`l-a-${step.shotId}-${idx}`}
                            className="compare-step-unavailable"
                            style={{ width: `${segWidthPct}%` }}
                            title={`Shot ${step.shotIndex}: Luminance unavailable`}
                          >
                            <span className="step-unavailable-text">Unavailable</span>
                          </div>
                        );
                      }

                      const topPct = 100 - (step.value ?? 0);
                      return (
                        <div
                          key={`l-a-${step.shotId}-${idx}`}
                          className="compare-step-block"
                          style={{ width: `${segWidthPct}%` }}
                          title={`Shot ${step.shotIndex}: Luminance ${step.value}%`}
                        >
                          <div
                            className="compare-step-line line-a"
                            style={{ top: `${topPct}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* C. DETECTED SPEECH CHART */}
                {selectedMeasure === "speech" && (
                  <div className="compare-speech-graph">
                    {!speechA.isValid ? (
                      <div className="compare-speech-unavailable">
                        <span>Speech analysis unavailable</span>
                      </div>
                    ) : speechA.isEmpty ? (
                      <div className="compare-speech-empty">
                        <div className="compare-speech-baseline" />
                        <span className="speech-empty-text">No detected speech</span>
                      </div>
                    ) : (
                      <div className="compare-speech-regions-track">
                        <div className="compare-speech-baseline" />
                        {speechA.regions.map((reg, idx) => {
                          const leftPct = (reg.localStart / durA) * 100;
                          const widthPct = ((reg.localEnd - reg.localStart) / durA) * 100;
                          return (
                            <div
                              key={`sp-a-${idx}`}
                              className="compare-speech-block block-a"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              title={`Detected speech: ${formatClock(reg.localStart)} – ${formatClock(
                                reg.localEnd,
                              )}`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* D. FRAMING CATEGORICAL BLOCKS */}
                {selectedMeasure === "framing" && (
                  <div className="compare-framing-strip-graph">
                    {framingA.map((block, idx) => {
                      const segWidthPct = (block.visibleDuration / durA) * 100;
                      return (
                        <div
                          key={`fr-a-${block.shotId}-${idx}`}
                          className={`compare-framing-cat-block ${
                            block.category === "Unknown" ? "cat-unknown" : ""
                          }`}
                          style={{
                            width: `${segWidthPct}%`,
                            backgroundColor: block.color,
                          }}
                          title={`Shot ${block.shotIndex}: ${block.category}`}
                        >
                          {segWidthPct >= 8 && (
                            <span className="framing-cat-text mono">{block.category}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Shorter passage deadzone in Actual time mode */}
              {timeMode === "actual" && passageWidthPctA < 99.9 && (
                <div
                  className="compare-actual-end-marker"
                  style={{ left: `${passageWidthPctA}%` }}
                >
                  <span className="actual-end-tag mono">
                    End of {passageA?.name ?? "Passage A"} ({durA.toFixed(1)}s)
                  </span>
                </div>
              )}

              {/* Active Scrubber Indicator for Passage A */}
              <div
                className={`compare-chart-playhead playhead-a ${
                  playingSide === "A" ? "prominent" : "subdued"
                }`}
                style={{ left: `${playheadPercentA}%` }}
              >
                <div className="chart-playhead-line line-a" />
                <div className="chart-playhead-thumb thumb-a" />
                {activeValA !== null && (
                  <div className="chart-playhead-badge badge-a mono">
                    {activeValA}%
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ROW B */}
        <div className="compare-overtime-row">
          <div className="compare-overtime-side-badge">
            <span className="order-badge badge-b">B</span>
            <span className="order-side-title">{passageB?.name ?? "Passage B"}</span>
          </div>

          <div className="compare-overtime-graph-container">
            {/* Numeric Y-Axis (0 - 100) */}
            {selectedMeasure !== "framing" && (
              <div className="compare-order-y-axis">
                <span className="order-y-label">
                  {selectedMeasure === "motion"
                    ? "Energy"
                    : selectedMeasure === "luminance"
                    ? "Luma %"
                    : "Speech"}
                </span>
                <div className="order-y-ticks">
                  <span>100</span>
                  <span>50</span>
                  <span>0</span>
                </div>
              </div>
            )}

            {/* Clickable Graph Surface */}
            <div
              className="compare-overtime-track"
              onClick={(e) => handleGraphClick("B", e)}
              title="Click to seek Passage B"
            >
              {/* Inner passage container sized according to actual / relative duration */}
              <div
                className="compare-overtime-inner"
                style={{ width: `${passageWidthPctB}%` }}
              >
                {/* A. MOTION ENERGY STEP CHART */}
                {selectedMeasure === "motion" && (
                  <div className="compare-step-graph">
                    {motionB.map((step, idx) => {
                      const segWidthPct = (step.visibleDuration / durB) * 100;
                      if (step.isUnavailable) {
                        return (
                          <div
                            key={`m-b-${step.shotId}-${idx}`}
                            className="compare-step-unavailable"
                            style={{ width: `${segWidthPct}%` }}
                            title={`Shot ${step.shotIndex}: Motion unavailable`}
                          >
                            <span className="step-unavailable-text">Unavailable</span>
                          </div>
                        );
                      }

                      const topPct = 100 - (step.value ?? 0);
                      return (
                        <div
                          key={`m-b-${step.shotId}-${idx}`}
                          className="compare-step-block"
                          style={{ width: `${segWidthPct}%` }}
                          title={`Shot ${step.shotIndex}: Motion energy ${step.value}`}
                        >
                          <div
                            className="compare-step-line line-b"
                            style={{ top: `${topPct}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* B. LUMINANCE STEP CHART */}
                {selectedMeasure === "luminance" && (
                  <div className="compare-step-graph">
                    {lumaB.map((step, idx) => {
                      const segWidthPct = (step.visibleDuration / durB) * 100;
                      if (step.isUnavailable) {
                        return (
                          <div
                            key={`l-b-${step.shotId}-${idx}`}
                            className="compare-step-unavailable"
                            style={{ width: `${segWidthPct}%` }}
                            title={`Shot ${step.shotIndex}: Luminance unavailable`}
                          >
                            <span className="step-unavailable-text">Unavailable</span>
                          </div>
                        );
                      }

                      const topPct = 100 - (step.value ?? 0);
                      return (
                        <div
                          key={`l-b-${step.shotId}-${idx}`}
                          className="compare-step-block"
                          style={{ width: `${segWidthPct}%` }}
                          title={`Shot ${step.shotIndex}: Luminance ${step.value}%`}
                        >
                          <div
                            className="compare-step-line line-b"
                            style={{ top: `${topPct}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* C. DETECTED SPEECH CHART */}
                {selectedMeasure === "speech" && (
                  <div className="compare-speech-graph">
                    {!speechB.isValid ? (
                      <div className="compare-speech-unavailable">
                        <span>Speech analysis unavailable</span>
                      </div>
                    ) : speechB.isEmpty ? (
                      <div className="compare-speech-empty">
                        <div className="compare-speech-baseline" />
                        <span className="speech-empty-text">No detected speech</span>
                      </div>
                    ) : (
                      <div className="compare-speech-regions-track">
                        <div className="compare-speech-baseline" />
                        {speechB.regions.map((reg, idx) => {
                          const leftPct = (reg.localStart / durB) * 100;
                          const widthPct = ((reg.localEnd - reg.localStart) / durB) * 100;
                          return (
                            <div
                              key={`sp-b-${idx}`}
                              className="compare-speech-block block-b"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              title={`Detected speech: ${formatClock(reg.localStart)} – ${formatClock(
                                reg.localEnd,
                              )}`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* D. FRAMING CATEGORICAL BLOCKS */}
                {selectedMeasure === "framing" && (
                  <div className="compare-framing-strip-graph">
                    {framingB.map((block, idx) => {
                      const segWidthPct = (block.visibleDuration / durB) * 100;
                      return (
                        <div
                          key={`fr-b-${block.shotId}-${idx}`}
                          className={`compare-framing-cat-block ${
                            block.category === "Unknown" ? "cat-unknown" : ""
                          }`}
                          style={{
                            width: `${segWidthPct}%`,
                            backgroundColor: block.color,
                          }}
                          title={`Shot ${block.shotIndex}: ${block.category}`}
                        >
                          {segWidthPct >= 8 && (
                            <span className="framing-cat-text mono">{block.category}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Shorter passage deadzone in Actual time mode */}
              {timeMode === "actual" && passageWidthPctB < 99.9 && (
                <div
                  className="compare-actual-end-marker"
                  style={{ left: `${passageWidthPctB}%` }}
                >
                  <span className="actual-end-tag mono">
                    End of {passageB?.name ?? "Passage B"} ({durB.toFixed(1)}s)
                  </span>
                </div>
              )}

              {/* Active Scrubber Indicator for Passage B */}
              <div
                className={`compare-chart-playhead playhead-b ${
                  playingSide === "B" ? "prominent" : "subdued"
                }`}
                style={{ left: `${playheadPercentB}%` }}
              >
                <div className="chart-playhead-line line-b" />
                <div className="chart-playhead-thumb thumb-b" />
                {activeValB !== null && (
                  <div className="chart-playhead-badge badge-b mono">
                    {activeValB}%
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* X-AXIS TICKS */}
        <div className="compare-overtime-x-axis">
          {timeMode === "relative" ? (
            <div className="compare-temporal-scale">
              <span>0%</span>
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>100%</span>
            </div>
          ) : (
            <div className="compare-temporal-scale">
              <span>0s</span>
              <span>{Math.round(maxActualDuration * 0.25)}s</span>
              <span>{Math.round(maxActualDuration * 0.5)}s</span>
              <span>{Math.round(maxActualDuration * 0.75)}s</span>
              <span>{Math.round(maxActualDuration)}s</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
