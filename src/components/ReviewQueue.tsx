import { useState, useMemo } from "react";
import type { Project, Shot } from "../models/project";
import {
  reviewFilters,
  reviewFilterCounts,
  matchesReviewFilter,
  reviewReasons,
  reviewReasonLabel,
  type ReviewFilter,
} from "../analysis/review";

const filterDisplayNames: Record<ReviewFilter, string> = {
  all: "All shots",
  unreviewed: "Unreviewed",
  uncertain: "Uncertain",
  failed: "Failed",
};

export default function ReviewQueue({
  project,
  selectedShotId,
  thumbnails,
  activeFilter,
  onFilterChange,
  onSelectShot,
  searchQuery,
  onSearchChange,
  autoAdvance = true,
  onAutoAdvanceChange,
}: {
  project: Project;
  selectedShotId?: string;
  thumbnails: Record<string, string>;
  activeFilter: ReviewFilter;
  onFilterChange: (filter: ReviewFilter) => void;
  onSelectShot: (shot: Shot) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  autoAdvance?: boolean;
  onAutoAdvanceChange?: (auto: boolean) => void;
}) {
  const counts = useMemo(() => reviewFilterCounts(project), [project]);

  // Compute queued shots according to active filter and search query
  const queuedShots = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return project.shots.filter((shot) => {
      // Filter matching
      if (!matchesReviewFilter(shot, activeFilter)) {
        return false;
      }
      // Query matching
      if (!query) return true;
      const indexStr = String(shot.index);
      const subjectStr = (shot.content || "").toLowerCase();
      const notesStr = (shot.notes || "").toLowerCase();
      const reasonsStr = reviewReasonLabel(reviewReasons(shot)).toLowerCase();
      return (
        indexStr.includes(query) ||
        subjectStr.includes(query) ||
        notesStr.includes(query) ||
        reasonsStr.includes(query)
      );
    });
  }, [project.shots, activeFilter, searchQuery]);

  return (
    <div className="review-queue-panel panel">
      {/* Header with count and filter selector */}
      <div className="section-head queue-head">
        <div className="queue-title">
          <span className="eyebrow">REVIEW QUEUE</span>
          <span className="queue-count-badge mono">
            {queuedShots.length} / {project.shots.length}
          </span>
        </div>
        <select
          className="queue-filter-select"
          value={activeFilter}
          onChange={(e) => onFilterChange(e.target.value as ReviewFilter)}
          aria-label="Filter review queue"
        >
          {reviewFilters.map((f) => (
            <option key={f} value={f}>
              {filterDisplayNames[f]} ({counts[f]})
            </option>
          ))}
        </select>
      </div>

      {/* Quick filter buttons */}
      <div className="queue-filter-pills" role="group" aria-label="Filter shots by review state">
        {reviewFilters.map((f) => (
          <button
            key={f}
            type="button"
            className={`queue-filter-pill ${activeFilter === f ? "active" : ""}`}
            onClick={() => onFilterChange(f)}
          >
            {filterDisplayNames[f]} <span>{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Search Input */}
      <div className="queue-search-bar">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          placeholder="Search shots, subjects, notes..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search review queue"
        />
        {searchQuery && (
          <button
            type="button"
            className="clear-search-btn"
            onClick={() => onSearchChange("")}
            title="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {onAutoAdvanceChange && (
        <div className="queue-advance-toggle">
          <label>
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => onAutoAdvanceChange(e.target.checked)}
            />
            <span>Advance after confirmation</span>
          </label>
        </div>
      )}

      {/* Shots List */}
      <div className="queue-list" role="listbox" aria-label="Review queue shots">
        {queuedShots.length === 0 ? (
          <div className="queue-empty-state">
            <span className="queue-empty-icon">✓</span>
            <b>Queue is empty</b>
            <p>
              {searchQuery
                ? "No shots match your search."
                : `No shots found matching '${filterDisplayNames[activeFilter]}'.`}
            </p>
            {activeFilter !== "all" && (
              <button
                type="button"
                className="btn-link"
                onClick={() => onFilterChange("all")}
              >
                View all shots
              </button>
            )}
          </div>
        ) : (
          queuedShots.map((shot) => {
            const isSelected = shot.id === selectedShotId;
            const reasons = reviewReasons(shot);
            const thumb = thumbnails[shot.id];
            const isConfirmed = shot.reviewStatus === "Confirmed";
            const isUncertain = shot.uncertain === true;
            const hasFailure = Boolean(
              shot.analysisFailures?.framing || shot.characterAnalysis?.failedTimes?.length
            );

            // Determine status label & badge
            const statusLabel = isConfirmed
              ? "Confirmed"
              : isUncertain
              ? "Uncertain"
              : hasFailure
              ? "Failed"
              : shot.suggestion
              ? "Needs review"
              : "Unreviewed";

            const primaryReason =
              reasons.length > 0
                ? reviewReasonLabel(reasons)
                : shot.content
                ? shot.content
                : "No flags";

            return (
              <button
                key={shot.id}
                role="option"
                aria-selected={isSelected}
                className={`queue-item-card ${isSelected ? "selected" : ""}`}
                onClick={() => onSelectShot(shot)}
              >
                <div className="queue-thumb-wrap">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={`Shot ${shot.index} thumbnail (${shot.shotSize || "Unknown"})`}
                      className="queue-thumb"
                    />
                  ) : (
                    <div className="queue-thumb-placeholder">
                      <span>{shot.shotSize || "—"}</span>
                    </div>
                  )}
                </div>

                <div className="queue-item-meta">
                  <div className="queue-item-row">
                    <b className="queue-shot-num">
                      {String(shot.index).padStart(3, "0")}
                    </b>
                    <span className="queue-shot-dur mono">
                      {shot.duration.toFixed(1)}s
                    </span>
                    <span
                      className={`queue-status-chip ${
                        isConfirmed
                          ? "status-confirmed"
                          : isUncertain
                          ? "status-uncertain"
                          : hasFailure
                          ? "status-failed"
                          : "status-needs-review"
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  <div className="queue-item-sub">
                    <span className="queue-reason-text" title={primaryReason}>
                      {primaryReason}
                    </span>
                    {shot.shotSize && shot.shotSize !== "Unknown" && (
                      <span className="queue-size-tag">{shot.shotSize}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
