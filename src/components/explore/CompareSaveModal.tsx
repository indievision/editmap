import React, { useState } from "react";
import type { SavedExploreComparison } from "../../models/explore";
import type { SequenceMarker } from "../../models/project";

interface CompareSaveModalProps {
  currentPassageA?: SequenceMarker;
  currentPassageB?: SequenceMarker;
  currentNote: string;
  savedComparisons: SavedExploreComparison[];
  allPassages: SequenceMarker[];
  onSaveCurrent: (name: string, note?: string) => void;
  onOpenSaved: (comparison: SavedExploreComparison) => void;
  onDeleteSaved: (id: string) => void;
  onClose: () => void;
}

export default function CompareSaveModal({
  currentPassageA,
  currentPassageB,
  currentNote,
  savedComparisons,
  allPassages,
  onSaveCurrent,
  onOpenSaved,
  onDeleteSaved,
  onClose,
}: CompareSaveModalProps) {
  const defaultName = currentPassageA && currentPassageB
    ? `${currentPassageA.name} vs ${currentPassageB.name}`
    : "Comparison";

  const [nameInput, setNameInput] = useState(defaultName);
  const [noteInput, setNoteInput] = useState(currentNote);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setErrorMsg("Please provide a name for this comparison.");
      return;
    }
    onSaveCurrent(trimmed, noteInput.trim() || undefined);
    onClose();
  };

  const getPassageName = (id: string) => {
    const found = allPassages.find((p) => p.id === id);
    return found ? found.name : "(deleted passage)";
  };

  return (
    <div
      className="explore-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-modal-title"
    >
      <div
        className="explore-modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="explore-modal-header">
          <h3 id="compare-modal-title" className="explore-modal-title">
            Save & Manage Comparisons
          </h3>
          <button
            type="button"
            className="explore-modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* SAVE CURRENT FORM */}
        <form onSubmit={handleSave} className="explore-save-form">
          <div className="explore-form-group">
            <label htmlFor="compare-name-input" className="explore-form-label">
              Comparison Name
            </label>
            <input
              id="compare-name-input"
              type="text"
              className="explore-text-input"
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                setErrorMsg("");
              }}
              placeholder="e.g. Opening vs Climax pacing"
              autoFocus
            />
          </div>

          <div className="explore-form-group">
            <label htmlFor="compare-note-input" className="explore-form-label">
              Interpretation Note (optional)
            </label>
            <textarea
              id="compare-note-input"
              className="explore-textarea-input"
              rows={2}
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Observations on rhythm, cuts, and character focus between these passages..."
            />
          </div>

          {errorMsg && <div className="explore-form-error">{errorMsg}</div>}

          <div className="explore-form-actions">
            <button
              type="button"
              className="explore-btn-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="explore-btn-primary"
              disabled={!currentPassageA || !currentPassageB}
            >
              Save comparison
            </button>
          </div>
        </form>

        {/* LIST OF SAVED COMPARISONS */}
        <div className="explore-saved-list-section">
          <h4 className="explore-saved-list-title">
            Saved comparisons ({savedComparisons.length})
          </h4>

          {savedComparisons.length === 0 ? (
            <p className="explore-no-saved">No saved comparisons yet.</p>
          ) : (
            <div className="explore-saved-items-container">
              {savedComparisons.map((item) => {
                const nameA = getPassageName(item.passageAId);
                const nameB = getPassageName(item.passageBId);
                const hasMissingPassage =
                  nameA === "(deleted passage)" || nameB === "(deleted passage)";

                return (
                  <div key={item.id} className="explore-saved-item">
                    <div className="explore-saved-info">
                      <span className="explore-saved-name">{item.name}</span>
                      <span className="explore-saved-meta">
                        {nameA} × {nameB}
                        {hasMissingPassage && (
                          <span className="explore-saved-warning"> (Missing passage)</span>
                        )}
                      </span>
                      {item.note && (
                        <p className="explore-saved-note-preview">"{item.note}"</p>
                      )}
                    </div>
                    <div className="explore-saved-actions">
                      <button
                        type="button"
                        className="explore-open-saved-btn"
                        onClick={() => {
                          onOpenSaved(item);
                          onClose();
                        }}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="explore-delete-saved-btn"
                        onClick={() => onDeleteSaved(item.id)}
                        aria-label={`Delete saved comparison "${item.name}"`}
                        title="Delete comparison"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
