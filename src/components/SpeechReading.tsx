import { useMemo } from "react";
import type { Project, Shot, SpeechAnalysis } from "../models/project";
import { classifyCut, pauseRegions, projectSelectionRange, speechSummary, type TimeRange } from "../analysis/speech";
import { formatTimecode } from "../utils/timecode";

export default function SpeechReading({ project, analysis, range, selectedShot, isScanning, status, onScan, onCancel, onRetry, onSeek, onToggleOverlay, showOverlay }: {
  project: Project; analysis?: SpeechAnalysis; range?: TimeRange; selectedShot?: Shot; isScanning: boolean; status: string;
  onScan: () => void; onCancel: () => void; onRetry: () => void; onSeek: (time: number) => void; onToggleOverlay: () => void; showOverlay: boolean;
}) {
  const selection = range ?? (selectedShot ? { start: selectedShot.startSeconds, end: selectedShot.endSeconds } : projectSelectionRange(project));
  const pauses = useMemo(() => analysis ? pauseRegions(analysis.regions) : [], [analysis]);
  const summary = useMemo(() => analysis ? speechSummary(analysis.regions, selection) : undefined, [analysis, selection.start, selection.end]);
  const cuts = useMemo(() => analysis ? project.shots.slice(1).map((shot) => ({ time: shot.startSeconds, kind: classifyCut(shot.startSeconds, analysis.regions) })) : [], [analysis, project.shots]);
  const tc = (time: number) => formatTimecode(time, project.frameRate, project.dropFrame);
  return <section className="speech-reading panel">
    <div className="section-head"><div><span className="eyebrow">SPEECH & PAUSES</span><span className="muted">Voice activity estimate only. “No speech detected” may still contain music, ambience, or effects.</span></div>
      {analysis && <label className="speech-toggle"><input type="checkbox" checked={showOverlay} onChange={onToggleOverlay} /> Show map overlay</label>}
    </div>
    {!analysis && !isScanning && <div className="speech-empty"><p>Detect where speech occurs and the gaps between detected regions. This does not transcribe or judge dialogue.</p><button className="primary" onClick={onScan} disabled={!project.videoMetadata}>Scan speech & pauses</button>{!project.videoMetadata && <small>Connect the original video first.</small>}</div>}
    {isScanning && <div className="speech-running"><span className="dme-spinner" /><span>{status || "Starting local speech analysis…"}</span><button onClick={onCancel}>Cancel</button></div>}
    {analysis && !isScanning && summary && <>
      <div className="speech-summary"><span><b>{summary.speechPercent.toFixed(1)}%</b> speech</span><span><b>{summary.speechDuration.toFixed(2)}s</b> detected speech</span><span><b>{summary.pauseCount}</b> pauses · {summary.pauseDuration.toFixed(2)}s</span></div>
      <p className="speech-selection">{range ? "Selected range" : selectedShot ? `Shot ${selectedShot.index}` : "Whole film"}: {tc(selection.start)} — {tc(selection.end)}</p>
      {analysis.regions.length ? <div className="speech-evidence"><b>Detected regions</b><div>{analysis.regions.slice(0, 12).map((region, index) => <button key={`${region.startSeconds}-${index}`} onClick={() => onSeek(region.startSeconds)}>Speech · {tc(region.startSeconds)} — {tc(region.endSeconds)}</button>)}{analysis.regions.length > 12 && <span>+{analysis.regions.length - 12} more on the map</span>}</div></div> : <p className="speech-no-result">No speech detected. This is not a claim that the soundtrack is silent.</p>}
      <div className="speech-cut-summary"><b>Picture cuts</b><span>{cuts.filter((cut) => cut.kind === "during speech").length} during speech</span><span>{cuts.filter((cut) => cut.kind === "during a pause").length} during pauses</span><span>{cuts.filter((cut) => cut.kind === "other non-speech region").length} other non-speech</span></div>
      <div className="speech-provenance">Silero VAD {analysis.modelVersion} · local 16 kHz ONNX · {analysis.processingSeconds.toFixed(1)}s processing for {analysis.duration.toFixed(1)}s media ({(analysis.processingSeconds / analysis.duration).toFixed(3)}× real time)</div>
      <button onClick={onRetry}>Re-scan speech & pauses</button>
    </>}
  </section>;
}
