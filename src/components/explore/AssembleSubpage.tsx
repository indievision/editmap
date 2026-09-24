import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ColorProfile, Project } from "../../models/project";
import type {
  ArrangeMeasure,
  ExploreArrangeConfig,
  ExploreFilters,
  ExploreSequence,
  SavedExploreSequence,
} from "../../models/explore";
import {
  DEFAULT_EXPLORE_ARRANGE,
  DEFAULT_EXPLORE_FILTERS,
} from "../../models/explore";
import {
  buildExploreSequence,
  reconstructExploreSequence,
} from "../../analysis/explore";
import {
  clampSequenceTime,
  findEntryIndexAtSequenceTime,
} from "../../analysis/explorePlayback";
import ExplorePreview from "./ExplorePreview";
import ExploreBuilder from "./ExploreBuilder";
import ExploreTimeline from "./ExploreTimeline";
import ExploreSourceLocator from "./ExploreSourceLocator";
import ExploreSaveModal from "./ExploreSaveModal";

interface AssembleSubpageProps {
  project: Project;
  url: string;
  mediaSignature?: string;
  thumbnails: Record<string, string>;
  colorProfiles?: Record<string, ColorProfile>;
  activeWorkspace: "studio" | "explore";
  activeSubpage: "assemble" | "compare";
  onUpdateProject: (patch: Partial<Project>) => void;
  onLocateInStudio: (shotId: string, sourceTime: number) => void;
  onRelinkVideo: () => void;
  isSaveModalOpen: boolean;
  setIsSaveModalOpen: (open: boolean) => void;
  onStatusNotice: (notice: string) => void;
}

export default function AssembleSubpage({
  project,
  url,
  mediaSignature,
  thumbnails,
  colorProfiles,
  activeWorkspace,
  activeSubpage,
  onUpdateProject,
  onLocateInStudio,
  onRelinkVideo,
  isSaveModalOpen,
  setIsSaveModalOpen,
  onStatusNotice,
}: AssembleSubpageProps) {
  const [filters, setFilters] = useState<ExploreFilters>(DEFAULT_EXPLORE_FILTERS);
  const [arrange, setArrange] = useState<ExploreArrangeConfig>(DEFAULT_EXPLORE_ARRANGE);

  // Context for analysis lookups
  const context = useMemo(
    () => ({
      loudnessAnalysis: project.loudnessAnalysis,
      mediaSignature,
      cast: project.cast,
      colorProfiles,
    }),
    [project.loudnessAnalysis, mediaSignature, project.cast, colorProfiles],
  );

  // Active viewing sequence
  const [sequence, setSequence] = useState<ExploreSequence>(() =>
    buildExploreSequence(project.shots, DEFAULT_EXPLORE_FILTERS, DEFAULT_EXPLORE_ARRANGE, {
      loudnessAnalysis: project.loudnessAnalysis,
      mediaSignature,
      cast: project.cast,
      colorProfiles,
    }),
  );

  // If shots or context data update externally, keep sequence in sync
  useEffect(() => {
    setSequence((prevSeq) =>
      buildExploreSequence(project.shots, filters, arrange, context),
    );
  }, [project.shots, context, filters, arrange]);

  const [activeSequenceTime, setActiveSequenceTime] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);

  // Pause outgoing player immediately when workspace is switched away from explore or subpage switches
  useEffect(() => {
    if (activeWorkspace !== "explore" || activeSubpage !== "assemble") {
      setPlaying(false);
    }
  }, [activeWorkspace, activeSubpage]);

  // Derive active entry index from current sequence time
  const activeEntryIndex = useMemo(() => {
    return findEntryIndexAtSequenceTime(activeSequenceTime, sequence.entries);
  }, [activeSequenceTime, sequence.entries]);

  // Apply new builder settings when user clicks "Build sequence"
  const handleBuildSequence = useCallback(
    (newFilters: ExploreFilters, newArrange: ExploreArrangeConfig) => {
      setFilters(newFilters);
      setArrange(newArrange);
      const nextSeq = buildExploreSequence(project.shots, newFilters, newArrange, context);
      setSequence(nextSeq);
      setActiveSequenceTime(0);

      if (nextSeq.entries.length > 0) {
        onStatusNotice(
          `Sequence built: ${nextSeq.entries.length} shots (${(nextSeq.totalDuration / 60).toFixed(1)}m) · Press Space or ▶ to play`,
        );
      } else {
        setPlaying(false);
        if (nextSeq.missingMeasureReason) {
          onStatusNotice(nextSeq.missingMeasureReason);
        } else {
          onStatusNotice("0 shots matched the current filter criteria.");
        }
      }
    },
    [project.shots, context, onStatusNotice],
  );

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_EXPLORE_FILTERS);
    setArrange(DEFAULT_EXPLORE_ARRANGE);
    const resetSeq = buildExploreSequence(
      project.shots,
      DEFAULT_EXPLORE_FILTERS,
      DEFAULT_EXPLORE_ARRANGE,
      context,
    );
    setSequence(resetSeq);
    setActiveSequenceTime(0);
    setPlaying(false);
    onStatusNotice("Sequence reset to all shots in original order.");
  }, [project.shots, context, onStatusNotice]);

  // Stepping shots (prev / next)
  const handleStepShot = useCallback(
    (direction: "prev" | "next") => {
      if (sequence.entries.length === 0) return;

      const curIndex = findEntryIndexAtSequenceTime(activeSequenceTime, sequence.entries);
      if (curIndex === -1) return;

      if (direction === "prev") {
        const curEntry = sequence.entries[curIndex];
        const offset = activeSequenceTime - curEntry.sequenceStart;
        if (offset > 1.0) {
          setActiveSequenceTime(curEntry.sequenceStart);
        } else if (curIndex > 0) {
          setActiveSequenceTime(sequence.entries[curIndex - 1].sequenceStart);
        } else {
          setActiveSequenceTime(0);
        }
      } else {
        if (curIndex + 1 < sequence.entries.length) {
          setActiveSequenceTime(sequence.entries[curIndex + 1].sequenceStart);
        } else {
          setActiveSequenceTime(sequence.totalDuration);
          setPlaying(false);
        }
      }
    },
    [activeSequenceTime, sequence.entries, sequence.totalDuration],
  );

  // Keyboard shortcut listener (only active when explore workspace and assemble subpage are active)
  useEffect(() => {
    if (activeWorkspace !== "explore" || activeSubpage !== "assemble") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (sequence.entries.length > 0) {
          setPlaying((prev) => !prev);
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleStepShot("prev");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleStepShot("next");
      } else if (e.key === "Escape") {
        if (isSaveModalOpen) {
          setIsSaveModalOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorkspace, activeSubpage, sequence.entries.length, handleStepShot, isSaveModalOpen, setIsSaveModalOpen]);

  // Saving sequences
  const handleSaveCurrentSequence = useCallback(
    (name: string) => {
      const newSaved: SavedExploreSequence = {
        id: crypto.randomUUID(),
        name,
        filters: { ...filters },
        arrange: { ...arrange },
        shotIds: sequence.entries.map((e) => e.shotId),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const existing = project.savedExploreSequences || [];
      onUpdateProject({
        savedExploreSequences: [...existing, newSaved],
      });
      onStatusNotice(`Saved sequence "${name}".`);
    },
    [filters, arrange, sequence.entries, project.savedExploreSequences, onUpdateProject, onStatusNotice],
  );

  const handleOpenSavedSequence = useCallback(
    (savedSeq: SavedExploreSequence) => {
      const { sequence: reconstructed, missingShotIds } = reconstructExploreSequence(
        savedSeq.shotIds,
        project.shots,
        savedSeq.filters,
        savedSeq.arrange,
        context,
      );

      setFilters(savedSeq.filters);
      setArrange(savedSeq.arrange);
      setSequence(reconstructed);
      setActiveSequenceTime(0);

      if (missingShotIds.length > 0) {
        onStatusNotice(
          `Opened "${savedSeq.name}". (${missingShotIds.length} shot${missingShotIds.length === 1 ? "" : "s"} were deleted from project and omitted)`,
        );
      } else {
        onStatusNotice(`Opened saved sequence "${savedSeq.name}".`);
      }
    },
    [project.shots, context, onStatusNotice],
  );

  const handleDeleteSavedSequence = useCallback(
    (id: string) => {
      const existing = project.savedExploreSequences || [];
      const updated = existing.filter((s) => s.id !== id);
      onUpdateProject({
        savedExploreSequences: updated,
      });
      onStatusNotice("Deleted saved sequence.");
    },
    [project.savedExploreSequences, onUpdateProject, onStatusNotice],
  );

  return (
    <div className="assemble-subpage-container" data-testid="assemble-subpage">
      {/* TOP ROW: PREVIEW MONITOR (LEFT) + BUILDER PANEL (RIGHT) */}
      <div className="explore-top-stage">
        <div className="explore-preview-column">
          <ExplorePreview
            sequence={sequence}
            activeSequenceTime={activeSequenceTime}
            activeEntryIndex={activeEntryIndex}
            url={url}
            frameRate={project.frameRate}
            dropFrame={project.dropFrame}
            playing={playing}
            onPlayPause={setPlaying}
            onSeekSequenceTime={setActiveSequenceTime}
            onStepShot={handleStepShot}
            onLocateInStudio={onLocateInStudio}
            onRelinkVideo={onRelinkVideo}
          />
        </div>

        <div className="explore-builder-column">
          <ExploreBuilder
            shots={project.shots}
            cast={project.cast || []}
            activeFilters={filters}
            activeArrange={arrange}
            sequence={sequence}
            context={context}
            url={url}
            onBuildSequence={handleBuildSequence}
            onResetFilters={handleResetFilters}
          />
        </div>
      </div>

      {/* MIDDLE SECTION: PLAYABLE EXPLORE TIMELINE */}
      <div className="explore-middle-stage">
        <ExploreTimeline
          sequence={sequence}
          activeSequenceTime={activeSequenceTime}
          activeEntryIndex={activeEntryIndex}
          thumbnails={thumbnails}
          frameRate={project.frameRate}
          dropFrame={project.dropFrame}
          onSeekSequenceTime={setActiveSequenceTime}
          onSelectEntry={(index) => {
            const entry = sequence.entries[index];
            if (entry) setActiveSequenceTime(entry.sequenceStart);
          }}
          onSaveSequence={() => setIsSaveModalOpen(true)}
          onResetSequence={handleResetFilters}
          onSelectArrangeMeasure={(measure: ArrangeMeasure) =>
            handleBuildSequence(filters, { measure, direction: "asc" })
          }
        />
      </div>

      {/* BOTTOM SECTION: SOURCE LOCATOR REFERENCE STRIP */}
      <div className="explore-bottom-stage">
        <ExploreSourceLocator
          sequence={sequence}
          filmDuration={project.duration || 1}
          activeEntryIndex={activeEntryIndex}
          onSelectEntry={(index) => {
            const entry = sequence.entries[index];
            if (entry) setActiveSequenceTime(entry.sequenceStart);
          }}
          onSeekSequenceTime={setActiveSequenceTime}
        />
      </div>

      {/* SAVE / MANAGE SEQUENCES MODAL */}
      {isSaveModalOpen && (
        <ExploreSaveModal
          currentSequenceName={sequence.name}
          savedSequences={project.savedExploreSequences || []}
          onSaveCurrent={handleSaveCurrentSequence}
          onOpenSaved={handleOpenSavedSequence}
          onDeleteSaved={handleDeleteSavedSequence}
          onClose={() => setIsSaveModalOpen(false)}
        />
      )}
    </div>
  );
}
