import React, { useRef, useState, useCallback, useEffect } from "react";

export interface ResizeHandleProps {
  direction: "col" | "row";
  onDrag: (delta: number) => void;
  onReset?: () => void;
  onToggleCollapse?: () => void;
  isCollapsed?: boolean;
  collapseIcon?: "left" | "right" | "up" | "down";
  label?: string;
  className?: string;
}

export default function ResizeHandle({
  direction,
  onDrag,
  onReset,
  onToggleCollapse,
  isCollapsed = false,
  collapseIcon,
  label = "Resize divider",
  className = "",
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef<number>(0);
  const handleRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only respond to primary mouse button
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    setIsDragging(true);
    startPosRef.current = direction === "col" ? e.clientX : e.clientY;
    document.body.style.cursor = direction === "col" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.preventDefault();
    e.stopPropagation();

    const currentPos = direction === "col" ? e.clientX : e.clientY;
    const delta = currentPos - startPosRef.current;
    if (delta !== 0) {
      onDrag(delta);
      startPosRef.current = currentPos;
    }
  };

  const stopDragging = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    stopDragging();
  };

  useEffect(() => {
    return () => {
      // Clean up body style if unmounted while dragging
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 30 : 10;
    if (direction === "col") {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onDrag(-step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onDrag(step);
      }
    } else {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        onDrag(-step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        onDrag(step);
      }
    }
  };

  const getChevron = () => {
    if (collapseIcon === "left") {
      return isCollapsed ? "▶" : "◀";
    }
    if (collapseIcon === "right") {
      return isCollapsed ? "◀" : "▶";
    }
    if (collapseIcon === "up") {
      return isCollapsed ? "▼" : "▲";
    }
    if (collapseIcon === "down") {
      return isCollapsed ? "▲" : "▼";
    }
    return isCollapsed ? "+" : "−";
  };

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation={direction === "col" ? "vertical" : "horizontal"}
      aria-label={label}
      tabIndex={0}
      className={`resize-handle resize-handle-${direction} ${isDragging ? "is-dragging" : ""} ${
        isCollapsed ? "is-collapsed" : ""
      } ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      title={isCollapsed ? "Collapsed (click arrow or double-click to restore)" : "Drag to resize · Double-click to reset"}
    >
      <div className="resize-line" />
      <div className="resize-grip">
        <span className="resize-grip-dots" />
      </div>

      {onToggleCollapse && (
        <button
          type="button"
          tabIndex={-1}
          className="resize-collapse-btn"
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          title={isCollapsed ? "Expand panel" : "Collapse panel"}
          aria-label={isCollapsed ? "Expand panel" : "Collapse panel"}
        >
          {getChevron()}
        </button>
      )}
    </div>
  );
}
