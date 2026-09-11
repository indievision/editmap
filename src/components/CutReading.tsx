import { useEffect, useState } from "react";
import { annotationFor, calculateCutVisualDelta, cutPairAt, durationChange, framingChange, type CutPair } from "../analysis/cuts";
import { cutInterpretations, type CutAnnotation, type Project } from "../models/project";
import { actualRate, formatTimecode } from "../utils/timecode";

type Frames = { outgoing?: string; incoming?: string; unavailable?: boolean };

function useBoundaryFrames(url: string, pair: CutPair | undefined, fps: number) {
  const [frames, setFrames] = useState<Frames>({});
  useEffect(() => {
    setFrames({});
    if (!url || !pair) return;
    const decoder = document.createElement("video");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    let cancelled = false;
    const wait = (event: string) => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Frame unavailable")), 8000);
      const done = () => { clearTimeout(timeout); resolve(); };
      decoder.addEventListener(event, done, { once: true });
      decoder.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Frame unavailable")); }, { once: true });
    });
    const capture = async (target: number) => {
      const sought = wait("seeked");
      decoder.currentTime = Math.max(0, Math.min(target, decoder.duration - 0.001));
      await sought;
      if (!context || cancelled) throw new Error("Frame unavailable");
      canvas.width = 320;
      canvas.height = 180;
      context.fillStyle = "#0a0c0d";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / decoder.videoWidth, canvas.height / decoder.videoHeight);
      const width = decoder.videoWidth * scale, height = decoder.videoHeight * scale;
      context.drawImage(decoder, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      return canvas.toDataURL("image/jpeg", 0.8);
    };
    void (async () => {
      try {
        decoder.muted = true;
        decoder.preload = "auto";
        const ready = wait("loadeddata");
        decoder.src = url;
        await ready;
        const frame = 1 / actualRate(fps);
        const outgoing = await capture(Math.max(pair.outgoing.startSeconds, pair.time - frame));
        const incoming = await capture(Math.min(pair.incoming.endSeconds - frame / 2, pair.time + frame));
        if (!cancelled) setFrames({ outgoing, incoming });
      } catch { if (!cancelled) setFrames({ unavailable: true }); }
    })();
    return () => { cancelled = true; decoder.removeAttribute("src"); decoder.load(); };
  }, [url, pair?.outgoing.id, pair?.incoming.id, pair?.time, fps]);
  return frames;
}

export default function CutReading({ project, incomingId, url, onSeek, onPlay, onUpdate }: {
  project: Project;
  incomingId?: string;
  url: string;
  onSeek: (time: number) => void;
  onPlay: (pair: CutPair, lead: number, follow: number, loop: boolean) => void;
  onUpdate: (annotations: CutAnnotation[]) => void;
}) {
  const pair = cutPairAt(project.shots, incomingId);
  const [lead, setLead] = useState(1);
  const [follow, setFollow] = useState(1);
  const [loop, setLoop] = useState(false);
  const frames = useBoundaryFrames(url, pair, project.frameRate);
  if (!pair) return <section className="cut-reading panel"><div className="section-head"><div><span className="eyebrow">CUT READING</span><span className="muted">Study what changes at an edit.</span></div></div><p className="cut-empty">Click a boundary between two contiguous shots on the editing map to compare the outgoing and incoming images.</p></section>;
  const framing = framingChange(pair), duration = durationChange(pair);
  const visualDelta = calculateCutVisualDelta(pair.outgoing, pair.incoming);
  const annotation = annotationFor(project.cutAnnotations, pair);
  const updateAnnotation = (patch: Partial<CutAnnotation>) => {
    const next = { ...annotation, ...patch };
    onUpdate([...(project.cutAnnotations ?? []).filter((item) => item.outgoingId !== pair.outgoing.id || item.incomingId !== pair.incoming.id), next]);
  };
  return <section className="cut-reading panel">
    <div className="section-head"><div><span className="eyebrow">CUT READING</span><span className="muted">Shot {String(pair.outgoing.index).padStart(3, "0")} → {String(pair.incoming.index).padStart(3, "0")}</span></div><button onClick={() => onSeek(pair.time)}>Go to cut</button></div>
    <div className="cut-frames">
      <figure><figcaption>OUTGOING · {formatTimecode(Math.max(pair.outgoing.startSeconds, pair.time - 1 / actualRate(project.frameRate)), project.frameRate, project.dropFrame)}</figcaption>{frames.outgoing ? <img src={frames.outgoing} alt={`Last frame of shot ${pair.outgoing.index}`} /> : <div className="cut-frame-empty">{frames.unavailable ? "Frame unavailable" : url ? "Sampling frame…" : "Relink video"}</div>}</figure>
      <figure><figcaption>INCOMING · {formatTimecode(Math.min(pair.incoming.endSeconds, pair.time + 1 / actualRate(project.frameRate)), project.frameRate, project.dropFrame)}</figcaption>{frames.incoming ? <img src={frames.incoming} alt={`First frame of shot ${pair.incoming.index}`} /> : <div className="cut-frame-empty">{frames.unavailable ? "Frame unavailable" : url ? "Sampling frame…" : "Relink video"}</div>}</figure>
    </div>
    <div className="cut-evidence">
      <div><span>Framing change</span><b>{framing.label}</b><small>{framing.detail}</small></div>
      <div><span>Duration change</span><b>{duration.label}</b><small>{duration.detail}</small></div>
      <div><span>Sensory Shock Index</span><b>{visualDelta.shockScore} / 100</b><small>ΔV = {visualDelta.deltaV.toFixed(2)} (ΔLuma: {visualDelta.deltaLuma.toFixed(2)}, ΔChroma: {visualDelta.deltaChroma.toFixed(2)})</small></div>
      <div><span>Transition</span><b>{pair.transition === "C" ? "Hard cut" : pair.transition}</b><small>{pair.transition === "C" ? "Boundary frames are one frame either side." : "Review the moving transition; boundary frames are reference samples."}</small></div>
    </div>
    <div className="cut-playback"><b>PLAY ACROSS THE CUT</b><label>Lead-in <input aria-label="Cut lead-in seconds" type="range" min="0.25" max="5" step="0.25" value={lead} onChange={(e) => setLead(Number(e.target.value))} /> {lead.toFixed(2)}s</label><label>Follow-through <input aria-label="Cut follow-through seconds" type="range" min="0.25" max="5" step="0.25" value={follow} onChange={(e) => setFollow(Number(e.target.value))} /> {follow.toFixed(2)}s</label><label className="cut-loop"><input aria-label="Loop across cut" type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop</label><button className="primary" disabled={!url} onClick={() => onPlay(pair, lead, follow, loop)}>Play cut</button></div>
    <div className="cut-interpretation"><label>YOUR INTERPRETATION<select aria-label="Cut interpretation" value={annotation.interpretation} onChange={(e) => updateAnnotation({ interpretation: e.target.value as CutAnnotation["interpretation"] })}>{cutInterpretations.map((item) => <option key={item}>{item}</option>)}</select></label><label>Note<textarea aria-label="Cut note" placeholder="What new information arrives? Why cut here?" value={annotation.notes} onChange={(e) => updateAnnotation({ notes: e.target.value })} /></label></div>
  </section>;
}
