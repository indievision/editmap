import { memo, useMemo, useRef, useState, useEffect, useCallback } from "react";
import type { Project, Shot, SpeechAnalysis, LoudnessAnalysis } from "../models/project";
import { cutTimes, pacingCurve, pacingAt } from "../analysis/pacing";
import { framingRank } from "../analysis/framing";
import { formatTimecode } from "../utils/timecode";

export interface StudioRhythmRibbonProps {
  project: Project;
  time: number;
  selectedShot?: Shot;
  onSelectShot: (shot: Shot) => void;
  onSeek: (time: number) => void;
  range?: { start: number; end: number };
  onRangeChange: (range?: { start: number; end: number }) => void;
  waveform?: number[];
  speechAnalysis?: SpeechAnalysis;
  loudnessAnalysis?: LoudnessAnalysis;
  thumbnails: Record<string, string>;
  onCompareSequence?: (range: { start: number; end: number }) => void;
  selectedCut?: string;
}

export const StudioRhythmRibbon = memo(function StudioRhythmRibbon({
  project,
  time,
  selectedShot,
  onSelectShot,
  onSeek,
  range,
  onRangeChange,
  waveform = [],
  speechAnalysis,
  loudnessAnalysis,
  thumbnails,
  onCompareSequence,
  selectedCut,
}: StudioRhythmRibbonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);
  const [activeRangeDrag, setActiveRangeDrag] = useState<"new" | "start" | "end" | null>(null);
  const dragAnchorRef = useRef<number | null>(null);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.max(600, entry.contentRect.width));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const duration = Math.max(1, project.duration);
  const shots = project.shots;
  const selectedCutShot = useMemo(() => shots.find((s) => s.id === selectedCut), [shots, selectedCut]);

  // Real data calculations:
  // 1. Cut Density & Pacing
  const cuts = useMemo(() => cutTimes(shots), [shots]);
  const pacingPoints = useMemo(() => pacingCurve(cuts, duration, 30), [cuts, duration]);
  const maxPacingRate = useMemo(() => {
    return Math.max(12, Math.ceil(Math.max(...pacingPoints.map((p) => p.rate), 0) / 5) * 5);
  }, [pacingPoints]);

  const pacingSvgPath = useMemo(() => {
    if (!pacingPoints.length || duration <= 0) return "";
    const w = containerWidth;
    return pacingPoints
      .map((p, i) => {
        const x = (p.time / duration) * w;
        const y = 32 - (p.rate / maxPacingRate) * 26;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [pacingPoints, duration, containerWidth, maxPacingRate]);

  const pacingSvgArea = useMemo(() => {
    if (!pacingSvgPath) return "";
    const w = containerWidth;
    return `${pacingSvgPath} L ${w.toFixed(1)},34 L 0,34 Z`;
  }, [pacingSvgPath, containerWidth]);

  // 2. Motion Data Check & Path
  const hasMotion = useMemo(() => {
    return shots.some((s) => s.motionProfile !== undefined);
  }, [shots]);

  const motionSvgPath = useMemo(() => {
    if (!hasMotion || !shots.length) return "";
    const w = containerWidth;
    const points: { x: number; y: number }[] = [];
    shots.forEach((s) => {
      const midTime = (s.startSeconds + s.endSeconds) / 2;
      const energy = s.motionProfile?.totalKineticEnergy ?? 0;
      const x = (midTime / duration) * w;
      const y = 32 - (energy / 100) * 26;
      points.push({ x, y });
    });
    if (!points.length) return "";
    return points.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
  }, [hasMotion, shots, duration, containerWidth]);

  const motionSvgArea = useMemo(() => {
    if (!motionSvgPath) return "";
    const w = containerWidth;
    return `${motionSvgPath} L ${w.toFixed(1)},34 L 0,34 Z`;
  }, [motionSvgPath, containerWidth]);

  // 3. Sound / DME / Speech Check
  const hasDme = Boolean(project.dmeWaveforms);
  const hasSpeech = Boolean(speechAnalysis && speechAnalysis.regions.length > 0);
  const hasWaveform = waveform.length > 0;
  const hasSoundData = hasDme || hasSpeech || hasWaveform;

  // 4. Cast Data Check
  const hasCastData = useMemo(() => {
    return (
      (project.cast && project.cast.length > 0) ||
      shots.some((s) => s.characterAnalysis?.intervals?.length || s.characterAnalysis?.manualMemberIds?.length)
    );
  }, [project.cast, shots]);

  // Map of characters by id for quick lookup
  const castMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; avatar?: string }>();
    project.cast?.forEach((c) => {
      map.set(c.id, { id: c.id, name: c.name, avatar: c.references?.[0]?.image });
    });
    return map;
  }, [project.cast]);

  // 5. Time Ruler Ticks
  const rulerTicks = useMemo(() => {
    const count = Math.max(3, Math.floor(containerWidth / 140));
    const ticks: { time: number; label: string; xPct: number }[] = [];
    for (let i = 0; i <= count; i++) {
      const t = (i * duration) / count;
      const xPct = (t / duration) * 100;
      ticks.push({
        time: t,
        label: formatTimecode(t, project.frameRate, project.dropFrame),
        xPct,
      });
    }
    return ticks;
  }, [containerWidth, duration, project.frameRate, project.dropFrame]);

  // 6. Contextual Card Information
  const activeContext = useMemo(() => {
    // If range is selected, analyze the range; otherwise analyze current shot / position
    const startSec = range ? range.start : (selectedShot?.startSeconds ?? Math.max(0, time - 2));
    const endSec = range ? range.end : (selectedShot?.endSeconds ?? Math.min(duration, time + 2));

    const shotsInRange = shots.filter(
      (s) => s.endSeconds >= startSec && s.startSeconds <= endSec
    );

    const shotCount = shotsInRange.length;
    const durations = shotsInRange.map((s) => s.duration).sort((a, b) => a - b);
    const medianDur = durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 0;

    // Sequence name match if available
    const matchingSeq = project.sequences?.find(
      (seq) =>
        (seq.startSeconds <= startSec && seq.endSeconds >= endSec) ||
        Math.abs(seq.startSeconds - startSec) < 1
    );
    const title = matchingSeq?.name || (range ? "Selected Sequence" : selectedShot ? `Shot ${String(selectedShot.index).padStart(3, "0")}` : "Timeline Window");

    // Strictly derived trend
    let trend = "steady pace";
    const startRate = pacingAt(cuts, duration, 30, startSec).rate;
    const endRate = pacingAt(cuts, duration, 30, endSec).rate;
    const rateDelta = endRate - startRate;

    if (rateDelta > 3.5) {
      trend = "pacing accelerates";
    } else if (rateDelta < -3.5) {
      trend = "pacing decelerates";
    } else if (hasMotion) {
      const halfTime = (startSec + endSec) / 2;
      const firstHalfShots = shotsInRange.filter((s) => s.startSeconds < halfTime);
      const secondHalfShots = shotsInRange.filter((s) => s.startSeconds >= halfTime);

      const firstAvgEnergy =
        firstHalfShots.length > 0
          ? firstHalfShots.reduce((acc, s) => acc + (s.motionProfile?.totalKineticEnergy ?? 0), 0) / firstHalfShots.length
          : 0;
      const secondAvgEnergy =
        secondHalfShots.length > 0
          ? secondHalfShots.reduce((acc, s) => acc + (s.motionProfile?.totalKineticEnergy ?? 0), 0) / secondHalfShots.length
          : 0;

      if (firstAvgEnergy - secondAvgEnergy > 12) {
        trend = "energy falls";
      } else if (secondAvgEnergy - firstAvgEnergy > 12) {
        trend = "energy rises";
      }
    }

    const tcStart = formatTimecode(startSec, project.frameRate, project.dropFrame);
    const tcEnd = formatTimecode(endSec, project.frameRate, project.dropFrame);

    return {
      title,
      startSec,
      endSec,
      timeSpan: `${tcStart.slice(3, 8)} - ${tcEnd.slice(3, 8)}`,
      shotCount,
      medianDur: medianDur.toFixed(1),
      trend,
      range: { start: startSec, end: endSec },
    };
  }, [range, selectedShot, time, shots, duration, project.sequences, project.frameRate, project.dropFrame, cuts, hasMotion]);

  // Position for Contextual Card
  const cardLeftPct = useMemo(() => {
    const centerSec = range ? (range.start + range.end) / 2 : time;
    return Math.max(5, Math.min(85, (centerSec / duration) * 100));
  }, [range, time, duration]);

  // Time conversion helpers
  const getTimeFromClientX = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return pct * duration;
    },
    [duration]
  );

  // Mouse handlers for scrubbing, seeking, and range selection
  const handleTrackMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // If clicking a shot or handle directly, let them handle it
    if ((e.target as HTMLElement).closest(".range-handle, .shot-block, button")) {
      return;
    }

    const clickedTime = getTimeFromClientX(e.clientX);
    onSeek(clickedTime);

    if (e.shiftKey) {
      // Shift+Click initiates a range drag
      dragAnchorRef.current = clickedTime;
      setActiveRangeDrag("new");
      onRangeChange({ start: clickedTime, end: clickedTime });
    }
  };

  const handleHandleMouseDown = (e: React.MouseEvent, handle: "start" | "end") => {
    e.stopPropagation();
    setActiveRangeDrag(handle);
  };

  useEffect(() => {
    if (!activeRangeDrag) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentT = getTimeFromClientX(e.clientX);
      if (activeRangeDrag === "new" && dragAnchorRef.current !== null) {
        const start = Math.min(dragAnchorRef.current, currentT);
        const end = Math.max(dragAnchorRef.current, currentT);
        onRangeChange({ start, end });
      } else if (activeRangeDrag === "start" && range) {
        onRangeChange({ start: Math.min(currentT, range.end - 0.2), end: range.end });
      } else if (activeRangeDrag === "end" && range) {
        onRangeChange({ start: range.start, end: Math.max(currentT, range.start + 0.2) });
      }
    };

    const handleMouseUp = () => {
      setActiveRangeDrag(null);
      dragAnchorRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [activeRangeDrag, range, getTimeFromClientX, onRangeChange]);

  const playheadPct = Math.max(0, Math.min(100, (time / duration) * 100));

  return (
    <section className="studio-rhythm-ribbon" ref={containerRef} aria-label="Studio Rhythm Ribbon">
      {/* 1. Contextual Interpretation Card floating above selected range or playhead */}
      <div
        className="ribbon-context-card"
        style={{ left: `${cardLeftPct}%` }}
        role="region"
        aria-label="Sequence context"
      >
        <div className="context-card-content">
          <div className="context-card-title">{activeContext.title}</div>
          <div className="context-card-facts">
            <span>{activeContext.timeSpan}</span>
            <span className="bullet">•</span>
            <span>{activeContext.shotCount} shots</span>
            <span className="bullet">•</span>
            <span className="context-trend">{activeContext.trend}</span>
          </div>
        </div>
        {onCompareSequence && (
          <button
            type="button"
            className="context-compare-btn"
            title="Compare this sequence in Structure view"
            onClick={() => onCompareSequence(activeContext.range)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="2" width="13" height="13" rx="2" />
              <path d="M9 9h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z" />
            </svg>
            <span>Compare</span>
          </button>
        )}
      </div>

      {/* 2. Minimap / Overview strip */}
      <div className="ribbon-minimap-bar" title="Timeline overview">
        <div
          className="ribbon-minimap-viewport"
          style={{
            left: `${range ? (range.start / duration) * 100 : Math.max(0, playheadPct - 10)}%`,
            width: `${range ? ((range.end - range.start) / duration) * 100 : 20}%`,
          }}
        />
      </div>

      {/* 3. Time Ruler Bar */}
      <div className="ribbon-ruler-bar">
        {rulerTicks.map((tick, i) => (
          <span
            key={i}
            className="ruler-tick"
            style={{ left: `${tick.xPct}%` }}
          >
            <span className="ruler-tick-mark" />
            <span className="ruler-tick-label mono">{tick.label.slice(0, 8)}</span>
          </span>
        ))}
      </div>

      {/* 4. Multi-Lane Synchronized Timeline Canvas */}
      <div
        className="ribbon-lanes-canvas"
        ref={trackRef}
        onMouseDown={handleTrackMouseDown}
      >
        {/* Selected Range Highlight Overlay */}
        {range && (
          <div
            className="ribbon-range-overlay"
            style={{
              left: `${(range.start / duration) * 100}%`,
              width: `${Math.max(0.4, ((range.end - range.start) / duration) * 100)}%`,
            }}
          >
            <div
              className="range-handle handle-left"
              onMouseDown={(e) => handleHandleMouseDown(e, "start")}
              title="Drag to resize range start"
            />
            <div
              className="range-handle handle-right"
              onMouseDown={(e) => handleHandleMouseDown(e, "end")}
              title="Drag to resize range end"
            />
          </div>
        )}

        {/* Selected Cut Highlight Marker */}
        {selectedCutShot && (
          <div
            className="ribbon-selected-cut-marker"
            style={{ left: `${(selectedCutShot.startSeconds / duration) * 100}%` }}
            title={`Cut at ${formatTimecode(selectedCutShot.startSeconds, project.frameRate, project.dropFrame)}`}
          >
            <div className="selected-cut-cap">CUT</div>
            <div className="selected-cut-line" />
          </div>
        )}

        {/* Playhead Vertical Line extending through all lanes */}
        <div
          className="ribbon-playhead"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="playhead-cap" />
          <div className="playhead-line" />
        </div>

        {/* ------------------------------------------------------------- */}
        {/* LANE 1: CUT DENSITY                                            */}
        {/* ------------------------------------------------------------- */}
        <div className="ribbon-lane cut-density-lane">
          <div className="lane-header">
            <span className="lane-name">CUT DENSITY</span>
          </div>
          <div className="lane-track">
            {pacingSvgPath ? (
              <svg className="lane-svg" width={containerWidth} height="36" preserveAspectRatio="none">
                <path d={pacingSvgArea} fill="rgba(245, 158, 11, 0.08)" />
                <path d={pacingSvgPath} fill="none" stroke="#f59e0b" strokeWidth="1.6" />
                {cuts.map((cutT, idx) => {
                  const x = (cutT / duration) * containerWidth;
                  return (
                    <line
                      key={idx}
                      x1={x}
                      y1="28"
                      x2={x}
                      y2="36"
                      stroke="rgba(245, 158, 11, 0.35)"
                      strokeWidth="1"
                    />
                  );
                })}
              </svg>
            ) : (
              <div className="lane-empty muted">No cuts detected</div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* LANE 2: FRAMING                                                */}
        {/* ------------------------------------------------------------- */}
        <div className="ribbon-lane framing-lane">
          <div className="lane-header">
            <span className="lane-name">FRAMING</span>
            <div className="lane-sublabels">
              <span>Close</span>
              <span>Medium</span>
              <span>Wide</span>
            </div>
          </div>
          <div className="lane-track framing-track">
            {shots.map((shot) => {
              const rank = framingRank(shot) ?? 0;
              // Classify into Close, Medium, Wide tiers
              let tierClass = "medium";
              if (rank >= 7) tierClass = "close";
              else if (rank <= 3 && rank > 0) tierClass = "wide";
              else if (rank === 0) tierClass = "unknown";

              const isSelected = selectedShot?.id === shot.id;
              const leftPct = (shot.startSeconds / duration) * 100;
              const widthPct = Math.max(0.4, (shot.duration / duration) * 100);

              return (
                <button
                  key={shot.id}
                  type="button"
                  className={`framing-step-block ${tierClass} ${isSelected ? "selected" : ""}`}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                  }}
                  title={`Shot ${shot.index}: ${shot.shotSize || "Unknown"} (${shot.duration.toFixed(2)}s)`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectShot(shot);
                    onSeek(shot.startSeconds);
                  }}
                  aria-label={`Shot ${shot.index} ${shot.shotSize}`}
                />
              );
            })}
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* LANE 3: MOTION                                                 */}
        {/* ------------------------------------------------------------- */}
        <div className="ribbon-lane motion-lane">
          <div className="lane-header">
            <span className="lane-name">MOTION</span>
          </div>
          <div className="lane-track">
            {hasMotion && motionSvgPath ? (
              <svg className="lane-svg" width={containerWidth} height="36" preserveAspectRatio="none">
                <path d={motionSvgArea} fill="rgba(45, 212, 191, 0.15)" />
                <path d={motionSvgPath} fill="none" stroke="#2dd4bf" strokeWidth="1.6" />
              </svg>
            ) : (
              <div className="lane-unavailable-msg muted">
                <span>Motion unanalyzed</span>
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* LANE 4: SOUND                                                  */}
        {/* ------------------------------------------------------------- */}
        <div className="ribbon-lane sound-lane">
          <div className="lane-header">
            <span className="lane-name">SOUND</span>
            {hasDme && (
              <div className="lane-sublabels">
                <span>speech</span>
                <span>music</span>
                <span>ambience</span>
              </div>
            )}
          </div>
          <div className="lane-track sound-track">
            {hasDme && project.dmeWaveforms ? (
              <div className="dme-mini-stack">
                <div className="dme-substem dialogue">
                  {project.dmeWaveforms.dialogue.slice(0, 100).map((v, i) => (
                    <div
                      key={i}
                      className="dme-bar"
                      style={{ height: `${Math.max(2, Math.min(100, v * 100))}%` }}
                    />
                  ))}
                </div>
                <div className="dme-substem music">
                  {project.dmeWaveforms.music.slice(0, 100).map((v, i) => (
                    <div
                      key={i}
                      className="dme-bar"
                      style={{ height: `${Math.max(2, Math.min(100, v * 100))}%` }}
                    />
                  ))}
                </div>
                <div className="dme-substem effects">
                  {project.dmeWaveforms.effects.slice(0, 100).map((v, i) => (
                    <div
                      key={i}
                      className="dme-bar"
                      style={{ height: `${Math.max(2, Math.min(100, v * 100))}%` }}
                    />
                  ))}
                </div>
              </div>
            ) : hasSpeech ? (
              <div className="speech-mini-track">
                {speechAnalysis?.regions.map((reg, i) => (
                  <div
                    key={i}
                    className="speech-mini-region"
                    style={{
                      left: `${(reg.startSeconds / duration) * 100}%`,
                      width: `${Math.max(0.4, ((reg.endSeconds - reg.startSeconds) / duration) * 100)}%`,
                    }}
                    title={`Speech: ${reg.startSeconds.toFixed(1)}s - ${reg.endSeconds.toFixed(1)}s`}
                  />
                ))}
              </div>
            ) : hasWaveform ? (
              <div className="waveform-mini-track">
                {waveform.slice(0, 150).map((v, i) => (
                  <div
                    key={i}
                    className="waveform-bar"
                    style={{ height: `${Math.max(3, Math.min(100, v * 100))}%` }}
                  />
                ))}
              </div>
            ) : (
              <div className="lane-unavailable-msg muted">
                <span>Sound stems unavailable</span>
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* LANE 5: CAST                                                   */}
        {/* ------------------------------------------------------------- */}
        <div className="ribbon-lane cast-lane">
          <div className="lane-header">
            <span className="lane-name">CAST</span>
          </div>
          <div className="lane-track cast-track">
            {hasCastData ? (
              shots.map((shot) => {
                const manualIds = shot.characterAnalysis?.manualMemberIds ?? [];
                const autoIds = (shot.characterAnalysis?.intervals ?? []).map((i) => i.memberId);
                const memberIds = Array.from(new Set([...manualIds, ...autoIds])).filter(Boolean);

                if (!memberIds.length) return null;

                const midTime = (shot.startSeconds + shot.endSeconds) / 2;
                const leftPct = (midTime / duration) * 100;
                const primaryMember = castMap.get(memberIds[0]);

                return (
                  <button
                    key={shot.id}
                    type="button"
                    className="cast-avatar-marker"
                    style={{ left: `${leftPct}%` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectShot(shot);
                      onSeek(shot.startSeconds);
                    }}
                    title={`Shot ${shot.index}: ${primaryMember?.name || "Character"} (${memberIds.length} present)`}
                    aria-label={`Cast in Shot ${shot.index}`}
                  >
                    {primaryMember?.avatar ? (
                      <img
                        src={primaryMember.avatar}
                        alt={primaryMember.name || "Cast"}
                        className="cast-avatar-img"
                      />
                    ) : (
                      <span className="cast-avatar-dot" />
                    )}
                  </button>
                );
              })
            ) : (
              <div className="lane-unavailable-msg muted">
                <span>Cast unanalyzed</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
});

export default StudioRhythmRibbon;
