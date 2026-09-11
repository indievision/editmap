import { useEffect, useState } from "react";
import {
  analyzeCutEyeTrace,
  annotationFor,
  calculateCutVisualDelta,
  cutPairAt,
  durationChange,
  framingChange,
  type CutPair,
} from "../analysis/cuts";
import {
  cutInterpretations,
  type CutAnnotation,
  type FocalPoint,
  type Project,
} from "../models/project";
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
    const wait = (event: string) =>
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Frame unavailable")), 8000);
        const done = () => {
          clearTimeout(timeout);
          resolve();
        };
        decoder.addEventListener(event, done, { once: true });
        decoder.addEventListener(
          "error",
          () => {
            clearTimeout(timeout);
            reject(new Error("Frame unavailable"));
          },
          { once: true }
        );
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
      const width = decoder.videoWidth * scale,
        height = decoder.videoHeight * scale;
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
      } catch {
        if (!cancelled) setFrames({ unavailable: true });
      }
    })();
    return () => {
      cancelled = true;
      decoder.removeAttribute("src");
      decoder.load();
    };
  }, [url, pair?.outgoing.id, pair?.incoming.id, pair?.time, fps]);
  return frames;
}

function FocalReticle({
  point,
  label,
  role,
}: {
  point: FocalPoint;
  label: string;
  role: "outgoing" | "incoming";
}) {
  return (
    <div
      className={`focal-reticle focal-reticle-${point.type} ${role}`}
      style={{
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
      }}
      title={`Focal attention: ${point.type.toUpperCase()} (${Math.round(point.confidence * 100)}% conf) at ${Math.round(point.x * 100)}%, ${Math.round(point.y * 100)}%`}
    >
      <div className="reticle-ring" />
      <div className="reticle-crosshair-h" />
      <div className="reticle-crosshair-v" />
      <div className="reticle-dot" />
      <div className="reticle-label">
        <span className="reticle-tag">{label}</span>
        <span className="reticle-type">{point.type}</span>
      </div>
    </div>
  );
}

export default function CutReading({
  project,
  incomingId,
  url,
  onSeek,
  onPlay,
  onUpdate,
  onClose,
  onDeleteCut,
  onNudgeCut,
}: {
  project: Project;
  incomingId?: string;
  url: string;
  onSeek: (time: number) => void;
  onPlay: (pair: CutPair, lead: number, follow: number, loop: boolean) => void;
  onUpdate: (annotations: CutAnnotation[]) => void;
  onClose?: () => void;
  onDeleteCut?: (incomingId: string) => void;
  onNudgeCut?: (incomingId: string, framesDelta: number) => void;
}) {
  const pair = cutPairAt(project.shots, incomingId);
  const [lead, setLead] = useState(1);
  const [follow, setFollow] = useState(1);
  const [loop, setLoop] = useState(false);
  const [showEyeTrace, setShowEyeTrace] = useState(true);
  const [squintCut, setSquintCut] = useState(false);
  const [analyzingEyeTrace, setAnalyzingEyeTrace] = useState(false);
  const frames = useBoundaryFrames(url, pair, project.frameRate);

  const annotation = pair ? annotationFor(project.cutAnnotations, pair) : null;
  const eyeTrace = annotation?.eyeTrace;

  const updateAnnotation = (patch: Partial<CutAnnotation>) => {
    if (!pair || !annotation) return;
    const next = { ...annotation, ...patch };
    onUpdate([
      ...(project.cutAnnotations ?? []).filter(
        (item) => item.outgoingId !== pair.outgoing.id || item.incomingId !== pair.incoming.id
      ),
      next,
    ]);
  };

  // Automatically compute Eye-Trace if not yet analyzed for this cut
  useEffect(() => {
    if (!frames.outgoing || !frames.incoming || !pair || eyeTrace) return;
    let cancelled = false;
    setAnalyzingEyeTrace(true);
    void analyzeCutEyeTrace(frames.outgoing, frames.incoming)
      .then((res) => {
        if (!cancelled && res) {
          updateAnnotation({ eyeTrace: res });
        }
      })
      .finally(() => {
        if (!cancelled) setAnalyzingEyeTrace(false);
      });
    return () => {
      cancelled = true;
    };
  }, [frames.outgoing, frames.incoming, pair?.incoming.id, eyeTrace]);

  if (!pair || !annotation) {
    return (
      <section className="cut-reading panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">CUT READING</span>
            <span className="muted">Study what changes at an edit.</span>
          </div>
          {onClose && (
            <button type="button" className="drawer-close-btn" onClick={onClose} title="Close reading">
              ✕
            </button>
          )}
        </div>
        <p className="cut-empty">
          Click a boundary between two contiguous shots on the editing map to compare the outgoing and incoming images.
        </p>
      </section>
    );
  }

  const framing = framingChange(pair);
  const duration = durationChange(pair);
  const visualDelta = calculateCutVisualDelta(pair.outgoing, pair.incoming);

  return (
    <section className="cut-reading panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">CUT READING</span>
          <span className="muted">
            Shot {String(pair.outgoing.index).padStart(3, "0")} → {String(pair.incoming.index).padStart(3, "0")}
          </span>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className={`eye-trace-toggle-btn ${showEyeTrace ? "active" : ""}`}
            onClick={() => setShowEyeTrace(!showEyeTrace)}
            title="Toggle Walter Murch Eyeline & Eye-Trace reticles overlay"
          >
            👁 Eye-Trace
          </button>
          <button
            type="button"
            className={`eye-trace-toggle-btn ${squintCut ? "active" : ""}`}
            onClick={() => setSquintCut(!squintCut)}
            title="Toggle Squint Test (Tonal Value / Chiaroscuro check across cut)"
          >
            😑 Squint Cut
          </button>
          <button type="button" onClick={() => onSeek(pair.time)}>
            Go to cut
          </button>
          {onNudgeCut && (
            <div className="cut-nudge-group" role="group" aria-label="Nudge cut boundary">
              <button
                type="button"
                className="cut-nudge-btn"
                onClick={() => onNudgeCut(pair.incoming.id, -1)}
                title="Nudge cut 1 frame left ([)"
              >
                ◂ -1f
              </button>
              <button
                type="button"
                className="cut-nudge-btn"
                onClick={() => onNudgeCut(pair.incoming.id, 1)}
                title="Nudge cut 1 frame right (])"
              >
                +1f ▸
              </button>
            </div>
          )}
          {onDeleteCut && (
            <button
              type="button"
              className="cut-delete-btn"
              onClick={() => onDeleteCut(pair.incoming.id)}
              title="Merge adjacent shots by deleting this cut (Delete/Backspace)"
            >
              ⌫ Merge Shots
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="drawer-close-btn"
              onClick={onClose}
              title="Close reading"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="cut-frames">
        <figure>
          <figcaption>
            OUTGOING · {formatTimecode(Math.max(pair.outgoing.startSeconds, pair.time - 1 / actualRate(project.frameRate)), project.frameRate, project.dropFrame)}
          </figcaption>
          <div className="cut-frame-container">
            {frames.outgoing ? (
              <img
                src={frames.outgoing}
                alt={`Last frame of shot ${pair.outgoing.index}`}
                className={squintCut ? "cut-squint-active" : ""}
              />
            ) : (
              <div className="cut-frame-empty">
                {frames.unavailable ? "Frame unavailable" : url ? "Sampling frame…" : "Relink video"}
              </div>
            )}
            {showEyeTrace && eyeTrace?.outgoingFocalPoint && frames.outgoing && (
              <FocalReticle point={eyeTrace.outgoingFocalPoint} label="OUT" role="outgoing" />
            )}
          </div>
        </figure>
        <figure>
          <figcaption>
            INCOMING · {formatTimecode(Math.min(pair.incoming.endSeconds, pair.time + 1 / actualRate(project.frameRate)), project.frameRate, project.dropFrame)}
          </figcaption>
          <div className="cut-frame-container">
            {frames.incoming ? (
              <img
                src={frames.incoming}
                alt={`First frame of shot ${pair.incoming.index}`}
                className={squintCut ? "cut-squint-active" : ""}
              />
            ) : (
              <div className="cut-frame-empty">
                {frames.unavailable ? "Frame unavailable" : url ? "Sampling frame…" : "Relink video"}
              </div>
            )}
            {showEyeTrace && eyeTrace?.incomingFocalPoint && frames.incoming && (
              <FocalReticle point={eyeTrace.incomingFocalPoint} label="IN" role="incoming" />
            )}
          </div>
        </figure>
      </div>

      <div className="cut-evidence">
        <div className={`cut-eyetrace-tile ${eyeTrace ? eyeTrace.rating : ""}`}>
          <span>Eye-Trace Jump (Murch Rule)</span>
          <b>
            {eyeTrace ? (
              <>
                {eyeTrace.jumpDistancePercent}% hop ·{" "}
                <span className={`rating-badge ${eyeTrace.rating}`}>
                  {eyeTrace.rating.toUpperCase()}
                </span>
              </>
            ) : analyzingEyeTrace ? (
              <span className="analyzing-shimmer">Scanning eye-trace…</span>
            ) : (
              "Awaiting frames"
            )}
          </b>
          <small>
            {eyeTrace
              ? `${eyeTrace.outgoingFocalPoint.type} → ${eyeTrace.incomingFocalPoint.type} · ${
                  eyeTrace.screenDirection === "left-to-right"
                    ? "Left ➔ Right"
                    : eyeTrace.screenDirection === "right-to-left"
                    ? "Right ➔ Left"
                    : "Neutral shift"
                }`
              : "Detects viewer saccadic hop distance across cut"}
          </small>
        </div>
        <div>
          <span>Framing change</span>
          <b>{framing.label}</b>
          <small>{framing.detail}</small>
        </div>
        <div>
          <span>Duration change</span>
          <b>{duration.label}</b>
          <small>{duration.detail}</small>
        </div>
        <div>
          <span>Sensory Shock Index</span>
          <b>{visualDelta.shockScore} / 100</b>
          <small>
            ΔV = {visualDelta.deltaV.toFixed(2)} (ΔLuma: {visualDelta.deltaLuma.toFixed(2)}, ΔChroma:{" "}
            {visualDelta.deltaChroma.toFixed(2)})
          </small>
        </div>
        <div>
          <span>Transition</span>
          <b>{pair.transition === "C" ? "Hard cut" : pair.transition}</b>
          <small>
            {pair.transition === "C"
              ? "Boundary frames are one frame either side."
              : "Review the moving transition; boundary frames are reference samples."}
          </small>
        </div>
      </div>

      <div className="cut-playback">
        <b>PLAY ACROSS THE CUT</b>
        <label>
          Lead-in{" "}
          <input
            aria-label="Cut lead-in seconds"
            type="range"
            min="0.25"
            max="5"
            step="0.25"
            value={lead}
            onChange={(e) => setLead(Number(e.target.value))}
          />{" "}
          {lead.toFixed(2)}s
        </label>
        <label>
          Follow-through{" "}
          <input
            aria-label="Cut follow-through seconds"
            type="range"
            min="0.25"
            max="5"
            step="0.25"
            value={follow}
            onChange={(e) => setFollow(Number(e.target.value))}
          />{" "}
          {follow.toFixed(2)}s
        </label>
        <label className="cut-loop">
          <input
            aria-label="Loop across cut"
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
          />{" "}
          Loop
        </label>
        <button className="primary" disabled={!url} onClick={() => onPlay(pair, lead, follow, loop)}>
          Play cut
        </button>
      </div>

      <div className="cut-interpretation">
        <label>
          YOUR INTERPRETATION
          <select
            aria-label="Cut interpretation"
            value={annotation.interpretation}
            onChange={(e) =>
              updateAnnotation({
                interpretation: e.target.value as CutAnnotation["interpretation"],
              })
            }
          >
            {cutInterpretations.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Note
          <textarea
            aria-label="Cut note"
            placeholder="What new information arrives? Why cut here?"
            value={annotation.notes}
            onChange={(e) => updateAnnotation({ notes: e.target.value })}
          />
        </label>
      </div>
    </section>
  );
}

