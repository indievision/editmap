import { useEffect, useState } from "react";
import { soundKinds, type Project, type SoundKind, type SoundSpan } from "../models/project";
import { formatTimecode } from "../utils/timecode";
import type { TimeRange } from "./SequenceReading";

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

export default function SoundReading({ project, range, onRangeChange, onPlay, onUpdate }: {
  project: Project;
  range?: TimeRange;
  onRangeChange: (range?: TimeRange) => void;
  onPlay: (range: TimeRange, loop: boolean) => void;
  onUpdate: (spans: SoundSpan[]) => void;
}) {
  const [kind, setKind] = useState<SoundKind>("Dialogue");
  const [notes, setNotes] = useState("");
  const [loop, setLoop] = useState(true);
  const [editing, setEditing] = useState<string>();
  const span = project.soundSpans?.find((item) => item.id === editing);
  useEffect(() => {
    if (!span) return;
    setKind(span.kind);
    setNotes(span.notes);
  }, [span?.id]);
  const save = () => {
    if (!range || range.end <= range.start) return;
    const next: SoundSpan = {
      id: span?.id ?? crypto.randomUUID(), kind,
      startSeconds: range.start, endSeconds: range.end, notes,
    };
    onUpdate([...(project.soundSpans ?? []).filter((item) => item.id !== next.id), next].sort((a, b) => a.startSeconds - b.startSeconds));
    setEditing(next.id);
    setNotes("");
  };
  const editTimes = (item: SoundSpan, patch: Partial<SoundSpan>) => {
    const next = { ...item, ...patch };
    if (next.endSeconds <= next.startSeconds) return;
    onUpdate((project.soundSpans ?? []).map((candidate) => candidate.id === item.id ? next : candidate));
    onRangeChange({ start: next.startSeconds, end: next.endSeconds });
  };
  return <section className="sound-reading panel">
    <div className="section-head"><div><span className="eyebrow">SOUND–IMAGE READING</span><span className="muted">Waveform is measured locally; categories are your annotations.</span></div><div>{editing && <button onClick={() => { setEditing(undefined); setNotes(""); }}>New sound span</button>}{range && <button onClick={() => onRangeChange(undefined)}>Clear passage</button>}</div></div>
    {!range ? <p className="sound-empty">Shift-drag a passage on the map, then listen for bridges, anticipation, synchronization, counterpoint, or pauses.</p> : <>
      <div className="sound-passage"><button onClick={() => onPlay(range, loop)} disabled={!project.videoMetadata}>Play passage</button><label><input aria-label="Loop selected passage" type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} /> Loop</label><span className="mono">{formatTimecode(range.start, project.frameRate, project.dropFrame)} — {formatTimecode(range.end, project.frameRate, project.dropFrame)} · {(range.end - range.start).toFixed(2)}s</span></div>
      <div className="sound-save"><label>Sound<span><select aria-label="Sound category" value={kind} onChange={(event) => setKind(event.target.value as SoundKind)}>{soundKinds.map((item) => <option key={item}>{item}</option>)}</select></span></label><label>Observation<textarea aria-label="Sound observation" placeholder="What continues, arrives early, lands with a cut, or leaves space?" value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button className="primary" onClick={save}>{span ? "Update span" : "Add sound span"}</button></div>
    </>}
    {!!project.soundSpans?.length && <div className="sound-list"><b>Sound spans</b>{project.soundSpans.map((item) => <div key={item.id} className={editing === item.id ? "selected" : ""}><button onClick={() => { setEditing(item.id); onRangeChange({ start: item.startSeconds, end: item.endSeconds }); }}>{item.kind}</button><label>In<input aria-label={`${item.kind} in`} type="number" min="0" max={project.duration} step="0.01" value={item.startSeconds} onChange={(event) => editTimes(item, { startSeconds: clamp(Number(event.target.value), project.duration) })} /></label><label>Out<input aria-label={`${item.kind} out`} type="number" min="0" max={project.duration} step="0.01" value={item.endSeconds} onChange={(event) => editTimes(item, { endSeconds: clamp(Number(event.target.value), project.duration) })} /></label><span>{item.notes || "No observation yet"}</span><button aria-label={`Delete ${item.kind} sound span`} onClick={() => { onUpdate(project.soundSpans!.filter((candidate) => candidate.id !== item.id)); if (editing === item.id) setEditing(undefined); }}>×</button></div>)}</div>}
  </section>;
}
