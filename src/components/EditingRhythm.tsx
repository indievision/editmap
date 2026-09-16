import { memo, useState, useRef, useEffect, useCallback } from "react";
import type { Project, Shot } from "../models/project";
import Rhythm from "./Rhythm";
import LocalPacing from "./LocalPacing";
import FramingSummary from "./FramingSummary";
import FramingArc from "./FramingArc";
import AudiovisualRhythm from "./AudiovisualRhythm";
import MotionEnergyArc from "./MotionEnergyArc";

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
}) {
  const [tab, setTab] = useState("duration");
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

  const handleSelectTab = (selectedTab: string, e: React.MouseEvent<HTMLButtonElement>) => {
    setTab(selectedTab);
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
              <button
                type="button"
                role="tab"
                aria-selected={tab === "summary"}
                aria-pressed={tab === "summary"}
                className={`rhythm-subtab-btn ${tab === "summary" ? "active" : ""}`}
                onClick={(e) => handleSelectTab("summary", e)}
              >
                Framing summary
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "arc"}
                aria-pressed={tab === "arc"}
                className={`rhythm-subtab-btn ${tab === "arc" ? "active" : ""}`}
                onClick={(e) => handleSelectTab("arc", e)}
              >
                Framing arc
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
              <button
                aria-pressed={tab === "summary"}
                onClick={(e) => handleSelectTab("summary", e)}
              >
                Framing summary
              </button>
              <button
                aria-pressed={tab === "arc"}
                onClick={(e) => handleSelectTab("arc", e)}
              >
                Framing arc
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
        <LocalPacing project={project} time={time} onSeek={onSeek} />
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
        />
      </div>
      <div hidden={tab !== "summary"}>
        <FramingSummary shots={project.shots} />
      </div>
      <div hidden={tab !== "arc"}>
        <FramingArc
          project={project}
          time={time}
          selected={selected}
          onSelect={onSelect}
        />
      </div>
    </section>
  );
});


export default EditingRhythm;
