import { useMemo } from "react";
import type { Project, ScreeningMark, SpeechAnalysis } from "../models/project";
import { screeningEvidence } from "../analysis/screening";
import { formatTimecode } from "../utils/timecode";

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function generateEdlMarkers(project: Project): string {
  const marks = project.screeningMarks ?? [];
  const lines: string[] = [
    `TITLE: ${project.name || "EDITMAP_SCREENING_MARKERS"}`,
    `FCM: ${project.dropFrame ? "DROP FRAME" : "NON-DROP FRAME"}`,
    "",
  ];
  marks.forEach((m, i) => {
    const num = String(i + 1).padStart(3, "0");
    const inTc = formatTimecode(
      m.anchorTime,
      project.frameRate,
      project.dropFrame,
    );
    const outTc = formatTimecode(
      m.anchorTime + 1 / project.frameRate,
      project.frameRate,
      project.dropFrame,
    );
    const incoming = m.incomingId
      ? project.shots.find((s) => s.id === m.incomingId)
      : undefined;
    const outgoing = m.outgoingId
      ? project.shots.find((s) => s.id === m.outgoingId)
      : undefined;
    const label =
      incoming && outgoing
        ? `Shot ${outgoing.index} -> ${incoming.index}`
        : `Reaction ${inTc}`;
    lines.push(
      `${num}  AX       V     C        ${inTc} ${outTc} ${inTc} ${outTc}`,
    );
    lines.push(
      `* FROM CLIP NAME: ${project.videoMetadata?.filename || "Screening"}`,
    );
    lines.push(`* MARKER NAME: ${label}`);
    const notes = [
      m.notes,
      m.trimFrames ? `Trim tail: ${m.trimFrames}f` : "",
      m.audioLeadFrames ? `J-cut lead: ${m.audioLeadFrames}f` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    lines.push(`* COMMENT: ${notes || "Screening mark"}`);
    lines.push("");
  });
  return lines.join("\n");
}

function generateCsvMarkers(project: Project): string {
  const marks = project.screeningMarks ?? [];
  const rows: string[] = [
    `"Timecode In","Timecode Out","Marker Name","Comment","Color"`,
  ];
  marks.forEach((m, i) => {
    const inTc = formatTimecode(
      m.anchorTime,
      project.frameRate,
      project.dropFrame,
    );
    const outTc = formatTimecode(
      m.anchorTime + 1 / project.frameRate,
      project.frameRate,
      project.dropFrame,
    );
    const incoming = m.incomingId
      ? project.shots.find((s) => s.id === m.incomingId)
      : undefined;
    const outgoing = m.outgoingId
      ? project.shots.find((s) => s.id === m.outgoingId)
      : undefined;
    const name =
      incoming && outgoing
        ? `Shot ${outgoing.index} -> ${incoming.index}`
        : `Mark ${i + 1}`;
    const comment = [
      m.notes,
      m.trimFrames ? `Trim: ${m.trimFrames}f` : "",
      m.audioLeadFrames ? `J-cut: ${m.audioLeadFrames}f` : "",
      m.resolved ? "[Reviewed]" : "",
    ]
      .filter(Boolean)
      .join(" | ");
    const color = m.resolved ? "Green" : "Cyan";
    rows.push(
      `"${inTc}","${outTc}","${name.replace(/"/g, '""')}","${comment.replace(/"/g, '""')}","${color}"`,
    );
  });
  return rows.join("\n");
}

export default function ReviewEvidenceCapsule({
  project,
  selected,
  speech,
  updateMark,
  onSeek,
  onStudio,
}: {
  project: Project;
  selected?: ScreeningMark;
  speech?: SpeechAnalysis;
  updateMark: (patch: Partial<ScreeningMark>) => void;
  onSeek: (time: number) => void;
  onStudio: (time: number) => void;
}) {
  const evidence = useMemo(
    () => (selected ? screeningEvidence(project, selected, speech) : undefined),
    [project, selected, speech],
  );
  const pair = evidence?.pair;
  const tc = (t: number) =>
    formatTimecode(t, project.frameRate, project.dropFrame);
  const target = evidence?.target;
  const nleNote = selected
    ? [
        `EDITMAP REVIEW — ${project.name}`,
        `Reaction ${tc(selected.time)}; anchor ${tc(selected.anchorTime)} (elapsed film time).`,
        `Record origin ${project.recordOrigin}; ${project.frameRate} fps.`,
        target
          ? `Shot ${target.index}; record ${target.startTimecode} – ${target.endTimecode}; source ${target.sourceReel} ${target.sourceIn} – ${target.sourceOut}.`
          : "",
        selected.notes,
        selected.trimFrames
          ? `Experiment: trim Shot ${target?.index ?? "?"} tail by ${selected.trimFrames} frames (${(selected.trimFrames / project.frameRate).toFixed(3)} s). Check handles and sync in the NLE.`
          : "",
        selected.audioLeadFrames
          ? `Experiment: try a ${selected.audioLeadFrames}-frame J-cut lead (${(selected.audioLeadFrames / project.frameRate).toFixed(3)} s). Verify source audio handles in the NLE.`
          : "",
        "Human-authored experiment; no edit has been applied.",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return (
    <aside className="sr-capsule" aria-label="Evidence capsule">
      {!selected || !evidence ? (
        <p className="sr-empty">Select a mark to recover its context.</p>
      ) : (
        <>
          <div className="sr-capsule-heading">
            <h2>
              {pair
                ? `Shot ${pair.outgoing.index} → ${pair.incoming.index}`
                : "Marked moment"}
            </h2>
            <p className="sr-caption">
              Reaction {tc(selected.time)}
              {" · "}
              {selected.incomingId
                ? `Cut anchor ${tc(selected.anchorTime)} · ${Math.round((selected.time - selected.anchorTime) * project.frameRate)} frames earlier`
                : "No cut magnet applied."}
            </p>
            {evidence.stale && (
              <p className="sr-error">
                This cut has changed. The original reaction is preserved; seam
                evidence is unavailable.
              </p>
            )}
          </div>
          <div className="sr-evidence-grid">
            <section className="sr-evidence-block">
              <span className="sr-eyebrow">01 / PACING DIVERGENCE</span>
              <h3>
                {target && evidence.average
                  ? `${target.duration.toFixed(1)}s vs ${evidence.average.toFixed(1)}s`
                  : "Not enough duration evidence"}
              </h3>
              <p>
                {evidence.deviation !== null
                  ? `${evidence.deviation >= 0 ? "+" : ""}${evidence.deviation.toFixed(0)}% relative to ${evidence.sequence ? `“${evidence.sequence.name}”` : "the local ±15s neighborhood"} (${evidence.nearby.length} shots, including this shot).`
                  : "Requires at least two shots in the local passage."}
              </p>
              <small>
                Duration difference does not establish a pacing problem.
              </small>
              <div
                className="sr-duration-bars"
                aria-label="Local shot durations"
              >
                {evidence.nearby.map((s) => (
                  <button
                    key={s.id}
                    title={`Shot ${s.index}: ${s.duration.toFixed(2)}s`}
                    aria-label={`Seek to shot ${s.index}`}
                    onClick={() => onSeek(s.startSeconds)}
                    style={{
                      height: `${Math.max(10, (85 * s.duration) / Math.max(...evidence.nearby.map((x) => x.duration)))}%`,
                    }}
                    className={s.id === target?.id ? "active" : ""}
                  />
                ))}
              </div>
            </section>
            <section className="sr-evidence-block">
              <span className="sr-eyebrow">02 / MOTION CHANGE</span>
              <h3>
                {evidence.kinetic
                  ? `${evidence.kinetic.before.totalKineticEnergy.toFixed(0)} → ${evidence.kinetic.after.totalKineticEnergy.toFixed(0)}`
                  : "Motion not available"}
              </h3>
              <p>
                {evidence.kinetic
                  ? `${evidence.kinetic.delta >= 0 ? "+" : ""}${evidence.kinetic.delta.toFixed(0)} points · ${evidence.kinetic.before.cameraMovement} → ${evidence.kinetic.after.cameraMovement}`
                  : "Analyze motion for both shots in Studio."}
              </p>
              {evidence.kinetic && (
                <div className="sr-motion-meter">
                  <meter
                    min={0}
                    max={100}
                    value={evidence.kinetic.before.totalKineticEnergy}
                    aria-label="Outgoing motion estimate"
                  />
                  <meter
                    min={0}
                    max={100}
                    value={evidence.kinetic.after.totalKineticEnergy}
                    aria-label="Incoming motion estimate"
                  />
                </div>
              )}
              <small>
                Shot-level estimates, 0–100. Not boundary velocity or emotional
                energy.
              </small>
            </section>
            <section className="sr-evidence-block">
              <span className="sr-eyebrow">03 / AUDIO SEAM</span>
              <h3>
                {!speech
                  ? "Speech evidence unavailable"
                  : evidence.pause
                    ? `${(evidence.pause.endSeconds - evidence.pause.startSeconds).toFixed(2)}s speech gap`
                    : evidence.speechAcross
                      ? "Detected speech crosses seam"
                      : "No detected speech at seam"}
              </h3>
              <p>
                {evidence.pause
                  ? `${tc(evidence.pause.startSeconds)} → ${tc(evidence.pause.endSeconds)}`
                  : "Listen through the seam with Darken screen."}
              </p>
              <small>
                Voice activity is not silence. Mixed audio cannot establish J/L
                cuts or an audio collision.
              </small>
            </section>
          </div>
          <div className="sr-review-footer">
            <label className="sr-note-label">
              Your reading
              <textarea
                aria-label="Your reading"
                value={selected.notes}
                placeholder="What felt off? What might you try?"
                onChange={(e) => updateMark({ notes: e.target.value })}
              />
            </label>
            <div className="sr-nle">
              <button popoverTarget="sr-nle-popover">
                NLE experiment / Export
              </button>
              <div
                id="sr-nle-popover"
                className="sr-nle-popover"
                popover="auto"
              >
                <div className="sr-section-heading">
                  <h2>NLE experiment</h2>
                  <button
                    popoverTarget="sr-nle-popover"
                    popoverTargetAction="hide"
                    aria-label="Close NLE experiment"
                  >
                    ✕
                  </button>
                </div>
                <p>
                  You choose the change. These values are notes, not automated
                  prescriptions.
                </p>
                <label>
                  Trim outgoing tail (frames)
                  <input
                    type="number"
                    min={0}
                    max={
                      target
                        ? Math.max(
                            0,
                            Math.floor(target.duration * project.frameRate) - 1,
                          )
                        : 0
                    }
                    value={selected.trimFrames ?? 0}
                    onChange={(e) =>
                      updateMark({
                        trimFrames: Math.max(
                          0,
                          Math.min(
                            Math.max(
                              0,
                              Math.floor(
                                (target?.duration ?? 0) * project.frameRate,
                              ) - 1,
                            ),
                            Math.round(Number(e.target.value) || 0),
                          ),
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  J-cut lead (frames)
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={selected.audioLeadFrames ?? 0}
                    onChange={(e) =>
                      updateMark({
                        audioLeadFrames: Math.max(
                          0,
                          Math.min(
                            10000,
                            Math.round(Number(e.target.value) || 0),
                          ),
                        ),
                      })
                    }
                  />
                </label>
                <div className="sr-export-buttons">
                  <button
                    type="button"
                    onClick={() =>
                      downloadBlob(
                        nleNote,
                        `editmap-review-${selected.id}.txt`,
                        "text/plain",
                      )
                    }
                    title="Export text note with timecode, reel, and trim values"
                  >
                    Export NLE note
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadBlob(
                        generateEdlMarkers(project),
                        `editmap-markers-${project.name ? project.name.toLowerCase().replace(/\s+/g, "_") : "film"}.edl`,
                        "text/plain",
                      )
                    }
                    title="Export CMX-3600 timeline markers for Premiere Pro & DaVinci Resolve"
                  >
                    Export EDL markers (.edl)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadBlob(
                        generateCsvMarkers(project),
                        `editmap-markers-${project.name ? project.name.toLowerCase().replace(/\s+/g, "_") : "film"}.csv`,
                        "text/csv",
                      )
                    }
                    title="Export CSV timeline markers for DaVinci Resolve & Premiere"
                  >
                    Export CSV markers (.csv)
                  </button>
                </div>
              </div>
            </div>
            <div className="sr-capsule-actions">
              <button
                aria-pressed={selected.resolved}
                onClick={() => updateMark({ resolved: !selected.resolved })}
              >
                {selected.resolved ? "✓ Reviewed" : "Mark reviewed"}
              </button>
              <button onClick={() => onStudio(selected.anchorTime)}>
                Open in Studio ↗
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
