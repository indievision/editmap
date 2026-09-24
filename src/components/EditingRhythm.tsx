import { memo, useState, useRef, useEffect, useCallback } from "react";
import type { Project, Shot } from "../models/project";
import Rhythm from "./Rhythm";
import LocalPacing from "./LocalPacing";
import AudiovisualRhythm from "./AudiovisualRhythm";
import MotionEnergyArc from "./MotionEnergyArc";
import ComparisonView from "./ComparisonView";
import type { MeasureId } from "../analysis/comparison";

const RHYTHM_TABS = ["duration", "pacing", "compare", "audiovisual", "motion"] as const;
type RhythmTabId = (typeof RHYTHM_TABS)[number];

const EditingRhythm = memo(function EditingRhythm({
  project,
  time,
  waveform,
  selected,
  url,
  onSelect,
  onSeek,
  onUpdateShots,
  onClose,
  variant = "deck",
  initialCompareMeasure,
  onClearInitialCompareMeasure,
  range,
  onRangeChange,
  onUpdateProject,
  isLoopingRange,
  onToggleLoopRange,
}: {
  project: Project;
  time: number;
  waveform: number[];
  selected?: string;
  url?: string;
  onSelect: (shot: Shot) => void;
  onSeek: (time: number) => void;
  onUpdateShots?: (shots: Shot[]) => void;
  onClose?: () => void;
  variant?: "deck" | "drawer";
  initialCompareMeasure?: MeasureId;
  onClearInitialCompareMeasure?: () => void;
  range?: { start?: number; end?: number };
  onRangeChange?: (range?: { start?: number; end?: number }) => void;
  onUpdateProject?: (patch: Partial<Project>) => void;
  isLoopingRange?: boolean;
  onToggleLoopRange?: (active?: boolean) => void;
}) {
  const [tab, setTab] = useState<RhythmTabId>(() => (initialCompareMeasure ? "compare" : "duration"));
  const [compareMeasure, setCompareMeasure] = useState<MeasureId | undefined>(initialCompareMeasure);

  useEffect(() => {
    if (initialCompareMeasure) {
      setCompareMeasure(initialCompareMeasure);
      setTab("compare");
      onClearInitialCompareMeasure?.();
    }
  }, [initialCompareMeasure, onClearInitialCompareMeasure]);

  const handleOpenCompare = useCallback((measure: MeasureId) => {
    setCompareMeasure(measure);
    setTab("compare");
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    if (variant === "drawer") return;
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, [variant]);

  useEffect(() => {
    if (variant === "drawer") return;
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    const handleScroll = () => checkScroll();
    el.addEventListener("scroll", handleScroll, { passive: true });
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(checkScroll);
    });
    resizeObserver.observe(el);
    if (el.parentElement) {
      resizeObserver.observe(el.parentElement);
    }
    return () => {
      el.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, [checkScroll, variant]);

  useEffect(() => {
    if (variant === "drawer") return;
    requestAnimationFrame(checkScroll);
  }, [tab, checkScroll, variant]);

  const scrollByAmount = (amount: number) => {
    scrollRef.current?.scrollBy({ left: amount, behavior: "smooth" });
  };

  const handleSelectTab = (selectedTab: RhythmTabId, e: React.MouseEvent<HTMLButtonElement>) => {
    setTab(selectedTab);
    if (selectedTab !== "compare") {
      onClearInitialCompareMeasure?.();
    }
    if (variant !== "drawer") {
      e.currentTarget.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (variant !== "drawer" && e.deltaY && scrollRef.current) {
      scrollRef.current.scrollLeft += e.deltaY;
    }
  };

  return (
    <section className={`editing-rhythm panel ${variant === "drawer" ? "editing-rhythm-drawer" : ""}`}>
      {variant === "drawer" ? (
        <>
          <div className="rhythm-drawer-head">
            <h2 className="rhythm-drawer-title">Editing rhythm</h2>
            {onClose && (
              <button
                type="button"
                className="studio-drawer-close-btn rhythm-drawer-close-btn"
                onClick={onClose}
                title="Close editing rhythm drawer (Esc)"
                aria-label="Close editing rhythm drawer"
              >
                ✕
              </button>
            )}
          </div>
          <div className="rhythm-tabs drawer-subtabs" role="tablist" aria-label="Editing rhythm views">
            <div className="rhythm-subtabs-wrap">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "duration"}
                aria-pressed={tab === "duration"}
                className={`rhythm-subtab-btn ${tab === "duration" ? "active" : ""}`}
                onClick={(e) => handleSelectTab("duration", e)}
              >
                Shot duration
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "pacing"}
                aria-pressed={tab === "pacing"}
                className={`rhythm-subtab-btn ${tab === "pacing" ? "active" : ""}`}
                onClick={(e) => handleSelectTab("pacing", e)}
              >
                Local pacing
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "compare"}
                aria-pressed={tab === "compare"}
                className={`rhythm-subtab-btn ${tab === "compare" ? "active" : ""}`}
                onClick={(e) => handleSelectTab("compare", e)}
              >
                Compare
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "audiovisual"}
                aria-pressed={tab === "audiovisual"}
                className={`rhythm-subtab-btn ${tab === "audiovisual" ? "active" : ""}`}
                onClick={(e) => handleSelectTab("audiovisual", e)}
              >
                Audiovisual
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "motion"}
                aria-pressed={tab === "motion"}
                className={`rhythm-subtab-btn ${tab === "motion" ? "active" : ""}`}
                onClick={(e) => handleSelectTab("motion", e)}
              >
                Motion energy
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="rhythm-tabs" aria-label="Editing rhythm views">
          <h2>Editing rhythm</h2>
          <div className="rhythm-tabs-nav">
            {canScrollLeft && (
              <button
                type="button"
                className="rhythm-tab-scroll-btn prev"
                onClick={() => scrollByAmount(-140)}
                title="Scroll tabs left"
                aria-label="Scroll tabs left"
              >
                ‹
              </button>
            )}
            <div
              ref={scrollRef}
              className={`rhythm-tabs-scroll-track ${canScrollLeft ? "fade-left" : ""} ${canScrollRight ? "fade-right" : ""}`}
              onWheel={handleWheel}
            >
              <button
                aria-pressed={tab === "duration"}
                onClick={(e) => handleSelectTab("duration", e)}
              >
                Shot duration
              </button>
              <button
                aria-pressed={tab === "pacing"}
                onClick={(e) => handleSelectTab("pacing", e)}
              >
                Local pacing
              </button>
              <button
                aria-pressed={tab === "compare"}
                onClick={(e) => handleSelectTab("compare", e)}
              >
                Compare
              </button>
              <button
                aria-pressed={tab === "audiovisual"}
                onClick={(e) => handleSelectTab("audiovisual", e)}
              >
                Audiovisual
              </button>
              <button
                aria-pressed={tab === "motion"}
                onClick={(e) => handleSelectTab("motion", e)}
              >
                Motion energy
              </button>
            </div>
            {canScrollRight && (
              <button
                type="button"
                className="rhythm-tab-scroll-btn next"
                onClick={() => scrollByAmount(140)}
                title="Scroll tabs right"
                aria-label="Scroll tabs right"
              >
                ›
              </button>
            )}
          </div>
        </div>
      )}
      <div hidden={tab !== "duration"}>
        <Rhythm shots={project.shots} selected={selected} onSelect={onSelect} />
      </div>
      <div hidden={tab !== "pacing"}>
        <LocalPacing
          project={project}
          time={time}
          onSeek={onSeek}
          onOpenCompare={handleOpenCompare}
        />
      </div>
      <div hidden={tab !== "compare"}>
        <ComparisonView
          project={project}
          time={time}
          initialMeasure={compareMeasure}
          onSeek={onSeek}
          onSelectShot={onSelect}
          range={range}
          onRangeChange={onRangeChange}
          onUpdateProject={onUpdateProject}
          isLooping={isLoopingRange}
          onToggleLoop={onToggleLoopRange}
        />
      </div>
      <div hidden={tab !== "audiovisual"}>
        <AudiovisualRhythm
          project={project}
          time={time}
          waveform={waveform}
          onSeek={onSeek}
        />
      </div>
      <div hidden={tab !== "motion"}>
        <MotionEnergyArc
          project={project}
          time={time}
          url={url}
          selected={selected}
          onSelect={onSelect}
          onUpdateShots={onUpdateShots}
          onOpenCompare={handleOpenCompare}
        />
      </div>
    </section>
  );
});


export default EditingRhythm;
