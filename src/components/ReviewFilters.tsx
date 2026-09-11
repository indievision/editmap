import type { Project } from "../models/project";
import {
  reviewFilters,
  reviewFilterCounts,
  type ReviewFilter,
} from "../analysis/review";

const labels: Record<ReviewFilter, string> = {
  all: "All",
  unreviewed: "Unreviewed",
  uncertain: "Uncertain",
  failed: "Failed",
};

export default function ReviewFilters({
  project,
  filter,
  matchIds,
  onFilter,
  onPrevious,
  onNext,
}: {
  project: Project;
  filter: ReviewFilter;
  matchIds: string[];
  onFilter: (filter: ReviewFilter) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const counts = reviewFilterCounts(project);
  return (
    <section className="review-filters panel" aria-label="Shot review filters">
      <div className="review-filter-label">
        <span className="eyebrow">REVIEW</span>
        <span className="muted">{filter === "all" ? "All shots shown" : `${matchIds.length} matching shot${matchIds.length === 1 ? "" : "s"}`}</span>
      </div>
      <div className="review-filter-buttons" role="group" aria-label="Filter shots by review state">
        {reviewFilters.map((item) => (
          <button key={item} aria-pressed={filter === item} className={filter === item ? "active" : ""} onClick={() => onFilter(item)}>
            {labels[item]} <span>{counts[item]}</span>
          </button>
        ))}
      </div>
      {filter !== "all" && (
        <div className="review-navigation">
          <button disabled={!matchIds.length} onClick={onPrevious} aria-label="Previous matching shot">Previous</button>
          <span className="muted" aria-live="polite">{matchIds.length ? `${matchIds.length} matches · wraps` : "No matching shots"}</span>
          <button disabled={!matchIds.length} onClick={onNext} aria-label="Next matching shot">Next</button>
          {!matchIds.length && <button onClick={() => onFilter("all")}>Show all</button>}
        </div>
      )}
    </section>
  );
}
