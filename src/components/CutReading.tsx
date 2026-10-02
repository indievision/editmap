import { useEffect, useState } from "react";
import {
  analyzeCutEyeTrace,
  annotationFor,
  calculateCutVisualDelta,
  calculateEyeTrace,
  colorMatchAtCut,
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
import { isHardCut } from "../analysis/pacing";
import { SaccadicCutFlow, GhostFocalReticle, type CutViewMode } from "./SaccadicCutFlow";

type Frames = { outgoing?: string; incoming?: string; outgoingPrev?: string; unavailable?: boolean };

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
        const outgoingPrev = await capture(Math.max(pair.outgoing.startSeconds, pair.time - 2 * frame));
        const outgoing = await capture(Math.max(pair.outgoing.startSeconds, pair.time - frame));
        const incoming = await capture(Math.min(pair.incoming.endSeconds - frame / 2, pair.time + frame));
        if (!cancelled) setFrames({ outgoing, incoming, outgoingPrev });
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
  onDragPoint,
}: {
  point: FocalPoint;
  label: string;
  role: "outgoing" | "incoming";
  onDragPoint?: (newPoint: FocalPoint) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!onDragPoint) return;
    e.stopPropagation();
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging || !onDragPoint) return;
    const onMove = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(".cut-frame-box, .cut-frame-container");
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const nx = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0.02, Math.min(0.98, (e.clientY - rect.top) / rect.height));
      onDragPoint({ ...point, x: Number(nx.toFixed(3)), y: Number(ny.toFixed(3)), type: "eyes", confidence: 1.0 });
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDragging, onDragPoint, point]);

  return (
    <div
      className={`focal-reticle focal-reticle-${point.type} ${role} ${isDragging ? "dragging" : ""}`}
      style={{
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        cursor: onDragPoint ? (isDragging ? "grabbing" : "grab") : undefined,
      }}
      onPointerDown={handlePointerDown}
      title={`Focal attention: ${point.type.toUpperCase()} (${Math.round(point.confidence * 100)}% conf) at ${Math.round(point.x * 100)}%, ${Math.round(point.y * 100)}%${onDragPoint ? " · Drag to position on eyes" : ""}`}
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
  variant,
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
  variant?: "deck" | "drawer";
}) {
  const pair = cutPairAt(project.shots, incomingId);
  const [lead, setLead] = useState(1);
  const [follow, setFollow] = useState(1);
  const [loop, setLoop] = useState(false);
  const [showEyeTrace, setShowEyeTrace] = useState(true);
  const [squintCut, setSquintCut] = useState(false);
  const [analyzingEyeTrace, setAnalyzingEyeTrace] = useState(false);
  const [cutViewMode, setCutViewMode] = useState<CutViewMode>("split");
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

  const handleRescanEyeTrace = () => {
    if (!frames.outgoing || !frames.incoming) return;
    setAnalyzingEyeTrace(true);
    void analyzeCutEyeTrace(frames.outgoing, frames.incoming, frames.outgoingPrev)
      .then((res) => {
        if (res) {
          updateAnnotation({ eyeTrace: res });
        }
      })
      .finally(() => {
        setAnalyzingEyeTrace(false);
      });
  };

  // Automatically compute Eye-Trace if not yet analyzed or if previously stuck with legacy center-collapse bug
  useEffect(() => {
    if (!frames.outgoing || !frames.incoming || !pair) return;

    // Detect if this cut has the old legacy center-collapse bug (both face near center <=12% hop)
    const isLegacyBuggyTrace =
      eyeTrace &&
      eyeTrace.outgoingFocalPoint.type === "face" &&
      eyeTrace.incomingFocalPoint.type === "face" &&
      Math.abs(eyeTrace.outgoingFocalPoint.x - 0.5) < 0.08 &&
      Math.abs(eyeTrace.incomingFocalPoint.x - 0.5) < 0.08 &&
      eyeTrace.jumpDistancePercent <= 12;

    if (eyeTrace && !isLegacyBuggyTrace) return;

    let cancelled = false;
    setAnalyzingEyeTrace(true);
    void analyzeCutEyeTrace(frames.outgoing, frames.incoming, frames.outgoingPrev)
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
  }, [frames.outgoing, frames.incoming, frames.outgoingPrev, pair?.incoming.id, eyeTrace]);

  if (!pair || !annotation) {
    if (variant === "drawer") {
      return (
        <section className="cut-drawer panel" aria-label="Cut reading drawer">
          <div className="cut-drawer-head">
            <div className="cut-drawer-title-group">
              <p className="cut-drawer-subtitle">Study what changes at an edit.</p>
            </div>
            {onClose && (
              <button
                type="button"
                className="studio-drawer-close-btn cut-drawer-close-btn"
                onClick={onClose}
                title="Close cut reading drawer (Esc)"
                aria-label="Close cut reading drawer"
              >
                ✕
              </button>
            )}
          </div>
          <div className="cut-drawer-content">
            <div className="cut-empty-box">
              <p className="cut-empty-msg">
                Click a boundary between two contiguous shots on the editing map to compare the outgoing and incoming images.
              </p>
            </div>
          </div>
        </section>
      );
    }
    return (
      <section className="cut-reading panel">
        <div className="section-head">
          <div>
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
  const colorMatch = colorMatchAtCut(pair.outgoing, pair.incoming);

  if (variant === "drawer") {
    const degrees = eyeTrace ? ((eyeTrace.jumpDistancePercent / 100) * 35).toFixed(1) : null;
    const ratingLabel = eyeTrace
      ? eyeTrace.rating === "anchored" || eyeTrace.rating === "smooth"
        ? "Anchored"
        : eyeTrace.rating === "shifted" || eyeTrace.rating === "natural"
        ? "Shifted"
        : "Scattered"
      : null;
    const deltaD = pair.incoming.duration - pair.outgoing.duration;
    const deltaSign = deltaD >= 0 ? "+" : "";
    const deltaLumaSign = visualDelta.deltaLuma >= 0 ? "+" : "";
    const deltaChromaSign = visualDelta.deltaChroma >= 0 ? "+" : "";

    return (
      <section className="cut-drawer panel" aria-label="Cut reading drawer">
        {/* 1. Header */}
        <div className="cut-drawer-head">
          <div className="cut-drawer-title-group">
            <p className="cut-drawer-subtitle">
              Shot {String(pair.outgoing.index).padStart(3, "0")} → {String(pair.incoming.index).padStart(3, "0")}
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              className="studio-drawer-close-btn cut-drawer-close-btn"
              onClick={onClose}
              title="Close cut reading drawer (Esc)"
              aria-label="Close cut reading drawer"
            >
              ✕
            </button>
          )}
        </div>

        <div className="cut-drawer-content">
          {/* 2. Action Toolbar */}
          <div className="cut-drawer-toolbar" role="toolbar" aria-label="Cut reading actions">
            <button
              type="button"
              className={`cut-toolbar-btn ${showEyeTrace ? "active" : ""}`}
              onClick={() => setShowEyeTrace(!showEyeTrace)}
              title="Toggle Walter Murch Eyeline & Eye-Trace reticles overlay"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>Eye-Trace</span>
            </button>

            <button
              type="button"
              className={`cut-toolbar-btn ${squintCut ? "active" : ""}`}
              onClick={() => setSquintCut(!squintCut)}
              title="Toggle Squint Test (Tonal Value / Chiaroscuro check across cut)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="6" cy="12" r="4" />
                <circle cx="18" cy="12" r="4" />
                <line x1="10" y1="12" x2="14" y2="12" />
              </svg>
              <span>Squint Cut</span>
            </button>

            <button
              type="button"
              className="cut-toolbar-btn"
              onClick={() => onSeek(pair.time)}
              title="Go to cut boundary"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
              <span>Go to cut</span>
            </button>

            {onNudgeCut && (
              <>
                <button
                  type="button"
                  className="cut-toolbar-btn"
                  onClick={() => onNudgeCut(pair.incoming.id, -1)}
                  title="Nudge cut 1 frame left ([)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  <span>-1f</span>
                </button>

                <button
                  type="button"
                  className="cut-toolbar-btn"
                  onClick={() => onNudgeCut(pair.incoming.id, 1)}
                  title="Nudge cut 1 frame right (])"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span>+1f</span>
                </button>
              </>
            )}

            {onDeleteCut && (
              <button
                type="button"
                className="cut-toolbar-btn merge-btn"
                onClick={() => onDeleteCut(pair.incoming.id)}
                title="Merge adjacent shots by deleting this cut (Delete/Backspace)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2" y="4" width="9" height="16" rx="1" />
                  <rect x="13" y="4" width="9" height="16" rx="1" />
                </svg>
                <span>Merge shots</span>
              </button>
            )}
          </div>

          {/* Saccadic Cut Flow & Vector Overlay */}
          {frames.outgoing && frames.incoming && eyeTrace && showEyeTrace && (
            <SaccadicCutFlow
              outgoingFrame={frames.outgoing}
              incomingFrame={frames.incoming}
              eyeTrace={eyeTrace}
              viewMode={cutViewMode}
              onViewModeChange={setCutViewMode}
              squint={squintCut}
              onUpdateEyeTrace={(updated) => updateAnnotation({ eyeTrace: updated })}
              onRescanEyeTrace={handleRescanEyeTrace}
              isRescanning={analyzingEyeTrace}
            />
          )}

          {/* 3. Comparison Frames */}
          <div
            className="cut-drawer-frames"
            style={{ display: cutViewMode !== "split" && eyeTrace && showEyeTrace ? "none" : undefined }}
          >
            <div className="cut-frame-card">
              <div className="cut-frame-card-head">
                OUTGOING · {formatTimecode(Math.max(pair.outgoing.startSeconds, pair.time - 1 / actualRate(project.frameRate)), project.frameRate, project.dropFrame)}
              </div>
              <div className="cut-frame-box">
                {frames.outgoing ? (
                  <img
                    src={frames.outgoing}
                    alt={`Last frame of shot ${pair.outgoing.index}`}
                    className={`cut-frame-img ${squintCut ? "cut-squint-active" : ""}`}
                  />
                ) : (
                  <div className="cut-frame-empty">
                    {frames.unavailable ? "Frame unavailable" : url ? "Sampling frame…" : "Relink video"}
                  </div>
                )}
                <div className="cut-bracket-marker outgoing">
                  <div className="cut-viewfinder-box">
                    <span className="corner top-left" />
                    <span className="corner top-right" />
                    <span className="corner bottom-left" />
                    <span className="corner bottom-right" />
                  </div>
                  <span className="cut-viewfinder-label">OUT</span>
                </div>
                {showEyeTrace && eyeTrace?.outgoingFocalPoint && frames.outgoing && (
                  <FocalReticle
                    point={eyeTrace.outgoingFocalPoint}
                    label="OUT"
                    role="outgoing"
                    onDragPoint={(newP) => {
                      const updated = calculateEyeTrace(newP, eyeTrace.incomingFocalPoint, eyeTrace.momentum);
                      updateAnnotation({ eyeTrace: updated });
                    }}
                  />
                )}
                {showEyeTrace && eyeTrace?.incomingFocalPoint && frames.outgoing && (
                  <GhostFocalReticle point={eyeTrace.incomingFocalPoint} role="target" label="IN TARGET" />
                )}
              </div>
            </div>

            <div className="cut-frame-card">
              <div className="cut-frame-card-head">
                INCOMING · {formatTimecode(Math.min(pair.incoming.endSeconds, pair.time + 1 / actualRate(project.frameRate)), project.frameRate, project.dropFrame)}
              </div>
              <div className="cut-frame-box">
                {frames.incoming ? (
                  <img
                    src={frames.incoming}
                    alt={`First frame of shot ${pair.incoming.index}`}
                    className={`cut-frame-img ${squintCut ? "cut-squint-active" : ""}`}
                  />
                ) : (
                  <div className="cut-frame-empty">
                    {frames.unavailable ? "Frame unavailable" : url ? "Sampling frame…" : "Relink video"}
                  </div>
                )}
                <div className="cut-bracket-marker incoming">
                  <div className="cut-viewfinder-box">
                    <span className="corner top-left" />
                    <span className="corner top-right" />
                    <span className="corner bottom-left" />
                    <span className="corner bottom-right" />
                  </div>
                  <span className="cut-viewfinder-label">IN</span>
                </div>
                {showEyeTrace && eyeTrace?.incomingFocalPoint && frames.incoming && (
                  <FocalReticle
                    point={eyeTrace.incomingFocalPoint}
                    label="IN"
                    role="incoming"
                    onDragPoint={(newP) => {
                      const updated = calculateEyeTrace(eyeTrace.outgoingFocalPoint, newP, eyeTrace.momentum);
                      updateAnnotation({ eyeTrace: updated });
                    }}
                  />
                )}
                {showEyeTrace && eyeTrace?.outgoingFocalPoint && frames.incoming && (
                  <GhostFocalReticle point={eyeTrace.outgoingFocalPoint} role="origin" label="OUT ORIGIN" />
                )}
              </div>
            </div>
          </div>


          {/* 4. Evidence Rows */}
          <div className="cut-drawer-section cut-evidence-section">
            <div className="cut-drawer-evidence">
              <div className="cut-evidence-row">
                <span className="cut-evidence-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  Eye-Trace jump
                </span>
                <span className="cut-evidence-value">
                  {eyeTrace ? (
                    <>
                      {degrees}° ({ratingLabel})
                      {eyeTrace.axisClash && (
                        <span className="axis-clash-tag" title={eyeTrace.axisClashDetail || "180° axis clash: eyelines clash across the edit boundary"}>
                          {" "}· ⚠️ 180° Axis Clash
                        </span>
                      )}
                      {eyeTrace.characterReplacement && (
                        <span className="replacement-tag" title={eyeTrace.characterReplacementDetail || "Subject substituted in same retinal position"}>
                          {" "}· ⚡ Position Collision
                        </span>
                      )}
                      {eyeTrace.depthShift && eyeTrace.depthShift.shift !== "constant" && (
                        <span className="depth-shift-tag" title={`Depth accommodation: ${eyeTrace.depthShift.shift} (${eyeTrace.depthShift.magnitude})`}>
                          {" "}· 👁️ {eyeTrace.depthShift.shift === "near-to-far" ? "Near→Far Depth" : "Far→Near Depth"}
                        </span>
                      )}
                      {eyeTrace.momentum && eyeTrace.momentum.alignment !== "static" && (
                        <span className={`momentum-tag ${eyeTrace.momentum.alignment}`}>
                          {" "}· {eyeTrace.momentum.alignment === "momentum-match" ? "Momentum Match" : "Kinetic Collision"}
                        </span>
                      )}
                    </>
                  ) : analyzingEyeTrace ? (
                    <span className="analyzing-shimmer">Scanning eye-trace…</span>
                  ) : (
                    "Awaiting frames"
                  )}
                </span>
              </div>

              <div className="cut-evidence-row">
                <span className="cut-evidence-label">Colour match</span>
                <span className="cut-evidence-value">
                  {colorMatch.label}{colorMatch.score === null ? "" : ` · ${Math.round(colorMatch.score * 100)}% measured difference`}
                </span>
              </div>

              <div className="cut-evidence-row">
                <span className="cut-evidence-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
                    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
                  </svg>
                  Framing change
                </span>
                <span className="cut-evidence-value">
                  {pair.outgoing.shotSize || "Unknown"} → {pair.incoming.shotSize || "Unknown"}
                </span>
              </div>

              <div className="cut-evidence-row">
                <span className="cut-evidence-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  Duration change
                </span>
                <span className="cut-evidence-value">
                  {pair.outgoing.duration.toFixed(2)}s → {pair.incoming.duration.toFixed(2)}s ({deltaSign}{deltaD.toFixed(2)}s)
                </span>
              </div>

              <div className="cut-evidence-row">
                <span className="cut-evidence-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" opacity="0.3" />
                  </svg>
                  Visual change
                </span>
                <span className="cut-evidence-value">
                  Brightness {deltaLumaSign}{Math.round(visualDelta.deltaLuma * 100)}% &nbsp; Color {deltaChromaSign}{Math.round(visualDelta.deltaChroma * 100)}%
                </span>
              </div>

              <div className="cut-evidence-row">
                <span className="cut-evidence-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="6" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <line x1="20" y1="4" x2="8.12" y2="15.88" />
                    <line x1="14.47" y1="14.48" x2="20" y2="20" />
                    <line x1="8.12" y1="8.12" x2="12" y2="12" />
                  </svg>
                  Transition
                </span>
                <span className="cut-evidence-value">
                  {isHardCut(pair.transition) ? "Hard cut" : pair.transition}
                </span>
              </div>
            </div>
            <p className="cut-evidence-footnote">
              ⓘ {isHardCut(pair.transition)
                ? "Boundary samples are one frame either side."
                : "Review the moving transition; boundary frames are reference samples."}
            </p>
          </div>

          {/* 5. Play Across The Cut */}
          <div className="cut-drawer-section">
            <div className="cut-drawer-section-eyebrow">PLAY ACROSS THE CUT</div>
            <div className="cut-drawer-playback-bar">
              <label className="cut-param-pill">
                <span className="cut-param-label">Lead-in</span>
                <input
                  aria-label="Cut lead-in seconds"
                  type="number"
                  min="0.25"
                  max="5"
                  step="0.25"
                  value={lead}
                  onChange={(e) => setLead(Number(e.target.value))}
                  className="cut-param-input"
                />
              </label>

              <label className="cut-param-pill">
                <span className="cut-param-label">Follow-through</span>
                <input
                  aria-label="Cut follow-through seconds"
                  type="number"
                  min="0.25"
                  max="5"
                  step="0.25"
                  value={follow}
                  onChange={(e) => setFollow(Number(e.target.value))}
                  className="cut-param-input"
                />
              </label>

              <label className="cut-loop-toggle">
                <input
                  aria-label="Loop across cut"
                  type="checkbox"
                  checked={loop}
                  onChange={(e) => setLoop(e.target.checked)}
                />
                <span>Loop</span>
              </label>

              <button
                type="button"
                className="cut-play-cut-btn"
                disabled={!url}
                onClick={() => onPlay(pair, lead, follow, loop)}
              >
                ▶ Play cut
              </button>
            </div>
          </div>

          {/* 6. Your Interpretation */}
          <div className="cut-drawer-section">
            <div className="cut-drawer-section-eyebrow">YOUR INTERPRETATION</div>
            <div className="cut-drawer-interpretation">
              <select
                aria-label="Cut interpretation"
                className="cut-interpretation-select"
                value={annotation.interpretation}
                onChange={(e) =>
                  updateAnnotation({
                    interpretation: e.target.value as CutAnnotation["interpretation"],
                  })
                }
              >
                {cutInterpretations.map((item) => (
                  <option key={item} value={item}>
                    {item === "Unmarked" ? "Select..." : item}
                  </option>
                ))}
              </select>

              <textarea
                aria-label="Cut note"
                className="cut-interpretation-notes"
                placeholder="What new information arrives? Why cut here?"
                value={annotation.notes}
                onChange={(e) => updateAnnotation({ notes: e.target.value })}
              />
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="cut-reading panel">
      <div className="section-head">
        <div>
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

      {/* Saccadic Cut Flow & Vector Overlay */}
      {frames.outgoing && frames.incoming && eyeTrace && showEyeTrace && (
        <SaccadicCutFlow
          outgoingFrame={frames.outgoing}
          incomingFrame={frames.incoming}
          eyeTrace={eyeTrace}
          viewMode={cutViewMode}
          onViewModeChange={setCutViewMode}
          squint={squintCut}
          onUpdateEyeTrace={(updated) => updateAnnotation({ eyeTrace: updated })}
          onRescanEyeTrace={handleRescanEyeTrace}
          isRescanning={analyzingEyeTrace}
        />
      )}

      <div
        className="cut-frames"
        style={{ display: cutViewMode !== "split" && eyeTrace && showEyeTrace ? "none" : undefined }}
      >
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
              <FocalReticle
                point={eyeTrace.outgoingFocalPoint}
                label="OUT"
                role="outgoing"
                onDragPoint={(newP) => {
                  const updated = calculateEyeTrace(newP, eyeTrace.incomingFocalPoint, eyeTrace.momentum);
                  updateAnnotation({ eyeTrace: updated });
                }}
              />
            )}
            {showEyeTrace && eyeTrace?.incomingFocalPoint && frames.outgoing && (
              <GhostFocalReticle point={eyeTrace.incomingFocalPoint} role="target" label="IN TARGET" />
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
              <FocalReticle
                point={eyeTrace.incomingFocalPoint}
                label="IN"
                role="incoming"
                onDragPoint={(newP) => {
                  const updated = calculateEyeTrace(eyeTrace.outgoingFocalPoint, newP, eyeTrace.momentum);
                  updateAnnotation({ eyeTrace: updated });
                }}
              />
            )}
            {showEyeTrace && eyeTrace?.outgoingFocalPoint && frames.incoming && (
              <GhostFocalReticle point={eyeTrace.outgoingFocalPoint} role="origin" label="OUT ORIGIN" />
            )}
          </div>
        </figure>
      </div>


      <div className="cut-evidence">
        <div className={`cut-eyetrace-tile ${eyeTrace ? eyeTrace.rating : ""}`}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Eye-Trace Jump (Murch Rule)</span>
            <button
              type="button"
              className="cut-eyetrace-rescan-btn"
              onClick={handleRescanEyeTrace}
              disabled={analyzingEyeTrace || !frames.outgoing || !frames.incoming}
              title="Auto-detect actor eyes and re-align saccadic vector via AI vision"
            >
              {analyzingEyeTrace ? "Scanning…" : "Re-scan Eyes"}
            </button>
          </div>
          <b>
            {eyeTrace ? (
              <>
                {eyeTrace.jumpDistancePercent}% hop ·{" "}
                <span className={`rating-badge ${eyeTrace.rating}`}>
                  {eyeTrace.rating.toUpperCase()}
                </span>
                {eyeTrace.momentum && eyeTrace.momentum.alignment !== "static" && (
                  <span className={`momentum-tag ${eyeTrace.momentum.alignment}`}>
                    {" "}· {eyeTrace.momentum.alignment === "momentum-match" ? "MOMENTUM MATCH" : "COLLISION"}
                  </span>
                )}
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
            ΔV = {visualDelta.deltaV.toFixed(2)} (Brightness: {visualDelta.deltaLuma.toFixed(2)}, Color:{" "}
            {visualDelta.deltaChroma.toFixed(2)})
          </small>
        </div>
        <div>
          <span>Transition</span>
          <b>{isHardCut(pair.transition) ? "Hard cut" : pair.transition}</b>
          <small>
            {isHardCut(pair.transition)
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
