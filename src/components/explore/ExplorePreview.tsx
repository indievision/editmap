import { useCallback, useEffect, useRef, useState } from "react";
import type { ExploreSequence, ExploreSequenceEntry } from "../../models/explore";
import { formatTimecode } from "../../utils/timecode";
import {
  clampSequenceTime,
  findEntryIndexAtSequenceTime,
  sequenceTimeToSourceTime,
} from "../../analysis/explorePlayback";

interface ExplorePreviewProps {
  sequence: ExploreSequence;
  activeSequenceTime: number;
  activeEntryIndex: number;
  url: string;
  frameRate: number;
  dropFrame: boolean;
  playing: boolean;
  onPlayPause: (playing: boolean) => void;
  onSeekSequenceTime: (time: number) => void;
  onStepShot: (direction: "prev" | "next") => void;
  onLocateInStudio: (shotId: string, sourceTime: number) => void;
  onRelinkVideo: () => void;
}

export default function ExplorePreview({
  sequence,
  activeSequenceTime,
  activeEntryIndex,
  url,
  frameRate,
  dropFrame,
  playing,
  onPlayPause,
  onSeekSequenceTime,
  onStepShot,
  onLocateInStudio,
  onRelinkVideo,
}: ExplorePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeEntryIndexRef = useRef(activeEntryIndex);
  activeEntryIndexRef.current = activeEntryIndex;
  const isPlayingRef = useRef(playing);
  isPlayingRef.current = playing;
  const sequenceRef = useRef(sequence);
  sequenceRef.current = sequence;

  const [playbackError, setPlaybackError] = useState("");
  const isSeekingRef = useRef(false);
  const seekTargetSourceTimeRef = useRef<number | null>(null);

  const activeEntry: ExploreSequenceEntry | undefined =
    sequence.entries[activeEntryIndex];

  // Helper to format sequence time as MM:SS
  const formatSeqDuration = (secs: number) => {
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  };

  // Current source time
  const currentSourceTime = (() => {
    if (!activeEntry) return 0;
    const offset = Math.max(
      0,
      Math.min(activeEntry.duration, activeSequenceTime - activeEntry.sequenceStart),
    );
    return activeEntry.sourceStart + offset;
  })();

  // Synchronize video element source time when external seek happens (e.g. clicking timeline)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || sequence.entries.length === 0) return;

    const mapped = sequenceTimeToSourceTime(activeSequenceTime, sequence.entries);
    if (!mapped) return;

    const currentVidTime = video.currentTime;
    // Only seek video if delta is meaningful (> 0.08s)
    if (Math.abs(currentVidTime - mapped.sourceTime) > 0.08) {
      isSeekingRef.current = true;
      seekTargetSourceTimeRef.current = mapped.sourceTime;
      video.currentTime = mapped.sourceTime;
    }
  }, [activeSequenceTime, sequence.entries, url]);

  // Synchronize video when metadata loads
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || sequence.entries.length === 0) return;

    const handleLoadedMetadata = () => {
      const mapped = sequenceTimeToSourceTime(activeSequenceTime, sequence.entries);
      if (mapped && video) {
        isSeekingRef.current = true;
        seekTargetSourceTimeRef.current = mapped.sourceTime;
        video.currentTime = mapped.sourceTime;
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [url, activeSequenceTime, sequence.entries]);

  // Handle play/pause state change from parent
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || sequence.entries.length === 0) return;

    if (playing) {
      setPlaybackError("");
      const curIndex = findEntryIndexAtSequenceTime(activeSequenceTime, sequence.entries);
      const curEntry = sequence.entries[curIndex >= 0 ? curIndex : 0];
      const mapped = sequenceTimeToSourceTime(activeSequenceTime, sequence.entries);
      let targetSource = mapped?.sourceTime ?? curEntry?.sourceStart ?? 0;

      // If we are at the very end of the sequence, loop back to start before playing
      if (activeSequenceTime >= sequence.totalDuration - 0.05) {
        onSeekSequenceTime(0);
        const firstEntry = sequence.entries[0];
        targetSource = firstEntry?.sourceStart ?? 0;
      }

      if (Math.abs(video.currentTime - targetSource) > 0.05) {
        isSeekingRef.current = true;
        seekTargetSourceTimeRef.current = targetSource;
        video.currentTime = targetSource;
      }

      video.play().catch((err) => {
        setPlaybackError("Playback could not start. Check video connection.");
        onPlayPause(false);
      });
    } else {
      video.pause();
    }
  }, [playing, url, sequence.entries, activeSequenceTime, sequence.totalDuration, onPlayPause, onSeekSequenceTime]);

  // Main playback tick & segment transition logic
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    let rfcId: number | null = null;
    let animId: number | null = null;
    let isCancelled = false;

    const checkPlaybackProgress = () => {
      if (isCancelled || !video) return;

      const currentVidTime = video.currentTime;
      const currentSeq = sequenceRef.current;
      const curIndex = activeEntryIndexRef.current;
      const curEntry = currentSeq.entries[curIndex];

      if (curEntry) {
        // If seeking target is met, clear isSeekingRef
        if (isSeekingRef.current && seekTargetSourceTimeRef.current !== null) {
          if (Math.abs(currentVidTime - seekTargetSourceTimeRef.current) < 0.12) {
            isSeekingRef.current = false;
            seekTargetSourceTimeRef.current = null;
          }
        }

        // Boundary transition: shot end reached!
        // Frame-aware: approx 1 frame lead (0.04s) or >= end
        const nearEnd = currentVidTime >= curEntry.sourceEnd - 0.04;

        if (nearEnd && isPlayingRef.current && !isSeekingRef.current) {
          if (curIndex + 1 < currentSeq.entries.length) {
            // Jump to next shot in Explore playlist
            const nextIndex = curIndex + 1;
            const nextEntry = currentSeq.entries[nextIndex];
            isSeekingRef.current = true;
            seekTargetSourceTimeRef.current = nextEntry.sourceStart;
            video.currentTime = nextEntry.sourceStart;
            onSeekSequenceTime(nextEntry.sequenceStart);
          } else {
            // Reached end of sequence! Stop cleanly
            video.pause();
            onPlayPause(false);
            onSeekSequenceTime(currentSeq.totalDuration);
          }
        } else if (!isSeekingRef.current) {
          // Regular progress within current entry
          const offset = Math.max(0, currentVidTime - curEntry.sourceStart);
          const seqTime = clampSequenceTime(
            curEntry.sequenceStart + offset,
            currentSeq.totalDuration,
          );
          onSeekSequenceTime(seqTime);
        }
      }

      // Schedule next check
      if (typeof video.requestVideoFrameCallback === "function") {
        rfcId = video.requestVideoFrameCallback(checkPlaybackProgress);
      } else {
        animId = requestAnimationFrame(checkPlaybackProgress);
      }
    };

    if (playing) {
      if (typeof video.requestVideoFrameCallback === "function") {
        rfcId = video.requestVideoFrameCallback(checkPlaybackProgress);
      } else {
        animId = requestAnimationFrame(checkPlaybackProgress);
      }
    }

    const handleSeeked = () => {
      isSeekingRef.current = false;
      seekTargetSourceTimeRef.current = null;
    };

    video.addEventListener("seeked", handleSeeked);

    return () => {
      isCancelled = true;
      if (rfcId !== null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(rfcId);
      }
      if (animId !== null) {
        cancelAnimationFrame(animId);
      }
      video.removeEventListener("seeked", handleSeeked);
    };
  }, [playing, url, onPlayPause, onSeekSequenceTime]);

  const handleLocateClick = () => {
    if (activeEntry) {
      onLocateInStudio(activeEntry.shotId, currentSourceTime);
    }
  };

  const handlePlayToggle = () => {
    if (sequence.entries.length === 0) return;
    onPlayPause(!playing);
  };

  return (
    <div className="explore-preview-container" data-testid="explore-preview">
      <div className="explore-preview-header">
        <span className="explore-preview-title">EXPLORE PREVIEW</span>
        {activeEntry ? (
          <span className="explore-shot-badge mono">
            Shot {activeEntry.originalIndex.toString().padStart(3, "0")} ·{" "}
            {activeEntryIndex + 1} of {sequence.entries.length}
          </span>
        ) : (
          <span className="explore-shot-badge mono">0 shots in sequence</span>
        )}
      </div>

      <div className="explore-monitor-wrapper">
        {url ? (
          <video
            ref={videoRef}
            src={url}
            className="explore-video-element"
            playsInline
            preload="auto"
            onClick={handlePlayToggle}
          />
        ) : (
          <div className="explore-no-video">
            <p>No video connected</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onRelinkVideo}
            >
              Connect source video
            </button>
          </div>
        )}

        {playbackError && (
          <div className="explore-playback-error" role="alert">
            {playbackError}
          </div>
        )}
      </div>

      <div className="explore-transport-bar">
        <div className="transport-controls">
          <button
            type="button"
            className="transport-btn"
            onClick={() => onStepShot("prev")}
            title="Previous shot in sequence"
            aria-label="Previous shot"
            disabled={sequence.entries.length === 0}
          >
            ⏮
          </button>
          <button
            type="button"
            className="transport-btn play-btn"
            onClick={handlePlayToggle}
            title={playing ? "Pause (Space)" : "Play sequence (Space)"}
            aria-label={playing ? "Pause" : "Play sequence"}
            disabled={sequence.entries.length === 0 || !url}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            className="transport-btn"
            onClick={() => onStepShot("next")}
            title="Next shot in sequence"
            aria-label="Next shot"
            disabled={sequence.entries.length === 0}
          >
            ⏭
          </button>
        </div>

        <div className="sequence-time-display">
          <div className="time-numbers mono">
            <span className="current-seq-time">
              {formatSeqDuration(activeSequenceTime)}
            </span>
            <span className="time-sep">/</span>
            <span className="total-seq-time">
              {formatSeqDuration(sequence.totalDuration)}
            </span>
          </div>
          <span className="time-caption">Sequence time</span>
        </div>

        <div className="source-time-display">
          <span className="source-tc mono">
            Source {formatTimecode(currentSourceTime, frameRate, dropFrame)}
          </span>
          <button
            type="button"
            className="locate-studio-btn"
            onClick={handleLocateClick}
            disabled={!activeEntry}
            title="Locate this shot and source timecode in Studio"
          >
            <span>Locate in Studio</span>
            <span className="locate-icon">↗</span>
          </button>
        </div>
      </div>
    </div>
  );
}
