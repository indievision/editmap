import { memo, useState, useCallback, useRef, useEffect } from "react";
import type { Project, Shot } from "../models/project";
import FramingSummary from "./FramingSummary";
import FramingArc from "./FramingArc";

export type FramingSubsection = "distribution" | "progression";

export interface FramingDrawerProps {
  project: Project;
  time: number;
  selected?: string;
  onSelect: (shot: Shot) => void;
  onSeek?: (time: number) => void;
  onClose?: () => void;
  variant?: "deck" | "drawer";
  initialSubsection?: FramingSubsection;
  onSubsectionChange?: (section: FramingSubsection) => void;
}

export const FramingDrawer = memo(function FramingDrawer({
  project,
  time,
  selected,
  onSelect,
  onSeek,
  onClose,
  variant = "drawer",
  initialSubsection = "distribution",
  onSubsectionChange,
}: FramingDrawerProps) {
  const [tab, setTab] = useState<FramingSubsection>(initialSubsection);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSelectTab = useCallback(
    (selectedTab: FramingSubsection, e?: React.MouseEvent<HTMLButtonElement>) => {
      setTab(selectedTab);
      onSubsectionChange?.(selectedTab);
      if (variant !== "drawer" && e) {
        e.currentTarget.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }
    },
    [variant, onSubsectionChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent, currentTab: FramingSubsection) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next: FramingSubsection = currentTab === "distribution" ? "progression" : "distribution";
      handleSelectTab(next);
      const nextBtnId =
        variant === "drawer"
          ? next === "distribution"
            ? "framing-subtab-distribution"
            : "framing-subtab-progression"
          : next === "distribution"
            ? "framing-deck-subtab-distribution"
            : "framing-deck-subtab-progression";
      document.getElementById(nextBtnId)?.focus();
    }
  };

  useEffect(() => {
    // If an invalid tab is passed or loaded, gracefully ensure valid tab
    if (tab !== "distribution" && tab !== "progression") {
      setTab("distribution");
    }
  }, [tab]);

  return (
    <section className={`framing-panel panel ${variant === "drawer" ? "framing-drawer" : ""}`}>
      {variant === "drawer" ? (
        <div className="rhythm-tabs drawer-subtabs framing-tabs" role="tablist" aria-label="Framing views">
          <div className="rhythm-subtabs-wrap">
            <button
              type="button"
              role="tab"
              id="framing-subtab-distribution"
              aria-controls="framing-panel-distribution"
              aria-selected={tab === "distribution"}
              aria-pressed={tab === "distribution"}
              className={`rhythm-subtab-btn framing-subtab-btn ${tab === "distribution" ? "active" : ""}`}
              onClick={(e) => handleSelectTab("distribution", e)}
              onKeyDown={(e) => handleKeyDown(e, "distribution")}
            >
              Distribution
            </button>
            <button
              type="button"
              role="tab"
              id="framing-subtab-progression"
              aria-controls="framing-panel-progression"
              aria-selected={tab === "progression"}
              aria-pressed={tab === "progression"}
              className={`rhythm-subtab-btn framing-subtab-btn ${tab === "progression" ? "active" : ""}`}
              onClick={(e) => handleSelectTab("progression", e)}
              onKeyDown={(e) => handleKeyDown(e, "progression")}
            >
              Progression
            </button>
          </div>
          {onClose && (
            <button
              type="button"
              className="studio-drawer-close-btn framing-drawer-close-btn"
              onClick={onClose}
              title="Close framing drawer (Esc)"
              aria-label="Close framing drawer"
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        <div className="rhythm-tabs framing-tabs" aria-label="Framing views">
          <div className="rhythm-tabs-nav">
            <div
              ref={scrollRef}
              className="rhythm-tabs-scroll-track"
              role="tablist"
              aria-label="Framing views"
            >
              <button
                type="button"
                role="tab"
                id="framing-deck-subtab-distribution"
                aria-controls="framing-panel-distribution"
                aria-selected={tab === "distribution"}
                aria-pressed={tab === "distribution"}
                className={tab === "distribution" ? "active" : ""}
                onClick={(e) => handleSelectTab("distribution", e)}
                onKeyDown={(e) => handleKeyDown(e, "distribution")}
              >
                Distribution
              </button>
              <button
                type="button"
                role="tab"
                id="framing-deck-subtab-progression"
                aria-controls="framing-panel-progression"
                aria-selected={tab === "progression"}
                aria-pressed={tab === "progression"}
                className={tab === "progression" ? "active" : ""}
                onClick={(e) => handleSelectTab("progression", e)}
                onKeyDown={(e) => handleKeyDown(e, "progression")}
              >
                Progression
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        id="framing-panel-distribution"
        role="tabpanel"
        aria-labelledby={variant === "drawer" ? "framing-subtab-distribution" : "framing-deck-subtab-distribution"}
        hidden={tab !== "distribution"}
      >
        <FramingSummary shots={project.shots} />
      </div>

      <div
        id="framing-panel-progression"
        role="tabpanel"
        aria-labelledby={variant === "drawer" ? "framing-subtab-progression" : "framing-deck-subtab-progression"}
        hidden={tab !== "progression"}
      >
        <FramingArc
          project={project}
          time={time}
          selected={selected}
          onSelect={onSelect}
          onSeek={onSeek}
        />
      </div>
    </section>
  );
});

export default FramingDrawer;
