import { useEffect, useState } from "react";
import { type Project } from "../models/project";
import { deleteProject, listProjects } from "../storage/projects";
import { formatTimecode } from "../utils/timecode";

export interface WelcomeScreenProps {
  onNewProject: () => void;
  onOpenProject: () => void;
  onSelectProject: (project: Project) => void;
}

export function EditmapLogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="editmap-logo-icon"
      aria-hidden="true"
    >
      <rect
        x="1.5"
        y="1.5"
        width="33"
        height="33"
        rx="2"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <line x1="8.5" y1="1.5" x2="8.5" y2="34.5" stroke="currentColor" strokeWidth="1.8" />
      <line x1="14.5" y1="1.5" x2="14.5" y2="34.5" stroke="currentColor" strokeWidth="1.8" />
      <line x1="20.5" y1="1.5" x2="20.5" y2="34.5" stroke="currentColor" strokeWidth="1.8" />
      <line x1="26.5" y1="1.5" x2="26.5" y2="34.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export default function WelcomeScreen({
  onNewProject,
  onOpenProject,
  onSelectProject,
}: WelcomeScreenProps) {
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    let mounted = true;
    listProjects()
      .then((projects) => {
        if (mounted) {
          setRecentProjects(projects);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (confirm(`Remove "${name}" from recent projects?`)) {
      await deleteProject(id);
      setRecentProjects((prev) => prev.filter((p) => p.id !== id));
    }
  };

  const getFormatLabel = (p: Project) => {
    if (p.videoMetadata?.height) {
      if (p.videoMetadata.height >= 2160) return "4K";
      if (p.videoMetadata.height >= 1440) return "2K";
      if (p.videoMetadata.height >= 1080) return "FHD";
      return "HD";
    }
    return "4K";
  };

  const formatDateLabel = (isoDate: string) => {
    try {
      const d = new Date(isoDate);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "Feb 12, 2024";
    }
  };

  const getShotThumbnail = (p: Project): string | undefined => {
    const frameImage = p.shots.find((s) => s.suggestion?.frame?.image)?.suggestion?.frame?.image;
    if (frameImage) return frameImage.startsWith("data:") ? frameImage : `data:image/jpeg;base64,${frameImage}`;
    const castRef = p.cast?.find((c) => c.references?.[0]?.image)?.references?.[0]?.image;
    if (castRef) return castRef.startsWith("data:") ? castRef : `data:image/jpeg;base64,${castRef}`;
    return undefined;
  };

  return (
    <div className="welcome-screen">
      {/* Top Header Bar */}
      <header className="welcome-header">
        <div className="welcome-header-brand">
          <EditmapLogoMark size={18} />
          <span className="welcome-brand-text">EDITMAP</span>
        </div>
        <div className="welcome-header-nav">
          <button
            type="button"
            className="welcome-help-link"
            onClick={() => setShowHelp(true)}
          >
            Help
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="welcome-main">
        {/* Hero Section */}
        <section className="welcome-hero">
          <div className="welcome-hero-logo">
            <EditmapLogoMark size={48} />
          </div>
          <h1 className="welcome-title">E D I T M A P</h1>
          <p className="welcome-subtitle">An editing map for your film.</p>

          <div className="welcome-actions">
            <button
              type="button"
              className="welcome-btn-primary header-action-btn"
              aria-label="New project"
              onClick={onNewProject}
            >
              Create project
            </button>
            <button
              type="button"
              className="welcome-btn-secondary"
              aria-label="Open project"
              onClick={onOpenProject}
            >
              Open
            </button>
          </div>
        </section>

        {/* Recent Projects Section */}
        <section className="welcome-recent">
          <div className="welcome-recent-header">
            <h2>
              Recent
              {!loading && recentProjects.length > 0 && (
                <span className="welcome-recent-count">{recentProjects.length}</span>
              )}
            </h2>
          </div>
          <div className="welcome-recent-divider" />

          <div className="welcome-recent-container">
            <div className="welcome-recent-list">
              {loading ? (
                <div className="welcome-recent-empty">Loading recent projects...</div>
              ) : recentProjects.length === 0 ? (
                <div className="welcome-recent-empty">
                  No recent projects yet. Click "Create project" to get started.
                </div>
              ) : (
                recentProjects.map((p) => {
                  const format = getFormatLabel(p);
                  const timecode = formatTimecode(p.duration || 0, p.frameRate || 24);
                  const dateStr = formatDateLabel(p.updatedAt || p.createdAt);
                  const thumb = getShotThumbnail(p);

                  return (
                    <div
                      key={p.id}
                      className="recent-item"
                      onClick={() => onSelectProject(p)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectProject(p);
                        }
                      }}
                    >
                      <div className="recent-item-thumb">
                        {thumb ? (
                          <img src={thumb} alt={p.name} />
                        ) : (
                          <div className="recent-item-thumb-placeholder">
                            <EditmapLogoMark size={20} />
                          </div>
                        )}
                      </div>
                      <div className="recent-item-info">
                        <div className="recent-item-title-row">
                          <span className="recent-item-title">
                            {p.name.toUpperCase()}
                          </span>
                          <button
                            type="button"
                            className="recent-item-delete"
                            title="Remove from recent"
                            onClick={(e) => handleDelete(e, p.id, p.name)}
                            aria-label={`Remove ${p.name}`}
                          >
                            ✕
                          </button>
                        </div>
                        <div className="recent-item-meta">
                          {format} · {timecode} · {dateStr}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Help Modal */}
      {showHelp && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowHelp(false);
          }}
        >
          <div className="open-panel panel modal-dialog-panel help-modal-panel">
            <div className="section-head">
              <h2 className="modal-title">About EDITMAP</h2>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                aria-label="Close help"
              >
                Close
              </button>
            </div>
            <div className="modal-body help-modal-body">
              <p>
                <strong>EDITMAP</strong> generates an interactive structural blueprint of
                your film's visual and audio edit.
              </p>
              <h3>Key Features</h3>
              <ul>
                <li>
                  <strong>Automatic Scene Cut Detection:</strong> Scans video files for
                  hard cuts and scene boundaries.
                </li>
                <li>
                  <strong>Framing & Shot Sizes:</strong> Suggests Extreme wide, Wide, Full,
                  American, Medium, Medium close-up, Close, or Extreme close using a local
                  cinema-specific vision model.
                </li>
                <li>
                  <strong>Character Discovery & Cast Gallery:</strong> Detects faces and
                  groups appearances by character across shots.
                </li>
                <li>
                  <strong>DME Stem Separation:</strong> Isolates Dialogue, Music, and
                  Sound Effects stems.
                </li>
                <li>
                  <strong>Speech VAD & Loudness:</strong> Scans speech activity and EBU
                  R128 loudness metrics.
                </li>
                <li>
                  <strong>Printable Reports:</strong> Exports high-resolution PDF summaries
                  and timeline maps for directors and editors.
                </li>
              </ul>
              <h3>Quick Start</h3>
              <ol>
                <li>Click <strong>Create project</strong> to begin a new editing map.</li>
                <li>Connect your film video file (MP4, MOV, MKV).</li>
                <li>Click <strong>Analyze Film</strong> to run automated shot & audio detection.</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
