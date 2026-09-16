import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import type { Project } from "../../models/project";
import EChart from "./EChart";

type Cell = [number, number, string, string];

export default function ReviewEvidenceMatrix({ project, currentTime, onSeek }: { project: Project; currentTime: number; onSeek: (time: number) => void }) {
  const duration = Math.max(project.duration, 1);
  const option = useMemo<EChartsOption>(() => {
    const rows = ["Review", "Framing", "Motion", "Speech activity"];
    const cells: Cell[] = [];
    const hasSpeech = Boolean(project.speechAnalysis);
    for (const shot of project.shots) {
      const time = (shot.startSeconds + shot.endSeconds) / 2;
      const review = shot.reviewStatus === "Confirmed" ? ["#d3ba7c", "Confirmed"] : shot.analysisFailures?.framing || shot.characterAnalysis?.failedTimes?.length ? ["#e88078", "Scan failure"] : shot.uncertain ? ["#b98be3", "Needs review"] : ["#63727a", "Unreviewed"];
      cells.push([time, 0, review[0], review[1]]);
      cells.push([time, 1, shot.shotSize !== "Unknown" ? "#91b7c4" : "#344047", shot.shotSize !== "Unknown" ? "Framing tagged" : "Framing untagged"]);
      cells.push([time, 2, shot.motionProfile ? "#b98be3" : "#344047", shot.motionProfile ? "Motion measured" : "Motion unscanned"]);
      const speechDetected = project.speechAnalysis?.regions.some((region) => region.endSeconds > shot.startSeconds && region.startSeconds < shot.endSeconds);
      cells.push([time, 3, !hasSpeech ? "#344047" : speechDetected ? "#38bdf8" : "#20282d", !hasSpeech ? "Speech scan unavailable" : speechDetected ? "Speech activity detected" : "No detected speech region"]);
    }
    return {
      animation: false,
      backgroundColor: "transparent",
      grid: { left: 84, right: 12, top: 10, bottom: 22 },
      tooltip: { backgroundColor: "#111619", borderColor: "#3a444a", textStyle: { color: "#e3dfd3", fontSize: 11 }, formatter: (params: unknown) => {
        const data = (params as { data?: Cell }).data;
        return data ? `${rows[data[1]]}<br/><b>${data[3]}</b>` : "";
      } },
      xAxis: { type: "value", min: 0, max: duration, axisLine: { lineStyle: { color: "#344047" } }, axisLabel: { color: "#87939a", fontSize: 9, formatter: (value: number) => `${Math.round(value)}s` }, splitLine: { show: false } },
      yAxis: { type: "category", data: rows, inverse: true, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: "#aeb7bc", fontSize: 10 }, splitArea: { show: true, areaStyle: { color: ["#ffffff03", "transparent"] } } },
      visualMap: { show: false },
      series: [{ type: "custom", renderItem: (params: any, api: any) => {
        const point = api.coord([Number(api.value(0)), Number(api.value(1))]);
        const size = api.size([Math.max(duration / Math.max(project.shots.length, 1), 0.3), 1]);
        return { type: "rect", shape: { x: point[0] - Math.max(2, size[0] * 0.42), y: point[1] - Math.max(2, size[1] * 0.28), width: Math.max(4, size[0] * 0.84), height: Math.max(4, size[1] * 0.56), r: 1 }, style: { fill: String(api.value(2)) } };
      }, data: cells, encode: { x: 0, y: 1 }, markLine: { silent: true, symbol: "none", lineStyle: { color: "#d3ba7c", width: 1.2 }, data: [{ xAxis: currentTime }] } }],
    } as EChartsOption;
  }, [currentTime, duration, project.speechAnalysis, project.shots]);
  if (!project.shots.length) return null;
  return <EChart className="review-evidence-echart" option={option} label="Review evidence matrix" currentTime={currentTime} duration={duration} onSeek={onSeek} />;
}
