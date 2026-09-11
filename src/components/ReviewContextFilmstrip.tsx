import type { Project, Shot } from "../models/project";

export default function ReviewContextFilmstrip({
  project,
  currentShot,
  thumbnails,
  onSelectShot,
}: {
  project: Project;
  currentShot: Shot | undefined;
  thumbnails: Record<string, string>;
  onSelectShot: (shot: Shot) => void;
}) {
  if (!currentShot) return null;

  const currentIndex = project.shots.indexOf(currentShot);
  const prevShot = currentIndex > 0 ? project.shots[currentIndex - 1] : null;
  const nextShot =
    currentIndex >= 0 && currentIndex < project.shots.length - 1
      ? project.shots[currentIndex + 1]
      : null;

  return (
    <div className="review-filmstrip-container" aria-label="3-Shot Context Filmstrip">
      {/* Previous Shot */}
      {prevShot ? (
        <button
          type="button"
          className="filmstrip-card prev-card"
          onClick={() => onSelectShot(prevShot)}
          title={`Previous: Shot ${prevShot.index} (${prevShot.shotSize || "Unknown"})`}
        >
          <div className="filmstrip-thumb-wrap">
            {thumbnails[prevShot.id] ? (
              <img src={thumbnails[prevShot.id]} alt="" className="filmstrip-thumb" />
            ) : (
              <div className="filmstrip-placeholder" />
            )}
            <span className="filmstrip-label-prev">‹ PREV</span>
          </div>
          <div className="filmstrip-info">
            <span className="filmstrip-num">Shot {String(prevShot.index).padStart(3, "0")}</span>
            <span className="filmstrip-dur mono">{prevShot.duration.toFixed(1)}s</span>
            <span className="filmstrip-size">{prevShot.shotSize || "—"}</span>
          </div>
        </button>
      ) : (
        <div className="filmstrip-card empty-card">
          <span className="muted">Film Start</span>
        </div>
      )}

      {/* Current Shot */}
      <div className="filmstrip-card current-card active" aria-current="true">
        <div className="filmstrip-thumb-wrap">
          {thumbnails[currentShot.id] ? (
            <img src={thumbnails[currentShot.id]} alt="" className="filmstrip-thumb" />
          ) : (
            <div className="filmstrip-placeholder" />
          )}
          <span className="filmstrip-label-curr">CURRENT</span>
        </div>
        <div className="filmstrip-info">
          <b className="filmstrip-num">Shot {String(currentShot.index).padStart(3, "0")}</b>
          <span className="filmstrip-dur mono">{currentShot.duration.toFixed(2)}s</span>
          <span className="filmstrip-size highlighted">{currentShot.shotSize || "—"}</span>
        </div>
      </div>

      {/* Next Shot */}
      {nextShot ? (
        <button
          type="button"
          className="filmstrip-card next-card"
          onClick={() => onSelectShot(nextShot)}
          title={`Next: Shot ${nextShot.index} (${nextShot.shotSize || "Unknown"})`}
        >
          <div className="filmstrip-thumb-wrap">
            {thumbnails[nextShot.id] ? (
              <img src={thumbnails[nextShot.id]} alt="" className="filmstrip-thumb" />
            ) : (
              <div className="filmstrip-placeholder" />
            )}
            <span className="filmstrip-label-next">NEXT ›</span>
          </div>
          <div className="filmstrip-info">
            <span className="filmstrip-num">Shot {String(nextShot.index).padStart(3, "0")}</span>
            <span className="filmstrip-dur mono">{nextShot.duration.toFixed(1)}s</span>
            <span className="filmstrip-size">{nextShot.shotSize || "—"}</span>
          </div>
        </button>
      ) : (
        <div className="filmstrip-card empty-card">
          <span className="muted">Film End</span>
        </div>
      )}
    </div>
  );
}
