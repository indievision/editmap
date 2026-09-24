import { memo, useState, useMemo, useEffect, useCallback } from "react";
import {
  soundKinds,
  type Project,
  type Shot,
  type LoudnessAnalysis,
  type SpeechAnalysis,
  type SoundSpan,
  type SoundKind,
} from "../models/project";
import type { TimeRange } from "./SequenceReading";
import { getRangeLoudness, getShotLoudness } from "../analysis/loudness";
import { speechSummary } from "../analysis/speech";
import { formatTimecode } from "../utils/timecode";
import AudioLoudnessTimeline from "./AudioLoudnessTimeline";
import SoundReading from "./SoundReading";
import LoudnessReading from "./LoudnessReading";
import SpeechReading from "./SpeechReading";

export type SoundSubTab = "overview" | "spans" | "loudness" | "speech" | "all";

export interface SoundDrawerProps {
  project: Project;
  range?: TimeRange;
  currentTime: number;
  selectedShot?: Shot;
  onRangeChange: (range?: TimeRange) => void;
  onPlayRange: (range: TimeRange, loop: boolean) => void;
  onUpdateSpans: (spans: SoundSpan[]) => void;
  loudnessAnalysis?: LoudnessAnalysis;
  isLoudnessScanning: boolean;
  loudnessStatus: string;
  onScanLoudness: () => void;
  onCancelLoudness: () => void;
  speechAnalysis?: SpeechAnalysis;
  isSpeechScanning: boolean;
  speechStatus: string;
  onScanSpeech: () => void;
  onCancelSpeech: () => void;
  onRetrySpeech: () => void;
  onSeek: (time: number) => void;
  showSpeechOverlay: boolean;
  onToggleSpeechOverlay: () => void;
  onClose?: () => void;
}

export const SoundDrawer = memo(function SoundDrawer({
  project,
  range,
  currentTime,
  selectedShot,
  onRangeChange,
  onPlayRange,
  onUpdateSpans,
  loudnessAnalysis,
  isLoudnessScanning,
  loudnessStatus,
  onScanLoudness,
  onCancelLoudness,
  speechAnalysis,
  isSpeechScanning,
  speechStatus,
  onScanSpeech,
  onCancelSpeech,
  onRetrySpeech,
  onSeek,
  showSpeechOverlay,
  onToggleSpeechOverlay,
  onClose,
}: SoundDrawerProps) {
  const [subTab, setSubTab] = useState<SoundSubTab>("overview");
  const [isSelectionOpen, setIsSelectionOpen] = useState(false);

  // Active sub-tab normalization (treat "all" as "overview")
  const activeTab = subTab === "all" ? "overview" : subTab;

  const duration = Math.max(0.001, project.duration || project.videoMetadata?.duration || 1);
  const tc = useCallback(
    (t: number) => formatTimecode(t, project.frameRate, project.dropFrame),
    [project.frameRate, project.dropFrame],
  );

  // Compact metrics row calculation
  const metrics = useMemo(() => {
    if (range) {
      if (loudnessAnalysis) {
        const rangeMetrics = getRangeLoudness(range, loudnessAnalysis);
        return {
          scope: `Selection ${tc(range.start)} — ${tc(range.end)}`,
          isSelection: true,
          integrated: `${rangeMetrics.avgMomentary.toFixed(1)} LUFS`,
          range: `${rangeMetrics.shortTermRange.toFixed(1)} LU`,
          truePeak: `${rangeMetrics.peakTruePeak.toFixed(1)} dBTP`,
        };
      }
      return {
        scope: `Selection ${tc(range.start)} — ${tc(range.end)}`,
        isSelection: true,
        integrated: "— LUFS",
        range: "— LU",
        truePeak: "— dBTP",
      };
    }

    if (selectedShot) {
      if (loudnessAnalysis) {
        const shotMetrics = getShotLoudness(selectedShot, loudnessAnalysis);
        return {
          scope: `Shot #${selectedShot.index} (${tc(selectedShot.startSeconds)} — ${tc(selectedShot.endSeconds)})`,
          isSelection: true,
          integrated: `${shotMetrics.avgMomentary.toFixed(1)} LUFS`,
          range: `${(shotMetrics.maxShortTerm - shotMetrics.avgMomentary >= 0 ? shotMetrics.maxShortTerm - shotMetrics.avgMomentary : 0).toFixed(1)} LU`,
          truePeak: `${shotMetrics.peakTruePeak.toFixed(1)} dBTP`,
        };
      }
      return {
        scope: `Shot #${selectedShot.index}`,
        isSelection: true,
        integrated: "— LUFS",
        range: "— LU",
        truePeak: "— dBTP",
      };
    }

    if (loudnessAnalysis) {
      return {
        scope: "Whole film",
        isSelection: false,
        integrated: `${loudnessAnalysis.integratedLoudness.toFixed(1)} LUFS`,
        range: `${loudnessAnalysis.loudnessRange.toFixed(1)} LU`,
        truePeak: `${loudnessAnalysis.truePeak.toFixed(1)} dBTP`,
      };
    }

    return {
      scope: "Whole film",
      isSelection: false,
      integrated: "— LUFS",
      range: "— LU",
      truePeak: "— dBTP",
    };
  }, [range, selectedShot, loudnessAnalysis, tc]);

  // Selection details state: sound span annotation form
  const [spanKind, setSpanKind] = useState<SoundKind>("Dialogue");
  const [spanNotes, setSpanNotes] = useState("");
  const [loopPlayback, setLoopPlayback] = useState(true);

  // Check if current range matches an existing span
  const matchedSpan = useMemo(() => {
    if (!range || !project.soundSpans) return undefined;
    return project.soundSpans.find(
      (s) =>
        Math.abs(s.startSeconds - range.start) < 0.1 &&
        Math.abs(s.endSeconds - range.end) < 0.1,
    );
  }, [range, project.soundSpans]);

  useEffect(() => {
    if (matchedSpan) {
      setSpanKind(matchedSpan.kind);
      setSpanNotes(matchedSpan.notes);
    } else {
      setSpanNotes("");
    }
  }, [matchedSpan]);

  // Auto-open selection details if user selects a range or shot
  useEffect(() => {
    if (range) {
      setIsSelectionOpen(true);
    }
  }, [range]);

  const handleSaveSpan = () => {
    if (!range || range.end <= range.start) return;
    const next: SoundSpan = {
      id: matchedSpan?.id ?? crypto.randomUUID(),
      kind: spanKind,
      startSeconds: range.start,
      endSeconds: range.end,
      notes: spanNotes,
    };
    const updated = [
      ...(project.soundSpans ?? []).filter((s) => s.id !== next.id),
      next,
    ].sort((a, b) => a.startSeconds - b.startSeconds);
    onUpdateSpans(updated);
  };

  // Re-scan handler
  const handleRescan = () => {
    if (!project.videoMetadata) return;
    onScanLoudness();
    if (!speechAnalysis && onScanSpeech) {
      onScanSpeech();
    }
  };

  const isScanning = isLoudnessScanning || isSpeechScanning;
  const scanningStatus = loudnessStatus || speechStatus || "Analyzing audio…";

  // Selection speech summary
  const selectionSpeech = useMemo(() => {
    if (!speechAnalysis || !range) return null;
    return speechSummary(speechAnalysis.regions, range);
  }, [speechAnalysis, range]);

  return (
    <div className="sound-drawer panel" aria-label="Audio & loudness drawer">
      {/* Header matching minimal mockup */}
      <div className="sound-drawer-head">
        <div className="sound-drawer-title-group">
          <div className="sound-drawer-kicker">EDITMAP / STUDIO</div>
          <h2 className="sound-drawer-title">Audio & loudness</h2>
        </div>
        {onClose && (
          <button
            type="button"
            className="studio-drawer-close-btn sound-drawer-close-btn"
            onClick={onClose}
            title="Close audio drawer (Esc)"
            aria-label="Close audio drawer"
          >
            ✕
          </button>
        )}
      </div>

      {/* Tabs Row */}
      <div className="sound-tabs-bar">
        <div className="sound-subtabs-wrap" role="tablist" aria-label="Audio subviews">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "overview"}
            className={`sound-subtab-btn ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setSubTab("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "spans"}
            className={`sound-subtab-btn ${activeTab === "spans" ? "active" : ""}`}
            onClick={() => setSubTab("spans")}
          >
            Sound spans
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "loudness"}
            className={`sound-subtab-btn ${activeTab === "loudness" ? "active" : ""}`}
            onClick={() => setSubTab("loudness")}
          >
            Loudness
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "speech"}
            className={`sound-subtab-btn ${activeTab === "speech" ? "active" : ""}`}
            onClick={() => setSubTab("speech")}
          >
            Speech
          </button>
        </div>

        {/* Understated Scan / Re-scan Controls */}
        <div className="sound-top-actions">
          {isScanning ? (
            <div className="sound-scanning-pill">
              <span className="dme-spinner" />
              <span className="sound-scanning-text">{scanningStatus}</span>
              <button
                type="button"
                className="sound-btn-cancel"
                onClick={() => {
                  if (isLoudnessScanning) onCancelLoudness();
                  if (isSpeechScanning) onCancelSpeech();
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="sound-btn-rescan"
              onClick={handleRescan}
              disabled={!project.videoMetadata}
              title={
                !project.videoMetadata
                  ? "Connect a video file first"
                  : loudnessAnalysis
                    ? "Re-scan loudness and audio features"
                    : "Scan audio loudness and speech activity"
              }
            >
              <span className="rescan-icon">↻</span>
              <span>{loudnessAnalysis ? "Re-scan" : "Scan audio"}</span>
            </button>
          )}
        </div>
      </div>

      <div className="sound-drawer-content">
        {activeTab === "overview" && (
          <div className="sound-overview-layout">
            {/* Compact Metric Row */}
            <div className="sound-compact-metrics-row">
              <div className="metric-scope-col">
                <span className={`metric-scope-badge ${metrics.isSelection ? "is-selection" : ""}`}>
                  {metrics.scope}
                </span>
                {range && (
                  <button
                    type="button"
                    className="metric-clear-btn"
                    onClick={() => onRangeChange(undefined)}
                    title="Clear passage selection"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="metric-sep" />

              <div className="metric-col">
                <span className="metric-label">Integrated</span>
                <span className="metric-value">{metrics.integrated}</span>
              </div>

              <div className="metric-sep" />

              <div className="metric-col">
                <span className="metric-label">Range</span>
                <span className="metric-value">{metrics.range}</span>
              </div>

              <div className="metric-sep" />

              <div className="metric-col">
                <span className="metric-label">True peak</span>
                <span className="metric-value">{metrics.truePeak}</span>
              </div>
            </div>

            {/* Dominant Audio & Loudness Timeline */}
            <AudioLoudnessTimeline
              project={project}
              loudnessAnalysis={loudnessAnalysis}
              speechAnalysis={speechAnalysis}
              currentTime={currentTime}
              range={range}
              selectedShot={selectedShot}
              onSeek={onSeek}
              onRangeChange={onRangeChange}
              onScanLoudness={onScanLoudness}
              onScanSpeech={onScanSpeech}
              isLoudnessScanning={isLoudnessScanning}
              isSpeechScanning={isSpeechScanning}
            />

            {/* Collapsible Selection Details */}
            <div className="sound-selection-section">
              <button
                type="button"
                className="sound-selection-toggle-bar"
                onClick={() => setIsSelectionOpen((prev) => !prev)}
                aria-expanded={isSelectionOpen}
              >
                <div className="selection-toggle-left">
                  <span className={`selection-chevron ${isSelectionOpen ? "open" : ""}`}>
                    ›
                  </span>
                  <span className="selection-title">Selection details</span>
                </div>
                <div className="selection-toggle-right">
                  <span className="selection-instruction">
                    Click to seek · Select a passage to inspect
                  </span>
                </div>
              </button>

              {isSelectionOpen && (
                <div className="sound-selection-body">
                  {range ? (
                    <div className="selection-controls-grid">
                      <div className="selection-playback-col">
                        <div className="selection-time-readout">
                          <span className="selection-tc">
                            {tc(range.start)} — {tc(range.end)}
                          </span>
                          <span className="selection-sec">
                            {(range.end - range.start).toFixed(2)}s
                          </span>
                        </div>
                        <div className="selection-play-row">
                          <button
                            type="button"
                            className="btn-play-passage"
                            onClick={() => onPlayRange(range, loopPlayback)}
                            disabled={!project.videoMetadata}
                          >
                            Play passage
                          </button>
                          <label className="selection-loop-label">
                            <input
                              type="checkbox"
                              checked={loopPlayback}
                              onChange={(e) => setLoopPlayback(e.target.checked)}
                            />
                            Loop
                          </label>
                          <button
                            type="button"
                            className="btn-clear-passage"
                            onClick={() => onRangeChange(undefined)}
                          >
                            Clear
                          </button>
                        </div>

                        {/* Selection Speech & Loudness quick stats */}
                        <div className="selection-quick-stats">
                          {selectionSpeech && (
                            <div className="quick-stat-item">
                              <span className="qs-label">Speech:</span>
                              <span className="qs-val">
                                {selectionSpeech.speechPercent.toFixed(1)}% (
                                {selectionSpeech.speechDuration.toFixed(2)}s)
                              </span>
                            </div>
                          )}
                          {loudnessAnalysis && (
                            <div className="quick-stat-item">
                              <span className="qs-label">Avg LUFS:</span>
                              <span className="qs-val">{metrics.integrated}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="selection-annotation-col">
                        <div className="annotation-inputs-row">
                          <label className="annotation-label">
                            <span>Sound category</span>
                            <select
                              value={spanKind}
                              onChange={(e) => setSpanKind(e.target.value as SoundKind)}
                              className="annotation-select"
                            >
                              {soundKinds.map((k) => (
                                <option key={k} value={k}>
                                  {k}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="annotation-label observation">
                            <span>Observation</span>
                            <textarea
                              value={spanNotes}
                              onChange={(e) => setSpanNotes(e.target.value)}
                              placeholder="Observation for this sound span…"
                              rows={2}
                              className="annotation-textarea"
                            />
                          </label>
                          <button
                            type="button"
                            className="btn-save-span"
                            onClick={handleSaveSpan}
                          >
                            {matchedSpan ? "Update span" : "Add sound span"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : selectedShot ? (
                    <div className="selection-shot-preview">
                      <div className="shot-preview-info">
                        <b>Shot #{selectedShot.index}</b>: {tc(selectedShot.startSeconds)} — {tc(selectedShot.endSeconds)} ({selectedShot.duration.toFixed(2)}s)
                      </div>
                      <div className="shot-preview-actions">
                        <button
                          type="button"
                          className="btn-select-shot-passage"
                          onClick={() =>
                            onRangeChange({
                              start: selectedShot.startSeconds,
                              end: selectedShot.endSeconds,
                            })
                          }
                        >
                          Select shot passage
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="selection-empty-hint">
                      Click or drag anywhere on the timeline to select and inspect an audio passage, or click an existing sound span.
                    </div>
                  )}
                </div>
              )}

              {/* Design Concept Footnote */}
              <div className="sound-drawer-footer">
                <span className="footer-concept-note">Illustrative data · Design concept</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === "spans" && (
          <SoundReading
            project={project}
            range={range}
            onRangeChange={onRangeChange}
            onPlay={onPlayRange}
            onUpdate={onUpdateSpans}
          />
        )}

        {activeTab === "loudness" && (
          <LoudnessReading
            project={project}
            analysis={loudnessAnalysis}
            currentTime={currentTime}
            selectedShot={selectedShot}
            isScanning={isLoudnessScanning}
            status={loudnessStatus}
            onScan={onScanLoudness}
            onCancel={onCancelLoudness}
            onSeek={onSeek}
          />
        )}

        {activeTab === "speech" && (
          <SpeechReading
            project={project}
            analysis={speechAnalysis}
            range={range}
            selectedShot={selectedShot}
            isScanning={isSpeechScanning}
            status={speechStatus}
            onScan={onScanSpeech}
            onCancel={onCancelSpeech}
            onRetry={onRetrySpeech}
            onSeek={onSeek}
            onToggleOverlay={onToggleSpeechOverlay}
            showOverlay={showSpeechOverlay}
          />
        )}
      </div>
    </div>
  );
});

export default SoundDrawer;
