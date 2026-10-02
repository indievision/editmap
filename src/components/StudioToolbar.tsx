import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { StudioToolTab } from "./StudioToolRail";

export interface StudioToolbarProps {
  activeTab?: StudioToolTab;
  drawerOpen?: boolean;
  onSelectTab?: (tab: StudioToolTab) => void;
  onToggleDrawer?: () => void;
  expanded?: boolean;
  onSplit: () => void;
  onMerge?: () => void;
  snapToCuts: boolean;
  onToggleSnap: () => void;
  onMarkIn?: () => void;
  onMarkOut?: () => void;
  onClearInOut?: () => void;
  onMark: () => void;
  squintMode: boolean;
  onToggleSquint: (active?: boolean) => void;
  onFit: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
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
    }, 500);
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
    if (!showTooltip) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowTooltip(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showTooltip]);

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

export const StudioToolbar = memo(function StudioToolbar({
  onSplit,
  onMerge,
  snapToCuts,
  onToggleSnap,
  onMarkIn,
  onMarkOut,
  onClearInOut,
  onMark,
  squintMode,
  onToggleSquint,
  onFit,
  zoom,
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onFullscreen,
}: StudioToolbarProps) {
  // Zoom slider tooltip state
  const [sliderTooltip, setSliderTooltip] = useState(false);
  const sliderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSliderEnter = () => {
    if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
    sliderTimerRef.current = setTimeout(() => {
      setSliderTooltip(true);
    }, 500);
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
      {/* Centered toolbar items: Split, Merge, In, Out, Clear In/Out, Snap, Mark, Squint, Fit, - [slider] +, Fullscreen */}
      <div
        className="studio-toolbar-center-group"
        role="group"
        aria-label="Timeline editing and navigation controls"
      >
        {/* 1. Split */}
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

        {/* 2. Merge (after split) */}
        <ToolbarButton
          id="studio-action-merge"
          label="Merge"
          ariaLabel="Merge adjacent shots at cut boundary (Del)"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="4" x2="12" y2="20" strokeDasharray="1 1" strokeWidth="1.8" />
              <polyline points="6 8 10 12 6 16" />
              <polyline points="18 8 14 12 18 16" />
              <line x1="2" y1="12" x2="10" y2="12" />
              <line x1="22" y1="12" x2="14" y2="12" />
            </svg>
          }
          onClick={() => onMerge?.()}
        />

        {/* 3. In */}
        <ToolbarButton
          id="studio-action-in"
          label="In"
          ariaLabel="Mark In point (I)"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 4H8v16h8" />
            </svg>
          }
          onClick={() => onMarkIn?.()}
        />

        {/* 4. Out */}
        <ToolbarButton
          id="studio-action-out"
          label="Out"
          ariaLabel="Mark Out point (O)"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 4h8v16H8" />
            </svg>
          }
          onClick={() => onMarkOut?.()}
        />

        {/* 5. Clear In Out */}
        <ToolbarButton
          id="studio-action-clear-in-out"
          label="Clear"
          ariaLabel="Clear In and Out points (Alt+X)"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 5H3v14h3" />
              <path d="M18 5h3v14h-3" />
              <line x1="9" y1="9" x2="15" y2="15" />
              <line x1="15" y1="9" x2="9" y2="15" />
            </svg>
          }
          onClick={() => onClearInOut?.()}
        />

        {/* 6. Snap (before marker) */}
        <ToolbarButton
          id="studio-action-snap"
          label="Snap"
          ariaLabel={`Snap to cut boundaries: ${snapToCuts ? "ON" : "OFF"} (S)`}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 4v7a8 8 0 0 0 16 0V4h-4.5v7a3.5 3.5 0 0 1-7 0V4H4z" />
              <line x1="4" y1="8" x2="8.5" y2="8" />
              <line x1="15.5" y1="8" x2="20" y2="8" />
            </svg>
          }
          isActive={snapToCuts}
          activeVariant="snap"
          onClick={onToggleSnap}
          ariaPressed={snapToCuts}
        />

        {/* 7. Marker */}
        <ToolbarButton
          id="studio-action-mark"
          label="Marker"
          ariaLabel="Add marker at current frame (M)"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 3h12a1 1 0 0 1 1 1v13.5a.5.5 0 0 1-.82.38L12 14.5l-6.18 3.38A.5.5 0 0 1 5 17.5V4a1 1 0 0 1 1-1z" />
              <polygon points="12,18 14.5,20.5 12,23 9.5,20.5" />
            </svg>
          }
          onClick={onMark}
        />

        {/* 7. Squint */}
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

        {/* 8. Fit */}
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

        {/* 9. Zoom - (simple unboxed minus glyph) */}
        <ToolbarButton
          id="studio-nav-zoom-out"
          label="Zoom-"
          ariaLabel="Zoom out (Q)"
          className="studio-toolbar-zoom-glyph"
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          }
          onClick={onZoomOut}
        />

        {/* 10. Zoom slider */}
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

        {/* 11. Zoom + (simple unboxed plus glyph) */}
        <ToolbarButton
          id="studio-nav-zoom-in"
          label="Zoom+"
          ariaLabel="Zoom in (W)"
          className="studio-toolbar-zoom-glyph"
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          }
          onClick={onZoomIn}
        />

        {/* 12. Fullscreen for graphs visualization */}
        <ToolbarButton
          id="studio-nav-fullscreen"
          label="Fullscreen"
          ariaLabel="Full screen graph visualization"
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
