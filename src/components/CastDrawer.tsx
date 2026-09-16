import { useMemo, useState } from "react";
import type { CastMember, Project, Shot } from "../models/project";
import {
  alternations,
  appearanceGaps,
  sharedPresence,
  type PresenceRange,
} from "../analysis/characterPresence";

const duration = (intervals: { startSeconds: number; endSeconds: number }[]) =>
  intervals.reduce((total, interval) => total + Math.max(0, interval.endSeconds - interval.startSeconds), 0);

const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export interface CastDrawerProps {
  project: Project;
  shot?: Shot;
  time: number;
  thumbnails?: Record<string, string>;
  range?: { start: number; end: number };
  selectedMember?: string;
  disabled?: boolean;
  onSelect: (memberId?: string) => void;
  onAdd: (name: string) => void;
  onReference: (memberId: string) => Promise<void>;
  onRemove: (memberId: string) => void;
  onRename?: (memberId: string, newName: string) => void;
  onMerge?: (sourceMemberId: string, targetMemberId: string) => void;
  onInspect: (shot: Shot) => void;
  onConfirmShot: (shotId: string) => void;
  onRemoveAppearance: (shotId: string, memberId: string) => void;
  onRangeChange: (range?: PresenceRange) => void;
  onPlayRange: (range: PresenceRange) => void;
  onSeek: (time: number) => void;
  onClose: () => void;
}

export default function CastDrawer({
  project,
  shot,
  time,
  thumbnails = {},
  range,
  selectedMember,
  disabled = false,
  onSelect,
  onAdd,
  onReference,
  onRemove,
  onRename,
  onMerge,
  onInspect,
  onConfirmShot,
  onRemoveAppearance,
  onRangeChange,
  onPlayRange,
  onSeek,
  onClose,
}: CastDrawerProps) {
  const cast = project.cast ?? [];
  const activeMemberId = selectedMember || cast[0]?.id;
  const selectedMemberObj = cast.find((m) => m.id === activeMemberId);

  const [newCharName, setNewCharName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState("");
  const [comparisonMember, setComparisonMember] = useState<string>();

  const referenceCount = cast.reduce((total, member) => total + member.references.length, 0);
  const timelineDuration = Math.max(1, project.duration || 1);

  // Compile all intervals and manual assignments
  const allSummary = useMemo(() => {
    return cast.map((member) => {
      const intervals = project.shots.flatMap((s) => {
        const analysis = s.characterAnalysis;
        // A confirmed manual decision is the source of truth for this shot
        if (analysis?.manualReviewStatus === "Confirmed") return [];
        return (analysis?.intervals ?? [])
          .filter((interval) => interval.memberId === member.id)
          .map((interval) => ({ ...interval, shot: s }));
      });
      const seconds = duration(intervals);
      const shots = new Map(intervals.map((interval) => [interval.shot.id, interval.shot])).values();
      const manualShots = project.shots.filter(
        (s) =>
          s.characterAnalysis?.manualReviewStatus === "Confirmed" &&
          s.characterAnalysis.manualMemberIds?.includes(member.id)
      );
      return {
        member,
        intervals,
        seconds,
        shots: [...new Map([...shots, ...manualShots].map((s) => [s.id, s])).values()],
        manualShots,
      };
    });
  }, [cast, project.shots]);

  // Selected member data
  const selectedSummary = useMemo(() => {
    return allSummary.find((item) => item.member.id === activeMemberId);
  }, [allSummary, activeMemberId]);

  // Unified appearances list for selected member
  const appearancesList = useMemo(() => {
    if (!selectedSummary) return [];
    const items: Array<{
      id: string;
      shot: Shot;
      isManual: boolean;
      startSeconds: number;
      endSeconds: number;
      reviewStatus: "Confirmed" | "Needs review";
    }> = [];

    selectedSummary.intervals.forEach((interval, idx) => {
      items.push({
        id: `interval-${interval.shot.id}-${idx}`,
        shot: interval.shot,
        isManual: false,
        startSeconds: interval.startSeconds,
        endSeconds: interval.endSeconds,
        reviewStatus:
          interval.reviewStatus === "Confirmed" ||
          interval.shot.characterAnalysis?.reviewStatus === "Confirmed"
            ? "Confirmed"
            : "Needs review",
      });
    });

    selectedSummary.manualShots.forEach((manualShot) => {
      items.push({
        id: `manual-${manualShot.id}`,
        shot: manualShot,
        isManual: true,
        startSeconds: manualShot.startSeconds,
        endSeconds: manualShot.endSeconds,
        reviewStatus: "Confirmed",
      });
    });

    return items.sort((a, b) => a.startSeconds - b.startSeconds);
  }, [selectedSummary]);

  // Comparison logic
  const comparison =
    activeMemberId && comparisonMember && comparisonMember !== activeMemberId
      ? ([
          allSummary.find((item) => item.member.id === activeMemberId),
          allSummary.find((item) => item.member.id === comparisonMember),
        ] as const)
      : undefined;

  const pairReadings =
    comparison?.[0] && comparison?.[1]
      ? {
          shared: sharedPresence(comparison[0].intervals, comparison[1].intervals, range),
          alternating: alternations(project.shots, comparison[0].member.id, comparison[1].member.id, range),
        }
      : undefined;

  const selectPassage = (passage: PresenceRange) => {
    onRangeChange(passage);
    if (passage.end > passage.start) onPlayRange(passage);
    else onSeek(passage.start);
  };

  // 6 ruler time points
  const rulerTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = timelineDuration / 5;
    for (let i = 0; i <= 5; i++) {
      ticks.push(Math.round(i * step));
    }
    return ticks;
  }, [timelineDuration]);

  const getAvatarSrc = (member: CastMember) => {
    if (member.references?.[0]?.image) {
      const img = member.references[0].image;
      return img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`;
    }
    return undefined;
  };

  return (
    <section className="cast-drawer panel" aria-label="Cast gallery drawer">
      {/* 1. Header */}
      <div className="cast-drawer-head">
        <div className="cast-drawer-title-group">
          <h2 className="cast-drawer-title">CAST GALLERY</h2>
          <p className="cast-drawer-subtitle">
            {cast.length} cast · {referenceCount} reference {referenceCount === 1 ? "view" : "views"}
          </p>
        </div>
        <button
          type="button"
          className="studio-drawer-close-btn cast-drawer-close-btn"
          onClick={onClose}
          title="Close cast drawer (Esc)"
          aria-label="Close cast drawer"
        >
          ✕
        </button>
      </div>

      <div className="cast-drawer-content">
        {/* 2. Cast Cards Row */}
        {cast.length > 0 ? (
          <div className="cast-drawer-cards" role="radiogroup" aria-label="Cast members">
            {cast.map((member) => {
              const isSelected = member.id === activeMemberId;
              const avatar = getAvatarSrc(member);
              return (
                <div
                  key={member.id}
                  className={`cast-card ${isSelected ? "selected" : ""}`}
                  onClick={() => onSelect(member.id)}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(member.id);
                    }
                  }}
                >
                  <div className="cast-card-img-wrap">
                    {avatar ? (
                      <img src={avatar} alt={member.name} className="cast-card-img" />
                    ) : (
                      <div className="portrait-empty">?</div>
                    )}
                    <button
                      type="button"
                      className="cast-card-remove-btn"
                      aria-label={`Remove ${member.name}`}
                      title={`Remove ${member.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(member.id);
                      }}
                    >
                      ×
                    </button>
                  </div>

                  <div className="cast-card-name-wrap" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="cast-card-name-input"
                      aria-label={`Rename ${member.name}`}
                      title="Click to rename"
                      value={editingId === member.id ? tempName : member.name}
                      onFocus={() => {
                        setEditingId(member.id);
                        setTempName(member.name);
                        onSelect(member.id);
                      }}
                      onChange={(e) => setTempName(e.target.value)}
                      onBlur={() => {
                        if (editingId === member.id) {
                          const trimmed = tempName.trim();
                          if (trimmed && trimmed !== member.name) {
                            onRename?.(member.id, trimmed);
                          }
                          setEditingId(null);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="cast-empty-box">
            <p className="cast-empty-msg">
              Characters can be automatically discovered using the scanner, or added manually with reference views you control.
            </p>
          </div>
        )}

        {/* 3. Cast Action Controls */}
        <div className="cast-drawer-actions">
          <div className="cast-actions-row">
            <button
              type="button"
              className="cast-action-btn"
              disabled={!shot || disabled || !selectedMemberObj}
              title={
                shot && selectedMemberObj
                  ? `Capture Shot ${shot.index} midpoint as reference view for ${selectedMemberObj.name}`
                  : "Select a shot and cast member first"
              }
              onClick={() => {
                if (selectedMemberObj) {
                  void onReference(selectedMemberObj.id);
                }
              }}
            >
              <span>+ Add view {selectedMemberObj ? `(to ${selectedMemberObj.name})` : ""}</span>
            </button>

            <div className="cast-merge-wrap">
              <select
                className="cast-action-select"
                aria-label={`Merge ${selectedMemberObj?.name || "character"} into another`}
                title="Merge this character into another"
                value=""
                disabled={!selectedMemberObj || cast.length < 2 || !onMerge}
                onChange={(e) => {
                  if (e.target.value && selectedMemberObj) {
                    onMerge?.(selectedMemberObj.id, e.target.value);
                    e.target.value = "";
                  }
                }}
              >
                <option value="" disabled>
                  🔗 Merge into…
                </option>
                {cast
                  .filter((other) => other.id !== selectedMemberObj?.id)
                  .map((other) => (
                    <option key={other.id} value={other.id}>
                      Merge into {other.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <form
            className="cast-add-row"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = newCharName.trim();
              if (trimmed) {
                onAdd(trimmed);
                setNewCharName("");
              }
            }}
          >
            <span className="cast-add-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
            </span>
            <input
              aria-label="Add a character"
              className="cast-add-input"
              placeholder="Add a character…"
              value={newCharName}
              onChange={(e) => setNewCharName(e.target.value)}
            />
          </form>
        </div>

        {/* 4. Character Appearances & Presence Arc */}
        <div className="cast-drawer-section">
          <div className="cast-drawer-section-head">
            <h3 className="cast-drawer-section-title">CHARACTER APPEARANCES</h3>
            <p className="cast-drawer-section-subtitle">Sampled presence and manual shot review</p>
          </div>

          <div className="cast-notice-box">
            <span className="cast-notice-icon" aria-hidden="true">ⓘ</span>
            <p className="cast-notice-text">
              Sampled intervals are estimates; midpoint results are markers, not measured screen time. A non-match is unresolved, never an absence.
            </p>
          </div>

          {cast.length > 0 && (
            <div className="presence-arc-card">
              {/* Time Ruler */}
              <div className="presence-ruler">
                {rulerTicks.map((t, idx) => (
                  <span key={idx} className="presence-ruler-tick">
                    {clock(t)}
                  </span>
                ))}
              </div>

              {/* Presence Lanes */}
              <div className="presence-lanes-container">
                {/* Vertical Playhead Needle */}
                <div
                  className="presence-playhead-line"
                  style={{ left: `calc(70px + ${(time / timelineDuration) * 100}% * ((100% - 70px) / 100))` }}
                  title={`Playhead: ${clock(time)}`}
                >
                  <div className="playhead-needle-cap top" />
                  <div className="playhead-needle-line" />
                  <div className="playhead-needle-cap bottom" />
                </div>

                {allSummary.map(({ member, intervals, manualShots }) => {
                  const isSelected = member.id === activeMemberId;
                  return (
                    <div
                      key={member.id}
                      className={`presence-arc-lane ${isSelected ? "selected" : ""}`}
                    >
                      <button
                        type="button"
                        className="presence-lane-name"
                        onClick={() => onSelect(member.id)}
                        title={`Select ${member.name}`}
                      >
                        {member.name}
                      </button>

                      <div
                        className="presence-lane-track"
                        aria-label={`${member.name} visible intervals`}
                      >
                        {/* Range Selection Highlight */}
                        {range && (
                          <div
                            className="presence-range-highlight"
                            style={{
                              left: `${(range.start / timelineDuration) * 100}%`,
                              width: `${((range.end - range.start) / timelineDuration) * 100}%`,
                            }}
                          />
                        )}

                        {/* Sampled Intervals */}
                        {intervals.map((interval, idx) => {
                          const isConfirmed =
                            interval.reviewStatus === "Confirmed" ||
                            interval.shot.characterAnalysis?.reviewStatus === "Confirmed";
                          return (
                            <button
                              key={`int-${interval.shot.id}-${idx}`}
                              type="button"
                              className={`presence-lane-block ${isConfirmed ? "confirmed" : ""}`}
                              title={`${member.name}: ${clock(interval.startSeconds)}–${clock(interval.endSeconds)} (${isConfirmed ? "Confirmed" : "Needs review"})`}
                              aria-label={`Play ${member.name} from ${clock(interval.startSeconds)} to ${clock(interval.endSeconds)}`}
                              style={{
                                left: `${(interval.startSeconds / timelineDuration) * 100}%`,
                                width: `${Math.max(0.6, ((interval.endSeconds - interval.startSeconds) / timelineDuration) * 100)}%`,
                              }}
                              onClick={() =>
                                selectPassage({
                                  start: interval.startSeconds,
                                  end: interval.endSeconds,
                                })
                              }
                            />
                          );
                        })}

                        {/* Manual Assignments */}
                        {manualShots.map((manual) => (
                          <button
                            key={`man-${manual.id}`}
                            type="button"
                            className="presence-lane-manual"
                            title={`${member.name}: manually assigned to Shot ${manual.index}; no timing inferred`}
                            aria-label={`Inspect manual ${member.name} assignment in Shot ${manual.index}`}
                            style={{
                              left: `${(((manual.startSeconds + manual.endSeconds) / 2) / timelineDuration) * 100}%`,
                            }}
                            onClick={() => onInspect(manual)}
                          />
                        ))}

                        {/* Unresolved Sample Points */}
                        {project.shots
                          .flatMap((s) => s.characterAnalysis?.unresolvedTimes ?? [])
                          .map((unresTime, idx) => (
                            <div
                              key={`unres-${unresTime}-${idx}`}
                              className="presence-lane-unresolved"
                              title={`Unresolved sample at ${clock(unresTime)}`}
                              style={{
                                left: `${(unresTime / timelineDuration) * 100}%`,
                              }}
                            />
                          ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="presence-arc-legend">
                <div className="legend-item">
                  <span className="legend-swatch sampled" />
                  <span>Sampled interval</span>
                </div>
                <div className="legend-item">
                  <span className="legend-swatch confirmed" />
                  <span>Confirmed interval</span>
                </div>
                <div className="legend-item">
                  <span className="legend-swatch manual" />
                  <span>Manual assignment</span>
                </div>
                <div className="legend-item">
                  <span className="legend-swatch unresolved" />
                  <span>Unresolved sample point</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 5. Selected Character Appearances List */}
        {selectedMemberObj && (
          <div className="cast-drawer-section appearances-list-section">
            <div className="appearances-section-head">
              <h3 className="appearances-section-title">
                {selectedMemberObj.name.toUpperCase()} — APPEARANCES
              </h3>

              <div className="compare-dropdown-wrap">
                <select
                  aria-label="Compare character presence"
                  className="cast-compare-select"
                  value={comparisonMember ?? ""}
                  onChange={(e) => setComparisonMember(e.target.value || undefined)}
                >
                  <option value="">Compare with…</option>
                  {cast
                    .filter((m) => m.id !== selectedMemberObj.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Comparison Findings if active */}
            {comparison?.[0] && comparison?.[1] && (
              <div className="pair-reading-box">
                <div className="pair-reading-head">
                  <span className="pair-reading-names">
                    {comparison[0].member.name} × {comparison[1].member.name}
                  </span>
                </div>
                <div className="pair-findings">
                  {pairReadings?.shared.length ? (
                    pairReadings.shared.map((passage, idx) => (
                      <button
                        key={`shared-${idx}`}
                        type="button"
                        className="presence-finding-pill"
                        onClick={() => selectPassage(passage)}
                      >
                        Shared visibility · {clock(passage.start)}–{clock(passage.end)}
                      </button>
                    ))
                  ) : (
                    <span className="muted">No sampled shared visibility in this selection.</span>
                  )}
                  {pairReadings?.alternating.map((passage, idx) => (
                    <button
                      key={`alt-${idx}`}
                      type="button"
                      className="presence-finding-pill"
                      onClick={() => selectPassage(passage)}
                    >
                      Separate-shot alternation · {clock(passage.start)}–{clock(passage.end)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Appearance Rows */}
            <div className="appearances-list">
              {appearancesList.length > 0 ? (
                appearancesList.map((item) => {
                  const shotThumb = thumbnails[item.shot.id] || getAvatarSrc(selectedMemberObj);
                  return (
                    <div key={item.id} className="appearance-row">
                      <div className="appearance-thumb-wrap">
                        {shotThumb ? (
                          <img src={shotThumb} alt={`Shot ${item.shot.index}`} className="appearance-thumb" />
                        ) : (
                          <div className="appearance-thumb-empty">Shot {item.shot.index}</div>
                        )}
                      </div>

                      <div className="appearance-info">
                        <div className="appearance-title">
                          {item.isManual && <span className="manual-diamond">◆</span>}
                          <span>Shot {String(item.shot.index).padStart(3, "0")}</span>
                          <span className="appearance-timing">
                            {item.isManual
                              ? "· manual assignment"
                              : `· ${clock(item.startSeconds)} – ${clock(item.endSeconds)}`}
                          </span>
                        </div>
                        <div className="appearance-status">
                          <span className={`status-dot ${item.reviewStatus === "Confirmed" ? "confirmed" : "needs-review"}`} />
                          <span className="status-text">{item.reviewStatus}</span>
                        </div>
                      </div>

                      <div className="appearance-actions">
                        <button
                          type="button"
                          className="appearance-action-btn inspect"
                          onClick={() => {
                            onInspect(item.shot);
                            onSeek(item.startSeconds);
                          }}
                          title={`Inspect Shot ${item.shot.index}`}
                        >
                          Inspect
                        </button>

                        {item.reviewStatus !== "Confirmed" && (
                          <button
                            type="button"
                            className="appearance-action-btn confirm"
                            onClick={() => onConfirmShot(item.shot.id)}
                            title="Confirm this character match"
                          >
                            Confirm
                          </button>
                        )}

                        <button
                          type="button"
                          className="appearance-action-btn remove"
                          onClick={() => onRemoveAppearance(item.shot.id, selectedMemberObj.id)}
                          title="Remove this mistaken match and protect the corrected shot on future scans"
                          aria-label="Remove appearance"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="appearances-empty-box">
                  <p className="muted">
                    No sampled or manual appearances found for {selectedMemberObj.name}.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
