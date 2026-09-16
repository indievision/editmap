import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import EChart from "./EChart";
import { formatTimecode } from "../../utils/timecode";

export type PacingPoint = { time: number; value: number };
export type ClosePoint = { time: number; value: number | null };
export type VisualDeltaPoint = { time: number; avgDeltaV: number; shockScore: number };

export interface PacingChartProps {
  pacing: PacingPoint[];
  close: ClosePoint[];
  visualDelta: VisualDeltaPoint[];
  hasFramingData: boolean;
  currentTime: number;
  duration: number;
  windowStart: number;
  windowEnd: number;
  currentValues: {
    cutRate: number;
    closeShare: number | null;
    avgDeltaV: number;
  };
  frameRate: number;
  dropFrame: boolean;
  onSeek: (time: number) => void;
}

export default function PacingChart({
  pacing,
  close,
  visualDelta,
  hasFramingData,
  currentTime,
  duration,
  windowStart,
  windowEnd,
  currentValues,
  frameRate,
  dropFrame,
  onSeek,
}: PacingChartProps) {
  const currentTc = formatTimecode(currentTime, frameRate, dropFrame);

  const windowMarkArea = useMemo(
    () => ({
      silent: true,
      itemStyle: {
        color: "rgba(211, 186, 124, 0.16)",
        borderColor: "rgba(211, 186, 124, 0.38)",
        borderWidth: 1,
      },
      data: [
        [
          { xAxis: windowStart },
          { xAxis: windowEnd },
        ] as [{ xAxis: number }, { xAxis: number }],
      ],
    }),
    [windowStart, windowEnd],
  );

  const playheadMarkLine = useMemo(
    () => ({
      silent: true,
      symbol: "none",
      lineStyle: {
        color: "#d3ba7c",
        width: 1.5,
        type: "dashed" as const,
      },
      label: { show: false },
      data: [{ xAxis: currentTime }],
    }),
    [currentTime],
  );

  const option = useMemo<EChartsOption>(() => {
    const gridLeft = 40;
    const gridRight = 12;
    const laneHeight = 68;

    return {
      animation: false,
      backgroundColor: "transparent",
      axisPointer: {
        link: [{ xAxisIndex: "all" }],
        type: "line",
        lineStyle: { color: "rgba(211, 186, 124, 0.65)", width: 1, type: "dashed" },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#111619",
        borderColor: "#2f383e",
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: "#e3dfd3", fontSize: 11 },
        formatter: (params: unknown) => {
          const rows = Array.isArray(params)
            ? (params as Array<{ axisValue: number; value: [number, number] }>)
            : [];
          if (!rows.length) return "";
          const hoverTime = Number(rows[0].axisValue ?? rows[0].value?.[0] ?? 0);
          const tcStr = formatTimecode(hoverTime, frameRate, dropFrame);

          const idx =
            duration > 0
              ? Math.max(
                  0,
                  Math.min(
                    pacing.length - 1,
                    Math.round((hoverTime / duration) * (pacing.length - 1)),
                  ),
                )
              : 0;

          const pRate = pacing[idx]?.value;
          const cShare =
            hasFramingData && close[idx]?.value !== null && close[idx]?.value !== undefined
              ? close[idx]!.value
              : null;
          const vDelta = visualDelta[idx];

          const lines = [
            `<div style="font-weight:700;color:#e3dfd3;margin-bottom:6px;font-size:11px;letter-spacing:0.04em;">${tcStr}</div>`,
            `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;">
              <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#6c9bc2;"></span>
              <span style="color:#8a969e;">Cut rate:</span>
              <b style="color:#e3dfd3;margin-left:auto;">${pRate !== undefined ? pRate.toFixed(1) : "—"} cuts/min</b>
            </div>`,
            `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;">
              <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#52b788;"></span>
              <span style="color:#8a969e;">Close framing:</span>
              <b style="color:#e3dfd3;margin-left:auto;">${cShare !== null ? `${cShare.toFixed(1)}%` : "<span style='color:#616e75;font-weight:normal;'>Unavailable</span>"}</b>
            </div>`,
            `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;">
              <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#b3a89b;"></span>
              <span style="color:#8a969e;">Visual change:</span>
              <b style="color:#e3dfd3;margin-left:auto;">${vDelta ? vDelta.avgDeltaV.toFixed(2) : "0.00"} avg ΔV</b>
            </div>`,
            vDelta && typeof vDelta.shockScore === "number"
              ? `<div style="font-size:10px;color:#707e86;margin-top:4px;padding-top:4px;border-top:1px solid #283238;display:flex;justify-content:space-between;">
                  <span>Sensory shock:</span>
                  <b style="color:#b3a89b;">${vDelta.shockScore} / 100</b>
                </div>`
              : "",
          ].filter(Boolean);

          return lines.join("");
        },
      },
      grid: [
        {
          left: gridLeft,
          right: gridRight,
          top: 14,
          height: laneHeight,
          containLabel: false,
        },
        {
          left: gridLeft,
          right: gridRight,
          top: 96,
          height: laneHeight,
          containLabel: false,
        },
        {
          left: gridLeft,
          right: gridRight,
          top: 178,
          height: laneHeight,
          containLabel: false,
        },
      ],
      xAxis: [
        {
          gridIndex: 0,
          type: "value",
          min: 0,
          max: duration,
          axisLine: { show: true, lineStyle: { color: "#283238", width: 1 } },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { lineStyle: { color: "#ffffff08" } },
        },
        {
          gridIndex: 1,
          type: "value",
          min: 0,
          max: duration,
          axisLine: { show: true, lineStyle: { color: "#283238", width: 1 } },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { lineStyle: { color: "#ffffff08" } },
        },
        {
          gridIndex: 2,
          type: "value",
          min: 0,
          max: duration,
          axisLine: { show: true, lineStyle: { color: "#344047", width: 1 } },
          axisTick: { lineStyle: { color: "#344047" } },
          axisLabel: {
            color: "#87939a",
            fontSize: 10,
            hideOverlap: true,
            formatter: (val: number) => formatTimecode(val, frameRate, dropFrame),
          },
          splitLine: { lineStyle: { color: "#ffffff08" } },
        },
      ],
      yAxis: [
        {
          gridIndex: 0,
          type: "value",
          min: 0,
          splitNumber: 2,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: "#7099c2", fontSize: 10 },
          splitLine: { lineStyle: { color: "#ffffff08" } },
        },
        {
          gridIndex: 1,
          type: "value",
          min: 0,
          max: 100,
          splitNumber: 2,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            show: hasFramingData,
            color: "#52b788",
            fontSize: 10,
            formatter: (v: number) => `${v}`,
          },
          splitLine: { show: hasFramingData, lineStyle: { color: "#ffffff08" } },
        },
        {
          gridIndex: 2,
          type: "value",
          min: 0,
          splitNumber: 2,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: "#a89f91",
            fontSize: 10,
            formatter: (val: number) => (val === 0 ? "0" : val.toFixed(2).replace(/^0/, "")),
          },
          splitLine: { lineStyle: { color: "#ffffff08" } },
        },
      ],
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0, 1, 2],
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
        },
        {
          type: "slider",
          xAxisIndex: [0, 1, 2],
          height: 14,
          bottom: 2,
          borderColor: "#283238",
          backgroundColor: "#101416",
          fillerColor: "rgba(211, 186, 124, 0.16)",
          handleStyle: { color: "#d3ba7c", borderColor: "#d3ba7c" },
          textStyle: { color: "transparent" },
        },
      ],
      series: [
        {
          id: "pacing-cut-rate",
          name: "Cut rate",
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          smooth: 0.2,
          showSymbol: false,
          data: pacing.map((pt) => [pt.time, pt.value]),
          lineStyle: { color: "#6c9bc2", width: 1.8 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(108, 155, 194, 0.25)" },
                { offset: 1, color: "rgba(108, 155, 194, 0.02)" },
              ],
            },
          },
          markArea: windowMarkArea,
          markLine: playheadMarkLine,
        },
        {
          id: "pacing-close-framing",
          name: "Close framing",
          type: "line",
          step: "middle",
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          data: close.map((pt) => [pt.time, pt.value]),
          lineStyle: { color: "#52b788", width: 1.8 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(82, 183, 136, 0.2)" },
                { offset: 1, color: "rgba(82, 183, 136, 0.02)" },
              ],
            },
          },
          markArea: windowMarkArea,
          markLine: playheadMarkLine,
        },
        {
          id: "pacing-visual-change",
          name: "Visual change",
          type: "line",
          xAxisIndex: 2,
          yAxisIndex: 2,
          smooth: 0.2,
          showSymbol: false,
          data: visualDelta.map((pt) => [pt.time, pt.avgDeltaV, pt.shockScore]),
          lineStyle: { color: "#b3a89b", width: 1.8 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(179, 168, 155, 0.18)" },
                { offset: 1, color: "rgba(179, 168, 155, 0.02)" },
              ],
            },
          },
          markArea: windowMarkArea,
          markLine: playheadMarkLine,
        },
      ],
    };
  }, [
    close,
    currentTime,
    dropFrame,
    duration,
    frameRate,
    hasFramingData,
    pacing,
    playheadMarkLine,
    visualDelta,
    windowEnd,
    windowMarkArea,
  ]);

  return (
    <div className="pacing-glance-body">
      <div className="pacing-lanes-labels" aria-hidden="true">
        <div className="pacing-lane-label lane-cut-rate">
          <div className="pacing-lane-title-row">
            <span className="pacing-lane-dot dot-cut-rate" />
            <span className="pacing-lane-name">CUT RATE</span>
          </div>
          <div className="pacing-lane-unit">cuts / min</div>
        </div>

        <div className="pacing-lane-label lane-close-framing">
          <div className="pacing-lane-title-row">
            <span className="pacing-lane-dot dot-close-framing" />
            <span className="pacing-lane-name">CLOSE FRAMING</span>
          </div>
          <div className="pacing-lane-unit">% of known framing</div>
        </div>

        <div className="pacing-lane-label lane-visual-change">
          <div className="pacing-lane-title-row">
            <span className="pacing-lane-dot dot-visual-change" />
            <span className="pacing-lane-name">VISUAL CHANGE</span>
          </div>
          <div className="pacing-lane-unit">avg ΔV</div>
        </div>
      </div>

      <div className="pacing-chart-canvas-wrapper">
        <EChart
          className="pacing-echart"
          option={option}
          label="Pacing at a glance: cut rate, close framing, and visual change chart"
          currentTime={currentTime}
          duration={duration}
          onSeek={onSeek}
        />
        {!hasFramingData && (
          <div className="pacing-no-framing-overlay" aria-hidden="true">
            <span>No framing data available</span>
          </div>
        )}
      </div>

      <div className="pacing-lanes-readouts" aria-label="Current values at playhead">
        <div className="pacing-lane-readout lane-cut-rate">
          <div className="pacing-readout-val val-cut-rate">
            {Number(currentValues.cutRate.toFixed(1))}
          </div>
          <div className="pacing-readout-unit">cuts / min</div>
          <div className="pacing-readout-time">(at {currentTc})</div>
        </div>

        <div className="pacing-lane-readout lane-close-framing">
          <div className="pacing-readout-val val-close-framing">
            {currentValues.closeShare !== null ? `${Math.round(currentValues.closeShare * 100)}%` : "—"}
          </div>
          <div className="pacing-readout-unit">
            {currentValues.closeShare !== null ? "% close" : "unavailable"}
          </div>
          <div className="pacing-readout-time">(at {currentTc})</div>
        </div>

        <div className="pacing-lane-readout lane-visual-change">
          <div className="pacing-readout-val val-visual-change">
            {currentValues.avgDeltaV.toFixed(2)}
          </div>
          <div className="pacing-readout-unit">avg ΔV</div>
          <div className="pacing-readout-time">(at {currentTc})</div>
        </div>
      </div>
    </div>
  );
}
