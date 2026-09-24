import { memo } from "react";

export type StudioToolTab = "rhythm" | "framing" | "sequence" | "sound" | "cuts" | "cast" | "color";

interface StudioToolRailProps {
  activeTab: StudioToolTab;
  drawerOpen: boolean;
  onSelectTab: (tab: StudioToolTab) => void;
  onToggleDrawer: () => void;
}

export const TABS: { id: StudioToolTab; label: string }[] = [
  { id: "rhythm", label: "Rhythm" },
  { id: "framing", label: "Framing" },
  { id: "sequence", label: "Structure" },
  { id: "sound", label: "Sound" },
  { id: "cuts", label: "Cuts" },
  { id: "cast", label: "Cast" },
  { id: "color", label: "Color" },
];

export const StudioToolRail = memo(function StudioToolRail({
  activeTab,
  drawerOpen,
  onSelectTab,
  onToggleDrawer,
}: StudioToolRailProps) {
  const handleClick = (id: StudioToolTab) => {
    onSelectTab(id);
    if (!drawerOpen) {
      onToggleDrawer();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = TABS[(index + 1) % TABS.length];
      handleClick(next.id);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = TABS[(index - 1 + TABS.length) % TABS.length];
      handleClick(prev.id);
    }
  };

  return (
    <nav className="studio-tool-rail studio-tabs" role="tablist" aria-label="Analytical views">
      {TABS.map((tab, idx) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            id={`studio-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`studio-tabpanel-${tab.id}`}
            aria-label={tab.label}
            className={`studio-tab studio-rail-btn ${isActive ? "active" : ""}`}
            onClick={() => handleClick(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
          >
            {isActive && <span className="studio-tab-dot" aria-hidden="true" />}
            <span className="studio-tab-label">{tab.label}</span>
            {isActive && <span className="studio-tab-indicator" aria-hidden="true" />}
          </button>
        );
      })}
    </nav>
  );
});

export { StudioToolbar } from "./StudioToolbar";
export default StudioToolRail;
