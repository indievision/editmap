import { useCallback, useEffect, useState } from "react";
import type { ColorProfile, Project } from "../../models/project";
import { getEligiblePassages } from "../../analysis/passageComparison";
import AssembleSubpage from "./AssembleSubpage";
import CompareSubpage from "./CompareSubpage";
import "./Explore.css";

interface ExploreWorkspaceProps {
  project: Project;
  url: string;
  mediaSignature?: string;
  thumbnails: Record<string, string>;
  colorProfiles?: Record<string, ColorProfile>;
  activeWorkspace: "studio" | "explore";
  onUpdateProject: (patch: Partial<Project>) => void;
  onLocateInStudio: (shotId: string, sourceTime: number, passageId?: string) => void;
  onRelinkVideo: () => void;
}

export type ExploreSubpageType = "assemble" | "compare";

export default function ExploreWorkspace({
  project,
  url,
  mediaSignature,
  thumbnails,
  colorProfiles,
  activeWorkspace,
  onUpdateProject,
  onLocateInStudio,
  onRelinkVideo,
}: ExploreWorkspaceProps) {
  const [activeSubpage, setActiveSubpage] = useState<ExploreSubpageType>("assemble");
  const [statusNotice, setStatusNotice] = useState<string>("");

  // Modals state
  const [isAssembleSaveOpen, setIsAssembleSaveOpen] = useState(false);
  const [isCompareSaveOpen, setIsCompareSaveOpen] = useState(false);

  // When switching subpages, clear any modals and notice if desired
  const handleSubpageChange = (nextSubpage: ExploreSubpageType) => {
    if (nextSubpage === activeSubpage) return;
    setActiveSubpage(nextSubpage);
    setIsAssembleSaveOpen(false);
    setIsCompareSaveOpen(false);
  };

  const eligiblePassages = getEligiblePassages(project.sequences);

  return (
    <main className="explore-workspace" data-testid="explore-workspace">
      {/* 1. TOP SUBPAGE NAVIGATION BAR */}
      <nav className="explore-subnav-bar" aria-label="Explore Views">
        <div className="explore-subnav-left">
          <span className="explore-subnav-title">EXPLORE</span>

          <div className="explore-subnav-tabs" role="tablist" aria-label="Explore Subpages">
            {/* ASSEMBLE SUBPAGE BUTTON */}
            <button
              type="button"
              role="tab"
              id="explore-tab-assemble"
              aria-selected={activeSubpage === "assemble"}
              aria-controls="explore-panel-assemble"
              className={`explore-subnav-tab ${activeSubpage === "assemble" ? "active" : ""}`}
              onClick={() => handleSubpageChange("assemble")}
            >
              <span>Assemble</span>
            </button>

            {/* COMPARE SUBPAGE BUTTON */}
            <button
              type="button"
              role="tab"
              id="explore-tab-compare"
              aria-selected={activeSubpage === "compare"}
              aria-controls="explore-panel-compare"
              className={`explore-subnav-tab ${activeSubpage === "compare" ? "active" : ""}`}
              onClick={() => handleSubpageChange("compare")}
            >
              <span>Compare</span>
            </button>
          </div>
        </div>

        <div className="explore-subnav-right">
          {activeSubpage === "compare" && (
            <button
              type="button"
              className="explore-header-save-btn"
              onClick={() => setIsCompareSaveOpen(true)}
              disabled={eligiblePassages.length < 2}
              title={
                eligiblePassages.length < 2
                  ? "At least 2 Studio passages are needed to save a comparison"
                  : "Save current comparison"
              }
            >
              Save comparison
            </button>
          )}
        </div>
      </nav>

      {/* 2. SUBPAGE DESCRIPTION BAR */}
      <div className="explore-subnav-desc-row">
        <p className="explore-subnav-description">
          {activeSubpage === "assemble"
            ? "Build and play data-driven viewing sequences from editorial data."
            : "Compare named sequences from Studio."}
        </p>
      </div>

      {/* 3. OPTIONAL STATUS NOTICE BANNER */}
      {statusNotice && (
        <div className="explore-status-banner" role="status">
          <span>{statusNotice}</span>
          <button
            type="button"
            className="status-close-btn"
            onClick={() => setStatusNotice("")}
            aria-label="Dismiss notice"
          >
            ✕
          </button>
        </div>
      )}

      {/* 4. SUBPAGES (Preserves state between switches while ensuring inactive players are strictly paused) */}
      <div
        id="explore-panel-assemble"
        role="tabpanel"
        aria-labelledby="explore-tab-assemble"
        style={{ display: activeSubpage === "assemble" ? "contents" : "none" }}
      >
        <AssembleSubpage
          project={project}
          url={url}
          mediaSignature={mediaSignature}
          thumbnails={thumbnails}
          colorProfiles={colorProfiles}
          activeWorkspace={activeWorkspace}
          activeSubpage={activeSubpage}
          onUpdateProject={onUpdateProject}
          onLocateInStudio={(shotId, sourceTime) => onLocateInStudio(shotId, sourceTime)}
          onRelinkVideo={onRelinkVideo}
          isSaveModalOpen={isAssembleSaveOpen}
          setIsSaveModalOpen={setIsAssembleSaveOpen}
          onStatusNotice={setStatusNotice}
        />
      </div>

      <div
        id="explore-panel-compare"
        role="tabpanel"
        aria-labelledby="explore-tab-compare"
        style={{ display: activeSubpage === "compare" ? "contents" : "none" }}
      >
        <CompareSubpage
          project={project}
          url={url}
          mediaSignature={mediaSignature}
          thumbnails={thumbnails}
          activeWorkspace={activeWorkspace}
          activeSubpage={activeSubpage}
          onUpdateProject={onUpdateProject}
          onLocateInStudio={onLocateInStudio}
          onRelinkVideo={onRelinkVideo}
          isSaveModalOpen={isCompareSaveOpen}
          setIsSaveModalOpen={setIsCompareSaveOpen}
          onStatusNotice={setStatusNotice}
        />
      </div>
    </main>
  );
}
