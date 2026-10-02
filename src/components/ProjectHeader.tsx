import { useState, useRef, useEffect } from "react";
import type { Project } from "../models/project";

export type WorkspaceMode = "screening" | "review" | "studio" | "explore";

export default function ProjectHeader({
  project,
  dirty,
  saveState,
  historyState,
  workspaceMode,
  onModeChange,
  onNew,
  onOpen,
  onSave,
  onUndo,
  onRedo,
  onImportVideo,
  onImportEdl,
  onImportProject,
  onExportProject,
  onExportPDF,
  onExportEdlMarkers,
  onAnalyze,
  isAnalyzing,
  hasVideo,
  onProjectNameChange,
  onHome,
  onOpenSettings,
  onOpenProjector,
  isScreeningSetup = false,
  showChangeFilm = false,
  onChangeFilm,
}: {
  project: Project | null;
  dirty: boolean;
  saveState: string;
  historyState?: { undo: number; redo: number };
  workspaceMode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onImportVideo: () => void;
  onImportEdl: () => void;
  onImportProject: () => void;
  onExportProject: () => void;
  onExportPDF: () => void;
  onExportEdlMarkers?: () => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  hasVideo: boolean;
  onProjectNameChange?: (name: string) => void;
  onHome?: () => void;
  onOpenSettings?: () => void;
  onOpenProjector?: () => void;
  isScreeningSetup?: boolean;
  showChangeFilm?: boolean;
  onChangeFilm?: () => void;
}) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);

  // Close file menu when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        fileMenuRef.current &&
        !fileMenuRef.current.contains(e.target as Node)
      ) {
        setFileMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && fileMenuOpen) {
        setFileMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fileMenuOpen]);

  const fileDropdown = (
    <div className="header-dropdown-container" ref={fileMenuRef}>
      <button
        type="button"
        className={`header-menu-btn file-trigger-btn ${fileMenuOpen ? "active" : ""}`}
        onClick={() => setFileMenuOpen(!fileMenuOpen)}
        aria-expanded={fileMenuOpen}
        aria-haspopup="true"
        title="File operations (New, Open, Save, Import, Export)"
      >
        <span>File</span>
        <span className="dropdown-arrow">▾</span>
      </button>

      {fileMenuOpen && (
        <div className="dropdown-menu file-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="header-action-btn"
            aria-label="New project"
            onClick={() => {
              setFileMenuOpen(false);
              onNew();
            }}
          >
            <span>New Project</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="header-action-btn"
            aria-label="Open project"
            onClick={() => {
              setFileMenuOpen(false);
              onOpen();
            }}
          >
            <span>Open Project…</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={!project}
            className="header-action-btn"
            aria-label="Save project"
            onClick={() => {
              setFileMenuOpen(false);
              onSave();
            }}
          >
            <span>Save Project</span>
            <kbd>Cmd+S</kbd>
          </button>

          <div className="menu-divider" />
          <div className="menu-section-header">Import</div>

          <button
            type="button"
            role="menuitem"
            disabled={!project}
            onClick={() => {
              setFileMenuOpen(false);
              onImportVideo();
            }}
          >
            <span>Import Video…</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={!project}
            onClick={() => {
              setFileMenuOpen(false);
              onImportEdl();
            }}
          >
            <span>Import EDL…</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={!project}
            onClick={() => {
              setFileMenuOpen(false);
              onImportProject();
            }}
          >
            <span>Import Backup (.json)…</span>
          </button>

          <div className="menu-divider" />
          <div className="menu-section-header">Export</div>

          <button
            type="button"
            role="menuitem"
            disabled={!project}
            onClick={() => {
              setFileMenuOpen(false);
              onExportProject();
            }}
          >
            <span>Export Project (.json)</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={!project}
            onClick={() => {
              setFileMenuOpen(false);
              onExportPDF();
            }}
          >
            <span>Export PDF Report…</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={!project}
            onClick={() => {
              setFileMenuOpen(false);
              onExportEdlMarkers?.();
            }}
            title="Export markers to DaVinci Resolve EDL"
          >
            <span>Export .EDL</span>
          </button>

          {onOpenSettings && (
            <>
              <div className="menu-divider" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setFileMenuOpen(false);
                  onOpenSettings();
                }}
              >
                <span>Scanner Settings…</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <header className={`app-header${isScreeningSetup ? " screening-setup-header" : ""}`}>
      {/* Left: Brand + Context / Project Name + Save Status */}
      <div className="header-left">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (onHome) onHome();
          }}
          title={isScreeningSetup ? "EDITMAP: Screening Setup" : "EDITMAP: Return to Welcome Screen"}
          aria-label="EDITMAP Home"
        >
          <span className="brand-mark" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          <span className="brand-name">EDITMAP</span>
        </a>

        <span className="brand-sep" aria-hidden="true" />

        {showChangeFilm && onChangeFilm && (
          <button
            type="button"
            className="change-film-btn"
            onClick={onChangeFilm}
            aria-label="Back to choose another film"
            title="Back to choose another film"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="change-film-icon">
              <path d="m7 3-5 5 5 5M2 8h12" />
            </svg>
            <span className="change-film-text">Change film</span>
          </button>
        )}

        {isScreeningSetup ? (
          <span className="brand-section">Screening setup</span>
        ) : (
          project && (
            <div className="header-project-group header-project-pill">
              <input
                aria-label="Project name"
                className="header-project-input"
                value={project.name}
                onChange={(e) => onProjectNameChange?.(e.target.value)}
                placeholder="Untitled film"
              />
              <button
                type="button"
                className={`header-save-status ${dirty ? "dirty" : "saved"}`}
                onClick={onSave}
                title={dirty ? "Unsaved changes • Click or Cmd+S to save immediately" : "All changes saved locally (Cmd+S)"}
                aria-label={dirty ? "Save project, unsaved changes exist" : "Project saved"}
              >
                <span className="save-status-dot" aria-hidden="true" />
                <span className="save-status-text">
                  {saveState === "Saving" ? "Saving…" : dirty ? "Unsaved" : "Saved"}
                </span>
              </button>
            </div>
          )
        )}
      </div>

      {/* Center: Workspace Mode Switch - purely text, no emojis */}
      <div
        className="workspace-mode-switch"
        role="tablist"
        aria-label="Workspace Modes"
      >
        <button
          type="button"
          role="tab"
          aria-selected={workspaceMode === "screening"}
          className={`mode-tab ${workspaceMode === "screening" ? "active" : ""}`}
          onClick={() => onModeChange("screening")}
          title="Screening: Dark cinema screening with live reaction keys and Wi-Fi sync"
        >
          Screening
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceMode === "review"}
          className={`mode-tab ${workspaceMode === "review" ? "active" : ""}`}
          onClick={() => onModeChange("review")}
          title="Review: Immediate post-screening discussion, reaction heatmap, pencil & cue sheet"
        >
          Review
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceMode === "studio"}
          className={`mode-tab ${workspaceMode === "studio" ? "active" : ""}`}
          onClick={() => onModeChange("studio")}
          title="Studio: Inspect rhythm, timeline, framing arc & shot breakdown"
        >
          Studio
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceMode === "explore"}
          className={`mode-tab ${workspaceMode === "explore" ? "active" : ""}`}
          onClick={() => onModeChange("explore")}
          title="Explore: Build and play data-driven viewing sequences"
        >
          Explore
        </button>
      </div>

      {/* Right: Projector ↗ · Analyze · File ▾ (fixed across all workspaces) */}
      <div className="header-right">
        {onOpenProjector && (
          <button
            type="button"
            className="header-projector-btn"
            disabled={!hasVideo}
            onClick={onOpenProjector}
            title={
              !hasVideo
                ? "Link a video first to open projector feed"
                : "Launch clean cinema feed for TV / Projector in secondary window"
            }
          >
            Projector ↗
          </button>
        )}

        {project && (
          <button
            type="button"
            className="header-analyze-btn"
            disabled={!hasVideo || isAnalyzing}
            onClick={onAnalyze}
            title={
              !hasVideo
                ? "Link a video first to analyze"
                : "Analyze film: Scene Cuts, Framing & Character Discovery"
            }
          >
            {isAnalyzing ? (
              <>
                <span className="spinner-dot" />
                <span>Analyzing…</span>
              </>
            ) : (
              <span>Analyze</span>
            )}
          </button>
        )}

        {fileDropdown}
      </div>
    </header>
  );
}
