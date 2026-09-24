import { useState } from "react";
import type { CameraMovementType, Project, Shot } from "../models/project";
import {
  cameraMovementTypes,
  peopleLabels,
  selectableShotSizes,
  subjectLabels,
} from "../models/project";
import {
  analyzeShotMotion,
  classifyKineticVelocity,
  classifyMomentumTransition,
} from "../analysis/motion";
import ShotAnalysis from "./ShotAnalysis";

const cameraMovementIcons: Record<CameraMovementType, React.ReactNode> = {
  Static: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  Pan: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  Tilt: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="5 12 12 5 19 12" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  ),
  "Dolly / Track": (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="2" x2="12" y2="22" />
      <polyline points="7 7 12 2 17 7" />
      <polyline points="7 17 12 22 17 17" />
    </svg>
  ),
  Handheld: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
    </svg>
  ),
  "Dynamic / Action": (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Zoom: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  ),
  Unknown: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

const shotSizeLabels: Record<Shot["shotSize"], string> = {
  "Extreme wide": "Extreme wide",
  Wide: "Wide",
  Full: "Full",
  American: "American",
  Medium: "Medium",
  "Medium close-up": "Medium close-up",
  Close: "Close",
  "Extreme close": "Extreme close",
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
  "Extreme wide": "Environment dominates; subject tiny or absent",
  Wide: "Subject small or surrounded by substantial environment",
  Full: "Full body or subject with contextual surroundings",
  American: "Approximately knees up; also called a cowboy shot",
  Medium: "Subject emphasis with meaningful environment retained",
  "Medium close-up": "Approximately chest up",
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

const shotSizeShortDescriptions: Partial<Record<Shot["shotSize"], string>> = {
  "Extreme wide": "Environment dominates",
  Wide: "Surroundings",
  Full: "Head to toe",
  American: "Knees up",
  Medium: "Waist up",
  "Medium close-up": "Chest up",
  Close: "Face / object",
  "Extreme close": "Tight detail",
  Unknown: "Undetermined",
};

const sizeShortcuts: Record<string, string> = {
  "Extreme wide": "1",
  Wide: "2",
  Full: "3",
  American: "4",
  Medium: "5",
  "Medium close-up": "6",
  Close: "7",
  "Extreme close": "8",
  Unknown: "U",
  // Legacy mappings for fallback
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
};

function getAvailableShotSizes(currentSize?: Shot["shotSize"]): Shot["shotSize"][] {
  const sizes: Shot["shotSize"][] = [
    ...selectableShotSizes,
    "MCU",
    "CU",
    "WS",
    "MS",
    "FS",
    "AS",
    "ECU",
    "EWS",
    "Not applicable",
  ];
  if (
    currentSize &&
    !sizes.includes(currentSize)
  ) {
    sizes.push(currentSize);
  }
  return sizes;
}

function formatShotSizeOption(s: Shot["shotSize"]): string {
  const shortcut = sizeShortcuts[s];
  const isLegacy =
    !selectableShotSizes.includes(s as (typeof selectableShotSizes)[number]) &&
    s !== "Not applicable";
  if (isLegacy) {
    const label = shotSizeLabels[s];
    return label && label !== s ? `${s} — ${label} (Legacy)` : `${s} (Legacy)`;
  }
  if (s === "Not applicable") {
    return "Not applicable";
  }
  return shortcut ? `${s} (${shortcut})` : s;
}

const gridShotSizes: Shot["shotSize"][] = [
  "Extreme wide",
  "Wide",
  "Full",
  "American",
  "Medium",
  "Medium close-up",
  "Close",
  "Extreme close",
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
      const rawProfile = await analyzeShotMotion(url, shot);
      const shotIndex = project.shots.findIndex((s) => s.id === shot.id);
      const prevShot = shotIndex > 0 ? project.shots[shotIndex - 1] : null;
      const kineticDelta =
        prevShot?.motionProfile?.totalKineticEnergy !== undefined
          ? Math.round(rawProfile.totalKineticEnergy - prevShot.motionProfile.totalKineticEnergy)
          : undefined;
      const profile = { ...rawProfile, kineticDelta };

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
                  {getAvailableShotSizes(shot.shotSize).map((s) => (
                    <option
                      key={s}
                      value={s}
                      title={shotSizeDescriptions[s as Shot["shotSize"]]}
                    >
                      {formatShotSizeOption(s)}
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
                    title={`${size}${shortcut ? ` (Key: ${shortcut})` : ""}${shotSizeDescriptions[size] ? ` — ${shotSizeDescriptions[size]}` : ""}`}
                  >
                    <span className="grid-btn-abbr">{size}</span>
                    <span className="grid-btn-name">{shotSizeShortDescriptions[size] || ""}</span>
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
              {getAvailableShotSizes(shot.shotSize).map((s) => (
                <option
                  key={s}
                  value={s}
                  title={shotSizeDescriptions[s as Shot["shotSize"]]}
                >
                  {formatShotSizeOption(s)}
                </option>
              ))}
            </select>
          )}

          {shot.suggestion && (
            <div className="suggestion-callout">
              <span className="suggestion-icon">✨</span>
              <span className="suggestion-text">
                Suggested by AI: <b>{shot.suggestion.shotSize}</b>
                {shotSizeDescriptions[shot.suggestion.shotSize]
                  ? ` — ${shotSizeDescriptions[shot.suggestion.shotSize]}`
                  : ""}
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "-1px", marginRight: 4 }}>
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span>{scanningMotion ? "Scanning…" : "Detect Motion"}</span>
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
                <span className="kinetic-title">Kinetic Energy Flow</span>
                <span
                  className={`kinetic-total-badge ${
                    shot.motionProfile.totalKineticEnergy > 50 ? "high" : "normal"
                  }`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "-1px", marginRight: 4 }}>
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  {shot.motionProfile.totalKineticEnergy}% Flow ({classifyKineticVelocity(shot.motionProfile.totalKineticEnergy)})
                </span>
              </div>
              <div className="kinetic-flow-gauge">
                <div className="gauge-bar-track">
                  <div
                    className="gauge-bar-fill unified-flow"
                    style={{ width: `${shot.motionProfile.totalKineticEnergy}%` }}
                  />
                </div>
              </div>
              {shot.motionProfile.kineticDelta !== undefined && (
                <div className="kinetic-momentum-row">
                  <span className="momentum-label">Cut Momentum Transition:</span>
                  <b
                    className={`momentum-value ${
                      classifyMomentumTransition(shot.motionProfile.kineticDelta).type
                    }`}
                  >
                    {classifyMomentumTransition(shot.motionProfile.kineticDelta).label}
                  </b>
                </div>
              )}
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
