import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import EChart from "./EChart";
import { cutTimes, pacingCurve } from "../../analysis/pacing";
import { audioIntensityCurve } from "../../analysis/audio";
import type { Project } from "../../models/project";
import { formatTimecode } from "../../utils/timecode";

export default function MapRhythmOverview({ project, waveform, currentTime, onSeek }: { project: Project; waveform: number[]; currentTime: number; onSeek: (time: number) => void }) {
  const duration = Math.max(project.duration, 1);
  const { pacing, audio } = useMemo(() => ({
    pacing: pacingCurve(cutTimes(project.shots), project.duration, 30),
    audio: audioIntensityCurve(waveform, project.duration, 30),
  }), [project.duration, project.shots, waveform]);
  const option = useMemo<EChartsOption>(() => ({
    animation: false,
    backgroundColor: "transparent",
    grid: { left: 38, right: 38, top: 18, bottom: 30 },
    legend: { top: 0, right: 0, textStyle: { color: "#aeb7bc", fontSize: 10 }, itemWidth: 10, itemHeight: 3 },
    tooltip: { trigger: "axis", backgroundColor: "#111619", borderColor: "#3a444a", textStyle: { color: "#e3dfd3", fontSize: 11 }, axisPointer: { type: "line", lineStyle: { color: "#d3ba7c" } } },
    xAxis: { type: "value", min: 0, max: duration, axisLine: { lineStyle: { color: "#344047" } }, axisLabel: { color: "#87939a", fontSize: 10, formatter: (value: number) => formatTimecode(value, project.frameRate, project.dropFrame) }, splitLine: { lineStyle: { color: "#ffffff10" } } },
    yAxis: [
      { type: "value", name: "cuts/min", min: 0, axisLabel: { color: "#91b7c4", fontSize: 10 }, nameTextStyle: { color: "#91b7c4", fontSize: 10 }, splitLine: { lineStyle: { color: "#ffffff10" } } },
      { type: "value", name: "audio", min: 0, max: 1, axisLabel: { color: "#4bd0df", fontSize: 10 }, nameTextStyle: { color: "#4bd0df", fontSize: 10 }, splitLine: { show: false } },
    ],
    dataZoom: [{ type: "inside", xAxisIndex: 0 }, { type: "slider", xAxisIndex: 0, height: 10, bottom: 2, borderColor: "#344047", backgroundColor: "#101416", fillerColor: "#d3ba7c22", handleStyle: { color: "#d3ba7c" }, textStyle: { color: "transparent" } }],
    series: [
      { name: "Cut density", type: "line", smooth: true, showSymbol: false, data: pacing.map((point) => [point.time, point.rate]), lineStyle: { color: "#91b7c4", width: 2 }, areaStyle: { color: "#91b7c41f" }, markLine: { silent: true, symbol: "none", lineStyle: { color: "#d3ba7c", width: 1.5 }, data: [{ xAxis: currentTime }] } },
      { name: "Audio intensity", type: "line", yAxisIndex: 1, smooth: true, showSymbol: false, data: audio.map((point) => [point.time, point.normalized]), lineStyle: { color: "#38bdf8", width: 1.6 }, areaStyle: { color: "#38bdf817" } },
    ],
  }), [audio, currentTime, duration, pacing, project.dropFrame, project.frameRate]);
  return <EChart className="map-rhythm-echart" option={option} label="Map Focus cut density and audio intensity overview" currentTime={currentTime} duration={duration} onSeek={onSeek} />;
}
