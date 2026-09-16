import { useState } from "react";
import { sequenceReading } from "../analysis/pacing";
import type { Project, SequenceMarker } from "../models/project";
import { formatTimecode } from "../utils/timecode";

export type TimeRange = { start: number; end: number };

export default function SequenceReading({
  project,
  range,
  onRangeChange,
  onSeek,
  onUpdate,
  onClose,
  variant = "deck",
}: {
  project: Project;
  range?: TimeRange;
  onRangeChange: (range?: TimeRange) => void;
  onSeek: (time: number) => void;
  onUpdate: (sequences: SequenceMarker[]) => void;
  onClose?: () => void;
  variant?: "deck" | "drawer";
}) {
  const [name, setName] = useState("");
  const reading = range && sequenceReading(project.shots, range.start, range.end);

  const addScene = () => {
    if (!range) return;
    const newSeqName = name.trim() || `Sequence ${(project.sequences?.length ?? 0) + 1}`;
    onUpdate([
      ...(project.sequences ?? []),
      {
        id: crypto.randomUUID(),
        name: newSeqName,
        startSeconds: range.start,
        endSeconds: range.end,
      },
    ]);
    setName("");
  };

  if (variant === "drawer") {
    return (
      <section className="sequence-drawer panel" aria-label="Sequence reading drawer">
        {/* 1. Header */}
        <div className="sequence-drawer-head">
          <div className="sequence-drawer-title-group">
            <h2 className="sequence-drawer-title">SEQUENCE READING</h2>
            <p className="sequence-drawer-subtitle">Evidence first; interpretation stays yours.</p>
          </div>
          {onClose && (
            <button
              type="button"
              className="studio-drawer-close-btn sequence-drawer-close-btn"
              onClick={onClose}
              title="Close sequence reading drawer (Esc)"
              aria-label="Close sequence reading drawer"
            >
              ✕
            </button>
          )}
        </div>

        <div className="sequence-drawer-content">
          {!range || !reading ? (
            /* Empty State */
            <div className="sequence-empty-box">
              <p className="sequence-empty-msg">
                Shift-drag on the editing map to select a passage. Its shot, cut, framing, and rhythm evidence will appear here.
              </p>
            </div>
          ) : (
            <>
              {/* 2. Selected Range Row */}
              <div className="sequence-drawer-section">
                <div className="sequence-section-eyebrow">Selected range</div>
                <div className="sequence-selected-range-row">
                  <button
                    type="button"
                    className="sequence-tc-pill"
                    onClick={() => onSeek(range.start)}
                    title={`Seek to ${formatTimecode(range.start, project.frameRate, project.dropFrame)}`}
                  >
                    {formatTimecode(range.start, project.frameRate, project.dropFrame)}
                  </button>
                  <span className="sequence-range-arrow">→</span>
                  <button
                    type="button"
                    className="sequence-tc-pill"
                    onClick={() => onSeek(range.end)}
                    title={`Seek to ${formatTimecode(range.end, project.frameRate, project.dropFrame)}`}
                  >
                    {formatTimecode(range.end, project.frameRate, project.dropFrame)}
                  </button>
                  <span className="sequence-range-duration">
                    {reading.duration.toFixed(1)} sec
                  </span>
                </div>
              </div>

              {/* 3. Metrics 4-column card */}
              <div className="sequence-metrics-grid">
                <div className="sequence-metric-col">
                  <span className="sequence-metric-val">{reading.shots.length}</span>
                  <span className="sequence-metric-lbl">shots</span>
                </div>
                <div className="sequence-metric-col">
                  <span className="sequence-metric-val">{reading.cuts}</span>
                  <span className="sequence-metric-lbl">hard cuts</span>
                </div>
                <div className="sequence-metric-col">
                  <span className="sequence-metric-val">{reading.median.toFixed(1)}s</span>
                  <span className="sequence-metric-lbl">median</span>
                </div>
                <div className="sequence-metric-col">
                  <span className="sequence-metric-val">{reading.variation.toFixed(1)}s</span>
                  <span className="sequence-metric-lbl">duration variation</span>
                </div>
              </div>

              {/* 4. Across Cuts */}
              <div className="sequence-detail-block">
                <div className="sequence-detail-label">Across cuts</div>
                <div className="sequence-detail-value">
                  {`${reading.framingChanges.tighter} tighter · ${reading.framingChanges.wider} wider · ${reading.framingChanges.unchanged} unchanged${reading.framingChanges.unknown ? ` · ${reading.framingChanges.unknown} unclassified` : ""}`}
                </div>
              </div>

              {/* 5. Rhythm */}
              <div className="sequence-detail-block">
                <div className="sequence-detail-label">Rhythm</div>
                <div className="sequence-detail-value">
                  {reading.acceleratingRuns
                    ? `${reading.acceleratingRuns} run${reading.acceleratingRuns === 1 ? "" : "s"} of three shortening shots`
                    : "No three-shot shortening run"}
                </div>
              </div>

              {/* 6. Name this span + Save span */}
              <div className="sequence-save-box">
                <input
                  type="text"
                  className="sequence-name-input"
                  placeholder="Name this span (e.g. Confrontation)"
                  aria-label="Sequence name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addScene();
                    }
                  }}
                />
                <button
                  type="button"
                  className="sequence-save-btn"
                  onClick={addScene}
                >
                  Save span
                </button>
              </div>
            </>
          )}

          {/* 7. Named Spans List */}
          {!!project.sequences?.length && (
            <div className="sequence-named-spans-wrap">
              <div className="sequence-detail-label">Named spans</div>
              <div className="sequence-spans-list">
                {project.sequences.map((scene) => {
                  const isActive =
                    range &&
                    Math.abs(scene.startSeconds - range.start) < 0.05 &&
                    Math.abs(scene.endSeconds - range.end) < 0.05;
                  return (
                    <div
                      key={scene.id}
                      className={`sequence-span-row ${isActive ? "active" : ""}`}
                      onClick={() =>
                        onRangeChange({
                          start: scene.startSeconds,
                          end: scene.endSeconds,
                        })
                      }
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRangeChange({
                            start: scene.startSeconds,
                            end: scene.endSeconds,
                          });
                        }
                      }}
                    >
                      <span className="sequence-span-name">{scene.name}</span>
                      <span className="sequence-span-tc">
                        {formatTimecode(scene.startSeconds, project.frameRate, project.dropFrame)} — {formatTimecode(scene.endSeconds, project.frameRate, project.dropFrame)}
                      </span>
                      <button
                        type="button"
                        className="sequence-span-action-btn"
                        aria-label={`Delete ${scene.name}`}
                        title={`Delete ${scene.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdate(project.sequences!.filter((item) => item.id !== scene.id));
                        }}
                      >
                        ⋮
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 8. Clear Selection Action */}
          {range && (
            <div className="sequence-clear-wrap">
              <button
                type="button"
                className="sequence-clear-btn"
                onClick={() => onRangeChange(undefined)}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                <span>Clear selection</span>
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  // Default: variant === "deck" for Map Focus / Review Desk
  return (
    <section className="sequence-reading panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">SEQUENCE READING</span>
          <span className="muted">Evidence first; interpretation stays yours.</span>
        </div>
        <div className="btn-row">
          {range && <button onClick={() => { onRangeChange(undefined); onClose?.(); }}>Clear selection</button>}
          {onClose && <button type="button" className="drawer-close-btn" onClick={onClose} title="Close reading">✕</button>}
        </div>
      </div>
      {!range ? (
        <p className="sequence-empty">Shift-drag on the editing map to select a passage. Its shot, cut, framing, and rhythm evidence will appear here.</p>
      ) : (
        <>
          <div className="sequence-range">
            <button onClick={() => onSeek(range.start)}>{formatTimecode(range.start, project.frameRate, project.dropFrame)}</button>
            <span>to</span>
            <button onClick={() => onSeek(range.end)}>{formatTimecode(range.end, project.frameRate, project.dropFrame)}</button>
            <span className="muted">{reading!.duration.toFixed(2)} sec</span>
          </div>
          <div className="sequence-stats">
            <span><b>{reading!.shots.length}</b> shots</span>
            <span><b>{reading!.cuts}</b> hard cuts</span>
            <span><b>{reading!.median.toFixed(2)}s</b> median</span>
            <span><b>{reading!.variation.toFixed(2)}s</b> duration variation</span>
          </div>
          <div className="sequence-evidence">
            <div>
              <b>Across cuts</b>
              <span>{reading!.framingChanges.tighter} tighter · {reading!.framingChanges.wider} wider · {reading!.framingChanges.unchanged} unchanged{reading!.framingChanges.unknown ? ` · ${reading!.framingChanges.unknown} unclassified` : ""}</span>
            </div>
            <div>
              <b>Rhythm</b>
              <span>{reading!.acceleratingRuns ? `${reading!.acceleratingRuns} run${reading!.acceleratingRuns === 1 ? "" : "s"} of three shortening shots` : "No three-shot shortening run"}</span>
            </div>
          </div>
          <div className="scene-save">
            <input aria-label="Sequence name" placeholder="Name this span (e.g. Confrontation)" value={name} onChange={(event) => setName(event.target.value)} />
            <button onClick={addScene}>Save span</button>
          </div>
        </>
      )}
      {!!project.sequences?.length && (
        <div className="scene-list">
          <b>Named spans</b>
          {project.sequences.map((scene) => (
            <div key={scene.id}>
              <button onClick={() => onRangeChange({ start: scene.startSeconds, end: scene.endSeconds })}>{scene.name}</button>
              <span>{formatTimecode(scene.startSeconds, project.frameRate, project.dropFrame)} — {formatTimecode(scene.endSeconds, project.frameRate, project.dropFrame)}</span>
              <button aria-label={`Delete ${scene.name}`} onClick={() => onUpdate(project.sequences!.filter((item) => item.id !== scene.id))}>×</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
