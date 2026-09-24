import { useEffect, useMemo, useState } from "react";
import type { CastMember, ColorProfile, LoudnessAnalysis, Shot } from "../../models/project";
import { peopleLabels, selectableShotSizes, type ShotSize } from "../../models/project";
import type {
  ArrangeDirection,
  ArrangeMeasure,
  ExploreArrangeConfig,
  ExploreFilters,
  ExploreSequence,
} from "../../models/explore";
import { DEFAULT_EXPLORE_FILTERS } from "../../models/explore";
import { buildExploreSequence } from "../../analysis/explore";
import { isLoudnessAnalysisValid } from "../../analysis/loudness";

interface ExploreBuilderProps {
  shots: Shot[];
  cast: CastMember[];
  activeFilters: ExploreFilters;
  activeArrange: ExploreArrangeConfig;
  sequence: ExploreSequence;
  context: {
    loudnessAnalysis?: LoudnessAnalysis;
    mediaSignature?: string;
    cast?: CastMember[];
    colorProfiles?: Record<string, ColorProfile>;
  };
  url?: string;
  onBuildSequence: (filters: ExploreFilters, arrange: ExploreArrangeConfig) => void;
  onResetFilters: () => void;
}

export default function ExploreBuilder({
  shots,
  cast,
  activeFilters,
  activeArrange,
  sequence,
  context,
  url,
  onBuildSequence,
  onResetFilters,
}: ExploreBuilderProps) {
  // Local pending filter & arrange state
  const [draftFilters, setDraftFilters] = useState<ExploreFilters>(activeFilters);
  const [draftArrange, setDraftArrange] = useState<ExploreArrangeConfig>(activeArrange);
  const [showCustomDuration, setShowCustomDuration] = useState(false);
  const [justBuilt, setJustBuilt] = useState(false);

  // Check which measures have scan data available across the film
  const hasLumaData = useMemo(() => {
    return shots.some((s) => {
      const luma = s.colorProfile?.luminance ?? context.colorProfiles?.[s.id]?.luminance;
      return luma !== undefined && luma !== null && Number.isFinite(luma);
    });
  }, [shots, context.colorProfiles]);

  const hasMotionData = useMemo(() => {
    return shots.some((s) => {
      const motion = s.motionProfile?.totalKineticEnergy;
      return motion !== undefined && motion !== null && Number.isFinite(motion);
    });
  }, [shots]);

  const hasLoudnessData = useMemo(() => {
    return isLoudnessAnalysisValid(context.loudnessAnalysis, context.mediaSignature);
  }, [context.loudnessAnalysis, context.mediaSignature]);

  // Live draft preview to inform user of match count before/during button click
  const draftPreview = useMemo(() => {
    return buildExploreSequence(shots, draftFilters, draftArrange, context);
  }, [shots, draftFilters, draftArrange, context]);

  // Sync draft state with props when filters or arrange are reset or updated externally
  useEffect(() => {
    setDraftFilters(activeFilters);
  }, [activeFilters]);

  useEffect(() => {
    setDraftArrange(activeArrange);
  }, [activeArrange]);

  // Check whether draft settings differ from the currently built sequence
  const isDirty = useMemo(() => {
    const filtersDiffer =
      draftFilters.characterId !== sequence.filters.characterId ||
      Boolean(draftFilters.onlyThisCharacter) !== Boolean(sequence.filters.onlyThisCharacter) ||
      draftFilters.composition !== sequence.filters.composition ||
      draftFilters.shotSize !== sequence.filters.shotSize ||
      draftFilters.minDuration !== sequence.filters.minDuration ||
      draftFilters.maxDuration !== sequence.filters.maxDuration;

    const arrangeDiffers =
      draftArrange.measure !== sequence.arrange.measure ||
      draftArrange.direction !== sequence.arrange.direction;

    return filtersDiffer || arrangeDiffers;
  }, [draftFilters, draftArrange, sequence]);

  const handleCharacterChange = (memberId: string) => {
    setDraftFilters((prev) => ({
      ...prev,
      characterId: memberId || undefined,
      onlyThisCharacter: memberId ? prev.onlyThisCharacter : false,
    }));
  };

  const handleDurationPresetChange = (value: string) => {
    if (value === "all") {
      setDraftFilters((prev) => ({ ...prev, minDuration: undefined, maxDuration: undefined }));
      setShowCustomDuration(false);
    } else if (value === "under-5") {
      setDraftFilters((prev) => ({ ...prev, minDuration: undefined, maxDuration: 5 }));
      setShowCustomDuration(false);
    } else if (value === "under-8") {
      setDraftFilters((prev) => ({ ...prev, minDuration: undefined, maxDuration: 8 }));
      setShowCustomDuration(false);
    } else if (value === "under-15") {
      setDraftFilters((prev) => ({ ...prev, minDuration: undefined, maxDuration: 15 }));
      setShowCustomDuration(false);
    } else if (value === "over-15") {
      setDraftFilters((prev) => ({ ...prev, minDuration: 15, maxDuration: undefined }));
      setShowCustomDuration(false);
    } else if (value === "custom") {
      setShowCustomDuration(true);
    }
  };

  const currentDurationPreset = useMemo(() => {
    if (draftFilters.minDuration === undefined && draftFilters.maxDuration === undefined) {
      return "all";
    }
    if (draftFilters.minDuration === undefined && draftFilters.maxDuration === 5) {
      return "under-5";
    }
    if (draftFilters.minDuration === undefined && draftFilters.maxDuration === 8) {
      return "under-8";
    }
    if (draftFilters.minDuration === undefined && draftFilters.maxDuration === 15) {
      return "under-15";
    }
    if (draftFilters.minDuration === 15 && draftFilters.maxDuration === undefined) {
      return "over-15";
    }
    return "custom";
  }, [draftFilters.minDuration, draftFilters.maxDuration]);

  const handleMeasureChange = (measure: ArrangeMeasure) => {
    // Default appropriate initial direction for the chosen measure
    let defaultDirection: ArrangeDirection = "asc";
    if (measure === "loudness" || measure === "motion") {
      defaultDirection = "desc"; // loudest / highest motion first by default
    } else if (measure === "duration") {
      defaultDirection = "asc"; // shortest first
    } else if (measure === "brightness") {
      defaultDirection = "asc"; // darkest first
    }
    setDraftArrange({ measure, direction: defaultDirection });
  };

  const handleBuild = (e: React.FormEvent) => {
    e.preventDefault();
    onBuildSequence(draftFilters, draftArrange);
    setJustBuilt(true);
    setTimeout(() => {
      setJustBuilt(false);
    }, 1500);
  };

  const handleReset = () => {
    setDraftFilters(DEFAULT_EXPLORE_FILTERS);
    setDraftArrange({ measure: "original", direction: "asc" });
    setShowCustomDuration(false);
    onResetFilters();
  };

  const selectedCharacter = cast.find((c) => c.id === draftFilters.characterId);

  // Format total duration string
  const formatTotalTime = (secs: number) => {
    const s = Math.round(secs);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  };

  return (
    <aside className="explore-builder-panel" aria-label="Sequence Builder">
      <div className="builder-header">
        <h2 className="builder-title">Build a viewing sequence</h2>
        <span className="builder-subtitle">Choose shots. Choose their order.</span>
      </div>

      <form onSubmit={handleBuild} className="builder-form">
        {/* SECTION 1: INCLUDE SHOTS */}
        <section className="builder-section">
          <div className="section-label">
            <span className="section-num">1</span>
            <span className="section-title">Include shots</span>
          </div>

          <div className="filter-controls-stack">
            {/* Character filter */}
            <div className="builder-row">
              <label htmlFor="filter-character" className="row-label">
                Character
              </label>
              <div className="row-input-group">
                <select
                  id="filter-character"
                  className="builder-select"
                  value={draftFilters.characterId || ""}
                  onChange={(e) => handleCharacterChange(e.target.value)}
                >
                  <option value="">All cast</option>
                  {cast.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>

                {draftFilters.characterId && (
                  <label className="checkbox-label" title="Require that only this character appears in the shot">
                    <input
                      type="checkbox"
                      checked={Boolean(draftFilters.onlyThisCharacter)}
                      onChange={(e) =>
                        setDraftFilters((prev) => ({
                          ...prev,
                          onlyThisCharacter: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      Only {selectedCharacter ? selectedCharacter.name : "character"} on screen
                    </span>
                  </label>
                )}
              </div>
            </div>

            {/* Duration filter */}
            <div className="builder-row">
              <label htmlFor="filter-duration" className="row-label">
                Duration
              </label>
              <div className="row-input-group">
                <select
                  id="filter-duration"
                  className="builder-select"
                  value={currentDurationPreset}
                  onChange={(e) => handleDurationPresetChange(e.target.value)}
                >
                  <option value="all">All durations</option>
                  <option value="under-5">Under 5 s</option>
                  <option value="under-8">Under 8 s</option>
                  <option value="under-15">Under 15 s</option>
                  <option value="over-15">15 s and over</option>
                  <option value="custom">Custom range…</option>
                </select>

                {(showCustomDuration || currentDurationPreset === "custom") && (
                  <div className="custom-duration-row">
                    <input
                      type="number"
                      className="builder-num-input"
                      placeholder="Min (s)"
                      min="0"
                      step="0.5"
                      value={draftFilters.minDuration ?? ""}
                      onChange={(e) =>
                        setDraftFilters((prev) => ({
                          ...prev,
                          minDuration: e.target.value ? Number(e.target.value) : undefined,
                        }))
                      }
                      aria-label="Minimum duration in seconds"
                    />
                    <span className="range-dash">to</span>
                    <input
                      type="number"
                      className="builder-num-input"
                      placeholder="Max (s)"
                      min="0"
                      step="0.5"
                      value={draftFilters.maxDuration ?? ""}
                      onChange={(e) =>
                        setDraftFilters((prev) => ({
                          ...prev,
                          maxDuration: e.target.value ? Number(e.target.value) : undefined,
                        }))
                      }
                      aria-label="Maximum duration in seconds"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* People count filter */}
            <div className="builder-row">
              <label htmlFor="filter-composition" className="row-label">
                People
              </label>
              <div className="row-input-group">
                <select
                  id="filter-composition"
                  className="builder-select"
                  value={draftFilters.composition || ""}
                  onChange={(e) =>
                    setDraftFilters((prev) => ({
                      ...prev,
                      composition: (e.target.value as keyof typeof peopleLabels) || undefined,
                    }))
                  }
                >
                  <option value="">Any people count</option>
                  <option value="No people">No people</option>
                  <option value="Single person">One person</option>
                  <option value="Two-shot">Two people</option>
                  <option value="Group">Group (3+)</option>
                </select>
              </div>
            </div>

            {/* Shot Size filter */}
            <div className="builder-row">
              <label htmlFor="filter-shot-size" className="row-label">
                Scale
              </label>
              <div className="row-input-group">
                <select
                  id="filter-shot-size"
                  className="builder-select"
                  value={draftFilters.shotSize || ""}
                  onChange={(e) =>
                    setDraftFilters((prev) => ({
                      ...prev,
                      shotSize: (e.target.value as ShotSize) || undefined,
                    }))
                  }
                >
                  <option value="">Any shot size</option>
                  {selectableShotSizes.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: ARRANGE BY */}
        <section className="builder-section">
          <div className="section-label">
            <span className="section-num">2</span>
            <span className="section-title">Arrange by</span>
          </div>

          <div className="builder-row">
            <label htmlFor="arrange-measure" className="row-label sr-only">
              Order by measure
            </label>
            <div className="row-input-group full-width">
              <select
                id="arrange-measure"
                className="builder-select primary-measure-select"
                value={draftArrange.measure}
                onChange={(e) => handleMeasureChange(e.target.value as ArrangeMeasure)}
              >
                <option value="brightness">
                  Brightness {hasLumaData ? "" : "(needs color scan)"}
                </option>
                <option value="duration">Shot duration</option>
                <option value="loudness">
                  Loudness {hasLoudnessData ? "" : "(needs loudness scan)"}
                </option>
                <option value="motion">
                  Motion {hasMotionData ? "" : "(needs motion scan)"}
                </option>
                <option value="original">Original order</option>
              </select>

              {/* Contextual Warning if Selected Measure Lacks Data */}
              {draftArrange.measure === "brightness" && !hasLumaData && (
                <div className="builder-measure-warning" role="alert">
                  <span>⚠️ No color data in project. Run Color scan in Studio to order by brightness.</span>
                </div>
              )}
              {draftArrange.measure === "motion" && !hasMotionData && (
                <div className="builder-measure-warning" role="alert">
                  <span>⚠️ No motion data in project. Run Motion scan in Studio to order by motion.</span>
                </div>
              )}
              {draftArrange.measure === "loudness" && !hasLoudnessData && (
                <div className="builder-measure-warning" role="alert">
                  <span>⚠️ No loudness data in project. Run Loudness scan in Studio to order by loudness.</span>
                </div>
              )}

              {/* Contextual Direction Controls */}
              {draftArrange.measure === "brightness" && (
                <div className="direction-toggles" role="radiogroup" aria-label="Brightness direction">
                  <label className={`direction-radio ${draftArrange.direction === "asc" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="brightness-dir"
                      checked={draftArrange.direction === "asc"}
                      onChange={() => setDraftArrange((prev) => ({ ...prev, direction: "asc" }))}
                    />
                    <span>Darkest first</span>
                  </label>
                  <label className={`direction-radio ${draftArrange.direction === "desc" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="brightness-dir"
                      checked={draftArrange.direction === "desc"}
                      onChange={() => setDraftArrange((prev) => ({ ...prev, direction: "desc" }))}
                    />
                    <span>Brightest first</span>
                  </label>
                </div>
              )}

              {draftArrange.measure === "duration" && (
                <div className="direction-toggles" role="radiogroup" aria-label="Duration direction">
                  <label className={`direction-radio ${draftArrange.direction === "asc" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="duration-dir"
                      checked={draftArrange.direction === "asc"}
                      onChange={() => setDraftArrange((prev) => ({ ...prev, direction: "asc" }))}
                    />
                    <span>Shortest first</span>
                  </label>
                  <label className={`direction-radio ${draftArrange.direction === "desc" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="duration-dir"
                      checked={draftArrange.direction === "desc"}
                      onChange={() => setDraftArrange((prev) => ({ ...prev, direction: "desc" }))}
                    />
                    <span>Longest first</span>
                  </label>
                </div>
              )}

              {draftArrange.measure === "loudness" && (
                <div className="direction-toggles" role="radiogroup" aria-label="Loudness direction">
                  <label className={`direction-radio ${draftArrange.direction === "desc" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="loudness-dir"
                      checked={draftArrange.direction === "desc"}
                      onChange={() => setDraftArrange((prev) => ({ ...prev, direction: "desc" }))}
                    />
                    <span>Loudest first</span>
                  </label>
                  <label className={`direction-radio ${draftArrange.direction === "asc" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="loudness-dir"
                      checked={draftArrange.direction === "asc"}
                      onChange={() => setDraftArrange((prev) => ({ ...prev, direction: "asc" }))}
                    />
                    <span>Quietest first</span>
                  </label>
                </div>
              )}

              {draftArrange.measure === "motion" && (
                <div className="direction-toggles" role="radiogroup" aria-label="Motion direction">
                  <label className={`direction-radio ${draftArrange.direction === "desc" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="motion-dir"
                      checked={draftArrange.direction === "desc"}
                      onChange={() => setDraftArrange((prev) => ({ ...prev, direction: "desc" }))}
                    />
                    <span>Highest motion first</span>
                  </label>
                  <label className={`direction-radio ${draftArrange.direction === "asc" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="motion-dir"
                      checked={draftArrange.direction === "asc"}
                      onChange={() => setDraftArrange((prev) => ({ ...prev, direction: "asc" }))}
                    />
                    <span>Lowest motion first</span>
                  </label>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Missing Analysis Notice */}
        {sequence.missingMeasureReason && (
          <div className="builder-missing-notice" role="alert">
            <span className="notice-icon">ℹ</span>
            <span>{sequence.missingMeasureReason}</span>
          </div>
        )}

        {/* Pending Changes Badge */}
        {isDirty && (
          <div className="pending-changes-banner" role="status">
            <span>Settings changed · Click "Build sequence" to apply</span>
          </div>
        )}

        {/* Action Button & Summary */}
        <div className="builder-actions">
          <button
            type="submit"
            className={`build-sequence-btn ${justBuilt ? "just-built" : ""}`}
          >
            {justBuilt ? "✓ Sequence Built" : "Build sequence"}
          </button>

          <div className="builder-summary-line">
            <span className="matching-count">
              {draftPreview.entries.length} matching shot{draftPreview.entries.length === 1 ? "" : "s"}
            </span>
            <span className="summary-sep">·</span>
            <span className="total-runtime">
              {formatTotalTime(draftPreview.totalDuration)} total
            </span>
            {draftPreview.excludedCount > 0 && (
              <>
                <span className="summary-sep">·</span>
                <span className="excluded-count" title="Shots omitted because they lack scan data for the chosen metric">
                  {draftPreview.excludedCount} excluded (no data)
                </span>
              </>
            )}
          </div>
        </div>
      </form>
    </aside>
  );
}
