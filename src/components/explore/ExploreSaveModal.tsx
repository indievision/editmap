import { useState } from "react";
import type { SavedExploreSequence } from "../../models/explore";

interface ExploreSaveModalProps {
  currentSequenceName: string;
  savedSequences: SavedExploreSequence[];
  onSaveCurrent: (name: string) => void;
  onOpenSaved: (savedSeq: SavedExploreSequence) => void;
  onDeleteSaved: (id: string) => void;
  onClose: () => void;
}

export default function ExploreSaveModal({
  currentSequenceName,
  savedSequences,
  onSaveCurrent,
  onOpenSaved,
  onDeleteSaved,
  onClose,
}: ExploreSaveModalProps) {
  const [name, setName] = useState(currentSequenceName || "Viewing sequence");
  const [viewTab, setViewTab] = useState<"save" | "manage">(
    savedSequences.length > 0 ? "save" : "save",
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSaveCurrent(name.trim());
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="save-modal-title">
      <div className="modal-card explore-save-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="save-modal-title" className="modal-title">
            Explore viewing sequences
          </h3>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={viewTab === "save"}
            className={`tab-btn ${viewTab === "save" ? "active" : ""}`}
            onClick={() => setViewTab("save")}
          >
            Save current
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewTab === "manage"}
            className={`tab-btn ${viewTab === "manage" ? "active" : ""}`}
            onClick={() => setViewTab("manage")}
          >
            Saved sequences ({savedSequences.length})
          </button>
        </div>

        {viewTab === "save" ? (
          <form onSubmit={handleSubmit} className="save-form">
            <div className="form-field">
              <label htmlFor="seq-name-input" className="field-label">
                Sequence name
              </label>
              <input
                id="seq-name-input"
                type="text"
                className="text-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Anna alone · Darkest first"
                autoFocus
              />
              <small className="field-hint">
                Saves the ordered shot references and builder settings within this project.
              </small>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
                Save sequence
              </button>
            </div>
          </form>
        ) : (
          <div className="manage-sequences-list">
            {savedSequences.length === 0 ? (
              <p className="empty-list-notice">No saved sequences yet.</p>
            ) : (
              <div className="saved-items-stack">
                {savedSequences.map((seq) => (
                  <div key={seq.id} className="saved-sequence-card">
                    <div className="seq-meta">
                      <span className="seq-card-name">{seq.name}</span>
                      <small className="seq-card-details mono">
                        {seq.shotIds.length} shots · {seq.arrange.measure} (
                        {seq.arrange.direction}) · {new Date(seq.createdAt).toLocaleDateString()}
                      </small>
                    </div>

                    <div className="seq-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          onOpenSaved(seq);
                          onClose();
                        }}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => onDeleteSaved(seq.id)}
                        title="Delete saved sequence"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
