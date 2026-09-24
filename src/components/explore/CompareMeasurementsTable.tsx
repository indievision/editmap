import React, { useMemo, useState, useRef } from "react";
import type {
  CastMember,
  DmeWaveforms,
  LoudnessAnalysis,
  SequenceMarker,
  Shot,
  SpeechAnalysis,
} from "../../models/project";
import {
  computePassageMeasurements,
  getIntersectingPassageShots,
  type PassageShotSegment,
} from "../../analysis/passageComparison";
import CompareOverviewView from "./CompareOverviewView";
import ComparePacingView from "./ComparePacingView";
import CompareFramingView from "./CompareFramingView";
import CompareOverTimeView from "./CompareOverTimeView";

export type CompareAnalysisTab = "overview" | "pacing" | "framing" | "overtime";

interface CompareMeasurementsTableProps {
  passageA?: SequenceMarker;
  passageB?: SequenceMarker;
  shots: Shot[];
  speechAnalysis?: SpeechAnalysis;
  mediaSignature?: string;
  filmDuration?: number;
  cast?: CastMember[];
  dmeWaveforms?: DmeWaveforms;
  loudnessAnalysis?: LoudnessAnalysis;
  playheadA?: { localTime: number; sourceTime: number };
  playheadB?: { localTime: number; sourceTime: number };
  playingSide?: "A" | "B" | null;
  onSeek?: (side: "A" | "B", target: { passageId: string; localTime: number; sourceTime: number }) => void;
}

export default function CompareMeasurementsTable({
  passageA,
  passageB,
  shots,
  speechAnalysis,
  mediaSignature,
  filmDuration,
  cast,
  dmeWaveforms,
  loudnessAnalysis,
  playheadA = { localTime: 0, sourceTime: 0 },
  playheadB = { localTime: 0, sourceTime: 0 },
  playingSide = null,
  onSeek = () => {},
}: CompareMeasurementsTableProps) {
  const [activeTab, setActiveTab] = useState<CompareAnalysisTab>("overview");
  const tabListRef = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => ({
      cast,
      dmeWaveforms,
      loudnessAnalysis,
    }),
    [cast, dmeWaveforms, loudnessAnalysis],
  );

  // Compute measurements strictly memoized on passage and analysis data
  const metricsA = useMemo(() => {
    if (!passageA) return null;
    return computePassageMeasurements(
      passageA,
      shots,
      speechAnalysis,
      mediaSignature,
      filmDuration,
      options,
    );
  }, [passageA, shots, speechAnalysis, mediaSignature, filmDuration, options]);

  const metricsB = useMemo(() => {
    if (!passageB) return null;
    return computePassageMeasurements(
      passageB,
      shots,
      speechAnalysis,
      mediaSignature,
      filmDuration,
      options,
    );
  }, [passageB, shots, speechAnalysis, mediaSignature, filmDuration, options]);

  // Intersecting shot segments memoized on shots & passages
  const segmentsA: PassageShotSegment[] = useMemo(() => {
    if (!passageA) return [];
    return getIntersectingPassageShots(shots, passageA);
  }, [shots, passageA]);

  const segmentsB: PassageShotSegment[] = useMemo(() => {
    if (!passageB) return [];
    return getIntersectingPassageShots(shots, passageB);
  }, [shots, passageB]);

  // Cast review status inspection
  const castReviewA = useMemo(() => {
    for (const s of segmentsA) {
      const c = s.shot.characterAnalysis;
      if (c && c.reviewStatus && c.reviewStatus !== "Confirmed") {
        return "Needs review";
      }
    }
    return undefined;
  }, [segmentsA]);

  const castReviewB = useMemo(() => {
    for (const s of segmentsB) {
      const c = s.shot.characterAnalysis;
      if (c && c.reviewStatus && c.reviewStatus !== "Confirmed") {
        return "Needs review";
      }
    }
    return undefined;
  }, [segmentsB]);

  const tabs: { id: CompareAnalysisTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "pacing", label: "Pacing" },
    { id: "framing", label: "Framing" },
    { id: "overtime", label: "Over time" },
  ];

  // Accessible keyboard navigation for tabs
  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = -1;
    if (e.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex >= 0) {
      e.preventDefault();
      const nextTab = tabs[nextIndex];
      setActiveTab(nextTab.id);
      const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      buttons?.[nextIndex]?.focus();
    }
  };

  return (
    <section className="compare-measurements-section" aria-label="Sequence measurements comparison">
      {/* 4 ANALYSIS VIEWS HEADER */}
      <div className="compare-measurements-header">
        <div className="compare-header-side side-a">
          <span className="order-badge badge-a">A</span>
          <span className="compare-header-title">{passageA?.name ?? "Passage A"}</span>
        </div>

        {/* 4 PRIMARY ANALYSIS TABS */}
        <div
          ref={tabListRef}
          className="compare-analysis-nav"
          role="tablist"
          aria-label="Passage analysis views"
        >
          {tabs.map((tab, idx) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`compare-tab-${tab.id}`}
                role="tab"
                type="button"
                className={`compare-view-tab ${isActive ? "active" : ""}`}
                aria-selected={isActive}
                aria-controls={`compare-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="compare-header-side side-b">
          <span className="order-badge badge-b">B</span>
          <span className="compare-header-title">{passageB?.name ?? "Passage B"}</span>
        </div>
      </div>

      {/* TAB PANEL CONTAINER */}
      <div
        id={`compare-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`compare-tab-${activeTab}`}
        className="compare-view-panel-container"
        tabIndex={0}
      >
        {activeTab === "overview" && (
          <CompareOverviewView
            passageA={passageA}
            passageB={passageB}
            metricsA={metricsA}
            metricsB={metricsB}
            castReviewA={castReviewA}
            castReviewB={castReviewB}
          />
        )}

        {activeTab === "pacing" && (
          <ComparePacingView
            passageA={passageA}
            passageB={passageB}
            segmentsA={segmentsA}
            segmentsB={segmentsB}
            aslA={metricsA?.asl ?? null}
            aslB={metricsB?.asl ?? null}
            onSeek={onSeek}
          />
        )}

        {activeTab === "framing" && (
          <CompareFramingView
            passageA={passageA}
            passageB={passageB}
            segmentsA={segmentsA}
            segmentsB={segmentsB}
            onSeek={onSeek}
          />
        )}

        {activeTab === "overtime" && (
          <CompareOverTimeView
            passageA={passageA}
            passageB={passageB}
            segmentsA={segmentsA}
            segmentsB={segmentsB}
            speechAnalysis={speechAnalysis}
            mediaSignature={mediaSignature}
            filmDuration={filmDuration}
            playheadA={playheadA}
            playheadB={playheadB}
            playingSide={playingSide}
            onSeek={onSeek}
          />
        )}
      </div>
    </section>
  );
}
