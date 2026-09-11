import { useState, useRef, useEffect } from "react";
import type { Project } from "../models/project";
import { formatTimecode } from "../utils/timecode";

export type WorkspaceMode = "studio" | "map" | "review";

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
  onAnalyze,
  isAnalyzing,
  hasVideo,
  onProjectNameChange,
}: {
  project: Project | null;
  dirty: boolean;
  saveState: string;
  historyState: { undo: number; redo: number };
  workspaceMode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onImportVideo: () => void;
  onImportEdl: () => void;
  onImportProject: () => void;
  onExportProject: () => void;
  onExportPDF: () => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  hasVideo: boolean;
  onProjectNameChange?: (name: string) => void;
}) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const projectMenuRef = useRef<HTMLDivElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        projectMenuRef.current &&
        !projectMenuRef.current.contains(e.target as Node)
      ) {
        setProjectMenuOpen(false);
      }
      if (
        importMenuRef.current &&
        !importMenuRef.current.contains(e.target as Node)
      ) {
        setImportMenuOpen(false);
      }
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(e.target as Node)
      ) {
        setExportMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="app-header">
      <div className="header-left">
        <a
          className="brand"
          href="#"
          onClick={(e) => e.preventDefault()}
          title="EDITMAP: Film Editing Structural Map"
          aria-label="EDITMAP Home"
        >
          <span className="brand-mark" aria-hidden="true">▥</span>
          <span className="brand-text">EDITMAP</span>
        </a>

        <span className="header-divider" aria-hidden="true" />

        {/* Project Pill: Direct Project Name Input + Menu Dropdown */}
        <div className="header-project-group" ref={projectMenuRef}>
          <button
            type="button"
            className={`header-menu-btn project-trigger-btn ${projectMenuOpen ? "active" : ""}`}
            onClick={() => {
              setProjectMenuOpen(!projectMenuOpen);
              setImportMenuOpen(false);
              setExportMenuOpen(false);
            }}
            aria-expanded={projectMenuOpen}
            aria-haspopup="true"
            title="Project management menu"
          >
            <span className="header-project-label">Project</span>
            <span className="dropdown-arrow">▾</span>
          </button>

          {project && (
            <div className="header-project-input-wrap">
              <input
                aria-label="Project name"
                className="header-project-input"
                value={project.name}
                onChange={(e) => onProjectNameChange?.(e.target.value)}
                placeholder="Untitled Film"
              />
              <span className="header-project-edit-icon" aria-hidden="true" title="Click to rename project">✎</span>
              <span
                className={`save-indicator ${dirty ? "unsaved" : "saved"}`}
                title={dirty ? "Unsaved changes exist" : "All changes saved locally"}
              >
                {saveState || (dirty ? "Unsaved •" : "Local • Saved")}
              </span>
            </div>
          )}

          <div className="header-file-actions" role="group" aria-label="Project actions">
            <button
              type="button"
              className="header-action-btn"
              onClick={onNew}
              aria-label="New project"
              title="Create new project"
            >
              New
            </button>

            <button
              type="button"
              className="header-action-btn"
              onClick={onOpen}
              aria-label="Open project"
              title="Open project"
            >
              Open…
            </button>

            <button
              type="button"
              className={`header-action-btn primary-save ${dirty ? "dirty" : ""}`}
              disabled={!project}
              onClick={onSave}
              aria-label={dirty ? "Save project, unsaved changes exist" : "Save project"}
              title="Save project (Cmd+S)"
            >
              Save{dirty ? " •" : ""}
            </button>
          </div>

          {projectMenuOpen && (
            <div className="dropdown-menu project-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProjectMenuOpen(false);
                  onNew();
                }}
              >
                <span>New Project</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProjectMenuOpen(false);
                  onOpen();
                }}
              >
                <span>Open Project...</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!project}
                onClick={() => {
                  setProjectMenuOpen(false);
                  onSave();
                }}
              >
                <span>Save Project</span>
                <kbd>Cmd+S</kbd>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Center: Workspace Mode Switch */}
      {project && (
        <div
          className="workspace-mode-switch"
          role="tablist"
          aria-label="Workspace Modes"
        >
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === "studio"}
            className={`mode-tab ${workspaceMode === "studio" ? "active" : ""}`}
            onClick={() => onModeChange("studio")}
            title="Studio: Everyday workbench with film monitor, analytical deck & shot inspector"
          >
            Studio
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === "map"}
            className={`mode-tab ${workspaceMode === "map" ? "active" : ""}`}
            onClick={() => onModeChange("map")}
            title="Map Focus: High-resolution structural analysis with aligned layers and film overview"
          >
            Map Focus
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === "review"}
            className={`mode-tab ${workspaceMode === "review" ? "active" : ""}`}
            onClick={() => onModeChange("review")}
            title="Review Desk: Fast human confirmation queue with 3-shot context and keyboard tagging"
          >
            Review Desk
          </button>
        </div>
      )}

      {/* Right: Stats, Undo/Redo, Import, Analyze, Export */}
      <div className="header-right">
        {project && (
          <div className="header-meta mono">
            <span>{project.frameRate} FPS</span>
            <span className="meta-sep">/</span>
            <span>{project.shots.length} shots</span>
            <span className="meta-sep">/</span>
            <span>
              {formatTimecode(project.duration, project.frameRate, project.dropFrame)}
            </span>
          </div>
        )}

        {/* Undo / Redo */}
        <div className="history-group">
          <button
            type="button"
            className="btn-icon"
            disabled={!project || !historyState.undo}
            onClick={onUndo}
            title={`Undo (Cmd/Ctrl+Z)${historyState.undo ? ` (${historyState.undo})` : ""}`}
            aria-label="Undo"
          >
            ↩
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={!project || !historyState.redo}
            onClick={onRedo}
            title="Redo (Cmd/Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            ↪
          </button>
        </div>

        {/* Import Menu */}
        <div className="header-dropdown-container" ref={importMenuRef}>
          <button
            type="button"
            className={`header-menu-btn ${importMenuOpen ? "active" : ""}`}
            onClick={() => {
              setImportMenuOpen(!importMenuOpen);
              setProjectMenuOpen(false);
              setExportMenuOpen(false);
            }}
            aria-expanded={importMenuOpen}
            aria-haspopup="true"
          >
            <span>Import</span>
            <span className="dropdown-arrow">▾</span>
          </button>

          {importMenuOpen && (
            <div className="dropdown-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={!project}
                onClick={() => {
                  setImportMenuOpen(false);
                  onImportVideo();
                }}
              >
                <span>Import Video...</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!project}
                onClick={() => {
                  setImportMenuOpen(false);
                  onImportEdl();
                }}
              >
                <span>Import EDL...</span>
              </button>
              <div className="menu-divider" />
              <button
                type="button"
                role="menuitem"
                disabled={!project}
                onClick={() => {
                  setImportMenuOpen(false);
                  onImportProject();
                }}
              >
                <span>Import Project Backup (.json)...</span>
              </button>
            </div>
          )}
        </div>

        {/* Analyze Action */}
        <button
          type="button"
          className="header-analyze-btn"
          disabled={!project || !hasVideo || isAnalyzing}
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

        {/* Export Menu */}
        <div className="header-dropdown-container" ref={exportMenuRef}>
          <button
            type="button"
            className={`header-menu-btn export-btn ${exportMenuOpen ? "active" : ""}`}
            disabled={!project}
            onClick={() => {
              setExportMenuOpen(!exportMenuOpen);
              setProjectMenuOpen(false);
              setImportMenuOpen(false);
            }}
            aria-expanded={exportMenuOpen}
            aria-haspopup="true"
          >
            <span>Export</span>
            <span className="dropdown-arrow">▾</span>
          </button>

          {exportMenuOpen && (
            <div className="dropdown-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={!project}
                onClick={() => {
                  setExportMenuOpen(false);
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
                  setExportMenuOpen(false);
                  onExportPDF();
                }}
              >
                <span>Export PDF Report...</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
