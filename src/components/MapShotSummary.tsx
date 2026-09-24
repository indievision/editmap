import type { Project, Shot } from "../models/project";

export default function MapShotSummary({
  shot,
  project,
  thumbnail,
  onOpenInspector,
  onPrevious,
  onNext,
}: {
  shot: Shot | undefined;
  project: Project;
  thumbnail?: string;
  onOpenInspector: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (!shot) {
    return (
      <div className="map-shot-summary-panel panel">
        <div className="section-head summary-head">
          <span className="eyebrow">SELECTED SHOT</span>
        </div>
        <div className="summary-empty">
          <p className="muted">Click any shot on the editing map below to view details.</p>
        </div>
      </div>
    );
  }

  const shotIndex = project.shots.indexOf(shot) + 1;
  const isConfirmed = shot.reviewStatus === "Confirmed";

  // Find sequence if any
  const sequence = project.sequences?.find(
    (seq) => (seq.kind ?? "passage") === "passage" && shot.startSeconds >= seq.startSeconds && shot.endSeconds <= seq.endSeconds
  );

  // Cast in shot
  const castNames = (shot.characterAnalysis?.manualMemberIds || [])
    .map((id) => project.cast?.find((c) => c.id === id)?.name)
    .filter(Boolean)
    .join(", ");

  return (
    <div className="map-shot-summary-panel panel">
      <div className="section-head summary-head">
        <div className="summary-title">
          <span className="eyebrow">SHOT {String(shot.index).padStart(3, "0")}</span>
          <span className="summary-count mono">
            {shotIndex} / {project.shots.length}
          </span>
        </div>
        <div className="nav-arrows-group">
          <button
            type="button"
            className="btn-icon-sm"
            onClick={onPrevious}
            disabled={shotIndex <= 1}
            title="Previous shot"
            aria-label="Previous shot"
          >
            ‹
          </button>
          <button
            type="button"
            className="btn-icon-sm"
            onClick={onNext}
            disabled={shotIndex >= project.shots.length}
            title="Next shot"
            aria-label="Next shot"
          >
            ›
          </button>
        </div>
      </div>

      <div className="summary-body">
        {thumbnail && (
          <div className="summary-thumb-wrap">
            <img src={thumbnail} alt={`Shot ${shot.index}`} className="summary-thumb" />
          </div>
        )}

        <div className="summary-details-list">
          <div className="summary-prop-row">
            <span className="summary-prop-label">Timecode:</span>
            <span className="summary-prop-val mono">
              {shot.startTimecode} → {shot.endTimecode}
            </span>
          </div>
          <div className="summary-prop-row">
            <span className="summary-prop-label">Duration:</span>
            <span className="summary-prop-val mono">
              {shot.duration.toFixed(2)}s ({Math.round(shot.duration * project.frameRate)} frames)
            </span>
          </div>
          {sequence && (
            <div className="summary-prop-row">
              <span className="summary-prop-label">Sequence:</span>
              <span className="summary-prop-val">{sequence.name}</span>
            </div>
          )}
          <div className="summary-prop-row">
            <span className="summary-prop-label">Shot size:</span>
            <b className="summary-prop-val highlighted">{shot.shotSize || "Unknown"}</b>
          </div>
          {shot.content && (
            <div className="summary-prop-row">
              <span className="summary-prop-label">Subject:</span>
              <span className="summary-prop-val">{shot.content}</span>
            </div>
          )}
          {castNames && (
            <div className="summary-prop-row">
              <span className="summary-prop-label">Cast:</span>
              <span className="summary-prop-val">{castNames}</span>
            </div>
          )}
          <div className="summary-prop-row">
            <span className="summary-prop-label">Status:</span>
            <span
              className={`queue-status-chip ${
                isConfirmed ? "status-confirmed" : "status-needs-review"
              }`}
            >
              {isConfirmed ? "Confirmed" : "Needs review"}
            </span>
          </div>
        </div>
      </div>

      <div className="summary-footer">
        <button
          type="button"
          className="btn-open-inspector"
          onClick={onOpenInspector}
        >
          <span>Open Full Inspector</span>
          <span>›</span>
        </button>
      </div>
    </div>
  );
}
