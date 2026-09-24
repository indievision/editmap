import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, SequenceMarker } from "../../models/project";
import type { SavedExploreComparison } from "../../models/explore";
import { getEligiblePassages } from "../../analysis/passageComparison";
import ComparePanel, { type ComparePanelHandle } from "./ComparePanel";
import CompareMeasurementsTable from "./CompareMeasurementsTable";
import CompareSaveModal from "./CompareSaveModal";

interface CompareSubpageProps {
  project: Project;
  url: string;
  mediaSignature?: string;
  thumbnails: Record<string, string>;
  activeWorkspace: "studio" | "explore";
  activeSubpage: "assemble" | "compare";
  onUpdateProject: (patch: Partial<Project>) => void;
  onLocateInStudio: (shotId: string, sourceTime: number, passageId?: string) => void;
  onRelinkVideo: () => void;
  isSaveModalOpen: boolean;
  setIsSaveModalOpen: (open: boolean) => void;
  onStatusNotice: (notice: string) => void;
}

export default function CompareSubpage({
  project,
  url,
  mediaSignature,
  thumbnails,
  activeWorkspace,
  activeSubpage,
  onUpdateProject,
  onLocateInStudio,
  onRelinkVideo,
  isSaveModalOpen,
  setIsSaveModalOpen,
  onStatusNotice,
}: CompareSubpageProps) {
  // Extract filmmaker-authored passages (positive duration, excludes moments, supports legacy)
  const passages: SequenceMarker[] = useMemo(() => {
    return getEligiblePassages(project.sequences);
  }, [project.sequences]);

  // Selected passage IDs for side A and side B
  const [selectedAId, setSelectedAId] = useState<string>(() => {
    return passages[0]?.id ?? "";
  });

  const [selectedBId, setSelectedBId] = useState<string>(() => {
    return passages[1]?.id ?? passages[0]?.id ?? "";
  });

  // Ensure selected IDs remain valid if passages change/delete
  useEffect(() => {
    if (passages.length === 0) {
      setSelectedAId("");
      setSelectedBId("");
      return;
    }

    setSelectedAId((prevA) => {
      const exists = passages.some((p) => p.id === prevA);
      return exists ? prevA : passages[0].id;
    });

    setSelectedBId((prevB) => {
      const exists = passages.some((p) => p.id === prevB);
      if (exists) return prevB;
      // Default to distinct passage if available
      return passages.length > 1 ? passages[1].id : passages[0].id;
    });
  }, [passages]);

  // Active playing side: "A", "B", or null. Playing one pauses the other without resetting position.
  const [playingSide, setPlayingSide] = useState<"A" | "B" | null>(null);

  // Pause playback immediately if leaving explore workspace or switching to Assemble subpage
  useEffect(() => {
    if (activeWorkspace !== "explore" || activeSubpage !== "compare") {
      setPlayingSide(null);
    }
  }, [activeWorkspace, activeSubpage]);

  // Current passage objects
  const passageA = useMemo(() => {
    return passages.find((p) => p.id === selectedAId);
  }, [passages, selectedAId]);

  const passageB = useMemo(() => {
    return passages.find((p) => p.id === selectedBId);
  }, [passages, selectedBId]);

  // Reading interpretation note state
  const [readingNote, setReadingNote] = useState<string>("");
  const [activeComparisonId, setActiveComparisonId] = useState<string | null>(null);

  // Playhead time tracking for cursors in charts
  const [playheadA, setPlayheadA] = useState<{ localTime: number; sourceTime: number }>({
    localTime: 0,
    sourceTime: passageA?.startSeconds ?? 0,
  });
  const [playheadB, setPlayheadB] = useState<{ localTime: number; sourceTime: number }>({
    localTime: 0,
    sourceTime: passageB?.startSeconds ?? 0,
  });

  // ComparePanel refs for typed seeking
  const panelARef = useRef<import("./ComparePanel").ComparePanelHandle>(null);
  const panelBRef = useRef<import("./ComparePanel").ComparePanelHandle>(null);

  const handleTimeUpdateA = useCallback((localTime: number, sourceTime: number) => {
    setPlayheadA({ localTime, sourceTime });
  }, []);

  const handleTimeUpdateB = useCallback((localTime: number, sourceTime: number) => {
    setPlayheadB({ localTime, sourceTime });
  }, []);

  // Chart seek handler routed directly to ComparePanel
  const handleChartSeek = useCallback(
    (
      side: "A" | "B",
      target: { passageId: string; localTime: number; sourceTime: number },
    ) => {
      if (side === "A") {
        if (target.passageId !== selectedAId) return;
        panelARef.current?.seekToLocalTime(target.localTime);
      } else {
        if (target.passageId !== selectedBId) return;
        panelBRef.current?.seekToLocalTime(target.localTime);
      }
    },
    [selectedAId, selectedBId],
  );

  // Changing A resets only A's playback
  const handleSelectA = useCallback((newId: string) => {
    setSelectedAId(newId);
    setPlayingSide((prev) => (prev === "A" ? null : prev));
  }, []);

  // Changing B resets only B's playback
  const handleSelectB = useCallback((newId: string) => {
    setSelectedBId(newId);
    setPlayingSide((prev) => (prev === "B" ? null : prev));
  }, []);

  // Save current comparison
  const handleSaveCurrentComparison = useCallback(
    (name: string, note?: string) => {
      if (!passageA || !passageB) return;

      const newSaved: SavedExploreComparison = {
        id: activeComparisonId || crypto.randomUUID(),
        name,
        passageAId: passageA.id,
        passageBId: passageB.id,
        note: note || readingNote || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const existing = project.savedExploreComparisons || [];
      const updated = existing.filter((c) => c.id !== newSaved.id);

      onUpdateProject({
        savedExploreComparisons: [...updated, newSaved],
      });

      setActiveComparisonId(newSaved.id);
      if (note !== undefined) {
        setReadingNote(note);
      }
      onStatusNotice(`Saved comparison "${name}".`);
    },
    [passageA, passageB, activeComparisonId, readingNote, project.savedExploreComparisons, onUpdateProject, onStatusNotice],
  );

  // Open a saved comparison
  const handleOpenSavedComparison = useCallback(
    (saved: SavedExploreComparison) => {
      const foundA = passages.find((p) => p.id === saved.passageAId);
      const foundB = passages.find((p) => p.id === saved.passageBId);

      if (!foundA || !foundB) {
        onStatusNotice(
          `Could not open comparison "${saved.name}": one or both passages were deleted from the project.`,
        );
        return;
      }

      setSelectedAId(saved.passageAId);
      setSelectedBId(saved.passageBId);
      setReadingNote(saved.note || "");
      setActiveComparisonId(saved.id);
      setPlayingSide(null);
      onStatusNotice(`Opened saved comparison "${saved.name}".`);
    },
    [passages, onStatusNotice],
  );

  // Delete a saved comparison
  const handleDeleteSavedComparison = useCallback(
    (id: string) => {
      const existing = project.savedExploreComparisons || [];
      const updated = existing.filter((c) => c.id !== id);
      onUpdateProject({
        savedExploreComparisons: updated,
      });
      if (activeComparisonId === id) {
        setActiveComparisonId(null);
      }
      onStatusNotice("Deleted saved comparison.");
    },
    [project.savedExploreComparisons, activeComparisonId, onUpdateProject, onStatusNotice],
  );

  // Save note action from footer
  const handleSaveNote = () => {
    if (!passageA || !passageB) return;
    const noteText = readingNote.trim();
    if (!noteText) return;

    if (activeComparisonId) {
      const existing = project.savedExploreComparisons || [];
      const updated = existing.map((c) =>
        c.id === activeComparisonId ? { ...c, note: noteText, updatedAt: new Date().toISOString() } : c,
      );
      onUpdateProject({ savedExploreComparisons: updated });
      onStatusNotice("Updated reading note on saved comparison.");
    } else {
      // Save new comparison with default name and note
      const defaultName = `${passageA.name} vs ${passageB.name}`;
      handleSaveCurrentComparison(defaultName, noteText);
    }
  };

  // Keyboard shortcut listener for spacebar playback
  useEffect(() => {
    if (activeWorkspace !== "explore" || activeSubpage !== "compare") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const role = target?.getAttribute?.("role");
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        tag === "button" ||
        role === "tab" ||
        role === "button" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        // Toggle play on currently active side, or default to A
        setPlayingSide((prev) => {
          if (prev === "A") return null;
          if (prev === "B") return null;
          return "A";
        });
      } else if (e.key === "Escape") {
        if (isSaveModalOpen) {
          setIsSaveModalOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorkspace, activeSubpage, isSaveModalOpen, setIsSaveModalOpen]);

  // If fewer than 2 valid passages exist, explain how to create them in Studio
  if (passages.length < 2) {
    return (
      <div className="compare-empty-container" data-testid="compare-empty-state">
        <div className="compare-empty-card">
          <div className="compare-empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="7" height="18" rx="1" />
              <rect x="14" y="3" width="7" height="18" rx="1" />
            </svg>
          </div>
          <h3 className="compare-empty-title">Compare Named Studio Passages</h3>
          <p className="compare-empty-text">
            Comparison requires at least two filmmaker-authored passages defined in Studio.
          </p>
          <div className="compare-empty-steps">
            <p><strong>To create passages:</strong></p>
            <ol>
              <li>Switch to <strong>Studio</strong> in the top workspace tabs.</li>
              <li>Select an In and Out range on the timeline or in the <strong>Structure</strong> tool.</li>
              <li>Name your passage (e.g. <em>"First encounter"</em>, <em>"Last conversation"</em>).</li>
            </ol>
          </div>
          {passages.length === 1 && (
            <p className="compare-empty-note">
              Currently, 1 passage (<em>"{passages[0].name}"</em>) exists. One more passage is needed to compare.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="compare-subpage-container" data-testid="compare-subpage">
      {/* TWO EQUAL-WIDTH COLUMNS: A (LEFT) & B (RIGHT) */}
      <div className="compare-columns-stage">
        {/* COLUMN A: GOLD ACCENT */}
        <div className="compare-column compare-column-a">
          <ComparePanel
            ref={panelARef}
            side="A"
            passages={passages}
            selectedPassageId={selectedAId}
            onSelectPassageId={handleSelectA}
            shots={project.shots}
            url={url}
            frameRate={project.frameRate}
            dropFrame={project.dropFrame}
            isPlaying={playingSide === "A"}
            onPlayRequest={() => setPlayingSide("A")}
            onPauseRequest={() => setPlayingSide((prev) => (prev === "A" ? null : prev))}
            onLocateInStudio={onLocateInStudio}
            onRelinkVideo={onRelinkVideo}
            thumbnails={thumbnails}
            onTimeUpdate={handleTimeUpdateA}
          />
        </div>

        {/* COLUMN B: CYAN ACCENT */}
        <div className="compare-column compare-column-b">
          <ComparePanel
            ref={panelBRef}
            side="B"
            passages={passages}
            selectedPassageId={selectedBId}
            onSelectPassageId={handleSelectB}
            shots={project.shots}
            url={url}
            frameRate={project.frameRate}
            dropFrame={project.dropFrame}
            isPlaying={playingSide === "B"}
            onPlayRequest={() => setPlayingSide("B")}
            onPauseRequest={() => setPlayingSide((prev) => (prev === "B" ? null : prev))}
            onLocateInStudio={onLocateInStudio}
            onRelinkVideo={onRelinkVideo}
            thumbnails={thumbnails}
            onTimeUpdate={handleTimeUpdateB}
          />
        </div>
      </div>

      {/* QUIET HELPER CAPTION */}
      <div className="compare-sync-caption" aria-live="polite">
        Independent playback · Playing one side pauses the other
      </div>

      {/* COMPACT ALIGNED MEASUREMENTS & 4 ANALYSIS VIEWS */}
      <div className="compare-measurements-row">
        <CompareMeasurementsTable
          passageA={passageA}
          passageB={passageB}
          shots={project.shots}
          speechAnalysis={project.speechAnalysis}
          loudnessAnalysis={project.loudnessAnalysis}
          dmeWaveforms={project.dmeWaveforms}
          cast={project.cast}
          mediaSignature={mediaSignature}
          filmDuration={project.duration}
          playheadA={playheadA}
          playheadB={playheadB}
          playingSide={playingSide}
          onSeek={handleChartSeek}
        />
      </div>

      {/* READING / NOTE FOOTER */}
      <footer className="compare-footer-bar">
        <div className="compare-reading-group">
          <label htmlFor="compare-reading-input" className="compare-reading-label">
            Your reading
          </label>
          <input
            id="compare-reading-input"
            type="text"
            className="compare-reading-input"
            placeholder="Add a note about these passages…"
            value={readingNote}
            onChange={(e) => setReadingNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSaveNote();
              }
            }}
          />
          <button
            type="button"
            className="compare-save-note-btn"
            onClick={handleSaveNote}
            disabled={!readingNote.trim()}
          >
            Save note
          </button>
        </div>

        <div className="compare-footer-footnote">
          <span className="footnote-text">Real project data</span>
        </div>
      </footer>

      {/* SAVE / MANAGE COMPARISONS MODAL */}
      {isSaveModalOpen && (
        <CompareSaveModal
          currentPassageA={passageA}
          currentPassageB={passageB}
          currentNote={readingNote}
          savedComparisons={project.savedExploreComparisons || []}
          allPassages={passages}
          onSaveCurrent={handleSaveCurrentComparison}
          onOpenSaved={handleOpenSavedComparison}
          onDeleteSaved={handleDeleteSavedComparison}
          onClose={() => setIsSaveModalOpen(false)}
        />
      )}
    </div>
  );
}
