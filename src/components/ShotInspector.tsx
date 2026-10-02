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

const shotSizeAbbreviations: Record<string, string> = {
  "Extreme wide": "EWS",
  Wide: "WS",
  Full: "FS",
  American: "AS",
  Medium: "MS",
  "Medium close-up": "MCU",
  Close: "CU",
  "Extreme close": "ECU",
  EWS: "EWS",
  WS: "WS",
  FS: "FS",
  AS: "AS",
  MS: "MS",
  MCU: "MCU",
  CU: "CU",
  ECU: "ECU",
  MWS: "MWS",
  Insert: "INS",
  OTS: "OTS",
  POV: "POV",
  Unknown: "UNK",
  "Not applicable": "N/A",
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
  EWS: "1",
  WS: "2",
  FS: "3",
  AS: "4",
  MS: "5",
  MCU: "6",
  CU: "7",
  ECU: "8",
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
    "Insert",
    "OTS",
    "POV",
    "Unknown",
    "Not applicable",
  ];
  if (currentSize && !sizes.includes(currentSize)) {
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
  onToggleCollapse,
  isDrawer = false,
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
  onToggleCollapse?: () => void;
  isDrawer?: boolean;
  useGridSizes?: boolean;
  autoAdvance?: boolean;
  isStudio?: boolean;
}) {
  const [copiedColor, setCopiedColor] = useState<string | null>(null);
  const [scanningMotion, setScanningMotion] = useState(false);

  if (!shot) {
    return (
      <aside className={`shot-inspector-panel panel ${isDrawer ? "drawer-mode" : ""} ${isStudio ? "mode-studio-inspector" : ""}`}>
        <div className="section-head inspector-head">
          <span className="eyebrow">SHOT INSPECTOR</span>
          {onToggleCollapse && (
            <button
              type="button"
              className="inspector-collapse-btn"
              onClick={onToggleCollapse}
              title="Collapse Inspector (Right Panel)"
              aria-label="Collapse Inspector"
            >
              ›|
            </button>
          )}
          {isDrawer && onCloseDrawer && (
            <button type="button" className="drawer-close-btn" onClick={onCloseDrawer} aria-label="Close drawer">
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

  const handleScanMotion = async () => {
    if (!url || !shot || scanningMotion) return;
    setScanningMotion(true);
    try {
      const rawProfile = await analyzeShotMotion(url, shot);
      const sIdx = project.shots.findIndex((s) => s.id === shot.id);
      const prevShot = sIdx > 0 ? project.shots[sIdx - 1] : null;
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

  const selectedCastIds =
    shot.characterAnalysis?.manualMemberIds ?? [
      ...new Set(shot.characterAnalysis?.intervals.map((i) => i.memberId) ?? []),
    ];

  return (
    <aside className={`shot-inspector-panel panel inspector ${isDrawer ? "drawer-mode" : ""} ${isStudio ? "mode-studio-inspector" : ""}`}>
      {/* 1. Header: Dense, Professional Editorial Bar */}
      <div className="section-head inspector-head">
        <div className="inspector-head-left">
          <span className="inspector-shot-title">Shot {String(shot.index).padStart(3, "0")}</span>
          <span className="inspector-pagination mono">
            {shotIndex}/{totalShots}
          </span>
          <span className="inspector-time-meta mono">
            {shot.duration.toFixed(2)}s
          </span>
        </div>

        <div className="inspector-head-right">
          <span
            className={`review-badge-compact ${
              isConfirmed
                ? "status-confirmed"
                : isUncertain
                ? "status-uncertain"
                : shot.suggestion
                ? "status-ai"
                : "status-review"
            }`}
            title={
              isConfirmed
                ? "Classification confirmed"
                : isUncertain
                ? "Marked as uncertain"
                : shot.suggestion
                ? `AI suggested ${shot.suggestion.shotSize}`
                : "Awaiting review"
            }
          >
            {isConfirmed ? "CONFIRMED" : isUncertain ? "UNCERTAIN" : shot.suggestion ? "AI" : "REVIEW"}
          </span>

          <div className="nav-arrows-group">
            <button
              type="button"
              className="btn-icon-sm"
              onClick={onPrevious}
              disabled={shotIndex <= 1}
              title="Previous shot (‹)"
              aria-label="Previous shot"
            >
              ‹
            </button>
            <button
              type="button"
              className="btn-icon-sm"
              onClick={onNext}
              disabled={shotIndex >= totalShots}
              title="Next shot (›)"
              aria-label="Next shot"
            >
              ›
            </button>
          </div>

          {onToggleCollapse && (
            <button
              type="button"
              className="inspector-collapse-btn"
              onClick={onToggleCollapse}
              title="Collapse Inspector (Right Panel)"
              aria-label="Collapse Inspector"
            >
              ›|
            </button>
          )}

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
        {/* 2. Framing & Shot Size (Fast Segmented Pills + Compact Select) */}
        <section className="inspector-section framing-section">
          <div className="inspector-section-label-row">
            <span className="inspector-section-label">Framing</span>
            {shot.suggestion && (
              <span className="inspector-ai-tag" title={`Suggested: ${shot.suggestion.shotSize}`}>
                ✨ AI: {shot.suggestion.shotSize}
              </span>
            )}
          </div>

          <div className="shot-size-pill-row" role="group" aria-label="Shot Size Quick Tags">
            {selectableShotSizes.map((size) => {
              const abbr = shotSizeAbbreviations[size] || size;
              const shortcut = sizeShortcuts[size];
              const isSelected = shot.shotSize === size;
              const isAiSuggested = shot.suggestion?.shotSize === size;

              return (
                <button
                  type="button"
                  key={size}
                  disabled={shot.content === "Text / title card"}
                  className={`size-pill-btn ${isSelected ? "selected" : ""} ${isAiSuggested ? "ai-suggested" : ""}`}
                  onClick={() =>
                    onEditShot({
                      shotSize: size,
                      uncertain: false,
                    })
                  }
                  title={`${size} (Key: ${shortcut}) — ${shotSizeDescriptions[size] || ""}`}
                >
                  <span className="pill-abbr">{abbr}</span>
                  {shortcut && <kbd className="pill-key">{shortcut}</kbd>}
                  {isAiSuggested && !isSelected && <span className="pill-sparkle" title="AI suggested" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          {/* Hidden select preserved for test compatibility and form accessibility */}
          <select
            id="shot-size-select"
            aria-label="Shot size"
            disabled={shot.content === "Text / title card"}
            value={shot.shotSize}
            onChange={(e) =>
              onEditShot({
                shotSize: e.target.value as Shot["shotSize"],
                uncertain: false,
              })
            }
            style={{ display: "none" }}
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
        </section>

        {/* 3. Composition & Camera Movement */}
        <section className="inspector-section composition-section">
          <div className="composition-fields-row">
            <label className="compact-field-inline">
              <span className="compact-field-label">Subject</span>
              <select
                aria-label="Main subject"
                value={shot.content ?? "Unknown"}
                onChange={(e) =>
                  onEditShot({
                    content: e.target.value as Shot["content"],
                  })
                }
                className="compact-select"
                style={{
                  width: `calc(${(subjectLabels[shot.content as keyof typeof subjectLabels] || shot.content || "Unknown").length}ch + 30px)`,
                }}
              >
                {Object.entries(subjectLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="compact-field-inline">
              <span className="compact-field-label">People</span>
              <select
                aria-label="People in frame"
                value={shot.composition ?? "Unknown"}
                onChange={(e) =>
                  onEditShot({
                    composition: e.target.value as Shot["composition"],
                  })
                }
                className="compact-select"
                style={{
                  width: `calc(${(peopleLabels[shot.composition as keyof typeof peopleLabels] || shot.composition || "Unknown").length}ch + 30px)`,
                }}
              >
                {Object.entries(peopleLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="camera-motion-compact-row">
            <label className="compact-field-inline">
              <span className="compact-field-label">Camera Movement</span>
              <select
                aria-label="Camera Movement"
                value={shot.cameraMovement ?? shot.motionProfile?.cameraMovement ?? "Unknown"}
                onChange={(e) =>
                  onEditShot({
                    cameraMovement: e.target.value as CameraMovementType,
                  })
                }
                className="compact-select"
                style={{
                  width: `calc(${(shot.cameraMovement ?? shot.motionProfile?.cameraMovement ?? "Unknown").length}ch + 30px)`,
                }}
              >
                {cameraMovementTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="scan-motion-compact-btn"
              onClick={handleScanMotion}
              disabled={scanningMotion || !url}
              title="Detect camera motion and kinetic flow from video"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span>{scanningMotion ? "Scanning…" : "Detect"}</span>
            </button>
          </div>
        </section>

        {/* 4. Characters in Shot (Inline Pills) */}
        <section className="inspector-section characters-section">
          <div className="inspector-section-label-row">
            <span className="inspector-section-label">Cast in Shot</span>
            {shot.characterAnalysis?.manualReviewStatus === "Confirmed" && (
              <span className="inspector-cast-status confirmed">Assigned</span>
            )}
          </div>

          {!project.cast?.length ? (
            <div className="cast-empty-hint">
              <span>No cast added yet. Discover faces or add characters in Cast deck.</span>
            </div>
          ) : (
            <div className="character-pill-wrap" role="group" aria-label="Toggle characters">
              {project.cast.map((member) => {
                const isChecked = selectedCastIds.includes(member.id);
                return (
                  <button
                    type="button"
                    key={member.id}
                    className={`char-toggle-pill ${isChecked ? "active" : ""}`}
                    onClick={() =>
                      onReviewCharacters(
                        shot.id,
                        isChecked
                          ? selectedCastIds.filter((id) => id !== member.id)
                          : [...selectedCastIds, member.id]
                      )
                    }
                    title={`${isChecked ? "Remove" : "Assign"} ${member.name}`}
                  >
                    <span className="char-check-icon">{isChecked ? "✓" : "+"}</span>
                    <span className="char-name">{member.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* 5. Sensory & Dynamics (Color & Kinetic in 1 Compact Row) */}
        {(shot.colorProfile || shot.motionProfile) && (
          <section className="inspector-section sensory-compact-section">
            {shot.colorProfile && (
              <div className="sensory-color-strip">
                <div className="swatches-strip" aria-label="Color Palette">
                  {shot.colorProfile.palette.map((hex, idx) => (
                    <button
                      type="button"
                      key={idx}
                      className="swatch-dot"
                      style={{ backgroundColor: hex }}
                      title={`Copy ${hex}`}
                      onClick={() => handleCopyColor(hex)}
                    />
                  ))}
                  {copiedColor && <span className="copy-hint">Copied!</span>}
                </div>
                <span className="sensory-meta-label">
                  {shot.colorProfile.mood} · {Math.round(shot.colorProfile.luminance * 100)}% Luma
                </span>
              </div>
            )}

            {shot.motionProfile && (
              <div className="sensory-motion-strip">
                <span className="motion-meta-badge">
                  ⚡ {shot.motionProfile.totalKineticEnergy}% Flow ({classifyKineticVelocity(shot.motionProfile.totalKineticEnergy)})
                </span>
                {shot.motionProfile.kineticDelta !== undefined && (
                  <span className="momentum-meta-badge">
                    {classifyMomentumTransition(shot.motionProfile.kineticDelta).label}
                  </span>
                )}
              </div>
            )}
          </section>
        )}

        {/* 6. Notes Input */}
        <section className="inspector-section notes-section">
          <input
            type="text"
            className="compact-notes-input"
            aria-label="Notes"
            placeholder="Add note for this shot…"
            value={shot.notes || ""}
            onChange={(e) => onEditShot({ notes: e.target.value })}
          />
        </section>
      </div>

      {/* 7. Action Footer: Sticky Buttons & Local CV */}
      <div className="inspector-footer-bar">
        <div className="inspector-footer-actions">
          <button
            type="button"
            className={`inspector-btn-uncertain ${isUncertain ? "active" : ""}`}
            onClick={onMarkUncertain}
            title={isUncertain ? "Unmark uncertain" : "Mark framing as uncertain"}
          >
            {isUncertain ? "Uncertain ✓" : "? Uncertain"}
          </button>

          <button
            type="button"
            className="primary primary-confirm-btn inspector-btn-confirm"
            onClick={onConfirmAndNext}
            aria-label="Confirm current tags"
            title={autoAdvance ? "Confirm classifications and advance to next shot (Enter)" : "Confirm classifications (Enter)"}
          >
            <span>{autoAdvance ? "Confirm & next" : "Confirm"}</span>
            <kbd>↵</kbd>
          </button>
        </div>

        <div className="inspector-cv-footer">
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
      </div>
    </aside>
  );
}
