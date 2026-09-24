import { useMemo } from "react";
import type { ExploreSequence } from "../../models/explore";

interface ExploreSourceLocatorProps {
  sequence: ExploreSequence;
  filmDuration: number;
  activeEntryIndex: number;
  onSelectEntry: (index: number) => void;
  onSeekSequenceTime: (time: number) => void;
}

export default function ExploreSourceLocator({
  sequence,
  filmDuration,
  activeEntryIndex,
  onSelectEntry,
  onSeekSequenceTime,
}: ExploreSourceLocatorProps) {
  const duration = Math.max(1, filmDuration);

  // Format MM:SS helper
  const formatTime = (secs: number) => {
    const s = Math.round(secs);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  };

  // Sort sequence entries strictly by ORIGINAL chronological sourceStart
  const chronoSortedEntries = useMemo(() => {
    return sequence.entries
      .map((entry, seqIdx) => ({ entry, seqIdx }))
      .sort((a, b) => a.entry.sourceStart - b.entry.sourceStart);
  }, [sequence.entries]);

  const activeEntry = sequence.entries[activeEntryIndex];

  return (
    <div className="explore-source-locator" aria-label="Original Film Source Locator">
      <div className="locator-header">
        <span className="locator-title">SOURCE LOCATIONS</span>
        <span className="locator-sep">·</span>
        <span className="locator-subtitle">Original film order</span>
      </div>

      <div className="locator-track-wrapper">
        <span className="endpoint-time start-time mono">00:00</span>

        <div className="locator-hairline">
          {chronoSortedEntries.map(({ entry, seqIdx }) => {
            const leftPct = Math.max(0, Math.min(100, (entry.sourceStart / duration) * 100));
            const isActive = seqIdx === activeEntryIndex;

            return (
              <div
                key={`${entry.shotId}-${seqIdx}`}
                className={`locator-marker ${isActive ? "active" : ""}`}
                style={{ left: `${leftPct}%` }}
                onClick={() => {
                  onSelectEntry(seqIdx);
                  onSeekSequenceTime(entry.sequenceStart);
                }}
                title={`Shot ${entry.originalIndex} (Source: ${formatTime(entry.sourceStart)})`}
              >
                <div className="marker-tick" />
                <div className="marker-label-cluster">
                  <span className="marker-shot-id mono">
                    {entry.originalIndex.toString().padStart(3, "0")}
                  </span>
                  <span className="marker-tc mono">
                    {formatTime(entry.sourceStart)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <span className="endpoint-time end-time mono">{formatTime(duration)}</span>
      </div>

      <div className="locator-footer">
        <small className="locator-microcopy">
          Chronological film timeline. Markers indicate source positions of sequence shots.
        </small>
      </div>
    </div>
  );
}
