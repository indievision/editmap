import { useState } from "react";
import type { CameraMovementType, Project, Shot } from "../models/project";
import {
  cameraMovementTypes,
  peopleLabels,
  selectableShotSizes,
  shotSizes,
  subjectLabels,
} from "../models/project";
import { analyzeShotMotion } from "../analysis/motion";
import ShotAnalysis from "./ShotAnalysis";

const cameraMovementIcons: Record<CameraMovementType, string> = {
  Static: "🔒",
  Pan: "↔️",
  Tilt: "↕️",
  "Dolly / Track": "🚂",
  Handheld: "〰️",
  "Dynamic / Action": "⚡",
  Zoom: "🔍",
  Unknown: "❓",
};

const shotSizeLabels: Record<Shot["shotSize"], string> = {
  Wide: "Wide framing",
  Full: "Full framing",
  Medium: "Medium framing",
  Close: "Close framing",
  "Extreme close": "Extreme close framing",
  EWS: "Extreme wide shot",
  WS: "Wide shot",
  FS: "Full shot",
  AS: "American shot",
  MS: "Medium shot",
  MCU: "Medium close-up",
  CU: "Close-up",
  ECU: "Extreme close-up",
  MWS: "Medium wide shot",
  Insert: "Insert",
  OTS: "Over the shoulder",
  POV: "Point of view",
  Unknown: "Unknown",
  "Not applicable": "Not applicable",
};

const shotSizeDescriptions: Partial<Record<Shot["shotSize"], string>> = {
  Wide: "Subject small or surrounded by substantial environment",
  Full: "Full body or subject with contextual surroundings",
  Medium: "Subject emphasis with meaningful environment retained",
  Close: "Face or main subject fills a substantial part of frame",
  "Extreme close": "An isolated facial, bodily, or prop detail dominates",
  EWS: "Environment dominates; subject tiny or absent",
  WS: "Whole subject with substantial surroundings",
  MWS: "Approximately knees or waist up with surroundings",
  MS: "Approximately waist up",
  MCU: "Approximately chest up",
  CU: "Face or main object fills much of the frame",
  ECU: "Small, isolated detail fills the frame",
  Insert: "Cutaway detail or inanimate object relevant to the scene",
  OTS: "Looking past the shoulder of another person",
  POV: "Scene viewed from character perspective",
  FS: "Person framed head to toe",
  AS: "Person framed approximately knees up",
};

const sizeShortcuts: Record<string, string> = {
  EWS: "1",
  WS: "2",
  FS: "F",
  MWS: "3",
  AS: "A",
  MS: "4",
  MCU: "5",
  CU: "6",
  ECU: "7",
  Insert: "8",
  OTS: "9",
  POV: "0",
  Unknown: "U",
};

const gridShotSizes: Shot["shotSize"][] = [
  "EWS",
  "WS",
  "FS",
  "MWS",
  "AS",
  "MS",
  "MCU",
  "CU",
  "ECU",
  "Insert",
  "OTS",
  "POV",
  "Unknown",
];

export default function ShotInspector({
  shot,
  project,
  url,
  thumbnail,
  scanningAll,
  scanningShot,
  onBusyChange,
  onPreview,
  onEditShot,
  onModelResult,
  onNext,
  onPrevious,
  onConfirmAndNext,
  onMarkUncertain,
  onReviewCharacters,
  onCloseDrawer,
  isDrawer = false,
  useGridSizes = false,
  autoAdvance = true,
  isStudio = false,
}: {
  shot: Shot | undefined;
  project: Project;
  url: string;
  thumbnail?: string;
  scanningAll: boolean;
  scanningShot: boolean;
  onBusyChange: (busy: boolean) => void;
  onPreview: (shot: Shot, time: number, image?: string) => void;
  onEditShot: (patch: Partial<Shot>) => void;
  onModelResult: (projectId: string, shotId: string, patch: Partial<Shot>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onConfirmAndNext: () => void;
  onMarkUncertain: () => void;
  onReviewCharacters: (shotId: string, memberIds: string[]) => void;
  onCloseDrawer?: () => void;
  isDrawer?: boolean;
  useGridSizes?: boolean;
  autoAdvance?: boolean;
  isStudio?: boolean;
}) {
  const [copiedColor, setCopiedColor] = useState<string | null>(null);
  const [scanningMotion, setScanningMotion] = useState(false);
  const [showDetailedEvidence, setShowDetailedEvidence] = useState(!isStudio);

  if (!shot) {
    return (
      <aside className={`shot-inspector-panel panel ${isDrawer ? "drawer-mode" : ""}`}>
        <div className="section-head">
          <span className="eyebrow">SHOT INSPECTOR</span>
          {isDrawer && onCloseDrawer && (
            <button type="button" className="drawer-close-btn" onClick={onCloseDrawer}>
              ✕
            </button>
          )}
        </div>
        <div className="inspector-empty">
          <span className="inspector-empty-icon">▻</span>
          <b>No shot selected</b>
          <p>Click any shot on the editing map to inspect, classify, and confirm framing.</p>
        </div>
      </aside>
    );
  }

  const shotIndex = project.shots.indexOf(shot) + 1;
  const totalShots = project.shots.length;
  const isConfirmed = shot.reviewStatus === "Confirmed";
  const isUncertain = shot.uncertain === true;
  const hasDialogue = Boolean(
    project.speechAnalysis?.regions.some(
      (r) => r.endSeconds >= shot.startSeconds && r.startSeconds <= shot.endSeconds
    )
  );

  const handleScanMotion = async () => {
    if (!url || !shot || scanningMotion) return;
    setScanningMotion(true);
    try {
      const profile = await analyzeShotMotion(url, shot);
      onEditShot({
        motionProfile: profile,
        cameraMovement: profile.cameraMovement,
        suggestion: {
          ...(shot.suggestion ?? {
            shotSize: shot.shotSize,
            model: "motion-engine",
            createdAt: new Date().toISOString(),
          }),
          cameraMovement: profile.cameraMovement,
        },
      });
    } finally {
      setScanningMotion(false);
    }
  };

  const handleCopyColor = (hex: string) => {
    navigator.clipboard.writeText(hex);
    setCopiedColor(hex);
    setTimeout(() => setCopiedColor(null), 1500);
  };

  return (
    <aside className={`shot-inspector-panel panel inspector ${isDrawer ? "drawer-mode" : ""} ${isStudio ? "mode-studio-inspector" : ""}`}>
      {/* Header */}
      <div className="section-head inspector-head">
        <div className="inspector-head-left">
          <span className="eyebrow">{isStudio ? `SHOT ${String(shot.index).padStart(2, "0")}` : "SHOT INSPECTOR"}</span>
          <span className="inspector-pagination mono">
            {shotIndex} / {totalShots}
          </span>
        </div>
        <div className="inspector-head-right">
          <div className="nav-arrows-group">
            <button
              type="button"
              className="btn-icon-sm"
              onClick={onPrevious}
              disabled={shotIndex <= 1}
              title="Previous shot (ArrowLeft / <)"
              aria-label="Previous shot"
            >
              ‹
            </button>
            <button
              type="button"
              className="btn-icon-sm"
              onClick={onNext}
              disabled={shotIndex >= totalShots}
              title="Next shot (ArrowRight / >)"
              aria-label="Next shot"
            >
              ›
            </button>
          </div>
          {isDrawer && onCloseDrawer && (
            <button
              type="button"
              className="drawer-close-btn"
              onClick={onCloseDrawer}
              aria-label="Close drawer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="inspector-scroll-content">
        {/* Shot Card Header with Thumbnail & Timestamps */}
        <div className="inspector-shot-hero">
          {thumbnail && (
            <div className="inspector-thumbnail-wrap">
              <img
                src={thumbnail}
                alt={`Shot ${shot.index} preview (${shot.shotSize || "Unknown"})`}
                className="inspector-shot-thumb"
              />
            </div>
          )}
          <div className="inspector-shot-info">
            <div className="shot-number-row">
              <h2>Shot {String(shot.index).padStart(3, "0")}</h2>
              <span
                className={`review-badge ${
                  isConfirmed
                    ? "status-confirmed"
                    : isUncertain
                    ? "status-uncertain"
                    : "status-needs-review"
                }`}
              >
                {isConfirmed
                  ? "CONFIRMED"
                  : isUncertain
                  ? "UNCERTAIN"
                  : shot.suggestion
                  ? "AI SUGGESTION"
                  : "NEEDS REVIEW"}
              </span>
            </div>
            <div className="shot-meta-details mono">
              <span>{shot.startTimecode} → {shot.endTimecode}</span>
              <span className="meta-sep">·</span>
              <span>{shot.duration.toFixed(3)}s</span>
            </div>
            <span className="shot-reel-info muted">
              Reel: {shot.sourceReel} · Transition: {shot.transition}
            </span>
          </div>
        </div>

        {/* Studio Mode Calm Framing Chip & Concise Evidence Rows */}
        {isStudio && (
          <div className="studio-inspector-summary">
            <div className="studio-shot-size-chip-wrap">
              <div className="studio-shot-size-chip" title="Click to edit shot size">
                <span className="chip-size-abbr">{shot.shotSize || "Unknown"}</span>
                <span className="chip-edit-icon" aria-hidden="true">✎</span>
                <select
                  id="shot-size-select"
                  aria-label="Shot size"
                  className="studio-chip-select"
                  disabled={shot.content === "Text / title card"}
                  value={shot.shotSize}
                  onChange={(e) =>
                    onEditShot({
                      shotSize: e.target.value as Shot["shotSize"],
                      uncertain: false,
                    })
                  }
                >
                  {shotSizes.map((s) => (
                    <option key={s} value={s}>
                      {s === "Unknown" || s === "Not applicable" ? s : `${s} — ${shotSizeLabels[s as Shot["shotSize"]] || s}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="studio-concise-evidence">
              <div className="concise-row">
                <div className="concise-label">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span>Duration</span>
                </div>
                <span className="concise-value mono">{shot.duration.toFixed(1)}s</span>
              </div>
              <div className="concise-row">
                <div className="concise-label">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
                  <span>Cut</span>
                </div>
                <span className="concise-value">{shot.transition?.toLowerCase() || "hard"}</span>
              </div>
              <div className="concise-row">
                <div className="concise-label">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  <span>Dialogue</span>
                </div>
                <span className="concise-value">{hasDialogue ? "present" : "none"}</span>
              </div>
              <div className="concise-row">
                <div className="concise-label">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
                  <span>Framing</span>
                </div>
                <span className={`concise-value status-${isConfirmed ? "confirmed" : isUncertain ? "uncertain" : "review"}`}>
                  {isConfirmed ? "confirmed" : isUncertain ? "uncertain" : "needs review"}
                </span>
              </div>
            </div>

            <button
              type="button"
              className="studio-details-toggle-btn"
              onClick={() => setShowDetailedEvidence(!showDetailedEvidence)}
            >
              <span>{showDetailedEvidence ? "Hide Detailed Evidence ▲" : "Detailed Evidence & AI Tools ▼"}</span>
            </button>
          </div>
        )}

        {showDetailedEvidence && (
          <div className="inspector-detailed-section">
            {/* Color Profile (if present) */}
        {shot.colorProfile && (
          <div className="shot-color-section">
            <div className="color-headline">
              <span className="color-mood-badge">{shot.colorProfile.mood}</span>
              <span className="color-luma-badge">
                {Math.round(shot.colorProfile.luminance * 100)}% Luma
              </span>
              {copiedColor && <span className="copy-confirmation">Copied {copiedColor}!</span>}
            </div>
            <div className="color-swatches-row" aria-label="Dominant color palette">
              {shot.colorProfile.palette.map((hex, idx) => (
                <button
                  type="button"
                  key={idx}
                  className="color-chip"
                  style={{ backgroundColor: hex }}
                  title={`Copy hex ${hex}`}
                  onClick={() => handleCopyColor(hex)}
                >
                  <span className="chip-hex">{hex}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Shot Size / Framing */}
        <div className="inspector-field-group">
          <div className="field-label-row">
            <label htmlFor="shot-size-select">
              <b>Shot size / Framing</b>
            </label>
            {shot.content === "Text / title card" && (
              <span className="field-hint muted">Title card (no size)</span>
            )}
          </div>

          {useGridSizes ? (
            <div className="shot-size-grid" role="group" aria-label="Select Shot Size">
              {gridShotSizes.map((size) => {
                const shortcut = sizeShortcuts[size];
                const isSelected = shot.shotSize === size;
                return (
                  <button
                    type="button"
                    key={size}
                    disabled={shot.content === "Text / title card"}
                    className={`size-grid-btn ${isSelected ? "selected" : ""}`}
                    onClick={() =>
                      onEditShot({
                        shotSize: size,
                        uncertain: false,
                      })
                    }
                    title={`${size}: ${shotSizeLabels[size]} ${shortcut ? `(Key: ${shortcut})` : ""}`}
                  >
                    <span className="grid-btn-abbr">{size}</span>
                    <span className="grid-btn-name">{shotSizeLabels[size]}</span>
                    {shortcut && <kbd className="grid-btn-key">{shortcut}</kbd>}
                  </button>
                );
              })}
            </div>
          ) : (
            <select
              id="shot-size-select"
              aria-label="Shot size"
              title={shotSizeDescriptions[shot.shotSize]}
              disabled={shot.content === "Text / title card"}
              value={shot.shotSize}
              onChange={(e) =>
                onEditShot({
                  shotSize: e.target.value as Shot["shotSize"],
                })
              }
            >
              {[
                ...selectableShotSizes,
                "Not applicable",
                ...(!selectableShotSizes.includes(shot.shotSize as typeof selectableShotSizes[number]) && shot.shotSize !== "Not applicable" ? [shot.shotSize] : []),
              ].map((s) => (
                <option
                  key={s}
                  value={s}
                  title={shotSizeDescriptions[s as Shot["shotSize"]]}
                >
                  {s === "Unknown" || s === "Not applicable"
                    ? s
                    : `${s} — ${shotSizeLabels[s as Shot["shotSize"]]}${
                        sizeShortcuts[s] ? ` (${sizeShortcuts[s]})` : ""
                      }`}
                </option>
              ))}
            </select>
          )}

          {shot.suggestion && (
            <div className="suggestion-callout">
              <span className="suggestion-icon">✨</span>
              <span className="suggestion-text">
                Suggested by AI: <b>{shot.suggestion.shotSize}</b> ({shotSizeLabels[shot.suggestion.shotSize]})
              </span>
            </div>
          )}
        </div>

        {/* Composition: People count & Main subject */}
        <div className="inspector-two-cols">
          <label>
            <span>People in frame</span>
            <select
              aria-label="People in frame"
              title="Count featured people; ignore incidental background figures."
              value={shot.composition ?? "Unknown"}
              onChange={(e) =>
                onEditShot({
                  composition: e.target.value as Shot["composition"],
                })
              }
            >
              {Object.entries(peopleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Main subject</span>
            <select
              aria-label="Main subject"
              title="What is primarily shown?"
              value={shot.content ?? "Unknown"}
              onChange={(e) =>
                onEditShot({
                  content: e.target.value as Shot["content"],
                })
              }
            >
              {Object.entries(subjectLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Camera Movement & Kinetic Energy */}
        <div className="inspector-field-group motion-field-group">
          <div className="field-label-row">
            <label>
              <b>Camera Movement</b>
            </label>
            <button
              type="button"
              className="scan-motion-btn"
              onClick={handleScanMotion}
              disabled={scanningMotion || !url}
              title="Analyze camera motion & subject energy from video"
            >
              {scanningMotion ? "Scanning…" : "⚡ Detect Motion"}
            </button>
          </div>

          <div className="camera-movement-pills" role="group" aria-label="Camera Movement">
            {cameraMovementTypes.map((type) => {
              const currentMovement = shot.cameraMovement ?? shot.motionProfile?.cameraMovement ?? "Unknown";
              const isSelected = currentMovement === type;
              return (
                <button
                  type="button"
                  key={type}
                  className={`motion-pill-btn ${isSelected ? "selected" : ""}`}
                  onClick={() =>
                    onEditShot({
                      cameraMovement: type,
                    })
                  }
                  title={`Tag camera movement: ${type}`}
                >
                  <span className="motion-pill-icon">{cameraMovementIcons[type]}</span>
                  <span className="motion-pill-label">{type}</span>
                </button>
              );
            })}
          </div>

          {shot.motionProfile && (
            <div className="kinetic-energy-card">
              <div className="kinetic-headline">
                <span className="kinetic-title">Kinetic Energy Breakdown</span>
                <span
                  className={`kinetic-total-badge ${
                    shot.motionProfile.totalKineticEnergy > 50 ? "high" : "normal"
                  }`}
                >
                  ⚡ {shot.motionProfile.totalKineticEnergy}% TOTAL
                </span>
              </div>
              <div className="kinetic-gauges-grid">
                <div className="kinetic-gauge">
                  <div className="gauge-label">
                    <span>🎥 Camera (Global)</span>
                    <b>{shot.motionProfile.cameraEnergy}%</b>
                  </div>
                  <div className="gauge-bar-track">
                    <div
                      className="gauge-bar-fill camera"
                      style={{ width: `${shot.motionProfile.cameraEnergy}%` }}
                    />
                  </div>
                </div>
                <div className="kinetic-gauge">
                  <div className="gauge-label">
                    <span>🏃 Subject (Internal)</span>
                    <b>{shot.motionProfile.subjectEnergy}%</b>
                  </div>
                  <div className="gauge-bar-track">
                    <div
                      className="gauge-bar-fill subject"
                      style={{ width: `${shot.motionProfile.subjectEnergy}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {shot.suggestion?.cameraMovement && shot.suggestion.cameraMovement !== shot.cameraMovement && (
            <div className="suggestion-callout">
              <span className="suggestion-icon">✨</span>
              <span className="suggestion-text">
                Suggested movement: <b>{shot.suggestion.cameraMovement}</b>
              </span>
            </div>
          )}
        </div>

        {/* Uncertainty Checkbox */}
        <label className="checkbox-row uncertain-row">
          <input
            type="checkbox"
            aria-label="Shot size uncertain"
            checked={shot.uncertain ?? false}
            onChange={(e) => onEditShot({ uncertain: e.target.checked })}
          />
          <span>Shot size / framing is uncertain</span>
        </label>

        {/* Character Review */}
        <fieldset className="character-review-fieldset">
          <legend>Characters in Shot</legend>
          {!project.cast?.length ? (
            <p className="field-hint muted">
              No cast members added yet. Discover faces or add characters in the Cast tab.
            </p>
          ) : (
            <>
              <div className="character-checkboxes-grid">
                {project.cast.map((member) => {
                  const selectedIds =
                    shot.characterAnalysis?.manualMemberIds ?? [
                      ...new Set(
                        shot.characterAnalysis?.intervals.map((i) => i.memberId) ?? []
                      ),
                    ];
                  const isChecked = selectedIds.includes(member.id);
                  return (
                    <label key={member.id} className={`character-tag-pill ${isChecked ? "active" : ""}`}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(event) =>
                          onReviewCharacters(
                            shot.id,
                            event.target.checked
                              ? [...selectedIds, member.id]
                              : selectedIds.filter((id) => id !== member.id)
                          )
                        }
                      />
                      <span>{member.name}</span>
                    </label>
                  );
                })}
              </div>
              <span className="field-hint muted">
                {shot.characterAnalysis?.manualReviewStatus === "Confirmed"
                  ? shot.characterAnalysis.manualMemberIds?.length
                    ? "Confirmed manual shot assignment (shot-level)."
                    : "Confirmed: no cast in this shot."
                  : "Check to assign cast to this shot."}
              </span>
            </>
          )}
        </fieldset>

        {/* Notes */}
        <label className="notes-field">
          <span>Notes</span>
          <textarea
            aria-label="Notes"
            placeholder="Add director or editing notes for this shot…"
            value={shot.notes || ""}
            rows={2}
            onChange={(e) => onEditShot({ notes: e.target.value })}
          />
        </label>

        {/* Review Action Buttons */}
        <div className="inspector-actions-bar">
          <button
            type="button"
            className="primary primary-confirm-btn"
            onClick={onConfirmAndNext}
            aria-label="Confirm current tags"
            title={autoAdvance ? "Confirm classifications and advance to next unreviewed shot (Enter)" : "Confirm classifications (Enter)"}
          >
            <span>{autoAdvance ? "Confirm & next" : "Confirm"}</span>
            <kbd>↵</kbd>
          </button>
          <button
            type="button"
            className={`secondary-action-btn ${isUncertain ? "active" : ""}`}
            onClick={onMarkUncertain}
            title="Mark framing as uncertain"
          >
            {isUncertain ? "Unmark uncertain" : "Mark uncertain"}
          </button>
        </div>

        {/* Single Shot Local AI Analysis */}
        <ShotAnalysis
          key={`${project.id}-${shot.id}-${url}`}
          shot={shot}
          url={url}
          disabled={scanningAll}
          onBusyChange={onBusyChange}
          onPreview={onPreview}
          onUpdate={(patch) => onModelResult(project.id, shot.id, patch)}
          onFailure={(failure) =>
            onModelResult(project.id, shot.id, {
              analysisFailures: {
                framing: { message: failure, createdAt: new Date().toISOString() },
              },
            })
          }
          onNext={onNext}
        />
          </div>
        )}
      </div>
    </aside>
  );
}
