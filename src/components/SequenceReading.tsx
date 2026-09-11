import { useState } from "react";
import { sequenceReading } from "../analysis/pacing";
import type { Project, SequenceMarker } from "../models/project";
import { formatTimecode } from "../utils/timecode";

export type TimeRange = { start: number; end: number };

export default function SequenceReading({ project, range, onRangeChange, onSeek, onUpdate }: {
  project: Project;
  range?: TimeRange;
  onRangeChange: (range?: TimeRange) => void;
  onSeek: (time: number) => void;
  onUpdate: (sequences: SequenceMarker[]) => void;
}) {
  const [name, setName] = useState("");
  const reading = range && sequenceReading(project.shots, range.start, range.end);
  const addScene = () => {
    if (!range) return;
    onUpdate([...(project.sequences ?? []), { id: crypto.randomUUID(), name: name.trim() || `Sequence ${(project.sequences?.length ?? 0) + 1}`, startSeconds: range.start, endSeconds: range.end }]);
    setName("");
  };
  return <section className="sequence-reading panel">
    <div className="section-head"><div><span className="eyebrow">SEQUENCE READING</span><span className="muted">Evidence first; interpretation stays yours.</span></div>{range && <button onClick={() => onRangeChange(undefined)}>Clear selection</button>}</div>
    {!range ? <p className="sequence-empty">Shift-drag on the editing map to select a passage. Its shot, cut, framing, and rhythm evidence will appear here.</p> : <>
      <div className="sequence-range"><button onClick={() => onSeek(range.start)}>{formatTimecode(range.start, project.frameRate, project.dropFrame)}</button><span>to</span><button onClick={() => onSeek(range.end)}>{formatTimecode(range.end, project.frameRate, project.dropFrame)}</button><span className="muted">{reading!.duration.toFixed(2)} sec</span></div>
      <div className="sequence-stats">
        <span><b>{reading!.shots.length}</b> shots</span><span><b>{reading!.cuts}</b> hard cuts</span><span><b>{reading!.median.toFixed(2)}s</b> median</span><span><b>{reading!.variation.toFixed(2)}s</b> duration variation</span>
      </div>
      <div className="sequence-evidence">
        <div><b>Across cuts</b><span>{reading!.framingChanges.tighter} tighter · {reading!.framingChanges.wider} wider · {reading!.framingChanges.unchanged} unchanged{reading!.framingChanges.unknown ? ` · ${reading!.framingChanges.unknown} unclassified` : ""}</span></div>
        <div><b>Rhythm</b><span>{reading!.acceleratingRuns ? `${reading!.acceleratingRuns} run${reading!.acceleratingRuns === 1 ? "" : "s"} of three shortening shots` : "No three-shot shortening run"}</span></div>
      </div>
      <div className="scene-save"><input aria-label="Sequence name" placeholder="Name this span (e.g. Confrontation)" value={name} onChange={(event) => setName(event.target.value)} /><button onClick={addScene}>Save span</button></div>
    </>}
    {!!project.sequences?.length && <div className="scene-list"><b>Named spans</b>{project.sequences.map((scene) => <div key={scene.id}><button onClick={() => onRangeChange({ start: scene.startSeconds, end: scene.endSeconds })}>{scene.name}</button><span>{formatTimecode(scene.startSeconds, project.frameRate, project.dropFrame)} — {formatTimecode(scene.endSeconds, project.frameRate, project.dropFrame)}</span><button aria-label={`Delete ${scene.name}`} onClick={() => onUpdate(project.sequences!.filter((item) => item.id !== scene.id))}>×</button></div>)}</div>}
  </section>;
}
