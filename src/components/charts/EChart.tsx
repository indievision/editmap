import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { LineChart, CustomChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  CanvasRenderer,
  LineChart,
  CustomChart,
  AxisPointerComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
]);

export default function EChart({
  option,
  className = "",
  label,
  currentTime,
  duration,
  onSeek,
}: {
  option: EChartsOption;
  className?: string;
  label: string;
  currentTime?: number;
  duration?: number;
  onSeek?: (time: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const instance = echarts.init(element, undefined, { renderer: "canvas" });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);

    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    // Merge incremental playhead updates so a user's data-zoom selection stays put.
    chart.current?.setOption(option, { notMerge: false, lazyUpdate: true });
  }, [option]);

  const step = Math.max(1, Math.round((duration ?? 60) / 120));
  const seekFromPointer = (clientX: number, clientY: number, element: HTMLDivElement) => {
    if (!onSeek || !chart.current) return;
    const rect = element.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let chartTime = NaN;

    // Check grids first if cursor falls within one of them
    for (let i = 0; i < 3; i++) {
      try {
        if (chart.current.containPixel({ gridIndex: i }, [x, y])) {
          const pt = chart.current.convertFromPixel({ gridIndex: i }, [x, y]);
          if (Array.isArray(pt) && Number.isFinite(pt[0])) {
            chartTime = Number(pt[0]);
            break;
          }
        }
      } catch {
        // ignore
      }
    }

    // Fallback: try converting via xAxisIndex
    if (!Number.isFinite(chartTime)) {
      for (let i = 0; i < 3; i++) {
        try {
          const pt = chart.current.convertFromPixel({ xAxisIndex: i }, [x, y]);
          if (Array.isArray(pt) && Number.isFinite(pt[0])) {
            chartTime = Number(pt[0]);
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    // A data-zoom slider or an uninitialized grid can reject pixel conversion.
    // The host ratio remains a safe, deterministic seek fallback in that case.
    const fallback = (x / Math.max(rect.width, 1)) * (duration ?? 0);
    const candidate = Number.isFinite(chartTime) && chartTime >= 0 ? chartTime : fallback;
    if (Number.isFinite(candidate)) onSeek(Math.max(0, Math.min(duration ?? candidate, candidate)));
  };
  return (
    <div
      ref={host}
      className={`e-chart ${className}`}
      role={onSeek ? "slider" : "img"}
      tabIndex={onSeek ? 0 : undefined}
      aria-label={label}
      aria-valuemin={onSeek ? 0 : undefined}
      aria-valuemax={onSeek ? duration : undefined}
      aria-valuenow={onSeek ? currentTime : undefined}
      onClickCapture={(event) => seekFromPointer(event.clientX, event.clientY, event.currentTarget)}
      onKeyDown={(event) => {
        if (!onSeek || currentTime === undefined) return;
        let next = currentTime;
        if (event.key === "ArrowRight") next += step;
        else if (event.key === "ArrowLeft") next -= step;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = duration ?? currentTime;
        else return;
        event.preventDefault();
        onSeek(Math.max(0, Math.min(duration ?? next, next)));
      }}
    />
  );
}
