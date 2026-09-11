import React, { useState } from "react";
import type { Project } from "../models/project";
import PrintableReport, { type ReportSectionConfig } from "./PrintableReport";

export interface ReportExportConfig {
  theme: "ink-saver" | "dark";
  format: "A4 Landscape" | "A4 Portrait" | "Letter";
  sections: ReportSectionConfig;
}

export interface ReportExportModalProps {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  onExport: (config: ReportExportConfig) => void;
  config?: ReportExportConfig;
  onChangeConfig?: (config: ReportExportConfig) => void;
}

export default function ReportExportModal({
  project,
  isOpen,
  onClose,
  onExport,
  config,
  onChangeConfig,
}: ReportExportModalProps) {
  const [theme, setTheme] = useState<"ink-saver" | "dark">(config?.theme ?? "ink-saver");
  const [format, setFormat] = useState<
    "A4 Landscape" | "A4 Portrait" | "Letter"
  >(config?.format ?? "A4 Landscape");

  const [sections, setSections] = useState<ReportSectionConfig>(
    config?.sections ?? {
      summary: true,
      rhythm: true,
      pacing: true,
      framing: true,
      color: Boolean(project.shots?.some((s) => s.colorProfile)),
      cast: Boolean(project.cast && project.cast.length > 0),
      notes: Boolean(
        (project.sequences && project.sequences.length > 0) ||
          project.shots?.some((s) => s.notes && s.notes.trim() !== ""),
      ),
    },
  );

  if (!isOpen) return null;

  const handleThemeChange = (newTheme: "ink-saver" | "dark") => {
    setTheme(newTheme);
    onChangeConfig?.({ theme: newTheme, format, sections });
  };

  const handleFormatChange = (
    newFormat: "A4 Landscape" | "A4 Portrait" | "Letter",
  ) => {
    setFormat(newFormat);
    onChangeConfig?.({ theme, format: newFormat, sections });
  };

  const toggleSection = (key: keyof ReportSectionConfig) => {
    const nextSections = { ...sections, [key]: !sections[key] };
    setSections(nextSections);
    onChangeConfig?.({ theme, format, sections: nextSections });
  };

  const handleExportClick = () => {
    onExport({ theme, format, sections });
  };

  return (
    <div className="report-modal-overlay" onClick={onClose}>
      <div className="report-modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="report-modal-header">
          <div className="report-modal-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Export Analysis Report (PDF)
          </div>
          <button className="report-modal-close" onClick={onClose} title="Close modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="report-modal-body">
          {/* Controls Sidebar */}
          <div className="report-controls-sidebar">
            {/* Theme Toggle */}
            <div className="control-group">
              <div className="control-group-title">Theme</div>
              <div className="theme-toggle-row">
                <span className="theme-toggle-label">
                  {theme === "ink-saver" ? "Ink-Saver (Light)" : "Dark Mode"}
                </span>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={theme === "dark"}
                    onChange={(e) => handleThemeChange(e.target.checked ? "dark" : "ink-saver")}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>

            {/* Page Format */}
            <div className="control-group">
              <div className="control-group-title">Page Format</div>
              <select
                className="format-select"
                value={format}
                onChange={(e) => handleFormatChange(e.target.value as any)}
              >
                <option value="A4 Landscape">A4 Landscape (297 x 210 mm)</option>
                <option value="A4 Portrait">A4 Portrait (210 x 297 mm)</option>
                <option value="Letter">US Letter (11 x 8.5 in)</option>
              </select>
            </div>

            {/* Sections Toggles */}
            <div className="control-group">
              <div className="control-group-title">Included Sections</div>
              <div className="section-toggles-list">
                <label className="toggle-item">
                  <input
                    type="checkbox"
                    checked={sections.summary}
                    onChange={() => toggleSection("summary")}
                  />
                  <span className="toggle-item-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    </svg>
                    Executive Summary & Stats
                  </span>
                </label>

                <label className="toggle-item">
                  <input
                    type="checkbox"
                    checked={sections.rhythm}
                    onChange={() => toggleSection("rhythm")}
                  />
                  <span className="toggle-item-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="20" x2="18" y2="10"></line>
                      <line x1="12" y1="20" x2="12" y2="4"></line>
                      <line x1="6" y1="20" x2="6" y2="14"></line>
                    </svg>
                    Rhythm & Shot Hold Histogram
                  </span>
                </label>

                <label className="toggle-item">
                  <input
                    type="checkbox"
                    checked={sections.pacing}
                    onChange={() => toggleSection("pacing")}
                  />
                  <span className="toggle-item-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                    </svg>
                    Local Pacing Curve
                  </span>
                </label>

                <label className="toggle-item">
                  <input
                    type="checkbox"
                    checked={sections.framing}
                    onChange={() => toggleSection("framing")}
                  />
                  <span className="toggle-item-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    </svg>
                    Framing Scale Distribution
                  </span>
                </label>

                <label className="toggle-item">
                  <input
                    type="checkbox"
                    checked={sections.color}
                    onChange={() => toggleSection("color")}
                  />
                  <span className="toggle-item-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"></circle>
                    </svg>
                    Color Chronology
                  </span>
                </label>

                <label className="toggle-item">
                  <input
                    type="checkbox"
                    checked={sections.cast}
                    onChange={() => toggleSection("cast")}
                  />
                  <span className="toggle-item-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                    </svg>
                    Cast Screen Time
                  </span>
                </label>

                <label className="toggle-item">
                  <input
                    type="checkbox"
                    checked={sections.notes}
                    onChange={() => toggleSection("notes")}
                  />
                  <span className="toggle-item-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    </svg>
                    Sequence & Editorial Notes
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Live Preview Panel */}
          <div className="report-preview-panel">
            <div className="preview-panel-header">Live preview:</div>
            <div className="preview-scroll-container">
              <div className="preview-page-wrapper" style={{ transform: "scale(0.65)", transformOrigin: "top center" }}>
                <PrintableReport
                  project={project}
                  theme={theme}
                  format={format}
                  sections={sections}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="report-modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleExportClick}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}
