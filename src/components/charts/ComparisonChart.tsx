import { memo, useMemo, useState, useRef, useEffect, useCallback } from "react";
import type { EChartsOption } from "echarts";
import EChart from "./EChart";
import { quantizeToFrame } from "../../timeline/timelineOps";
import {
  type MeasureId,
  MEASURE_METAS,
  type ComparisonSeriesCollection,
  getComparisonValuesAt,
  formatDisplayTime,
} from "../../analysis/comparison";
import type { Project } from "../../models/project";

export interface ComparisonChartProps {
  project: Project;
  seriesCollection: ComparisonSeriesCollection;
  currentTime: number;
  duration: number;
  selectedMeasures: MeasureId[];
  hiddenMeasures?: Set<MeasureId>;
  viewMode: "overlay" | "lanes";
  pacingWindow: number;
  frameRate: number;
  dropFrame: boolean;
  onSeek: (time: number) => void;
  scopeStart?: number;
  scopeEnd?: number;
  visibleStart?: number;
  visibleEnd?: number;
  range?: { start?: number; end?: number };
  onRangeChange?: (range?: { start?: number; end?: number }) => void;
  onPan?: (deltaSecs: number) => void;
}

export const ComparisonChart = memo(function ComparisonChart({
  project,
  seriesCollection,
  currentTime,
  duration,
  selectedMeasures,
  hiddenMeasures = new Set(),
  viewMode,
  pacingWindow,
  frameRate,
  dropFrame: _dropFrame,
  onSeek,
  scopeStart = 0,
  scopeEnd,
  visibleStart,
  visibleEnd,
  range,
  onRangeChange,
  onPan,
}: ComparisonChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 280 });

  const effectiveScopeEnd = scopeEnd ?? duration;
  const effectiveVisibleStart = visibleStart ?? scopeStart;
  const effectiveVisibleEnd = visibleEnd ?? effectiveScopeEnd;

  // Track container size for SVG overlay alignment
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const gridLeft = viewMode === "overlay" ? 46 : 52;
  const gridRight = 14;
  const gridTop = viewMode === "overlay" ? 22 : 14;
  const gridBottom = viewMode === "overlay" ? 26 : 24;
  const gridWidth = Math.max(10, containerSize.width - gridLeft - gridRight);
  const gridHeight = Math.max(10, containerSize.height - gridTop - gridBottom);

  // Time <-> Pixel conversion
  const timeToPx = useCallback(
    (t: number) => {
      const span = Math.max(0.001, effectiveVisibleEnd - effectiveVisibleStart);
      const ratio = (t - effectiveVisibleStart) / span;
      return gridLeft + ratio * gridWidth;
    },
    [effectiveVisibleStart, effectiveVisibleEnd, gridLeft, gridWidth],
  );

  const pxToTime = useCallback(
    (px: number) => {
      const clampedPx = Math.max(gridLeft, Math.min(gridLeft + gridWidth, px));
      const ratio = (clampedPx - gridLeft) / gridWidth;
      const span = effectiveVisibleEnd - effectiveVisibleStart;
      const raw = effectiveVisibleStart + ratio * span;
      const clamped = Math.max(scopeStart, Math.min(effectiveScopeEnd, raw));
      return quantizeToFrame(clamped, frameRate);
    },
    [effectiveScopeEnd, effectiveVisibleEnd, effectiveVisibleStart, frameRate, gridLeft, gridWidth, scopeStart],
  );

  // Playhead line marker across active axes
  const playheadMarkLine = useMemo(
    () => ({
      silent: true,
      symbol: "none",
      lineStyle: {
        color: "#d3ba7c",
        width: 1.5,
        type: "solid" as const,
      },
      label: { show: false },
      data: [{ xAxis: currentTime }],
    }),
    [currentTime],
  );

  // ECharts option calculation
  const option = useMemo<EChartsOption>(() => {
    const isOverlay = viewMode === "overlay";

    // Compact raw-values tooltip matching mockup
    const tooltipFormatter = (params: unknown) => {
      const rows = Array.isArray(params)
        ? (params as Array<{ axisValue: number; value: [number, number | null] }>)
        : [];
      if (!rows.length) return "";
      const hoverTime = Number(rows[0].axisValue ?? rows[0].value?.[0] ?? 0);
      const tcStr = formatDisplayTime(hoverTime);

      const timeValues = getComparisonValuesAt(project, hoverTime, pacingWindow);

      const lines = [
        `<div style="font-weight:700;color:#e3dfd3;font-size:12px;margin-bottom:6px;letter-spacing:0.02em;">${tcStr}</div>`,
      ];

      selectedMeasures.forEach((id) => {
        const meta = MEASURE_METAS[id];
        const val = timeValues[id];
        const isHidden = hiddenMeasures.has(id);
        const opacity = isHidden ? "0.45" : "1";

        let valStr = "";
        if (!val.available) {
          valStr = `<span style="color:#64737d;font-weight:normal;">Unavailable</span>`;
        } else if (id === "cutRate") {
          valStr = `<b style="color:#e3dfd3;">${Math.round(val.rawValue ?? 0)} cuts/min</b>`;
        } else if (id === "luminance") {
          valStr = `<b style="color:#e3dfd3;">${Math.round(val.rawValue ?? 0)}%</b>`;
        } else if (id === "motion") {
          valStr = `<b style="color:#e3dfd3;">${Math.round(val.rawValue ?? 0)}% flow</b>`;
        }

        lines.push(`
          <div style="display:flex;align-items:center;gap:8px;margin:3px 0;opacity:${opacity};font-size:11px;">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${meta.color};flex-shrink:0;"></span>
            <span style="color:#8a969e;">${meta.name}</span>
            <span style="margin-left:auto;padding-left:14px;">${valStr}</span>
          </div>
        `);
      });

      return lines.join("");
    };

    if (isOverlay) {
      // OVERLAY MODE: 1 grid, normalized 0.0 to 1.0 relative scale with sparse grid
      const seriesList = selectedMeasures.map((id) => {
        const meta = MEASURE_METAS[id];
        const data = seriesCollection[id];
        const isHidden = hiddenMeasures.has(id);

        return {
          id: `compare-overlay-${id}`,
          name: meta.name,
          type: "line" as const,
          xAxisIndex: 0,
          yAxisIndex: 0,
          smooth: meta.temporalResolution === "windowed" ? 0.2 : false,
          showSymbol: false,
          connectNulls: false, // Ensure missing/unscanned data appears as genuine gaps
          data: isHidden ? [] : data.normalizedPoints,
          lineStyle: { color: meta.color, width: 2 },
          markLine: id === selectedMeasures[0] ? playheadMarkLine : undefined,
        };
      });

      return {
        animation: false,
        backgroundColor: "transparent",
        axisPointer: {
          link: [{ xAxisIndex: "all" }],
          type: "line",
          lineStyle: { color: "rgba(211, 186, 124, 0.55)", width: 1, type: "dashed" },
        },
        tooltip: {
          trigger: "axis",
          backgroundColor: "#161b1e",
          borderColor: "#2e3a42",
          borderWidth: 1,
          padding: [8, 12],
          textStyle: { color: "#e3dfd3", fontSize: 11 },
          formatter: tooltipFormatter,
        },
        grid: [
          {
            left: gridLeft,
            right: gridRight,
            top: gridTop,
            bottom: gridBottom,
            containLabel: false,
          },
        ],
        xAxis: [
          {
            gridIndex: 0,
            type: "value",
            min: effectiveVisibleStart,
            max: effectiveVisibleEnd,
            axisLine: { show: true, lineStyle: { color: "#344047", width: 1 } },
            axisTick: { show: true, lineStyle: { color: "#344047" } },
            axisLabel: {
              color: "#87939a",
              fontSize: 10,
              hideOverlap: true,
              formatter: (val: number) => formatDisplayTime(val),
            },
            splitLine: { show: false },
          },
        ],
        yAxis: [
          {
            gridIndex: 0,
            type: "value",
            name: "Relative\nscale",
            nameTextStyle: {
              color: "#717f88",
              fontSize: 9.5,
              lineHeight: 12,
              align: "left",
              padding: [0, 0, 4, 0],
            },
            min: 0,
            max: 1.0,
            interval: 0.2,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: {
              color: "#87939a",
              fontSize: 10,
              formatter: (v: number) => v.toFixed(1),
            },
            splitLine: {
              show: true,
              lineStyle: { color: "#ffffff0a", type: "dashed" as const },
            },
          },
        ],
        series: seriesList,
      };
    }

    // STACKED MODE: 1 to 3 distinct vertical lanes in original units
    const laneCount = Math.max(1, selectedMeasures.length);
    const availableHeight = containerSize.height - 18 - 26;
    const laneGap = 12;
    const totalGaps = (laneCount - 1) * laneGap;
    const laneHeight = Math.max(36, Math.floor((availableHeight - totalGaps) / laneCount));
    const topOffset = 14;

    const grids = selectedMeasures.map((_, i) => ({
      left: gridLeft,
      right: gridRight,
      top: topOffset + i * (laneHeight + laneGap),
      height: laneHeight,
      containLabel: false,
    }));

    const xAxes = selectedMeasures.map((_, i) => {
      const isBottom = i === selectedMeasures.length - 1;
      return {
        gridIndex: i,
        type: "value" as const,
        min: effectiveVisibleStart,
        max: effectiveVisibleEnd,
        axisLine: { show: true, lineStyle: { color: isBottom ? "#344047" : "#283238", width: 1 } },
        axisTick: { show: isBottom, lineStyle: { color: "#344047" } },
        axisLabel: {
          show: isBottom,
          color: "#87939a",
          fontSize: 10,
          hideOverlap: true,
          formatter: (val: number) => formatDisplayTime(val),
        },
        splitLine: { show: false },
      };
    });

    const yAxes = selectedMeasures.map((id, i) => {
      const meta = MEASURE_METAS[id];
      const data = seriesCollection[id];
      const maxVal = id === "cutRate" ? Math.max(5, Math.ceil(data.refMax)) : 100;

      return {
        gridIndex: i,
        type: "value" as const,
        name: `${meta.name} (${meta.unit})`,
        nameTextStyle: {
          color: meta.color,
          fontSize: 9,
          padding: [0, 0, 1, 2],
          align: "left" as const,
        },
        min: 0,
        max: maxVal,
        splitNumber: 2,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: meta.color,
          fontSize: 9.5,
          formatter: (v: number) => (id === "cutRate" ? `${v}` : `${v}%`),
        },
        splitLine: {
          show: true,
          lineStyle: { color: "#ffffff0a", type: "dashed" as const },
        },
      };
    });

    const seriesList = selectedMeasures.map((id, i) => {
      const meta = MEASURE_METAS[id];
      const data = seriesCollection[id];
      const isHidden = hiddenMeasures.has(id);

      return {
        id: `compare-lane-${id}`,
        name: meta.name,
        type: "line" as const,
        xAxisIndex: i,
        yAxisIndex: i,
        smooth: meta.temporalResolution === "windowed" ? 0.2 : false,
        showSymbol: false,
        connectNulls: false,
        data: isHidden ? [] : data.rawPoints,
        lineStyle: { color: meta.color, width: 1.8 },
        markLine: playheadMarkLine,
      };
    });

    return {
      animation: false,
      backgroundColor: "transparent",
      axisPointer: {
        link: [{ xAxisIndex: "all" }],
        type: "line",
        lineStyle: { color: "rgba(211, 186, 124, 0.55)", width: 1, type: "dashed" },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#161b1e",
        borderColor: "#2e3a42",
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: "#e3dfd3", fontSize: 11 },
        formatter: tooltipFormatter,
      },
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      series: seriesList,
    };
  }, [
    containerSize.height,
    currentTime,
    effectiveVisibleEnd,
    effectiveVisibleStart,
    gridBottom,
    gridLeft,
    gridRight,
    gridTop,
    hiddenMeasures,
    pacingWindow,
    playheadMarkLine,
    project,
    selectedMeasures,
    seriesCollection,
    viewMode,
  ]);

  // Pointer interactions: drag to select, drag handle to resize, click to seek
  const [draftRange, setDraftRange] = useState<{ start: number; end: number } | null>(null);
  const draftRangeRef = useRef<{ start: number; end: number } | null>(null);
  const pointerDownRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    mode: "none" | "in" | "out" | "select";
    originalRange?: { start: number; end: number };
  }>({
    startX: 0,
    startY: 0,
    startTime: 0,
    mode: "none",
  });

  const activeRange = draftRange || (range && range.start !== undefined && range.end !== undefined && range.end > range.start ? { start: range.start, end: range.end } : null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const t = pxToTime(x);

    pointerDownRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTime: t,
      mode: "select",
      originalRange: activeRange ? { ...activeRange } : undefined,
    };
    draftRangeRef.current = null;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  const handleHandleDown = (e: React.PointerEvent, handle: "in" | "out") => {
    e.stopPropagation();
    if (e.button !== 0 || !activeRange) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const t = pxToTime(x);

    pointerDownRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTime: t,
      mode: handle,
      originalRange: { ...activeRange },
    };
    draftRangeRef.current = { ...activeRange };

    if (containerRef.current) {
      try {
        containerRef.current.setPointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const down = pointerDownRef.current;
    if (down.mode === "none") return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const currentT = pxToTime(x);
    const dx = Math.abs(e.clientX - down.startX);

    if (down.mode === "in" && down.originalRange) {
      const newIn = Math.min(down.originalRange.end - (1 / frameRate), Math.max(scopeStart, currentT));
      const next = { start: newIn, end: down.originalRange.end };
      draftRangeRef.current = next;
      setDraftRange(next);
    } else if (down.mode === "out" && down.originalRange) {
      const newOut = Math.max(down.originalRange.start + (1 / frameRate), Math.min(effectiveScopeEnd, currentT));
      const next = { start: down.originalRange.start, end: newOut };
      draftRangeRef.current = next;
      setDraftRange(next);
    } else if (down.mode === "select") {
      if (dx > 4) {
        const start = Math.min(down.startTime, currentT);
        const end = Math.max(down.startTime, currentT);
        const next = { start, end };
        draftRangeRef.current = next;
        setDraftRange(next);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const down = pointerDownRef.current;
    if (down.mode === "none") return;
    const dx = Math.abs(e.clientX - down.startX);
    const rect = containerRef.current?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : 0;
    const currentT = pxToTime(x);

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    const resolvedDraft = draftRangeRef.current || (dx > 4 ? {
      start: Math.min(down.startTime, currentT),
      end: Math.max(down.startTime, currentT),
    } : null);

    if (down.mode === "in" || down.mode === "out") {
      if (resolvedDraft && onRangeChange) {
        onRangeChange({ start: resolvedDraft.start, end: resolvedDraft.end });
      }
    } else if (down.mode === "select") {
      if (dx > 4 && resolvedDraft && resolvedDraft.end - resolvedDraft.start >= 1 / frameRate) {
        onRangeChange?.({ start: resolvedDraft.start, end: resolvedDraft.end });
      } else if (dx <= 4) {
        // Plain click -> seek!
        onSeek(down.startTime);
      }
    }

    pointerDownRef.current = { startX: 0, startY: 0, startTime: 0, mode: "none" };
    draftRangeRef.current = null;
    setDraftRange(null);
  };

  // Wheel handling: shift+wheel or horizontal trackpad wheel pans viewport
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!onPan) return;
    const delta = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (Math.abs(delta) > 2) {
      e.preventDefault();
      const visibleDuration = effectiveVisibleEnd - effectiveVisibleStart;
      const secPerPixel = visibleDuration / gridWidth;
      onPan(delta * secPerPixel);
    }
  };

  // Range visual coordinates
  const rangeInPx = activeRange ? timeToPx(activeRange.start) : null;
  const rangeOutPx = activeRange ? timeToPx(activeRange.end) : null;

  return (
    <div
      ref={containerRef}
      className="comparison-chart-wrapper"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      style={{ position: "relative", userSelect: "none" }}
    >
      <EChart
        className={`comparison-echart mode-${viewMode} lanes-${selectedMeasures.length}`}
        option={option}
        label={`Analytical comparison graph: ${selectedMeasures.map((m) => MEASURE_METAS[m].name).join(", ")}`}
        currentTime={currentTime}
        duration={duration}
        notMerge={true}
      />

      {/* Range Selection Box and Brackets Overlay */}
      {activeRange && rangeInPx !== null && rangeOutPx !== null && (
        <svg
          className="comparison-range-svg-overlay"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        >
          {/* Translucent selection fill */}
          {rangeOutPx > rangeInPx && (
            <rect
              x={Math.max(gridLeft, rangeInPx)}
              y={gridTop}
              width={Math.max(1, Math.min(gridLeft + gridWidth, rangeOutPx) - Math.max(gridLeft, rangeInPx))}
              height={gridHeight}
              fill="rgba(211, 186, 124, 0.18)"
              pointerEvents="none"
            />
          )}

          {/* In bracket handle [ */}
          {rangeInPx >= gridLeft - 4 && rangeInPx <= gridLeft + gridWidth + 4 && (
            <g className="range-handle-in" pointerEvents="auto" onPointerDown={(e) => handleHandleDown(e, "in")}>
              {/* Bracket line */}
              <path
                d={`M ${rangeInPx + 5} ${gridTop} L ${rangeInPx} ${gridTop} L ${rangeInPx} ${gridTop + gridHeight} L ${rangeInPx + 5} ${gridTop + gridHeight}`}
                stroke="#d3ba7c"
                strokeWidth="2"
                fill="none"
              />
              {/* Invisible wide hit target for easy drag */}
              <rect
                x={rangeInPx - 7}
                y={gridTop}
                width={14}
                height={gridHeight}
                fill="transparent"
                style={{ cursor: "ew-resize" }}
              />
            </g>
          )}

          {/* Out bracket handle ] */}
          {rangeOutPx >= gridLeft - 4 && rangeOutPx <= gridLeft + gridWidth + 4 && (
            <g className="range-handle-out" pointerEvents="auto" onPointerDown={(e) => handleHandleDown(e, "out")}>
              {/* Bracket line */}
              <path
                d={`M ${rangeOutPx - 5} ${gridTop} L ${rangeOutPx} ${gridTop} L ${rangeOutPx} ${gridTop + gridHeight} L ${rangeOutPx - 5} ${gridTop + gridHeight}`}
                stroke="#d3ba7c"
                strokeWidth="2"
                fill="none"
              />
              {/* Invisible wide hit target for easy drag */}
              <rect
                x={rangeOutPx - 7}
                y={gridTop}
                width={14}
                height={gridHeight}
                fill="transparent"
                style={{ cursor: "ew-resize" }}
              />
            </g>
          )}
        </svg>
      )}
    </div>
  );
});

export default ComparisonChart;
