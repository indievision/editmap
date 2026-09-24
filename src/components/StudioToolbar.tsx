import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { StudioToolTab } from "./StudioToolRail";

export interface StudioToolbarProps {
  activeTab?: StudioToolTab;
  drawerOpen?: boolean;
  onSelectTab?: (tab: StudioToolTab) => void;
  onToggleDrawer?: () => void;
  expanded?: boolean;
  onSplit: () => void;
  onMark: () => void;
  snapToCuts: boolean;
  onToggleSnap: () => void;
  squintMode: boolean;
  onToggleSquint: (active?: boolean) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onFullscreen?: () => void;
}

interface ToolbarButtonProps {
  id?: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
  activeVariant?: "default" | "snap";
  disabled?: boolean;
  className?: string;
  role?: string;
  ariaLabel?: string;
  ariaPressed?: boolean;
  ariaSelected?: boolean;
}

const ToolbarButton = memo(function ToolbarButton({
  id,
  label,
  icon,
  onClick,
  isActive = false,
  activeVariant = "default",
  disabled = false,
  className = "",
  role = "button",
  ariaLabel,
  ariaPressed,
  ariaSelected,
}: ToolbarButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePointerEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setShowTooltip(true);
    }, 800);
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShowTooltip(false);
  }, []);

  const handleFocus = useCallback(() => {
    setShowTooltip(true);
  }, []);

  const handleBlur = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShowTooltip(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const variantClass = isActive
    ? activeVariant === "snap"
      ? "active-snap"
      : "active"
    : "";

  return (
    <div className="studio-toolbar-btn-wrap">
      <button
        id={id}
        type="button"
        role={role}
        className={`studio-toolbar-btn ${variantClass} ${className}`}
        onClick={onClick}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        disabled={disabled}
        aria-label={ariaLabel || label}
        aria-pressed={ariaPressed}
        aria-selected={ariaSelected}
      >
        {icon}
      </button>
      {showTooltip && (
        <div className="studio-toolbar-tooltip" role="tooltip">
          {label}
        </div>
      )}
    </div>
  );
});

const ANALYTICAL_TOOLS: Array<{
  id: StudioToolTab;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    id: "rhythm",
    label: "Rhythm",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="3" y="11" width="2.8" height="10" rx="1.4" />
        <rect x="7.3" y="6" width="2.8" height="15" rx="1.4" />
        <rect x="11.6" y="2" width="2.8" height="19" rx="1.4" />
        <rect x="15.9" y="8" width="2.8" height="13" rx="1.4" />
        <rect x="20.2" y="13" width="2.8" height="8" rx="1.4" />
      </svg>
    ),
  },
  {
    id: "framing",
    label: "Framing",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 8V4h4" />
        <path d="M20 8V4h-4" />
        <path d="M4 16v4h4" />
        <path d="M20 16v4h-4" />
      </svg>
    ),
  },
  {
    id: "sequence",
    label: "Structure",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <line x1="3" y1="6" x2="21" y2="6" strokeOpacity="0.4" />
        <rect x="7" y="4" width="10" height="4" rx="2" fill="currentColor" stroke="none" />
        <line x1="3" y1="12" x2="21" y2="12" strokeOpacity="0.4" />
        <rect x="5" y="10" width="10" height="4" rx="2" fill="currentColor" stroke="none" />
        <line x1="3" y1="18" x2="21" y2="18" strokeOpacity="0.4" />
        <rect x="9" y="16" width="10" height="4" rx="2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "sound",
    label: "Sound",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="3" y="10" width="2" height="4" rx="1" />
        <rect x="6.5" y="7" width="2" height="10" rx="1" />
        <rect x="10" y="4" width="2" height="16" rx="1" />
        <rect x="12" y="3" width="2" height="18" rx="1" />
        <rect x="15.5" y="7" width="2" height="10" rx="1" />
        <rect x="19" y="10" width="2" height="4" rx="1" />
      </svg>
    ),
  },
  {
    id: "cuts",
    label: "Cuts",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="8" x2="21" y2="8" />
        <line x1="3" y1="16" x2="21" y2="16" />
        <line x1="8" y1="3" x2="8" y2="8" />
        <line x1="16" y1="3" x2="16" y2="8" />
        <line x1="8" y1="16" x2="8" y2="21" />
        <line x1="16" y1="16" x2="16" y2="21" />
        <line x1="2" y1="22" x2="22" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
      </svg>
    ),
  },
  {
    id: "cast",
    label: "Cast",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        <path d="M4.5 10c1.38 0 2.5-1.12 2.5-2.5S5.88 5 4.5 5 2 6.12 2 7.5 3.12 10 4.5 10zm0 1.5C2.83 11.5 0 12.34 0 14v1.5h4.15A5.94 5.94 0 0 1 4 14c0-.88.18-1.71.5-2.5z" opacity="0.75" />
        <path d="M19.5 10c1.38 0 2.5-1.12 2.5-2.5S20.88 5 19.5 5 17 6.12 17 7.5s1.12 2.5 2.5 2.5zm0 1.5c.32.79.5 1.62.5 2.5 0 .52-.06 1.02-.15 1.5H24V14c0-1.66-2.83-2.5-4.5-2.5z" opacity="0.75" />
      </svg>
    ),
  },
  {
    id: "color",
    label: "Colour",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="8" r="4.5" />
        <circle cx="8" cy="15" r="4.5" />
        <circle cx="16" cy="15" r="4.5" />
      </svg>
    ),
  },
];

export const StudioToolbar = memo(function StudioToolbar({
  activeTab = "rhythm",
  drawerOpen = true,
  onSelectTab,
  onToggleDrawer,
  expanded = false,
  onSplit,
  onMark,
  snapToCuts,
  onToggleSnap,
  squintMode,
  onToggleSquint,
  zoom,
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onFit,
  onFullscreen,
}: StudioToolbarProps) {
  // Tools menu state for expanded Studio
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toolsOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setToolsOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [toolsOpen]);

  const handleSelectTool = (id: StudioToolTab) => {
    if (activeTab === id && drawerOpen) {
      onToggleDrawer?.();
    } else {
      onSelectTab?.(id);
      if (!drawerOpen) {
        onToggleDrawer?.();
      }
    }
    setToolsOpen(false);
  };

  // Zoom slider tooltip state
  const [sliderTooltip, setSliderTooltip] = useState(false);
  const sliderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSliderEnter = () => {
    if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
    sliderTimerRef.current = setTimeout(() => {
      setSliderTooltip(true);
    }, 800);
  };

  const handleSliderLeave = () => {
    if (sliderTimerRef.current) {
      clearTimeout(sliderTimerRef.current);
      sliderTimerRef.current = null;
    }
    setSliderTooltip(false);
  };

  useEffect(() => {
    return () => {
      if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
    };
  }, []);

  return (
    <div
      className="studio-toolbar-row"
      role="toolbar"
      aria-label="Studio timeline toolbar"
    >
      {/* Left group: [Tools (expanded Studio only)] Split, Mark, Snap, Squint */}
      <div className="studio-toolbar-group studio-toolbar-editorial" role="group" aria-label="Editorial actions">
        {expanded && (
          <div ref={toolsMenuRef} className="studio-toolbar-tools-menu-wrap">
            <button
              id="studio-tools-menu-btn"
              type="button"
              className={`studio-toolbar-btn studio-toolbar-tools-btn ${toolsOpen || (drawerOpen && activeTab) ? "active" : ""}`}
              onClick={() => setToolsOpen((prev) => !prev)}
              aria-label="Analytical tools"
              aria-haspopup="menu"
              aria-expanded={toolsOpen}
            >
              <span>Tools</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points={toolsOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
              </svg>
            </button>
            {toolsOpen && (
              <div className="studio-toolbar-tools-popover" role="menu" aria-label="Analytical tools">
                {ANALYTICAL_TOOLS.map((tool) => {
                  const isActive = drawerOpen && activeTab === tool.id;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      role="menuitem"
                      className={`studio-tools-menu-item ${isActive ? "active" : ""}`}
                      onClick={() => handleSelectTool(tool.id)}
                      aria-label={tool.label}
                    >
                      <span className="studio-tools-menu-icon">{tool.icon}</span>
                      <span className="studio-tools-menu-label">{tool.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Split */}
        <ToolbarButton
          id="studio-action-split"
          label="Split"
          ariaLabel="Split shot at current frame (C)"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <line x1="20" y1="4" x2="8.12" y2="15.88" />
              <line x1="14.47" y1="14.48" x2="20" y2="20" />
              <line x1="8.12" y1="8.12" x2="12" y2="12" />
            </svg>
          }
          onClick={onSplit}
        />

        {/* Mark */}
        <ToolbarButton
          id="studio-action-mark"
          label="Mark"
          ariaLabel="Add marker at current frame (M)"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 3h12a1 1 0 0 1 1 1v13.5a.5.5 0 0 1-.82.38L12 14.5l-6.18 3.38A.5.5 0 0 1 5 17.5V4a1 1 0 0 1 1-1z" />
              <polygon points="12,18 14.5,20.5 12,23 9.5,20.5" />
            </svg>
          }
          onClick={onMark}
        />

        {/* Snap */}
        <ToolbarButton
          id="studio-action-snap"
          label="Snap"
          ariaLabel={`Snap to cut boundaries: ${snapToCuts ? "ON" : "OFF"} (S)`}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
              <path d="M8 5C5.8 7 4.5 9.8 4.5 12s1.3 5 3.5 7" />
              <path d="M16 5c2.2 2 3.5 4.8 3.5 7s-1.3 5-3.5 7" />
            </svg>
          }
          isActive={snapToCuts}
          activeVariant="snap"
          onClick={onToggleSnap}
          ariaPressed={snapToCuts}
        />

        {/* Squint */}
        <ToolbarButton
          id="studio-action-squint"
          label="Squint"
          ariaLabel="Toggle Squint Mode"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" fill="currentColor" />
            </svg>
          }
          isActive={squintMode}
          onClick={() => onToggleSquint(!squintMode)}
          ariaPressed={squintMode}
        />
      </div>

      {/* Navigation group (right-aligned) */}
      <div className="studio-toolbar-group studio-toolbar-nav" role="group" aria-label="Timeline navigation">
        {/* Zoom out */}
        <ToolbarButton
          id="studio-nav-zoom-out"
          label="Zoom out"
          ariaLabel="Zoom out (Q)"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16" y2="16" />
              <line x1="8" y1="11" x2="14" y2="11" strokeWidth="2.5" />
            </svg>
          }
          onClick={onZoomOut}
        />

        {/* Zoom slider */}
        <div
          className="studio-toolbar-slider-wrap"
          onPointerEnter={handleSliderEnter}
          onPointerLeave={handleSliderLeave}
        >
          <input
            type="range"
            className="studio-zoom-slider"
            min="0"
            max="6"
            step="0.05"
            value={Math.log2(zoom)}
            onChange={(e) => onZoomChange(Math.pow(2, Number(e.target.value)))}
            aria-label="Timeline zoom slider"
            aria-valuenow={zoom}
            aria-valuetext={`${zoom.toFixed(1)}×`}
            onFocus={() => setSliderTooltip(true)}
            onBlur={() => setSliderTooltip(false)}
          />
          {sliderTooltip && (
            <div className="studio-toolbar-tooltip" role="tooltip">
              Zoom
            </div>
          )}
        </div>

        {/* Zoom in */}
        <ToolbarButton
          id="studio-nav-zoom-in"
          label="Zoom in"
          ariaLabel="Zoom in (W)"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16" y2="16" />
              <line x1="11" y1="8" x2="11" y2="14" strokeWidth="2.5" />
              <line x1="8" y1="11" x2="14" y2="11" strokeWidth="2.5" />
            </svg>
          }
          onClick={onZoomIn}
        />

        {/* Fit */}
        <ToolbarButton
          id="studio-nav-fit"
          label="Fit"
          ariaLabel="Fit timeline overview (F)"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="5" x2="3" y2="19" strokeWidth="2.5" />
              <line x1="21" y1="5" x2="21" y2="19" strokeWidth="2.5" />
              <polyline points="7 9 4 12 7 15" />
              <polyline points="17 9 20 12 17 15" />
              <line x1="4" y1="12" x2="20" y2="12" />
            </svg>
          }
          onClick={onFit}
        />

        {/* Full screen */}
        <ToolbarButton
          id="studio-nav-fullscreen"
          label="Full screen"
          ariaLabel="Full screen visualization"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 8V4a1 1 0 0 1 1-1h4" />
              <path d="M16 3h4a1 1 0 0 1 1 1v4" />
              <path d="M21 16v4a1 1 0 0 1-1 1h-4" />
              <path d="M8 21H4a1 1 0 0 1-1-1v-4" />
              <line x1="10" y1="9" x2="10" y2="15" strokeDasharray="2 2" strokeWidth="1.8" />
              <line x1="14" y1="9" x2="14" y2="15" strokeDasharray="2 2" strokeWidth="1.8" />
            </svg>
          }
          onClick={() => onFullscreen?.()}
        />
      </div>
    </div>
  );
});

export default StudioToolbar;
