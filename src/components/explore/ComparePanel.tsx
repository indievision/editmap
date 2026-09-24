import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { SequenceMarker, Shot } from "../../models/project";
import { formatTimecode } from "../../utils/timecode";
import {
  findPassageSegmentAtLocalTime,
  getIntersectingPassageShots,
  localTimeToSourceTime,
  sourceTimeToLocalTime,
  type PassageShotSegment,
} from "../../analysis/passageComparison";
import CompareTimeline from "./CompareTimeline";

export interface ComparePanelHandle {
  seekToLocalTime: (localTime: number) => void;
  seekToSourceTime: (sourceTime: number) => void;
  getLocalTime: () => number;
}

export interface ComparePanelProps {
  side: "A" | "B";
  passages: SequenceMarker[];
  selectedPassageId: string;
  onSelectPassageId: (id: string) => void;
  shots: Shot[];
  url: string;
  frameRate: number;
  dropFrame: boolean;
  isPlaying: boolean;
  onPlayRequest: () => void;
  onPauseRequest: () => void;
  onLocateInStudio: (shotId: string, sourceTime: number, passageId?: string) => void;
  onRelinkVideo: () => void;
  thumbnails: Record<string, string>;
  onTimeUpdate?: (localTime: number, sourceTime: number) => void;
}

const ComparePanel = React.forwardRef<ComparePanelHandle, ComparePanelProps>(function ComparePanel(
  {
    side,
    passages,
    selectedPassageId,
    onSelectPassageId,
    shots,
    url,
    frameRate,
    dropFrame,
    isPlaying,
    onPlayRequest,
    onPauseRequest,
    onLocateInStudio,
    onRelinkVideo,
    thumbnails,
    onTimeUpdate,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isA = side === "A";
  const accentColor = isA ? "#d3ba7c" : "#38bdf8";

  // Selected passage
  const currentPassage = useMemo(() => {
    return passages.find((p) => p.id === selectedPassageId) ?? passages[0];
  }, [passages, selectedPassageId]);

  const pIn = currentPassage ? currentPassage.startSeconds : 0;
  const pOut = currentPassage ? currentPassage.endSeconds : 0;
  const passageDuration = Math.max(0.001, pOut - pIn);

  // Independent panel states
  const [localTime, setLocalTime] = useState<number>(0);
  const [loop, setLoop] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1.0);
  const [scrollLeft, setScrollLeft] = useState<number>(0);
  const [videoError, setVideoError] = useState<string>("");

  const isSeekingRef = useRef(false);

  // Intersecting shot segments
  const segments: PassageShotSegment[] = useMemo(() => {
    if (!currentPassage) return [];
    return getIntersectingPassageShots(shots, currentPassage);
  }, [shots, currentPassage]);

  // Current active shot segment
  const activeSegment = useMemo(() => {
    return findPassageSegmentAtLocalTime(segments, localTime);
  }, [segments, localTime]);

  // Reset this panel's playback, zoom, and scroll when its passage changes
  useEffect(() => {
    setLocalTime(0);
    setZoom(1.0);
    setScrollLeft(0);
    setVideoError("");
    const video = videoRef.current;
    if (video && currentPassage) {
      video.currentTime = currentPassage.startSeconds;
    }
    onTimeUpdate?.(0, pIn);
  }, [selectedPassageId, pIn, onTimeUpdate]); // Only triggers when this panel's selected passage changes

  // Synchronize video playback state
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !currentPassage) return;

    if (isPlaying) {
      setVideoError("");
      const currentSource = video.currentTime;
      // If at or past out boundary, wrap to In
      if (currentSource >= pOut - 0.04 || currentSource < pIn - 0.05) {
        video.currentTime = pIn;
        setLocalTime(0);
        onTimeUpdate?.(0, pIn);
      }
      video.play().catch((err: Error) => {
        if (err.name !== "AbortError") {
          setVideoError("Playback failed. Click play to resume.");
          onPauseRequest();
        }
      });
    } else {
      video.pause();
    }
  }, [isPlaying, url, currentPassage, pIn, pOut, onPauseRequest, onTimeUpdate]);

  // Handle video element timeupdate
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !currentPassage || isSeekingRef.current) return;

    const sourceTime = video.currentTime;

    // Check Out boundary
    if (sourceTime >= pOut - 0.03) {
      if (loop) {
        video.currentTime = pIn;
        setLocalTime(0);
        onTimeUpdate?.(0, pIn);
      } else {
        video.pause();
        video.currentTime = pOut;
        setLocalTime(passageDuration);
        onTimeUpdate?.(passageDuration, pOut);
        onPauseRequest();
      }
      return;
    }

    if (sourceTime < pIn - 0.05) {
      video.currentTime = pIn;
      setLocalTime(0);
      onTimeUpdate?.(0, pIn);
      return;
    }

    const calculatedLocal = Math.max(0, Math.min(passageDuration, sourceTime - pIn));
    setLocalTime(calculatedLocal);
    onTimeUpdate?.(calculatedLocal, sourceTime);
  };

  // Synchronize video time when loaded metadata fires
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video || !currentPassage) return;
    const targetSource = pIn + localTime;
    video.currentTime = targetSource;
    onTimeUpdate?.(localTime, targetSource);
  };

  // Seek handler from timeline or transport
  const seekToLocalTime = useCallback(
    (newLocalTime: number) => {
      const clampedLocal = Math.max(0, Math.min(passageDuration, newLocalTime));
      setLocalTime(clampedLocal);
      onTimeUpdate?.(clampedLocal, pIn + clampedLocal);

      const video = videoRef.current;
      if (video && currentPassage) {
        const targetSource = pIn + clampedLocal;
        isSeekingRef.current = true;
        video.currentTime = targetSource;
        setTimeout(() => {
          isSeekingRef.current = false;
        }, 50);
      }
    },
    [passageDuration, currentPassage, pIn, onTimeUpdate],
  );

  const seekToSourceTime = useCallback(
    (sourceTime: number) => {
      if (!currentPassage) return;
      const targetLocal = sourceTime - pIn;
      seekToLocalTime(targetLocal);
    },
    [currentPassage, pIn, seekToLocalTime],
  );

  useImperativeHandle(
    ref,
    () => ({
      seekToLocalTime,
      seekToSourceTime,
      getLocalTime: () => localTime,
    }),
    [seekToLocalTime, seekToSourceTime, localTime],
  );

  // Stepping frames
  const handleStepFrame = (direction: "prev" | "next") => {
    const frameDuration = 1 / (frameRate > 0 ? frameRate : 24);
    const delta = direction === "next" ? frameDuration : -frameDuration;
    seekToLocalTime(localTime + delta);
  };

  const togglePlayPause = () => {
    if (isPlaying) {
      onPauseRequest();
    } else {
      onPlayRequest();
    }
  };

  // Format MM:SS helper
  const formatClock = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  };

  const currentSourceTime = pIn + localTime;

  // Handle Locate in Studio
  const handleLocateInStudio = () => {
    const shotId = activeSegment ? activeSegment.shot.id : shots[0]?.id ?? "";
    onLocateInStudio(shotId, currentSourceTime, currentPassage?.id);
  };

  if (!currentPassage) {
    return (
      <div className={`compare-panel side-${side.toLowerCase()}`}>
        <div className="compare-panel-empty">No passage selected.</div>
      </div>
    );
  }

  return (
    <div className={`compare-panel side-${side.toLowerCase()}`} data-testid={`compare-panel-${side.toLowerCase()}`}>
      {/* 1. TOP HEADER: BADGE + PASSAGE SELECTOR + LOCATE IN STUDIO */}
      <div className="compare-panel-top-row">
        <div className="compare-panel-select-group">
          <div
            className={`compare-panel-badge badge-${side.toLowerCase()}`}
            style={{ backgroundColor: accentColor }}
          >
            {side}
          </div>

          <div className="compare-select-wrapper">
            <select
              aria-label={`${side} passage selection`}
              className="compare-passage-select"
              value={selectedPassageId}
              onChange={(e) => onSelectPassageId(e.target.value)}
            >
              {passages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="compare-select-caret" aria-hidden="true">▾</span>
          </div>
        </div>

        <button
          type="button"
          className="compare-locate-btn"
          onClick={handleLocateInStudio}
          title="Locate this passage and position in Studio workbench"
        >
          <span>Locate in Studio</span>
          <span className="compare-locate-arrow" aria-hidden="true">↗</span>
        </button>
      </div>

      {/* 2. SUB-ROW METADATA: In, Out, Duration, Shots */}
      <div className="compare-panel-meta-row">
        <span className="meta-inout">
          In {formatClock(pIn)} &nbsp; Out {formatClock(pOut)}
        </span>
        <span className="meta-sep">·</span>
        <span className="meta-duration">{Math.round(passageDuration)} s</span>
        <span className="meta-sep">·</span>
        <span className="meta-shots">{segments.length} shots</span>
      </div>

      {/* 3. 16:9 PREVIEW MONITOR */}
      <div className="compare-monitor-container">
        {url ? (
          <video
            ref={videoRef}
            src={url}
            muted={muted}
            playsInline
            controls={false}
            className="compare-video-player"
            onClick={togglePlayPause}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onError={() => setVideoError("Video stream could not be loaded.")}
          />
        ) : (
          <div className="compare-monitor-no-video">
            <p>No video linked to project.</p>
            <button
              type="button"
              className="compare-relink-btn"
              onClick={onRelinkVideo}
            >
              Link video file
            </button>
          </div>
        )}

        {videoError && (
          <div className="compare-monitor-error" role="alert">
            {videoError}
          </div>
        )}
      </div>

      {/* 4. TRANSPORT CONTROLS */}
      <div className="compare-transport-row" role="toolbar" aria-label={`${side} playback controls`}>
        <div className="compare-transport-left">
          <button
            type="button"
            className="compare-transport-btn"
            onClick={() => handleStepFrame("prev")}
            aria-label="Previous frame"
            title="Previous frame (1 frame back)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm12 12l-8.5-6 8.5-6v12z" />
            </svg>
          </button>

          <button
            type="button"
            className={`compare-transport-btn compare-play-btn ${isPlaying ? "active" : ""}`}
            onClick={togglePlayPause}
            aria-label={isPlaying ? "Pause" : "Play"}
            title={isPlaying ? "Pause passage" : "Play passage"}
          >
            {isPlaying ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            className="compare-transport-btn"
            onClick={() => handleStepFrame("next")}
            aria-label="Next frame"
            title="Next frame (1 frame forward)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>

          <span className="compare-time-readout mono">
            {formatClock(localTime)} / {formatClock(passageDuration)}
          </span>
        </div>

        <div className="compare-transport-right">
          <span className="compare-source-readout mono" title="Current position in full film">
            Source {formatClock(currentSourceTime)}
          </span>

          <button
            type="button"
            className={`compare-transport-toggle ${loop ? "active" : ""}`}
            onClick={() => setLoop(!loop)}
            aria-label="Loop passage"
            aria-pressed={loop}
            title={loop ? "Looping enabled" : "Enable loop"}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M17 1l4 4-4 4" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <path d="M7 23l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>

          <button
            type="button"
            className={`compare-transport-toggle ${muted ? "muted" : ""}`}
            onClick={() => setMuted(!muted)}
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
            title={muted ? "Muted" : "Mute audio"}
          >
            {muted ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* 5. LOCAL SHOT TIMELINE WITH INDEPENDENT ZOOM & SCROLL */}
      <CompareTimeline
        side={side}
        passage={currentPassage}
        shots={shots}
        localTime={localTime}
        thumbnails={thumbnails}
        onSeekLocalTime={seekToLocalTime}
        zoom={zoom}
        onZoomChange={setZoom}
        scrollLeft={scrollLeft}
        onScrollChange={setScrollLeft}
      />
    </div>
  );
});

export default ComparePanel;
