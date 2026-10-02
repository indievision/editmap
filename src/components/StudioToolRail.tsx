import { memo } from "react";

export type StudioToolTab = "rhythm" | "framing" | "sequence" | "sound" | "cuts" | "cast" | "color";

interface StudioToolRailProps {
  activeTab: StudioToolTab;
  drawerOpen: boolean;
  onSelectTab: (tab: StudioToolTab) => void;
  onToggleDrawer: () => void;
}

export const TABS: { id: StudioToolTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "rhythm",
    label: "Rhythm",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    id: "framing",
    label: "Framing",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
        <path d="M3 8V5a2 2 0 0 1 2-2h3" />
        <path d="M3 16v3a2 2 0 0 0 2 2h3" />
        <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
      </svg>
    ),
  },
  {
    id: "sequence",
    label: "Structure",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="9" y1="4" x2="9" y2="20" />
        <line x1="15" y1="4" x2="15" y2="20" />
      </svg>
    ),
  },
  {
    id: "sound",
    label: "Sound",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    ),
  },
  {
    id: "cuts",
    label: "Cuts",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <line x1="20" y1="4" x2="8.12" y2="15.88" />
        <line x1="14.47" y1="14.48" x2="20" y2="20" />
        <line x1="8.12" y1="8.12" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    id: "cast",
    label: "Cast",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: "color",
    label: "Color",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2a10 10 0 0 0-10 10c0 4.42 3.13 8 7 8 1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.9-.5-1.6 0-1.1.9-2 2-2h2.4c4 0 7.1-3.1 7.1-7 0-4.42-4.25-8-9.5-8z" />
        <circle cx="7.5" cy="9.5" r="1.5" fill="currentColor" />
        <circle cx="12" cy="7.5" r="1.5" fill="currentColor" />
        <circle cx="16.5" cy="9.5" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
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
            <span className="studio-tab-icon" aria-hidden="true">
              {tab.icon}
            </span>
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
