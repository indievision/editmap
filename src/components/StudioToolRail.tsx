import { memo } from "react";

export type StudioToolTab = "rhythm" | "sequence" | "cuts" | "cast" | "color";

interface StudioToolRailProps {
  activeTab: StudioToolTab;
  drawerOpen: boolean;
  onSelectTab: (tab: StudioToolTab) => void;
  onToggleDrawer: () => void;
}

export const StudioToolRail = memo(function StudioToolRail({
  activeTab,
  drawerOpen,
  onSelectTab,
  onToggleDrawer,
}: StudioToolRailProps) {
  const tools: { id: StudioToolTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "rhythm",
      label: "Rhythm",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="2" x2="12" y2="22" />
          <line x1="8" y1="6" x2="8" y2="18" />
          <line x1="4" y1="10" x2="4" y2="14" />
          <line x1="16" y1="5" x2="16" y2="19" />
          <line x1="20" y1="9" x2="20" y2="15" />
        </svg>
      ),
    },
    {
      id: "sequence",
      label: "Structure",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <rect x="3" y="10" width="12" height="4" rx="1" />
          <rect x="3" y="16" width="15" height="4" rx="1" />
        </svg>
      ),
    },
    {
      id: "cuts",
      label: "Cuts",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      id: "color",
      label: "Color",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="7" r="4" />
          <circle cx="7" cy="16" r="4" />
          <circle cx="17" cy="16" r="4" />
        </svg>
      ),
    },
  ];

  const handleClick = (id: StudioToolTab) => {
    if (activeTab === id) {
      onToggleDrawer();
    } else {
      onSelectTab(id);
      if (!drawerOpen) {
        onToggleDrawer();
      }
    }
  };

  return (
    <aside className="studio-tool-rail" role="tablist" aria-label="Studio tools">
      <div className="studio-rail-group">
        {tools.map((tool) => {
          const isActive = activeTab === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={tool.label}
              title={`${tool.label} (${isActive && drawerOpen ? "Click to close drawer" : "Click to view analytical details"})`}
              className={`studio-rail-btn ${isActive ? "active" : ""} ${isActive && drawerOpen ? "drawer-expanded" : ""}`}
              onClick={() => handleClick(tool.id)}
            >
              <span className="studio-rail-icon">{tool.icon}</span>
              <span className="studio-rail-label">{tool.label}</span>
              {isActive && drawerOpen && <span className="active-pip" />}
            </button>
          );
        })}
      </div>
    </aside>
  );
});

export default StudioToolRail;
