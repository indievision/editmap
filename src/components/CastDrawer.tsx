import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { CastMember, CharacterInterval, Project, Shot } from "../models/project";
import {
  alternations,
  sharedPresence,
  type PresenceRange,
} from "../analysis/characterPresence";

export const CAST_PALETTE = [
  "#d97764", // terracotta
  "#7ca381", // sage green
  "#8e7cc3", // purple
  "#d4a34b", // warm gold
  "#c97282", // rose
  "#6ba3cf", // steel blue
];

export function getMemberColor(memberId: string, cast: CastMember[]): string {
  const index = cast.findIndex((m) => m.id === memberId);
  return CAST_PALETTE[(index >= 0 ? index : 0) % CAST_PALETTE.length];
}

const formatClock = (seconds: number) => {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.floor(Math.max(0, seconds) % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
  onReviewCharacters?: (shotId: string, memberIds: string[]) => void;
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
  onReviewCharacters,
  onRangeChange,
  onPlayRange,
  onSeek,
  onClose,
}: CastDrawerProps) {
  const containerRef = useRef<HTMLElement>(null);
  const [isEnlarged, setIsEnlarged] = useState(false);

  // Responsive observer for container width: threshold 620px
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsEnlarged(entry.contentRect.width >= 620);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cast = project.cast ?? [];
  const activeMemberId = selectedMember || cast[0]?.id;
  const selectedMemberObj = cast.find((m) => m.id === activeMemberId) || cast[0];

  const [isAddingChar, setIsAddingChar] = useState(false);
  const [newCharName, setNewCharName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState("");
  const [showMergeSelect, setShowMergeSelect] = useState(false);
  const [comparisonMember, setComparisonMember] = useState<string | undefined>();
  const [selectedShotId, setSelectedShotId] = useState<string | undefined>(shot?.id);
  const [hoveredShotId, setHoveredShotId] = useState<string | null>(null);

  // Sync selectedShotId if external shot changes
  useEffect(() => {
    if (shot?.id) setSelectedShotId(shot.id);
  }, [shot?.id]);

  const timelineDuration = Math.max(1, project.duration || 1);

  // Pointer-capture drag seeking for cast distribution chart
  const isDraggingChartRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const hasDraggedChartRef = useRef(false);

  const seekFromChartClientX = useCallback(
    (clientX: number, chartEl: HTMLElement) => {
      const rect = chartEl.getBoundingClientRect();
      const clickX = clientX - rect.left - 70; // 70px left gutter for names
      const trackWidth = rect.width - 70;
      if (trackWidth > 0 && timelineDuration > 0) {
        const seekRatio = Math.max(0, Math.min(1, clickX / trackWidth));
        onSeek(seekRatio * timelineDuration);
      }
    },
    [onSeek, timelineDuration],
  );

  const handleChartPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".distribution-row-name")) return;

    isDraggingChartRef.current = true;
    hasDraggedChartRef.current = false;
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    seekFromChartClientX(e.clientX, e.currentTarget);
  };

  const handleChartPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingChartRef.current) return;
    if (dragStartPosRef.current) {
      const dist = Math.hypot(e.clientX - dragStartPosRef.current.x, e.clientY - dragStartPosRef.current.y);
      if (dist > 3) hasDraggedChartRef.current = true;
    }
    seekFromChartClientX(e.clientX, e.currentTarget);
  };

  const handleChartPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingChartRef.current) return;
    isDraggingChartRef.current = false;
    dragStartPosRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // Check if active selected character is present in currently selected shot
  const isMemberInCurrentShot = useMemo(() => {
    if (!shot || !selectedMemberObj) return false;
    const manual = shot.characterAnalysis?.manualMemberIds;
    if (manual) return manual.includes(selectedMemberObj.id);
    const intervals = shot.characterAnalysis?.intervals ?? [];
    return intervals.some((i) => i.memberId === selectedMemberObj.id);
  }, [shot, selectedMemberObj]);

  const handleToggleCurrentShotAssignment = () => {
    if (!shot || !selectedMemberObj || !onReviewCharacters) return;
    const currentManual = shot.characterAnalysis?.manualMemberIds;
    const currentIds = currentManual ?? [
      ...new Set(shot.characterAnalysis?.intervals.map((i) => i.memberId) ?? []),
    ];
    const nextIds = isMemberInCurrentShot
      ? currentIds.filter((id) => id !== selectedMemberObj.id)
      : [...currentIds, selectedMemberObj.id];
    onReviewCharacters(shot.id, nextIds);
  };

  // Map of shotId -> set of cast memberIds present in that shot
  const shotsCastMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of project.shots) {
      const set = new Set<string>();
      const ca = s.characterAnalysis;
      if (ca) {
        if (ca.manualReviewStatus === "Confirmed" && ca.manualMemberIds) {
          for (const id of ca.manualMemberIds) {
            if (cast.some((m) => m.id === id)) set.add(id);
          }
        } else if (ca.intervals) {
          for (const inv of ca.intervals) {
            if (cast.some((m) => m.id === inv.memberId)) set.add(inv.memberId);
          }
        }
      }
      map.set(s.id, set);
    }
    return map;
  }, [project.shots, cast]);

  // Shots where 2 or more cast members appear together
  const overlappingShots = useMemo(() => {
    const overlaps: Array<{
      shot: Shot;
      startSeconds: number;
      endSeconds: number;
      members: CastMember[];
    }> = [];

    for (const s of project.shots) {
      const presentIds = shotsCastMap.get(s.id);
      if (presentIds && presentIds.size >= 2) {
        const members = Array.from(presentIds)
          .map((id) => cast.find((m) => m.id === id))
          .filter(Boolean) as CastMember[];
        overlaps.push({
          shot: s,
          startSeconds: s.startSeconds,
          endSeconds: s.endSeconds,
          members,
        });
      }
    }

    return overlaps.sort((a, b) => a.startSeconds - b.startSeconds);
  }, [project.shots, shotsCastMap, cast]);

  // Compile summary of appearances for all characters with duration lines covering time
  const allSummary = useMemo(() => {
    return cast.map((member) => {
      const segmentMap = new Map<
        string,
        {
          id: string;
          shot: Shot;
          startSeconds: number;
          endSeconds: number;
          isManual: boolean;
          isConfirmed: boolean;
          overlappingMemberIds: string[];
        }
      >();

      for (const s of project.shots) {
        const ca = s.characterAnalysis;
        if (!ca) continue;

        const isManual =
          ca.manualReviewStatus === "Confirmed" &&
          (ca.manualMemberIds?.includes(member.id) ?? false);

        const memberIntervals =
          ca.manualReviewStatus !== "Confirmed" && ca.intervals
            ? ca.intervals.filter((i) => i.memberId === member.id)
            : [];

        if (!isManual && memberIntervals.length === 0) continue;

        const isConfirmed =
          isManual ||
          ca.reviewStatus === "Confirmed" ||
          memberIntervals.some((i) => i.reviewStatus === "Confirmed");

        // The appearance covers the shot's duration across time,
        // or the trimmed sub-shot span if explicit duration is present.
        let start = s.startSeconds;
        let end = s.endSeconds;
        if (!isManual && memberIntervals.length > 0) {
          const hasExplicitSpan = memberIntervals.some(
            (i) => i.endSeconds > i.startSeconds + 0.1,
          );
          if (hasExplicitSpan) {
            start = Math.max(s.startSeconds, Math.min(...memberIntervals.map((i) => i.startSeconds)));
            end = Math.min(s.endSeconds, Math.max(...memberIntervals.map((i) => i.endSeconds)));
          }
        }

        const presentInShot = shotsCastMap.get(s.id) ?? new Set();
        const overlappingMemberIds = Array.from(presentInShot).filter((id) => id !== member.id);

        segmentMap.set(s.id, {
          id: `seg-${member.id}-${s.id}`,
          shot: s,
          startSeconds: start,
          endSeconds: end,
          isManual,
          isConfirmed,
          overlappingMemberIds,
        });
      }

      const segments = Array.from(segmentMap.values()).sort(
        (a, b) => a.startSeconds - b.startSeconds,
      );

      const uniqueShots = segments.map((seg) => seg.shot);

      const presenceIntervals: CharacterInterval[] = segments.map((seg) => ({
        memberId: member.id,
        startSeconds: seg.startSeconds,
        endSeconds: seg.endSeconds,
        reviewStatus: seg.isConfirmed ? ("Confirmed" as const) : ("Needs review" as const),
      }));

      return {
        member,
        segments,
        uniqueShots,
        presenceIntervals,
      };
    });
  }, [cast, project.shots, shotsCastMap]);

  const selectedSummary = useMemo(() => {
    return allSummary.find((item) => item.member.id === activeMemberId);
  }, [allSummary, activeMemberId]);

  // Unified appearances list for selected member
  const appearancesList = useMemo(() => {
    if (!selectedSummary) return [];
    return selectedSummary.segments.map((seg) => ({
      id: seg.id,
      shot: seg.shot,
      isManual: seg.isManual,
      startSeconds: seg.startSeconds,
      endSeconds: seg.endSeconds,
      reviewStatus: (seg.isConfirmed ? "Confirmed" : "Needs review") as "Confirmed" | "Needs review",
      overlappingMemberIds: seg.overlappingMemberIds,
    }));
  }, [selectedSummary]);

  // Currently focused shot in details
  const currentAppearanceShot = useMemo(() => {
    if (selectedShotId) {
      const found = project.shots.find((s) => s.id === selectedShotId);
      if (found) return found;
    }
    return appearancesList[0]?.shot ?? shot ?? project.shots[0];
  }, [selectedShotId, project.shots, appearancesList, shot]);

  const hoveredShot = useMemo(() => {
    return hoveredShotId ? project.shots.find((s) => s.id === hoveredShotId) : null;
  }, [hoveredShotId, project.shots]);

  // Pair comparison
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
          shared: sharedPresence(
            comparison[0].presenceIntervals,
            comparison[1].presenceIntervals,
            range,
          ),
          alternating: alternations(
            project.shots,
            comparison[0].member.id,
            comparison[1].member.id,
            range,
          ),
        }
      : undefined;

  const selectPassage = useCallback(
    (passage: PresenceRange) => {
      onRangeChange(passage);
      if (passage.end > passage.start) onPlayRange(passage);
      else onSeek(passage.start);
    },
    [onRangeChange, onPlayRange, onSeek],
  );

  // Time ruler tick marks: 5 evenly spaced intervals
  const rulerTicks = useMemo(() => {
    const count = 5;
    const step = timelineDuration / (count - 1);
    const ticks: number[] = [];
    for (let i = 0; i < count; i++) {
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

  const handleStartRename = (member: CastMember) => {
    setEditingId(member.id);
    setTempName(member.name);
  };

  const handleCommitRename = (memberId: string) => {
    if (editingId === memberId) {
      const trimmed = tempName.trim();
      if (trimmed && trimmed !== selectedMemberObj?.name) {
        onRename?.(memberId, trimmed);
      }
      setEditingId(null);
    }
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCharName.trim();
    if (trimmed) {
      onAdd(trimmed);
      setNewCharName("");
      setIsAddingChar(false);
    }
  };

  return (
    <section
      ref={containerRef}
      className={`cast-munari-container ${isEnlarged ? "view-enlarged" : "view-compact"}`}
      aria-label="Cast Gallery"
    >
      {/* ── 1. LEFT ROSTER COLUMN ── */}
      <aside className="cast-roster-column" aria-label="Cast members roster">
        <div className="cast-roster-list" role="radiogroup" aria-label="Characters">
          {cast.map((member) => {
            const isSelected = member.id === activeMemberId;
            const avatar = getAvatarSrc(member);
            const color = getMemberColor(member.id, cast);

            return (
              <div
                key={member.id}
                className={`cast-roster-card ${isSelected ? "selected" : ""}`}
                onClick={() => {
                  onSelect(member.id);
                  setShowMergeSelect(false);
                }}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(member.id);
                  }
                }}
                title={member.name}
              >
                {/* Active indicator bar */}
                {isSelected && <div className="roster-active-bar" />}

                {/* Avatar */}
                <div className="roster-avatar-wrap">
                  {avatar ? (
                    <img src={avatar} alt={member.name} className="roster-avatar-img" />
                  ) : (
                    <div className="roster-avatar-placeholder" style={{ background: color + "22", color }}>
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Name */}
                <span className="roster-member-name">{member.name}</span>

                {/* Color Dot */}
                <span
                  className="roster-color-dot"
                  style={{ backgroundColor: color }}
                  title={`Character color: ${member.name}`}
                />
              </div>
            );
          })}
        </div>

        {/* Add Character Form / Button */}
        <div className="cast-roster-footer">
          {isAddingChar ? (
            <form onSubmit={handleAddSubmit} className="roster-add-form">
              <input
                autoFocus
                type="text"
                className="roster-add-input"
                placeholder="Name..."
                value={newCharName}
                onChange={(e) => setNewCharName(e.target.value)}
                onBlur={() => {
                  if (!newCharName.trim()) setIsAddingChar(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setIsAddingChar(false);
                }}
              />
              <button type="submit" className="roster-add-submit-btn" disabled={!newCharName.trim()}>
                Add
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="roster-add-btn"
              onClick={() => setIsAddingChar(true)}
              title="Add a new character"
            >
              <span className="add-plus-icon">+</span> Add
            </button>
          )}
        </div>
      </aside>

      {/* ── 2. MAIN CONTENT AREA (COMPACT OR ENLARGED) ── */}
      <main className="cast-main-area">
        {selectedMemberObj ? (
          <>
            {/* ── ENLARGED VIEW: DISTRIBUTION OVERVIEW CHART ── */}
            {isEnlarged && (
              <section className="cast-distribution-section" aria-label="Across the film distribution">
                <div className="cast-distribution-header">
                  <span className="distribution-title">Across the film</span>
                  <span className="distribution-range mono">
                    00:00 — {formatClock(timelineDuration)}
                  </span>
                </div>

                {/* Interactive Multi-Row Timeline Chart */}
                <div
                  className="cast-distribution-chart"
                  onPointerDown={handleChartPointerDown}
                  onPointerMove={handleChartPointerMove}
                  onPointerUp={handleChartPointerUp}
                  onPointerCancel={handleChartPointerUp}
                  style={{ userSelect: "none", touchAction: "none" }}
                >
                  {/* Time Ruler Ticks */}
                  <div className="distribution-ruler">
                    <div className="ruler-gutter" />
                    <div className="ruler-ticks">
                      {rulerTicks.map((tick, idx) => (
                        <span
                          key={idx}
                          className="ruler-tick mono"
                          style={{ left: `${(tick / timelineDuration) * 100}%` }}
                        >
                          {formatClock(tick)}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Character Presence Lanes */}
                  <div className="distribution-lanes">
                    {/* Synchronized Playhead Line */}
                    <div
                      className="distribution-playhead"
                      style={{
                        left: `calc(70px + ${(time / timelineDuration) * 100}% * ((100% - 70px) / 100))`,
                      }}
                      title={`Playhead: ${formatClock(time)}`}
                    >
                      <div className="playhead-diamond" />
                      <div className="playhead-line" />
                    </div>

                    {/* Synchronized Hover Guide Beam across all tracks */}
                    {hoveredShot && (
                      <div
                        className="distribution-hover-guide"
                        style={{
                          left: `calc(70px + ${(hoveredShot.startSeconds / timelineDuration) * 100}% * ((100% - 70px) / 100))`,
                          width: `calc(${Math.max(0.6, ((hoveredShot.endSeconds - hoveredShot.startSeconds) / timelineDuration) * 100)}% * ((100% - 70px) / 100))`,
                        }}
                      />
                    )}

                    {/* Overlaps Summary Lane: highlights shots where 2+ characters are present */}
                    {overlappingShots.length > 0 && (
                      <div className="distribution-row overlap-summary-row">
                        <span
                          className="distribution-row-name overlap-row-label"
                          title="Shots where two or more characters appear together"
                        >
                          Overlaps
                        </span>
                        <div className="distribution-track overlap-track">
                          {overlappingShots.map(({ shot: oShot, startSeconds, endSeconds, members }) => {
                            const isHovered = hoveredShotId === oShot.id;
                            const spanWidth = Math.max(
                              0.6,
                              ((endSeconds - startSeconds) / timelineDuration) * 100,
                            );
                            const memberNames = members.map((m) => m.name).join(", ");
                            return (
                              <div
                                key={`overlap-${oShot.id}`}
                                className={`distribution-segment overlap-segment ${
                                  isHovered ? "hovered" : ""
                                }`}
                                style={{
                                  left: `${(startSeconds / timelineDuration) * 100}%`,
                                  width: `${spanWidth}%`,
                                }}
                                onClick={(e) => {
                                  if (hasDraggedChartRef.current) return;
                                  e.stopPropagation();
                                  setSelectedShotId(oShot.id);
                                  onInspect(oShot);
                                  onSeek(startSeconds);
                                }}
                                onMouseEnter={() => setHoveredShotId(oShot.id)}
                                onMouseLeave={() => setHoveredShotId(null)}
                                title={`Overlap · ${memberNames} · Shot ${oShot.index} (${formatClock(
                                  startSeconds,
                                )}–${formatClock(endSeconds)})`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {allSummary.map(({ member, segments }) => {
                      const isRowSelected = member.id === activeMemberId;
                      const memberColor = getMemberColor(member.id, cast);

                      return (
                        <div
                          key={member.id}
                          className={`distribution-row ${isRowSelected ? "selected" : ""}`}
                        >
                          <span
                            className="distribution-row-name"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect(member.id);
                            }}
                          >
                            {member.name}
                          </span>

                          <div className="distribution-track">
                            {/* Unanalysed background segments */}
                            {project.shots
                              .filter((s) => !s.characterAnalysis)
                              .map((unscanned) => (
                                <div
                                  key={`unscanned-${unscanned.id}`}
                                  className="distribution-segment unanalysed"
                                  style={{
                                    left: `${(unscanned.startSeconds / timelineDuration) * 100}%`,
                                    width: `${Math.max(
                                      0.4,
                                      ((unscanned.endSeconds - unscanned.startSeconds) /
                                        timelineDuration) *
                                        100,
                                    )}%`,
                                  }}
                                  title={`Shot ${unscanned.index}: Unanalysed`}
                                />
                              ))}

                            {/* Appearance Lines covering time */}
                            {segments.map((seg) => {
                              const spanWidth = Math.max(
                                0.6,
                                ((seg.endSeconds - seg.startSeconds) / timelineDuration) * 100,
                              );
                              const isHovered = hoveredShotId === seg.shot.id;
                              const hasOverlap = seg.overlappingMemberIds.length > 0;
                              const overlapNames = seg.overlappingMemberIds
                                .map((id) => cast.find((m) => m.id === id)?.name)
                                .filter(Boolean)
                                .join(", ");

                              return (
                                <div
                                  key={seg.id}
                                  className={`distribution-segment ${
                                    seg.isConfirmed ? "confirmed" : "needs-review"
                                  } ${seg.isManual ? "manual" : ""} ${
                                    hasOverlap ? "has-overlap" : ""
                                  } ${isHovered ? "hovered" : ""}`}
                                  style={{
                                    left: `${(seg.startSeconds / timelineDuration) * 100}%`,
                                    width: `${spanWidth}%`,
                                    backgroundColor: seg.isConfirmed
                                      ? memberColor
                                      : "rgba(18, 22, 26, 0.8)",
                                    borderColor: memberColor,
                                    color: memberColor,
                                  }}
                                  onClick={(e) => {
                                    if (hasDraggedChartRef.current) return;
                                    e.stopPropagation();
                                    onSelect(member.id);
                                    setSelectedShotId(seg.shot.id);
                                    onInspect(seg.shot);
                                    onSeek(seg.startSeconds);
                                  }}
                                  onMouseEnter={() => setHoveredShotId(seg.shot.id)}
                                  onMouseLeave={() => setHoveredShotId(null)}
                                  title={`${member.name} · Shot ${seg.shot.index} (${formatClock(
                                    seg.startSeconds,
                                  )}–${formatClock(seg.endSeconds)}) [${
                                    seg.isManual
                                      ? "Manual"
                                      : seg.isConfirmed
                                        ? "Confirmed"
                                        : "Needs review"
                                  }]${hasOverlap ? ` · Overlaps with: ${overlapNames}` : ""}`}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Distribution Legend */}
                  <div className="distribution-legend">
                    <span className="legend-item">
                      <span className="legend-swatch confirmed" /> Confirmed
                    </span>
                    <span className="legend-item">
                      <span className="legend-swatch needs-review" /> Needs review
                    </span>
                    <span className="legend-item">
                      <span className="legend-swatch manual" /> Manual
                    </span>
                    <span className="legend-item">
                      <span className="legend-swatch unanalysed" /> Unanalysed
                    </span>
                    {overlappingShots.length > 0 && (
                      <span className="legend-item">
                        <span className="legend-swatch overlap" /> Overlap (2+ cast)
                      </span>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* ── APPEARANCES DETAIL AREA ── */}
            <section className="cast-details-section" aria-label="Character appearances">
              {/* Header with Name & Actions */}
              <div className="cast-details-header">
                <div className="cast-details-title-wrap">
                  {editingId === selectedMemberObj.id ? (
                    <input
                      autoFocus
                      type="text"
                      className="cast-rename-input"
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      onBlur={() => handleCommitRename(selectedMemberObj.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCommitRename(selectedMemberObj.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <div className="cast-name-row">
                      <h2 className="cast-member-name">{selectedMemberObj.name}</h2>
                      <button
                        type="button"
                        className="cast-edit-pencil-btn"
                        onClick={() => handleStartRename(selectedMemberObj)}
                        title="Rename character"
                        aria-label="Rename character"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    </div>
                  )}

                  <span className="cast-shots-count">
                    {selectedSummary?.uniqueShots.length ?? 0} shots
                  </span>
                </div>

                {/* Action Links/Buttons */}
                <div className="cast-action-links">
                  <button
                    type="button"
                    className="cast-link-btn"
                    disabled={!shot || disabled}
                    onClick={() => void onReference(selectedMemberObj.id)}
                    title={
                      shot
                        ? `Capture Shot ${shot.index} midpoint as reference photo for ${selectedMemberObj.name}`
                        : "Select a shot in timeline first"
                    }
                  >
                    Reference +
                  </button>

                  {shot && selectedMemberObj && onReviewCharacters && (
                    <button
                      type="button"
                      className={`cast-link-btn ${isMemberInCurrentShot ? "active-in-shot" : ""}`}
                      onClick={handleToggleCurrentShotAssignment}
                      title={
                        isMemberInCurrentShot
                          ? `Remove ${selectedMemberObj.name} from Shot ${shot.index}`
                          : `Assign ${selectedMemberObj.name} to Shot ${shot.index}`
                      }
                    >
                      {isMemberInCurrentShot ? `In Shot ${shot.index} ✓` : `+ Add to Shot ${shot.index}`}
                    </button>
                  )}

                  <button
                    type="button"
                    className="cast-link-btn"
                    onClick={() => handleStartRename(selectedMemberObj)}
                  >
                    Rename
                  </button>

                  <div className="cast-merge-dropdown-wrap">
                    <button
                      type="button"
                      className="cast-link-btn"
                      disabled={cast.length < 2 || !onMerge}
                      onClick={() => setShowMergeSelect(!showMergeSelect)}
                    >
                      Merge
                    </button>

                    {showMergeSelect && (
                      <div className="cast-merge-popover">
                        <span className="merge-popover-title">Merge into:</span>
                        {cast
                          .filter((other) => other.id !== selectedMemberObj.id)
                          .map((other) => (
                            <button
                              key={other.id}
                              type="button"
                              className="merge-target-btn"
                              onClick={() => {
                                onMerge?.(selectedMemberObj.id, other.id);
                                setShowMergeSelect(false);
                              }}
                            >
                              {other.name}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>

                  <div className="cast-compare-wrap">
                    <select
                      aria-label="Compare with another character"
                      className="cast-compare-select"
                      value={comparisonMember ?? ""}
                      onChange={(e) => setComparisonMember(e.target.value || undefined)}
                    >
                      <option value="">Compare</option>
                      {cast
                        .filter((m) => m.id !== selectedMemberObj.id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            Compare: {m.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Comparison Findings if active */}
              {comparison?.[0] && comparison?.[1] && (
                <div className="cast-comparison-findings">
                  <span className="comparison-names">
                    {comparison[0].member.name} × {comparison[1].member.name}
                  </span>
                  <div className="comparison-pills">
                    {pairReadings?.shared.length ? (
                      pairReadings.shared.map((p, idx) => (
                        <button
                          key={`sh-${idx}`}
                          type="button"
                          className="comparison-pill"
                          onClick={() => selectPassage(p)}
                        >
                          Shared · {formatClock(p.start)}–{formatClock(p.end)}
                        </button>
                      ))
                    ) : (
                      <span className="muted-text">No shared presence detected.</span>
                    )}
                    {pairReadings?.alternating.map((p, idx) => (
                      <button
                        key={`alt-${idx}`}
                        type="button"
                        className="comparison-pill"
                        onClick={() => selectPassage(p)}
                      >
                        Alternation · {formatClock(p.start)}–{formatClock(p.end)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── ENLARGED: THUMBNAIL GRID ── */}
              {isEnlarged ? (
                <div className="appearances-grid-wrap">
                  {appearancesList.length > 0 ? (
                    <div className="appearances-grid">
                      {appearancesList.map((item) => {
                        const isCurrent = currentAppearanceShot?.id === item.shot.id;
                        const shotThumb = thumbnails[item.shot.id] || getAvatarSrc(selectedMemberObj);

                        return (
                          <div
                            key={item.id}
                            className={`appearance-card ${isCurrent ? "current-selected" : ""}`}
                            onClick={() => {
                              setSelectedShotId(item.shot.id);
                              onInspect(item.shot);
                              onSeek(item.startSeconds);
                            }}
                          >
                            <div className="appearance-card-thumb">
                              {shotThumb ? (
                                <img
                                  src={shotThumb}
                                  alt={`Shot ${item.shot.index}`}
                                  className="appearance-card-img"
                                />
                              ) : (
                                <div className="appearance-card-placeholder">
                                  Shot {item.shot.index}
                                </div>
                              )}
                            </div>

                            <div className="appearance-card-meta">
                              <span className="appearance-shot-label">
                                Shot {String(item.shot.index).padStart(3, "0")}
                              </span>
                              <span
                                className={`appearance-status-badge ${item.reviewStatus === "Confirmed" ? "confirmed" : "needs-review"}`}
                              >
                                {item.reviewStatus}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="appearances-empty">
                      No appearances recorded for {selectedMemberObj.name}.
                    </div>
                  )}
                </div>
              ) : (
                /* ── COMPACT: VERTICAL LIST ── */
                <div className="appearances-list-wrap">
                  <div className="appearances-list-label">Appearances</div>
                  {appearancesList.length > 0 ? (
                    <div className="appearances-vertical-list">
                      {appearancesList.map((item) => {
                        const isCurrent = currentAppearanceShot?.id === item.shot.id;
                        const shotThumb = thumbnails[item.shot.id] || getAvatarSrc(selectedMemberObj);

                        return (
                          <div
                            key={item.id}
                            className={`appearance-list-row ${isCurrent ? "current-selected" : ""}`}
                            onClick={() => {
                              setSelectedShotId(item.shot.id);
                              onInspect(item.shot);
                              onSeek(item.startSeconds);
                            }}
                          >
                            {isCurrent && <div className="appearance-row-indicator" />}

                            <div className="appearance-row-thumb">
                              {shotThumb ? (
                                <img
                                  src={shotThumb}
                                  alt={`Shot ${item.shot.index}`}
                                  className="appearance-row-img"
                                />
                              ) : (
                                <div className="appearance-row-placeholder">
                                  {item.shot.index}
                                </div>
                              )}
                            </div>

                            <span className="appearance-row-shot-num">
                              Shot {String(item.shot.index).padStart(3, "0")}
                            </span>

                            <span
                              className={`appearance-row-status ${item.reviewStatus === "Confirmed" ? "confirmed" : "needs-review"}`}
                            >
                              {item.reviewStatus}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="appearances-empty">
                      No appearances recorded for {selectedMemberObj.name}.
                    </div>
                  )}
                </div>
              )}

              {/* ── BOTTOM ACTION BAR ── */}
              {currentAppearanceShot && (
                <div className="cast-bottom-action-bar">
                  <span className="current-shot-label mono">
                    Shot {String(currentAppearanceShot.index).padStart(3, "0")}
                  </span>

                  <div className="bottom-action-buttons">
                    <button
                      type="button"
                      className="bottom-action-btn confirm"
                      onClick={() => onConfirmShot(currentAppearanceShot.id)}
                      title="Confirm this character match"
                    >
                      Confirm
                    </button>

                    <button
                      type="button"
                      className="bottom-action-btn inspect"
                      onClick={() => onInspect(currentAppearanceShot)}
                      title={`Inspect Shot ${currentAppearanceShot.index} in shot inspector`}
                    >
                      Inspect
                    </button>

                    <button
                      type="button"
                      className="bottom-action-btn remove"
                      onClick={() =>
                        onRemoveAppearance(currentAppearanceShot.id, selectedMemberObj.id)
                      }
                      title="Remove character match from this shot"
                      aria-label="Remove match"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="cast-no-selection">
            <p>No characters found in this project.</p>
            <button
              type="button"
              className="roster-add-btn"
              onClick={() => setIsAddingChar(true)}
            >
              + Add first character
            </button>
          </div>
        )}
      </main>
    </section>
  );
}
