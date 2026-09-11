import { useState, useEffect, useCallback } from "react";
import type { WorkspaceMode } from "../components/ProjectHeader";

export interface ModeLayoutState {
  leftWidth: number;
  rightWidth: number;
  topHeightRatio: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export interface WorkspaceLayoutConfig {
  defaultLeftWidth: number;
  defaultRightWidth: number;
  defaultTopHeightRatio: number;
  minLeftWidth: number;
  maxLeftWidth: number;
  minRightWidth: number;
  maxRightWidth: number;
  minTopHeightRatio: number;
  maxTopHeightRatio: number;
}

const DEFAULT_CONFIGS: Record<WorkspaceMode, WorkspaceLayoutConfig> = {
  studio: {
    defaultLeftWidth: 380,
    defaultRightWidth: 360,
    defaultTopHeightRatio: 0.58,
    minLeftWidth: 240,
    maxLeftWidth: 700,
    minRightWidth: 260,
    maxRightWidth: 650,
    minTopHeightRatio: 0.25,
    maxTopHeightRatio: 0.82,
  },
  map: {
    defaultLeftWidth: 340,
    defaultRightWidth: 360,
    defaultTopHeightRatio: 0.38,
    minLeftWidth: 240,
    maxLeftWidth: 600,
    minRightWidth: 260,
    maxRightWidth: 650,
    minTopHeightRatio: 0.2,
    maxTopHeightRatio: 0.75,
  },
  review: {
    defaultLeftWidth: 340,
    defaultRightWidth: 380,
    defaultTopHeightRatio: 0.68,
    minLeftWidth: 240,
    maxLeftWidth: 650,
    minRightWidth: 280,
    maxRightWidth: 700,
    minTopHeightRatio: 0.3,
    maxTopHeightRatio: 0.85,
  },
};

const STORAGE_KEY = "editmap_workspace_layout_v1";

function loadSavedLayouts(): Record<WorkspaceMode, Partial<ModeLayoutState>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {} as Record<WorkspaceMode, Partial<ModeLayoutState>>;
    return JSON.parse(raw);
  } catch {
    return {} as Record<WorkspaceMode, Partial<ModeLayoutState>>;
  }
}

function saveLayouts(layouts: Record<WorkspaceMode, Partial<ModeLayoutState>>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // ignore storage errors
  }
}

export function useWorkspaceLayout(mode: WorkspaceMode) {
  const config = DEFAULT_CONFIGS[mode] || DEFAULT_CONFIGS.studio;

  const [layouts, setLayouts] = useState<Record<WorkspaceMode, ModeLayoutState>>(() => {
    const saved = loadSavedLayouts();
    const result = {} as Record<WorkspaceMode, ModeLayoutState>;
    (Object.keys(DEFAULT_CONFIGS) as WorkspaceMode[]).forEach((m) => {
      const c = DEFAULT_CONFIGS[m];
      const s = saved[m] || {};
      result[m] = {
        leftWidth: typeof s.leftWidth === "number" ? Math.max(c.minLeftWidth, Math.min(c.maxLeftWidth, s.leftWidth)) : c.defaultLeftWidth,
        rightWidth: typeof s.rightWidth === "number" ? Math.max(c.minRightWidth, Math.min(c.maxRightWidth, s.rightWidth)) : c.defaultRightWidth,
        topHeightRatio: typeof s.topHeightRatio === "number" ? Math.max(c.minTopHeightRatio, Math.min(c.maxTopHeightRatio, s.topHeightRatio)) : c.defaultTopHeightRatio,
        leftCollapsed: Boolean(s.leftCollapsed),
        rightCollapsed: Boolean(s.rightCollapsed),
      };
    });
    return result;
  });

  const current = layouts[mode] || {
    leftWidth: config.defaultLeftWidth,
    rightWidth: config.defaultRightWidth,
    topHeightRatio: config.defaultTopHeightRatio,
    leftCollapsed: false,
    rightCollapsed: false,
  };

  // Persist whenever layouts change
  useEffect(() => {
    saveLayouts(layouts);
  }, [layouts]);

  const updateCurrentMode = useCallback(
    (updater: (prev: ModeLayoutState) => ModeLayoutState) => {
      setLayouts((all) => {
        const prevModeState = all[mode] || {
          leftWidth: config.defaultLeftWidth,
          rightWidth: config.defaultRightWidth,
          topHeightRatio: config.defaultTopHeightRatio,
          leftCollapsed: false,
          rightCollapsed: false,
        };
        const updated = updater(prevModeState);
        return { ...all, [mode]: updated };
      });
    },
    [mode, config],
  );

  const resizeLeft = useCallback(
    (delta: number) => {
      updateCurrentMode((prev) => {
        const nextWidth = Math.max(
          config.minLeftWidth,
          Math.min(config.maxLeftWidth, (prev.leftCollapsed ? config.minLeftWidth : prev.leftWidth) + delta),
        );
        return {
          ...prev,
          leftWidth: nextWidth,
          leftCollapsed: false,
        };
      });
    },
    [config, updateCurrentMode],
  );

  const resizeRight = useCallback(
    (delta: number) => {
      updateCurrentMode((prev) => {
        // Dragging right handle to the left increases right panel width, dragging right decreases it
        const nextWidth = Math.max(
          config.minRightWidth,
          Math.min(config.maxRightWidth, (prev.rightCollapsed ? config.minRightWidth : prev.rightWidth) - delta),
        );
        return {
          ...prev,
          rightWidth: nextWidth,
          rightCollapsed: false,
        };
      });
    },
    [config, updateCurrentMode],
  );

  const resizeTopRatio = useCallback(
    (ratioDelta: number) => {
      updateCurrentMode((prev) => {
        const nextRatio = Math.max(
          config.minTopHeightRatio,
          Math.min(config.maxTopHeightRatio, prev.topHeightRatio + ratioDelta),
        );
        return {
          ...prev,
          topHeightRatio: nextRatio,
        };
      });
    },
    [config, updateCurrentMode],
  );

  const resizeTopPixels = useCallback(
    (pixelDelta: number, containerHeight: number) => {
      if (!containerHeight || containerHeight <= 0) return;
      const ratioDelta = pixelDelta / containerHeight;
      updateCurrentMode((prev) => {
        const nextRatio = Math.max(
          config.minTopHeightRatio,
          Math.min(config.maxTopHeightRatio, prev.topHeightRatio + ratioDelta),
        );
        return {
          ...prev,
          topHeightRatio: nextRatio,
        };
      });
    },
    [config, updateCurrentMode],
  );

  const toggleLeftCollapse = useCallback(() => {
    updateCurrentMode((prev) => ({
      ...prev,
      leftCollapsed: !prev.leftCollapsed,
    }));
  }, [updateCurrentMode]);

  const toggleRightCollapse = useCallback(() => {
    updateCurrentMode((prev) => ({
      ...prev,
      rightCollapsed: !prev.rightCollapsed,
    }));
  }, [updateCurrentMode]);

  const resetLeftWidth = useCallback(() => {
    updateCurrentMode((prev) => ({
      ...prev,
      leftWidth: config.defaultLeftWidth,
      leftCollapsed: false,
    }));
  }, [config, updateCurrentMode]);

  const resetRightWidth = useCallback(() => {
    updateCurrentMode((prev) => ({
      ...prev,
      rightWidth: config.defaultRightWidth,
      rightCollapsed: false,
    }));
  }, [config, updateCurrentMode]);

  const resetTopHeightRatio = useCallback(() => {
    updateCurrentMode((prev) => ({
      ...prev,
      topHeightRatio: config.defaultTopHeightRatio,
    }));
  }, [config, updateCurrentMode]);

  const resetAll = useCallback(() => {
    updateCurrentMode(() => ({
      leftWidth: config.defaultLeftWidth,
      rightWidth: config.defaultRightWidth,
      topHeightRatio: config.defaultTopHeightRatio,
      leftCollapsed: false,
      rightCollapsed: false,
    }));
  }, [config, updateCurrentMode]);

  return {
    leftWidth: current.leftWidth,
    rightWidth: current.rightWidth,
    topHeightRatio: current.topHeightRatio,
    leftCollapsed: current.leftCollapsed,
    rightCollapsed: current.rightCollapsed,
    resizeLeft,
    resizeRight,
    resizeTopRatio,
    resizeTopPixels,
    toggleLeftCollapse,
    toggleRightCollapse,
    resetLeftWidth,
    resetRightWidth,
    resetTopHeightRatio,
    resetAll,
  };
}
