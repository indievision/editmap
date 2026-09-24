import React, { useEffect, useMemo, useRef, useState } from "react";
import { sequenceReading } from "../analysis/pacing";
import type { Project, SequenceMarker } from "../models/project";
import {
  STRUCTURE_VOCABULARIES,
  getVocabulary,
  getSelectableBeats,
  type StructureVocabularyId,
} from "../models/structureVocabularies";
import { quantizeToFrame } from "../timeline/timelineOps";
import { formatTimecode, parseTimecodeSafely } from "../utils/timecode";

export type TimeRange = { start: number; end: number };
export type DraftRange = { start?: number; end?: number };

export interface SequenceReadingProps {
  project: Project;
  range?: DraftRange;
  currentTime?: number;
  onRangeChange: (range?: DraftRange) => void;
  onSeek: (time: number) => void;
  onUpdate: (sequences: SequenceMarker[]) => void;
  onUpdateProject?: (patch: Partial<Project>) => void;
  selectedEntryId?: string | null;
  onSelectEntryId?: (id: string | null) => void;
  onClose?: () => void;
  variant?: "deck" | "drawer";
}

export default function SequenceReading({
  project,
  range,
  currentTime = 0,
  onRangeChange,
  onSeek,
  onUpdate,
  onUpdateProject,
  selectedEntryId,
  onSelectEntryId,
  onClose,
  variant = "deck",
}: SequenceReadingProps) {
  // Deck variant state
  const [deckName, setDeckName] = useState("");

  // Vocabulary & custom labels state
  const vocabId: StructureVocabularyId = project.structureVocabulary || "freeform";
  const activeVocab = useMemo(() => getVocabulary(vocabId), [vocabId]);
  const [showManageLabels, setShowManageLabels] = useState(false);
  const [showVocabInfo, setShowVocabInfo] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [newLabelInput, setNewLabelInput] = useState("");
  const [editingLabelIdx, setEditingLabelIdx] = useState<number | null>(null);
  const [editingLabelText, setEditingLabelText] = useState("");

  // Drawer variant state
  const [mode, setMode] = useState<"moment" | "passage">(() =>
    range && range.end !== undefined && range.start !== undefined && range.end > range.start
      ? "passage"
      : "moment",
  );
  const [editingId, setEditingId] = useState<string | null>(selectedEntryId ?? null);
  const [name, setName] = useState("");
  const [beatSelect, setBeatSelect] = useState<string>("No label");
  const [customBeat, setCustomBeat] = useState("");
  const [notes, setNotes] = useState("");
  const [statusMessage, setStatusMessage] = useState("Your interpretation");

  // In / Out / At anchor states (frame-accurate)
  const initialMomentTime = useMemo(
    () => quantizeToFrame(currentTime, project.frameRate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [momentTime, setMomentTime] = useState<number>(initialMomentTime);
  const [atText, setAtText] = useState<string>(() =>
    formatTimecode(initialMomentTime, project.frameRate, project.dropFrame),
  );
  const [atError, setAtError] = useState<string>("");

  const [draftIn, setDraftIn] = useState<number | undefined>(() =>
    range?.start !== undefined ? quantizeToFrame(range.start, project.frameRate) : undefined,
  );
  const [inText, setInText] = useState<string>(() =>
    range?.start !== undefined
      ? formatTimecode(quantizeToFrame(range.start, project.frameRate), project.frameRate, project.dropFrame)
      : "",
  );
  const [inError, setInError] = useState<string>("");

  const [draftOut, setDraftOut] = useState<number | undefined>(() =>
    range?.end !== undefined ? quantizeToFrame(range.end, project.frameRate) : undefined,
  );
  const [outText, setOutText] = useState<string>(() =>
    range?.end !== undefined
      ? formatTimecode(quantizeToFrame(range.end, project.frameRate), project.frameRate, project.dropFrame)
      : "",
  );
  const [outError, setOutError] = useState<string>("");

  const nameInputRef = useRef<HTMLInputElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  // Sync selectedEntryId prop from outside (e.g. clicked on Story lane)
  useEffect(() => {
    if (selectedEntryId !== undefined) {
      if (selectedEntryId === null) {
        setEditingId(null);
      } else {
        const found = project.sequences?.find((s) => s.id === selectedEntryId);
        if (found) {
          if (found.id !== editingId) {
            loadEntryIntoState(found);
          } else {
            // Update time bounds if dragged on timeline
            if ((found.kind ?? "passage") === "moment") {
              if (found.startSeconds !== momentTime) {
                setMomentTime(found.startSeconds);
                setAtText(formatTimecode(found.startSeconds, project.frameRate, project.dropFrame));
              }
            } else {
              if (found.startSeconds !== draftIn || found.endSeconds !== draftOut) {
                setDraftIn(found.startSeconds);
                setDraftOut(found.endSeconds);
                setInText(formatTimecode(found.startSeconds, project.frameRate, project.dropFrame));
                setOutText(formatTimecode(found.endSeconds, project.frameRate, project.dropFrame));
              }
            }
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntryId, project.sequences]);

  // Synchronize when timeline range changes from timeline Shift-drag or I/O shortcuts
  useEffect(() => {
    if (mode === "passage") {
      if (range?.start !== undefined && range.start !== draftIn) {
        const qStart = quantizeToFrame(range.start, project.frameRate);
        setDraftIn(qStart);
        setInText(formatTimecode(qStart, project.frameRate, project.dropFrame));
        setInError("");
      }
      if (range?.end !== undefined && range.end !== draftOut) {
        const qEnd = quantizeToFrame(range.end, project.frameRate);
        setDraftOut(qEnd);
        setOutText(formatTimecode(qEnd, project.frameRate, project.dropFrame));
        setOutError("");
      }
    }
  }, [range?.start, range?.end, mode, draftIn, draftOut, project.frameRate, project.dropFrame]);

  // If both In and Out are set, validate relative order
  useEffect(() => {
    if (draftIn !== undefined && draftOut !== undefined) {
      if (draftOut <= draftIn) {
        setOutError("Out must be after In");
      } else if (outError === "Out must be after In") {
        setOutError("");
      }
    }
  }, [draftIn, draftOut, outError]);

  // Close menus and info popovers on outside click or Escape
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".sr-item-actions")) {
        setOpenMenuId(null);
      }
      if (!target.closest(".sr-info-wrap")) {
        setShowVocabInfo(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenuId(null);
        setShowVocabInfo(false);
      }
    };
    window.addEventListener("click", handleGlobalClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Dirty state tracking to prevent accidental navigation loss
  const isDirty = useMemo(() => {
    if (editingId !== null) {
      const original = project.sequences?.find((s) => s.id === editingId);
      if (!original) return false;
      const origBeat = original.beat ?? "";
      const currentBeat =
        beatSelect === "Custom…" ? customBeat.trim() : beatSelect === "No label" ? "" : beatSelect;
      const origNotes = original.notes ?? "";
      const origKind = original.kind ?? "passage";

      if (name.trim() !== original.name.trim()) return true;
      if (notes.trim() !== origNotes.trim()) return true;
      if (currentBeat !== origBeat) return true;
      if (mode !== origKind) return true;

      if (mode === "moment") {
        if (momentTime !== original.startSeconds) return true;
      } else {
        if (draftIn !== original.startSeconds || draftOut !== original.endSeconds) return true;
      }
      return false;
    }
    return (
      name.trim().length > 0 ||
      notes.trim().length > 0 ||
      beatSelect !== "No label" ||
      customBeat.trim().length > 0 ||
      (mode === "passage" && (draftIn !== undefined || draftOut !== undefined))
    );
  }, [editingId, project.sequences, beatSelect, customBeat, name, notes, mode, momentTime, draftIn, draftOut]);

  const sortedEntries = useMemo(() => {
    return [...(project.sequences ?? [])].sort(
      (a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds,
    );
  }, [project.sequences]);

  // Selectable beats for dropdown (integrating current vocabulary + project custom labels)
  const selectableBeats = useMemo(() => {
    const entryBeat = editingId
      ? project.sequences?.find((s) => s.id === editingId)?.beat
      : undefined;
    return getSelectableBeats(activeVocab, project.customStoryBeats || [], entryBeat);
  }, [activeVocab, project.customStoryBeats, project.sequences, editingId]);

  // Rhythm Evidence Range & Calculation (Strictly for passages)
  const { evidenceRange, evidenceReading, evidenceSummaryText } = useMemo(() => {
    if (mode === "passage" && draftIn !== undefined && draftOut !== undefined && draftOut > draftIn) {
      const reading = sequenceReading(project.shots, draftIn, draftOut);
      const durationSec = draftOut - draftIn;
      return {
        evidenceRange: { start: draftIn, end: draftOut },
        evidenceReading: reading,
        evidenceSummaryText: `Selected passage · ${durationSec.toFixed(1)} sec`,
      };
    }

    return {
      evidenceRange: null,
      evidenceReading: null,
      evidenceSummaryText: "No passage selected",
    };
  }, [mode, draftIn, draftOut, project.shots]);

  // --- Handlers for Vocabulary & Custom Labels ---
  const handleVocabChange = (newVocabId: StructureVocabularyId) => {
    onUpdateProject?.({ structureVocabulary: newVocabId });
  };

  const handleAddCustomLabel = () => {
    const trimmed = newLabelInput.trim();
    if (!trimmed) return;
    const current = project.customStoryBeats || [];
    if (!current.includes(trimmed)) {
      onUpdateProject?.({ customStoryBeats: [...current, trimmed] });
    }
    setNewLabelInput("");
  };

  const handleRemoveCustomLabel = (beatToRemove: string) => {
    const current = project.customStoryBeats || [];
    onUpdateProject?.({
      customStoryBeats: current.filter((b) => b !== beatToRemove),
    });
  };

  const handleSaveRenameCustomLabel = (idx: number) => {
    const trimmed = editingLabelText.trim();
    if (!trimmed) return;
    const current = [...(project.customStoryBeats || [])];
    current[idx] = trimmed;
    onUpdateProject?.({ customStoryBeats: current });
    setEditingLabelIdx(null);
    setEditingLabelText("");
  };

  const handleMoveCustomLabel = (idx: number, direction: -1 | 1) => {
    const current = [...(project.customStoryBeats || [])];
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= current.length) return;
    const item = current.splice(idx, 1)[0];
    current.splice(targetIdx, 0, item);
    onUpdateProject?.({ customStoryBeats: current });
  };

  // --- Handlers for In / Out / At text fields ---
  const handleInTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInText(val);
    const parsed = parseTimecodeSafely(val, project.frameRate, project.dropFrame);
    if (!parsed.valid || parsed.seconds === undefined) {
      setInError(parsed.error || "Invalid timecode");
      return;
    }
    if (parsed.seconds < 0 || parsed.seconds > project.duration) {
      setInError(`Out of bounds (film duration is ${formatTimecode(project.duration, project.frameRate, project.dropFrame)})`);
      return;
    }
    const q = quantizeToFrame(parsed.seconds, project.frameRate);
    setDraftIn(q);
    setInError("");
    if (draftOut !== undefined && q >= draftOut) {
      setOutError("Out must be after In");
    } else {
      setOutError("");
    }
    onRangeChange({ start: q, end: draftOut });
  };

  const handleOutTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setOutText(val);
    const parsed = parseTimecodeSafely(val, project.frameRate, project.dropFrame);
    if (!parsed.valid || parsed.seconds === undefined) {
      setOutError(parsed.error || "Invalid timecode");
      return;
    }
    if (parsed.seconds < 0 || parsed.seconds > project.duration) {
      setOutError(`Out of bounds (film duration is ${formatTimecode(project.duration, project.frameRate, project.dropFrame)})`);
      return;
    }
    const q = quantizeToFrame(parsed.seconds, project.frameRate);
    setDraftOut(q);
    if (draftIn !== undefined && q <= draftIn) {
      setOutError("Out must be after In");
      return;
    }
    setOutError("");
    onRangeChange({ start: draftIn, end: q });
  };

  const handleAtTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setAtText(val);
    const parsed = parseTimecodeSafely(val, project.frameRate, project.dropFrame);
    if (!parsed.valid || parsed.seconds === undefined) {
      setAtError(parsed.error || "Invalid timecode");
      return;
    }
    if (parsed.seconds < 0 || parsed.seconds > project.duration) {
      setAtError(`Out of bounds (film duration is ${formatTimecode(project.duration, project.frameRate, project.dropFrame)})`);
      return;
    }
    const q = quantizeToFrame(parsed.seconds, project.frameRate);
    setMomentTime(q);
    setAtError("");
  };

  const handleSetInAtPlayhead = () => {
    const q = quantizeToFrame(currentTime, project.frameRate);
    setDraftIn(q);
    setInText(formatTimecode(q, project.frameRate, project.dropFrame));
    setInError("");
    let targetOut = draftOut;
    if (targetOut !== undefined && q >= targetOut) {
      targetOut = quantizeToFrame(q + 1, project.frameRate);
      setDraftOut(targetOut);
      setOutText(formatTimecode(targetOut, project.frameRate, project.dropFrame));
      setOutError("");
    }
    onRangeChange({ start: q, end: targetOut });
    setStatusMessage("In point marked at playhead");
  };

  const handleSetOutAtPlayhead = () => {
    let q = quantizeToFrame(currentTime, project.frameRate);
    let targetIn = draftIn;
    if (targetIn !== undefined && q <= targetIn) {
      q = quantizeToFrame(targetIn + 1, project.frameRate);
    }
    setDraftOut(q);
    setOutText(formatTimecode(q, project.frameRate, project.dropFrame));
    setOutError("");
    onRangeChange({ start: targetIn, end: q });
    setStatusMessage("Out point marked at playhead");
  };

  const handleClearInOut = () => {
    setDraftIn(undefined);
    setDraftOut(undefined);
    setInText("");
    setOutText("");
    setInError("");
    setOutError("");
    onRangeChange(undefined);
    setStatusMessage("Cleared In / Out marks");
  };

  const handleSetAtPlayhead = () => {
    const q = quantizeToFrame(currentTime, project.frameRate);
    setMomentTime(q);
    setAtText(formatTimecode(q, project.frameRate, project.dropFrame));
    setAtError("");
    setStatusMessage("Moment anchored at playhead");
  };

  const handleModeChange = (newMode: "moment" | "passage") => {
    if (newMode === mode) return;
    setMode(newMode);
    if (newMode === "moment") {
      if (momentTime === undefined) {
        const defaultSec = draftIn !== undefined ? draftIn : currentTime;
        const q = quantizeToFrame(defaultSec, project.frameRate);
        setMomentTime(q);
        setAtText(formatTimecode(q, project.frameRate, project.dropFrame));
      }
      setStatusMessage(editingId ? "Editing saved entry" : "Your interpretation");
    } else {
      let qIn = draftIn ?? (range?.start !== undefined ? range.start : currentTime);
      let qOut = draftOut ?? (range?.end !== undefined ? range.end : qIn + 3);
      if (qOut <= qIn) qOut = qIn + 3;
      qIn = quantizeToFrame(qIn, project.frameRate);
      qOut = quantizeToFrame(qOut, project.frameRate);
      setDraftIn(qIn);
      setDraftOut(qOut);
      setInText(formatTimecode(qIn, project.frameRate, project.dropFrame));
      setOutText(formatTimecode(qOut, project.frameRate, project.dropFrame));
      onRangeChange({ start: qIn, end: qOut });
      setStatusMessage(editingId ? "Editing saved entry" : "Your interpretation");
    }
  };

  const handleNewEntry = () => {
    if (isDirty) {
      const discard = window.confirm("You have unsaved changes. Discard them?");
      if (!discard) return;
    }
    setOpenMenuId(null);
    setEditingId(null);
    onSelectEntryId?.(null);
    setName("");
    setNotes("");
    setBeatSelect("No label");
    setCustomBeat("");
    setInError("");
    setOutError("");
    setAtError("");

    if (range?.start !== undefined && range?.end !== undefined && range.end > range.start) {
      setMode("passage");
      const qStart = quantizeToFrame(range.start, project.frameRate);
      const qEnd = quantizeToFrame(range.end, project.frameRate);
      setDraftIn(qStart);
      setDraftOut(qEnd);
      setInText(formatTimecode(qStart, project.frameRate, project.dropFrame));
      setOutText(formatTimecode(qEnd, project.frameRate, project.dropFrame));
    } else {
      setMode("moment");
      const q = quantizeToFrame(currentTime, project.frameRate);
      setMomentTime(q);
      setAtText(formatTimecode(q, project.frameRate, project.dropFrame));
    }
    setStatusMessage("Your interpretation");
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const loadEntryIntoState = (entry: SequenceMarker) => {
    setOpenMenuId(null);
    setEditingId(entry.id);
    onSelectEntryId?.(entry.id);
    setName(entry.name);
    setNotes(entry.notes ?? "");

    const entryBeat = entry.beat ?? "";
    const isVocabOrProjectCustom =
      activeVocab.beats.includes(entryBeat) ||
      (project.customStoryBeats || []).includes(entryBeat);

    if (entryBeat) {
      if (isVocabOrProjectCustom) {
        setBeatSelect(entryBeat);
        setCustomBeat("");
      } else {
        setBeatSelect("Custom…");
        setCustomBeat(entryBeat);
      }
    } else {
      setBeatSelect("No label");
      setCustomBeat("");
    }

    const itemKind = entry.kind ?? "passage";
    setMode(itemKind);
    setInError("");
    setOutError("");
    setAtError("");

    if (itemKind === "moment") {
      setMomentTime(entry.startSeconds);
      setAtText(formatTimecode(entry.startSeconds, project.frameRate, project.dropFrame));
      onSeek(entry.startSeconds);
      onRangeChange(undefined);
    } else {
      setDraftIn(entry.startSeconds);
      setDraftOut(entry.endSeconds);
      setInText(formatTimecode(entry.startSeconds, project.frameRate, project.dropFrame));
      setOutText(formatTimecode(entry.endSeconds, project.frameRate, project.dropFrame));
      onRangeChange({ start: entry.startSeconds, end: entry.endSeconds });
      onSeek(entry.startSeconds);
    }
    setStatusMessage("Editing saved entry");
  };

  const handleSelectEntry = (entry: SequenceMarker) => {
    if (entry.id === editingId) return;
    if (isDirty) {
      const discard = window.confirm("You have unsaved changes. Discard them?");
      if (!discard) return;
    }
    loadEntryIntoState(entry);
  };

  const handleDelete = (idToDelete: string) => {
    const entry = project.sequences?.find((s) => s.id === idToDelete);
    const label = entry?.name || "this entry";
    if (!window.confirm(`Delete "${label}"?`)) return;

    const remaining = (project.sequences ?? []).filter((s) => s.id !== idToDelete);
    onUpdate(remaining);

    if (editingId === idToDelete) {
      setEditingId(null);
      onSelectEntryId?.(null);
      setName("");
      setNotes("");
      setBeatSelect("No label");
      setCustomBeat("");
      setStatusMessage("Entry deleted");
    }
  };

  // Validation before saving
  const isPassageValid =
    mode === "passage" &&
    draftIn !== undefined &&
    draftOut !== undefined &&
    draftOut > draftIn &&
    !inError &&
    !outError;

  const isMomentValid =
    mode === "moment" &&
    !atError &&
    momentTime >= 0 &&
    momentTime <= project.duration;

  const canSave =
    (mode === "moment" ? isMomentValid : isPassageValid) &&
    (beatSelect !== "Custom…" || customBeat.trim().length > 0);

  const handleSave = () => {
    const defaultName =
      mode === "moment"
        ? `Moment ${(project.sequences?.filter((s) => (s.kind ?? "passage") === "moment").length ?? 0) + 1}`
        : `Passage ${(project.sequences?.filter((s) => (s.kind ?? "passage") === "passage").length ?? 0) + 1}`;
    const trimmedName = name.trim() || defaultName;

    let finalBeat: string | undefined;
    if (beatSelect === "Custom…") {
      const trimmedCustom = customBeat.trim();
      if (!trimmedCustom) {
        setStatusMessage("Enter a custom beat label.");
        customInputRef.current?.focus();
        return;
      }
      finalBeat = trimmedCustom;
      // Reusable in project: persist to project customStoryBeats
      const existingCustom = project.customStoryBeats || [];
      if (!existingCustom.includes(trimmedCustom)) {
        onUpdateProject?.({ customStoryBeats: [...existingCustom, trimmedCustom] });
      }
    } else if (beatSelect !== "No label") {
      finalBeat = beatSelect;
    }

    let startSeconds: number;
    let endSeconds: number;

    if (mode === "moment") {
      if (!isMomentValid) {
        setStatusMessage("Valid timestamp required for moment.");
        return;
      }
      startSeconds = momentTime;
      endSeconds = momentTime;
    } else {
      if (!isPassageValid) {
        if (draftIn === undefined || draftOut === undefined) {
          setStatusMessage("Set both In and Out points for this passage.");
        } else if (draftOut <= draftIn) {
          setStatusMessage("Out point must be after In point.");
        } else {
          setStatusMessage("Fix invalid In / Out boundaries.");
        }
        return;
      }
      startSeconds = draftIn;
      endSeconds = draftOut;
    }

    const trimmedNotes = notes.trim();
    const currentSequences = project.sequences ?? [];

    if (editingId) {
      const updated = currentSequences.map((s) =>
        s.id === editingId
          ? {
              ...s,
              name: trimmedName,
              startSeconds,
              endSeconds,
              kind: mode,
              ...(finalBeat ? { beat: finalBeat } : { beat: undefined }),
              ...(trimmedNotes ? { notes: trimmedNotes } : { notes: undefined }),
            }
          : s,
      );
      onUpdate(updated);
      setStatusMessage("Changes saved");
    } else {
      const newMarker: SequenceMarker = {
        id: `seq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: trimmedName,
        startSeconds,
        endSeconds,
        kind: mode,
        ...(finalBeat ? { beat: finalBeat } : {}),
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      };
      onUpdate([...currentSequences, newMarker]);
      setEditingId(newMarker.id);
      onSelectEntryId?.(newMarker.id);
      setStatusMessage("Entry saved to story map");
    }
  };

  const addDeckScene = () => {
    if (!range || range.start === undefined || range.end === undefined || !deckName.trim()) return;
    const marker: SequenceMarker = {
      id: crypto.randomUUID(),
      name: deckName.trim(),
      startSeconds: range.start,
      endSeconds: range.end,
      kind: "passage",
    };
    onUpdate([...(project.sequences || []), marker]);
    setDeckName("");
  };

  // Calculated duration for passage display
  const passageDurationText = useMemo(() => {
    if (draftIn !== undefined && draftOut !== undefined && draftOut > draftIn) {
      const dur = draftOut - draftIn;
      return `${dur.toFixed(2)}s (${formatTimecode(dur, project.frameRate, project.dropFrame)})`;
    }
    return "--";
  }, [draftIn, draftOut, project.frameRate, project.dropFrame]);

  // Drawer variant rendering
  if (variant === "drawer") {
    return (
      <section
        className="sequence-drawer"
        role="region"
        aria-label="Story structure and sequence reading"
      >
        {/* 1. Compact Header */}
        <div className="sr-head">
          <div className="sr-head-top">
            <h2 className="sr-title sequence-drawer-title">Sequence reading</h2>

            <div className="sr-header-controls">
              {/* Structure Vocabulary Selector */}
              <div className="sr-vocab-wrap">
                <select
                  id="sr-vocab"
                  className="sr-vocab-select-compact"
                  value={vocabId}
                  onChange={(e) => handleVocabChange(e.target.value as StructureVocabularyId)}
                  title="Select narrative framework vocabulary"
                  aria-label="Structure vocabulary"
                >
                  {STRUCTURE_VOCABULARIES.map((v) => {
                    const shortName =
                      v.id === "short-form" || v.id === "shortform"
                        ? "Short-form essentials"
                        : v.id === "syd-field"
                        ? "Syd Field"
                        : v.id === "save-the-cat"
                        ? "Save the Cat!"
                        : v.id === "vogler"
                        ? "Hero’s Journey"
                        : v.id === "freeform"
                        ? "Freeform / Custom"
                        : v.label.split(" · ")[0];
                    return (
                      <option key={v.id} value={v.id}>
                        {shortName}
                      </option>
                    );
                  })}
                </select>
                <span className="sr-select-arrow" aria-hidden="true">▾</span>
              </div>

              <span className="sr-header-sep" aria-hidden="true" />

              {/* Custom labels manager toggle */}
              <button
                type="button"
                className={`sr-header-text-btn sr-manage-labels-toggle ${showManageLabels ? "active" : ""}`}
                onClick={() => {
                  setShowManageLabels(!showManageLabels);
                  if (showVocabInfo) setShowVocabInfo(false);
                }}
                aria-expanded={showManageLabels}
                title="Manage reusable custom story labels"
              >
                Custom labels
              </button>

              {/* Vocabulary Info button */}
              <div className="sr-info-wrap">
                <button
                  type="button"
                  className={`sr-header-icon-btn sr-vocab-info-btn ${showVocabInfo ? "active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowVocabInfo(!showVocabInfo);
                    if (showManageLabels) setShowManageLabels(false);
                  }}
                  title={activeVocab.description ? `${activeVocab.name}: ${activeVocab.description}` : "Vocabulary description"}
                  aria-label="Vocabulary description"
                  aria-expanded={showVocabInfo}
                >
                  ⓘ
                </button>
                {showVocabInfo && (
                  <div className="sr-vocab-popover" role="region" aria-label="Vocabulary description">
                    <div className="sr-popover-head">
                      <strong className="sr-popover-title">{activeVocab.name}</strong>
                      <button
                        type="button"
                        className="sr-popover-close"
                        onClick={() => setShowVocabInfo(false)}
                        aria-label="Close vocabulary info"
                      >
                        ✕
                      </button>
                    </div>
                    {activeVocab.description && (
                      <div className="sr-vocab-desc">{activeVocab.description}</div>
                    )}
                    {activeVocab.beats.length > 0 && (
                      <div className="sr-vocab-beats-preview">
                        {activeVocab.beats.map((b) => (
                          <span key={b} className="sr-vocab-beat-chip">
                            {b}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {onClose && (
                <>
                  <span className="sr-header-sep" aria-hidden="true" />
                  <button
                    type="button"
                    className="studio-drawer-close-btn sequence-drawer-close-btn sr-header-close"
                    onClick={onClose}
                    title="Close sequence reading drawer (Esc)"
                    aria-label="Close sequence reading drawer"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="sr-muted sequence-drawer-subtitle">
            Your interpretation, anchored in time.
          </div>

          {/* Compact Secondary Custom Labels Manager */}
          {showManageLabels && (
            <div className="sr-custom-manager" role="region" aria-label="Custom story labels manager">
              <div className="sr-manager-head">
                <div className="sr-manager-title">Reusable Project Labels</div>
                <button
                  type="button"
                  className="sr-popover-close"
                  onClick={() => setShowManageLabels(false)}
                  aria-label="Close label manager"
                >
                  ✕
                </button>
              </div>
              {(project.customStoryBeats || []).length === 0 ? (
                <div className="sr-manager-empty">No reusable custom labels created yet.</div>
              ) : (
                <div className="sr-manager-list">
                  {(project.customStoryBeats || []).map((label, idx) => (
                    <div key={`custom-beat-${idx}`} className="sr-manager-item">
                      {editingLabelIdx === idx ? (
                        <div className="sr-manager-edit-row">
                          <input
                            className="sr-manager-input"
                            value={editingLabelText}
                            onChange={(e) => setEditingLabelText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRenameCustomLabel(idx);
                              else if (e.key === "Escape") setEditingLabelIdx(null);
                            }}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="sr-manager-btn"
                            onClick={() => handleSaveRenameCustomLabel(idx)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="sr-manager-btn"
                            onClick={() => setEditingLabelIdx(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="sr-manager-label-name">{label}</span>
                          <div className="sr-manager-actions">
                            <button
                              type="button"
                              className="sr-manager-icon-btn"
                              disabled={idx === 0}
                              onClick={() => handleMoveCustomLabel(idx, -1)}
                              title="Move up"
                              aria-label={`Move ${label} up`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="sr-manager-icon-btn"
                              disabled={idx === (project.customStoryBeats?.length ?? 0) - 1}
                              onClick={() => handleMoveCustomLabel(idx, 1)}
                              title="Move down"
                              aria-label={`Move ${label} down`}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="sr-manager-icon-btn"
                              onClick={() => {
                                setEditingLabelIdx(idx);
                                setEditingLabelText(label);
                              }}
                              title="Rename label"
                              aria-label={`Rename ${label}`}
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className="sr-manager-icon-btn delete"
                              onClick={() => handleRemoveCustomLabel(label)}
                              title="Remove label from suggestions"
                              aria-label={`Remove ${label}`}
                            >
                              ✕
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="sr-manager-add-row">
                <input
                  className="sr-manager-add-input"
                  placeholder="Add reusable custom beat…"
                  value={newLabelInput}
                  onChange={(e) => setNewLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustomLabel();
                    }
                  }}
                />
                <button
                  type="button"
                  className="sr-manager-add-btn"
                  onClick={handleAddCustomLabel}
                  disabled={!newLabelInput.trim()}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="sr-content">
          {/* 2. Mode Selector and Time Anchors Bar */}
          <div className="sr-anchor-bar">
            <div className="sr-mode-toggle" role="group" aria-label="Annotation duration mode">
              <button
                type="button"
                data-mode="moment"
                aria-pressed={mode === "moment"}
                className={`sr-mode-btn ${mode === "moment" ? "active" : ""}`}
                onClick={() => handleModeChange("moment")}
              >
                <span className="sr-mode-icon moment" aria-hidden="true">◇</span>
                <span>Moment</span>
              </button>
              <span className="sr-bar-sep" aria-hidden="true" />
              <button
                type="button"
                data-mode="passage"
                aria-pressed={mode === "passage"}
                className={`sr-mode-btn ${mode === "passage" ? "active" : ""}`}
                onClick={() => handleModeChange("passage")}
              >
                <span className="sr-mode-icon passage" aria-hidden="true">━</span>
                <span>Passage</span>
              </button>
            </div>

            <span className="sr-bar-sep" aria-hidden="true" />

            {/* Time Anchor Controls beside Mode Selector */}
            {mode === "moment" ? (
              <div className="sr-anchor-controls moment">
                <div className="sr-anchor-group">
                  <label htmlFor="sr-at-tc" className="sr-field-tag">AT</label>
                  <input
                    id="sr-at-tc"
                    className={`sr-tc-input mono ${atError ? "error" : ""}`}
                    value={atText}
                    onChange={handleAtTextChange}
                    placeholder="00:00:00:00"
                    aria-label="Moment timecode"
                  />
                </div>
                <button
                  type="button"
                  className="sr-anchor-link-btn"
                  onClick={handleSetAtPlayhead}
                  title="Anchor moment to current playhead frame"
                >
                  Set at playhead
                </button>
                {atError && <div className="sr-inline-error">{atError}</div>}
              </div>
            ) : (
              <div className="sr-anchor-controls passage">
                <div className="sr-anchor-group">
                  <label htmlFor="sr-in-tc" className="sr-field-tag">IN</label>
                  <input
                    id="sr-in-tc"
                    className={`sr-tc-input mono ${inError ? "error" : ""}`}
                    value={inText}
                    onChange={handleInTextChange}
                    placeholder="--:--:--:--"
                    aria-label="Passage In timecode"
                  />
                  <button
                    type="button"
                    className="sr-anchor-link-btn"
                    onClick={handleSetInAtPlayhead}
                    title="Set In point at current playhead (I)"
                  >
                    Set In
                  </button>
                </div>

                <div className="sr-anchor-group">
                  <label htmlFor="sr-out-tc" className="sr-field-tag">OUT</label>
                  <input
                    id="sr-out-tc"
                    className={`sr-tc-input mono ${outError ? "error" : ""}`}
                    value={outText}
                    onChange={handleOutTextChange}
                    placeholder="--:--:--:--"
                    aria-label="Passage Out timecode"
                  />
                  <button
                    type="button"
                    className="sr-anchor-link-btn"
                    onClick={handleSetOutAtPlayhead}
                    title="Set Out point at current playhead (O)"
                  >
                    Set Out
                  </button>
                </div>

                <div className="sr-passage-meta">
                  <span className="sr-dur-val mono">{passageDurationText}</span>
                  <button
                    type="button"
                    className="sr-clear-io-btn"
                    onClick={handleClearInOut}
                    title="Clear In / Out marks"
                  >
                    Clear In / Out
                  </button>
                </div>

                {(inError || outError) && (
                  <div className="sr-inline-error">{inError || outError}</div>
                )}
              </div>
            )}
          </div>

          {/* 3. Story Input Form: Name & Optional Story Beat */}
          <div className="sr-fields">
            <div className="sr-field-col name-col">
              <label htmlFor="sr-name" className="sr-field-label">Name</label>
              <input
                id="sr-name"
                ref={nameInputRef}
                className="sr-underline-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  mode === "moment"
                    ? "Give this moment a name"
                    : "Give this passage a name"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSave();
                  }
                }}
              />
            </div>
            <div className="sr-field-col beat-col">
              <label htmlFor="sr-type" className="sr-field-label">Story beat · optional</label>
              <div className="sr-underline-select-wrap">
                <select
                  id="sr-type"
                  className="sr-underline-select"
                  value={beatSelect}
                  onChange={(e) => setBeatSelect(e.target.value)}
                >
                  {selectableBeats.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <span className="sr-select-arrow" aria-hidden="true">▾</span>
              </div>
            </div>
          </div>

          {beatSelect === "Custom…" && (
            <div id="sr-custom-wrap" className="sr-custom-wrap">
              <label htmlFor="sr-custom" className="sr-field-label">Custom beat label</label>
              <input
                id="sr-custom"
                ref={customInputRef}
                className="sr-underline-input"
                value={customBeat}
                onChange={(e) => setCustomBeat(e.target.value)}
                placeholder="e.g. A quiet reversal"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSave();
                  }
                }}
              />
            </div>
          )}

          {/* Notes and Save Button Row */}
          <div className="sr-notes-section">
            <label htmlFor="sr-note" className="sr-field-label">What changes here?</label>
            <div className="sr-notes-input-row">
              <div className="sr-notes-wrap">
                <textarea
                  id="sr-note"
                  className="sr-underline-textarea"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="A decision, a reversal, a shift in what we know…"
                  rows={1}
                />
              </div>
              <button
                type="button"
                className="sr-save-btn"
                id="sr-save"
                disabled={!canSave}
                onClick={handleSave}
              >
                {editingId
                  ? "Save changes"
                  : mode === "moment"
                    ? "Save moment"
                    : "Save passage"}
              </button>
            </div>
          </div>

          {/* Feedback & Editing Action Bar */}
          {(statusMessage !== "Your interpretation" || editingId) && (
            <div className="sr-status-row">
              <span className="sr-status" role="status" id="sr-status">
                {statusMessage}
              </span>
              {editingId && (
                <div className="sr-editing-actions">
                  <button
                    type="button"
                    className="sr-cancel-btn"
                    onClick={handleNewEntry}
                    title="Start a new entry"
                  >
                    + New entry
                  </button>
                  <button
                    type="button"
                    className="sr-delete-btn"
                    onClick={() => handleDelete(editingId)}
                    title="Delete this saved story entry"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 4. Rhythm Evidence Disclosure (strictly for Passages) */}
          {mode === "passage" && (
            <details id="sr-details" className="sr-details">
              <summary>
                <span>Rhythm evidence</span>
                <span className="sr-summary-right">{evidenceSummaryText}</span>
              </summary>
              <div className="sr-evidence">
                {evidenceReading && evidenceRange ? (
                  <>
                    <div className="sr-evidence-range">
                      <strong>
                        {formatTimecode(
                          evidenceRange.start,
                          project.frameRate,
                          project.dropFrame,
                        )}{" "}
                        →{" "}
                        {formatTimecode(
                          evidenceRange.end,
                          project.frameRate,
                          project.dropFrame,
                        )}
                      </strong>
                    </div>
                    <div>
                      <strong>{evidenceReading.shots.length}</strong> shots &nbsp; · &nbsp;{" "}
                      <strong>{evidenceReading.cuts}</strong> hard cuts &nbsp; · &nbsp;{" "}
                      <strong>{evidenceReading.median.toFixed(1)}s</strong> median &nbsp; · &nbsp;{" "}
                      <strong>{evidenceReading.variation.toFixed(1)}s</strong> duration variation
                    </div>
                    <div>
                      Across cuts &nbsp; {evidenceReading.framingChanges.tighter} tighter ·{" "}
                      {evidenceReading.framingChanges.wider} wider ·{" "}
                      {evidenceReading.framingChanges.unchanged} unchanged
                      {evidenceReading.framingChanges.unknown
                        ? ` · ${evidenceReading.framingChanges.unknown} unclassified`
                        : ""}
                    </div>
                    <div>
                      Rhythm &nbsp;{" "}
                      {evidenceReading.acceleratingRuns
                        ? `${evidenceReading.acceleratingRuns} run${
                            evidenceReading.acceleratingRuns === 1 ? "" : "s"
                          } of three shortening shots`
                        : "No three-shot shortening run"}
                    </div>
                  </>
                ) : (
                  <div className="sr-evidence-empty">
                    Mark In and Out points above or Shift-drag on the timeline to inspect passage rhythm.
                  </div>
                )}
              </div>
            </details>
          )}

          {/* 5. Your Story Map */}
          <div className="sr-saved">
            <div className="sr-saved-header">
              <div className="sr-saved-title-group">
                <h3 className="sr-saved-title">Your story map</h3>
                <span className="sr-saved-count">
                  {sortedEntries.length} {sortedEntries.length === 1 ? "entry" : "entries"}
                </span>
              </div>
              <button
                type="button"
                className="sr-new"
                id="sr-new"
                onClick={handleNewEntry}
                title="Create a new entry"
              >
                + New entry
              </button>
            </div>

            <div id="sr-list" className="sr-list" role="list" aria-label="Story map entries">
              {sortedEntries.length === 0 ? (
                <div className="sr-empty-list-msg">
                  No story entries yet. Anchor a moment or passage above.
                </div>
              ) : (
                sortedEntries.map((e) => {
                  const isSelected = editingId === e.id;
                  const isMoment = (e.kind ?? "passage") === "moment";
                  const beatDisplay = e.beat || "No label";
                  const timeDisplay = isMoment
                    ? formatTimecode(e.startSeconds, project.frameRate, project.dropFrame)
                    : `${formatTimecode(e.startSeconds, project.frameRate, project.dropFrame)} — ${formatTimecode(e.endSeconds, project.frameRate, project.dropFrame)}`;

                  return (
                    <div
                      key={e.id}
                      className={`sr-item-row ${isSelected ? "selected" : ""}`}
                      role="listitem"
                    >
                      <button
                        type="button"
                        className="sr-item"
                        onClick={() => handleSelectEntry(e)}
                        aria-current={isSelected ? "true" : undefined}
                        title={`Edit ${e.name}`}
                      >
                        <span className="sr-mark" aria-hidden="true">
                          {isMoment ? (
                            <span className="sr-mark-moment">◇</span>
                          ) : (
                            <span className="sr-mark-passage" aria-hidden="true">
                              <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
                                <line x1="1" y1="2" x2="1" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                                <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.2" />
                                <line x1="13" y1="2" x2="13" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                              </svg>
                            </span>
                          )}
                        </span>
                        <span className="sr-item-time mono">{timeDisplay}</span>
                        <span className="sr-item-name">{e.name}</span>
                        <span className="sr-item-beat sr-item-type">{beatDisplay}</span>
                      </button>
                      <div className="sr-item-actions">
                        <button
                          type="button"
                          className="sr-item-delete-btn"
                          onClick={(evt) => {
                            evt.stopPropagation();
                            handleDelete(e.id);
                          }}
                          title={`Delete ${e.name}`}
                          aria-label={`Delete ${e.name}`}
                        >
                          ✕
                        </button>
                        <button
                          type="button"
                          className="sr-item-more-btn"
                          onClick={(evt) => {
                            evt.stopPropagation();
                            setOpenMenuId(openMenuId === e.id ? null : e.id);
                          }}
                          title="More options"
                          aria-label={`More options for ${e.name}`}
                          aria-expanded={openMenuId === e.id}
                        >
                          ···
                        </button>
                        {openMenuId === e.id && (
                          <div className="sr-item-menu" role="menu">
                            <button
                              type="button"
                              className="sr-item-menu-btn"
                              role="menuitem"
                              onClick={(evt) => {
                                evt.stopPropagation();
                                setOpenMenuId(null);
                                handleSelectEntry(e);
                              }}
                            >
                              Edit entry
                            </button>
                            <button
                              type="button"
                              className="sr-item-menu-btn"
                              role="menuitem"
                              onClick={(evt) => {
                                evt.stopPropagation();
                                setOpenMenuId(null);
                                onSeek(e.startSeconds);
                              }}
                            >
                              Seek to timecode
                            </button>
                            <button
                              type="button"
                              className="sr-item-menu-btn delete"
                              role="menuitem"
                              onClick={(evt) => {
                                evt.stopPropagation();
                                setOpenMenuId(null);
                                handleDelete(e.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="sr-footer-note">
              <em>Moments mark a frame. Passages hold a duration.</em>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Default: variant === "deck" for Map Focus / Review Desk
  const deckReading =
    range && range.start !== undefined && range.end !== undefined && range.end > range.start
      ? sequenceReading(project.shots, range.start, range.end)
      : null;

  return (
    <section className="sequence-reading panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">SEQUENCE READING</span>
          <span className="muted">Evidence first; interpretation stays yours.</span>
        </div>
        <div className="btn-row">
          {range && (
            <button
              onClick={() => {
                onRangeChange(undefined);
                onClose?.();
              }}
            >
              Clear selection
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
      {!range || !deckReading ? (
        <p className="sequence-empty">
          Shift-drag on the editing map to select a passage. Its shot, cut, framing, and rhythm
          evidence will appear here.
        </p>
      ) : (
        <>
          <div className="sequence-range">
            <button onClick={() => onSeek(range.start!)}>
              {formatTimecode(range.start!, project.frameRate, project.dropFrame)}
            </button>
            <span>to</span>
            <button onClick={() => onSeek(range.end!)}>
              {formatTimecode(range.end!, project.frameRate, project.dropFrame)}
            </button>
            <span className="muted">{deckReading.duration.toFixed(2)} sec</span>
          </div>
          <div className="sequence-stats">
            <span>
              <b>{deckReading.shots.length}</b> shots
            </span>
            <span>
              <b>{deckReading.cuts}</b> hard cuts
            </span>
            <span>
              <b>{deckReading.median.toFixed(2)}s</b> median
            </span>
            <span>
              <b>{deckReading.variation.toFixed(2)}s</b> duration variation
            </span>
          </div>
          <div className="sequence-evidence">
            <div>
              <b>Across cuts</b>
              <span>
                {deckReading.framingChanges.tighter} tighter ·{" "}
                {deckReading.framingChanges.wider} wider ·{" "}
                {deckReading.framingChanges.unchanged} unchanged
                {deckReading.framingChanges.unknown
                  ? ` · ${deckReading.framingChanges.unknown} unclassified`
                  : ""}
              </span>
            </div>
            <div>
              <b>Rhythm</b>
              <span>
                {deckReading.acceleratingRuns
                  ? `${deckReading.acceleratingRuns} run${
                      deckReading.acceleratingRuns === 1 ? "" : "s"
                    } of three shortening shots`
                  : "No three-shot shortening run"}
              </span>
            </div>
          </div>
          <div className="scene-save">
            <input
              aria-label="Sequence name"
              placeholder="Name this span (e.g. Confrontation)"
              value={deckName}
              onChange={(event) => setDeckName(event.target.value)}
            />
            <button onClick={addDeckScene}>Save span</button>
          </div>
        </>
      )}
      {!!project.sequences?.length && (
        <div className="scene-list">
          <b>Your story map</b>
          {project.sequences.map((scene) => {
            const isMoment = scene.kind === "moment";
            return (
              <div key={scene.id}>
                <button
                  onClick={() => {
                    if (isMoment) {
                      onSeek(scene.startSeconds);
                    } else {
                      onRangeChange({ start: scene.startSeconds, end: scene.endSeconds });
                    }
                  }}
                >
                  {isMoment ? "◇ " : "━ "}
                  {scene.beat ? `${scene.beat}: ` : ""}
                  {scene.name}
                </button>
                <span>
                  {isMoment
                    ? formatTimecode(scene.startSeconds, project.frameRate, project.dropFrame)
                    : `${formatTimecode(scene.startSeconds, project.frameRate, project.dropFrame)} — ${formatTimecode(scene.endSeconds, project.frameRate, project.dropFrame)}`}
                </span>
                <button
                  aria-label={`Delete ${scene.name}`}
                  onClick={() =>
                    onUpdate(project.sequences!.filter((item) => item.id !== scene.id))
                  }
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
