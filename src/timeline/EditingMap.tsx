import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Project, Shot } from "../models/project";
import { colorMappings, sizeColors } from "../analysis/colors";
import { actualRate, formatTimecode } from "../utils/timecode";
import { reviewReasonLabel, reviewReasons } from "../analysis/review";
export default memo(function EditingMap({
  project,
  thumbnails,
  time,
  selected,
  active,
  onSeek,
  onScrub,
  onShot,
  onPlayShot,
  selectedCut,
  onCut,
  range,
  onRangeChange,
  waveform = [],
  highlightedShotIds,
  reviewMatchIds,
  onColorModeChange,
  tagBar,
  onSeparateDme,
  isDmeSeparating = false,
  dmeSeparationStatus = "",
  hasVideo = false,
}: {
  project: Project;
  thumbnails: Record<string, string>;
  time: number;
  selected?: string;
  active?: string;
  onSeek: (t: number) => void;
  onScrub: (t: number) => void;
  onShot: (s: Shot) => void;
  onPlayShot: (s: Shot) => void;
  selectedCut?: string;
  onCut: (incoming: Shot) => void;
  range?: { start: number; end: number };
  onRangeChange: (range?: { start: number; end: number }) => void;
  waveform?: number[];
  highlightedShotIds?: string[];
  /** Filtering never changes timing or visibility; non-matches are only dimmed. */
  reviewMatchIds?: string[];
  onColorModeChange?: (mode: string) => void;
  tagBar?: React.ReactNode;
  onSeparateDme?: () => void;
  isDmeSeparating?: boolean;
  dmeSeparationStatus?: string;
  hasVideo?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const rangeAnchor = useRef<number | null>(null);
  const suppressMapClick = useRef(false);
  const [dragRange, setDragRange] = useState<{ start: number; end: number }>();
  const [audioMode, setAudioMode] = useState<"mixed" | "dme">(
    project.dmeWaveforms ? "dme" : "mixed"
  );

  useEffect(() => {
    if (project.dmeWaveforms) {
      setAudioMode("dme");
    }
  }, [project.dmeWaveforms]);
  const scrubAt = (clientX: number) => {
    const left = canvas.current!.getBoundingClientRect().left;
    onScrub(Math.max(0, Math.min(project.duration, (clientX - left) / scale)));
  };
  const [width, setWidth] = useState(1000),
    [zoom, setZoom] = useState(1),
    [scrollLeft, setScrollLeft] = useState(0);
  const duration = Math.max(project.duration, 1),
    canvasWidth = Math.max(width, width * zoom),
    scale = canvasWidth / duration;

  const buffer = width * 0.75;
  const visibleStartTime = Math.max(0, (scrollLeft - buffer) / scale);
  const visibleEndTime = Math.min(
    duration,
    (scrollLeft + width + buffer) / scale,
  );

  const visibleShots = useMemo(() => {
    if (zoom <= 1) return project.shots;
    return project.shots.filter(
      (s) =>
        s.endSeconds >= visibleStartTime && s.startSeconds <= visibleEndTime,
    );
  }, [project.shots, visibleStartTime, visibleEndTime, zoom]);

  const visibleCuts = useMemo(() => {
    const cuts: { incoming: Shot; outgoing: Shot }[] = [];
    for (let i = 1; i < project.shots.length; i++) {
      const incoming = project.shots[i];
      const outgoing = project.shots[i - 1];
      if (Math.abs(outgoing.endSeconds - incoming.startSeconds) <= 0.00001) {
        if (
          zoom <= 1 ||
          (incoming.startSeconds >= visibleStartTime &&
            incoming.startSeconds <= visibleEndTime)
        ) {
          cuts.push({ incoming, outgoing });
        }
      }
    }
    return cuts;
  }, [project.shots, visibleStartTime, visibleEndTime, zoom]);

  const rulerTicks = useMemo(() => {
    const count = Math.max(2, Math.floor(canvasWidth / 130));
    const ticks: { i: number; t: number; x: number }[] = [];
    for (let i = 0; i < count; i++) {
      const t = (i * duration) / count;
      const x = t * scale;
      if (
        zoom <= 1 ||
        (x >= scrollLeft - 130 && x <= scrollLeft + width + 130)
      ) {
        ticks.push({ i, t, x });
      }
    }
    return ticks;
  }, [canvasWidth, duration, scale, zoom, scrollLeft, width]);

  const visibleSoundSpans = useMemo(() => {
    if (!project.soundSpans) return [];
    if (zoom <= 1) return project.soundSpans;
    return project.soundSpans.filter(
      (s) =>
        s.endSeconds >= visibleStartTime && s.startSeconds <= visibleEndTime,
    );
  }, [project.soundSpans, visibleStartTime, visibleEndTime, zoom]);

  const visibleSequences = useMemo(() => {
    if (!project.sequences) return [];
    if (zoom <= 1) return project.sequences;
    return project.sequences.filter(
      (s) =>
        s.endSeconds >= visibleStartTime && s.startSeconds <= visibleEndTime,
    );
  }, [project.sequences, visibleStartTime, visibleEndTime, zoom]);
  useEffect(() => {
    const el = viewport.current!;
    const ob = new ResizeObserver(() => setWidth(el.clientWidth));
    ob.observe(el);
    return () => ob.disconnect();
  }, []);
  useEffect(() => {
    if (dragging.current) return;
    const el = viewport.current!;
    const x = time * scale;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 16)
      el.scrollLeft = Math.max(0, x - el.clientWidth * 0.25);
  }, [time, scale]);
  const changeZoom = (factor: number) =>
    setZoom((z) => Math.max(1, Math.min(128, z * factor)));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]"
        )
      ) {
        return;
      }
      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        changeZoom(1 / 1.25);
      } else if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        changeZoom(1.25);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const pointAt = (clientX: number) =>
    Math.max(0, Math.min(project.duration, (clientX - canvas.current!.getBoundingClientRect().left) / scale));
  const visibleRange = dragRange ?? range;
  return (
    <section className="map panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">EDITING MAP</span>
          <span className="muted">
            {project.shots.length} shots · duration-scaled
          </span>
        </div>
        <div className="tools">
          <div className="view-toggle-group" role="group" aria-label="Timeline Color Mode">
            <button
              className={project.colorMode !== "palette" ? "active" : ""}
              onClick={() => onColorModeChange?.("shotSize")}
              title="Color timeline blocks by shot framing size"
            >
              Framing Colors
            </button>
            <button
              className={project.colorMode === "palette" ? "active" : ""}
              onClick={() => onColorModeChange?.("palette")}
              title="Color timeline blocks by extracted film palette"
            >
              Footage Palette
            </button>
          </div>
        </div>
      </div>
      {tagBar && <div className="map-top-bar">{tagBar}</div>}
      <div
        className="map-scroll"
        ref={viewport}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            changeZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
          }
        }}
      >
        <div
          ref={canvas}
          className="map-canvas"
          style={{ width: canvasWidth }}
          onPointerDown={(event) => {
            if (!event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            rangeAnchor.current = pointAt(event.clientX);
            suppressMapClick.current = true;
            setDragRange({ start: rangeAnchor.current, end: rangeAnchor.current });
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (rangeAnchor.current === null) return;
            setDragRange({ start: Math.min(rangeAnchor.current, pointAt(event.clientX)), end: Math.max(rangeAnchor.current, pointAt(event.clientX)) });
          }}
          onPointerUp={(event) => {
            if (rangeAnchor.current === null) return;
            const end = pointAt(event.clientX), start = rangeAnchor.current;
            rangeAnchor.current = null;
            setDragRange(undefined);
            if (Math.abs(end - start) > 1 / actualRate(project.frameRate)) onRangeChange({ start: Math.min(start, end), end: Math.max(start, end) });
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onClick={(e) =>
            suppressMapClick.current
              ? (suppressMapClick.current = false)
              : onSeek((e.clientX - e.currentTarget.getBoundingClientRect().left) / scale)
          }
        >
          <div className="ruler">
            {rulerTicks.map(({ i, t, x }) => (
              <span key={i} style={{ left: x }}>
                {formatTimecode(t, project.frameRate, project.dropFrame)}
              </span>
            ))}
          </div>
          <div className="shot-track">
            {visibleShots.map((s) => {
              const w = s.duration * scale;
              const reviewMatch = !reviewMatchIds || reviewMatchIds.includes(s.id);
              const colorGetter = (colorMappings[project.colorMode] || colorMappings.shotSize).color;
              return (
                <button
                  key={s.id}
                  title={`${reviewReasonLabel(reviewReasons(s))} · Shot ${s.index} · ${s.shotSize} · ${s.duration.toFixed(3)}s`}
                  aria-label={`Shot ${s.index}${reviewMatch ? "" : ", outside active review filter"}`}
                  className={`shot ${selected === s.id ? "selected" : ""} ${active === s.id ? "active" : ""} ${highlightedShotIds?.includes(s.id) ? "character-highlight" : ""} ${reviewMatch ? "review-match" : "review-dimmed"}`}
                  style={
                    {
                      left: s.startSeconds * scale,
                      width: w,
                      "--size-color": colorGetter(s),
                    } as CSSProperties
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onShot(s);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onPlayShot(s);
                  }}
                >
                  {w > 58 && thumbnails[s.id] && (
                    <img
                      className="shot-thumbnail"
                      src={thumbnails[s.id]}
                      alt=""
                      draggable={false}
                    />
                  )}
                  {s.reviewStatus !== "Confirmed" && (
                    <i
                      className="review-marker"
                      aria-label="Unconfirmed tags"
                    />
                  )}
                  {w > 25 && (
                    <strong>{String(s.index).padStart(3, "0")}</strong>
                  )}
                  {w > 58 && (
                    <span>{s.shotSize === "Unknown" ? "—" : s.shotSize}</span>
                  )}
                  {w > 90 && <small>{s.duration.toFixed(2)}s</small>}
                </button>
              );
            })}
            {visibleCuts.map(({ incoming, outgoing }) => (
              <button
                key={`cut-${incoming.id}`}
                className={`cut-boundary ${selectedCut === incoming.id ? "selected" : ""}`}
                style={{ left: incoming.startSeconds * scale }}
                aria-label={`Cut between Shot ${outgoing.index} and Shot ${incoming.index}`}
                title={`Read cut: Shot ${outgoing.index} → Shot ${incoming.index}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCut(incoming);
                }}
              />
            ))}
          </div>
          <div
            className={`audio-track ${audioMode === "dme" && project.dmeWaveforms ? "dme-mode" : ""}`}
            aria-label="Soundtrack waveform"
          >
            {audioMode === "dme" && project.dmeWaveforms ? (
              <div className="dme-stem-lanes" aria-hidden="true">
                <div className="dme-lane dialogue" title="DX: Dialogue">
                  <span className="dme-lane-badge dx">DX</span>
                  <div className="waveform dme-waveform">
                    {project.dmeWaveforms.dialogue.map((level, i) => (
                      <i key={i} style={{ height: `${Math.max(4, level * 100)}%` }} />
                    ))}
                  </div>
                </div>
                <div className="dme-lane music" title="MX: Music">
                  <span className="dme-lane-badge mx">MX</span>
                  <div className="waveform dme-waveform">
                    {project.dmeWaveforms.music.map((level, i) => (
                      <i key={i} style={{ height: `${Math.max(4, level * 100)}%` }} />
                    ))}
                  </div>
                </div>
                <div className="dme-lane effects" title="FX: Effects">
                  <span className="dme-lane-badge fx">FX</span>
                  <div className="waveform dme-waveform">
                    {project.dmeWaveforms.effects.map((level, i) => (
                      <i key={i} style={{ height: `${Math.max(4, level * 100)}%` }} />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="waveform" aria-hidden="true">
                {waveform.length ? (
                  waveform.map((level, index) => (
                    <i key={index} style={{ height: `${Math.max(4, level * 100)}%` }} />
                  ))
                ) : (
                  <span>Relink a film to view its local waveform</span>
                )}
              </div>
            )}

            {visibleSoundSpans.map((span) => (
              <button
                key={span.id}
                className={`sound-span ${span.kind.toLowerCase()}`}
                title={`${span.kind}: ${span.notes || "No observation"}`}
                style={{
                  left: span.startSeconds * scale,
                  width: Math.max(2, (span.endSeconds - span.startSeconds) * scale),
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onRangeChange({ start: span.startSeconds, end: span.endSeconds });
                }}
              >
                {span.kind}
              </button>
            ))}

            <div className="audio-caption-bar">
              <div className="audio-caption">
                {audioMode === "dme" && project.dmeWaveforms ? (
                  <>
                    DME <span>STEM SEPARATION (DX · MX · FX)</span>
                  </>
                ) : (
                  <>
                    A1 <span>MIXED SOUNDTRACK</span>
                  </>
                )}
              </div>

              <div className="audio-actions" onClick={(e) => e.stopPropagation()}>
                {project.dmeWaveforms ? (
                  <div className="dme-mode-pills">
                    <button
                      type="button"
                      className={`dme-pill-btn ${audioMode === "mixed" ? "active" : ""}`}
                      onClick={() => setAudioMode("mixed")}
                    >
                      Mixed
                    </button>
                    <button
                      type="button"
                      className={`dme-pill-btn ${audioMode === "dme" ? "active" : ""}`}
                      onClick={() => setAudioMode("dme")}
                    >
                      DME (3-Stem)
                    </button>
                    {onSeparateDme && (
                      <button
                        type="button"
                        className="dme-rescan-btn"
                        title="Re-run DME separation"
                        disabled={isDmeSeparating}
                        onClick={onSeparateDme}
                      >
                        ↻ Re-scan
                      </button>
                    )}
                  </div>
                ) : onSeparateDme ? (
                  <button
                    type="button"
                    className="btn-dme-test"
                    onClick={onSeparateDme}
                    disabled={isDmeSeparating || !hasVideo}
                    title={!hasVideo ? "Connect a video file first to test DME separation" : "Separate Dialogue, Music, and Effects locally"}
                  >
                    {isDmeSeparating ? (
                      <>
                        <span className="dme-spinner" />
                        <span>{dmeSeparationStatus || "Separating DME..."}</span>
                      </>
                    ) : (
                      <>🧪 Test DME Separation</>
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          {visibleRange && <div className="map-range" style={{ left: visibleRange.start * scale, width: Math.max(2, (visibleRange.end - visibleRange.start) * scale) }} />}
          {visibleSequences.map((scene) => (
            <button
              key={scene.id}
              className="scene-marker"
              title={scene.name}
              style={{
                left: scene.startSeconds * scale,
                width: Math.max(2, (scene.endSeconds - scene.startSeconds) * scale),
              }}
              onClick={(event) => {
                event.stopPropagation();
                onRangeChange({ start: scene.startSeconds, end: scene.endSeconds });
              }}
            >
              {scene.name}
            </button>
          ))}
          {!project.shots.length && (
            <div className="map-empty">
              Import an EDL to reveal the structure of your film.
            </div>
          )}
          <div
            className="playhead"
            role="slider"
            tabIndex={0}
            aria-label="Timeline playhead"
            aria-valuemin={0}
            aria-valuemax={project.duration}
            aria-valuenow={Math.min(time, project.duration)}
            aria-valuetext={formatTimecode(
              time,
              project.frameRate,
              project.dropFrame,
            )}
            style={{ left: Math.min(time, duration) * scale }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              e.currentTarget.focus();
              scrubAt(e.clientX);
            }}
            onPointerMove={(e) => {
              if (dragging.current) scrubAt(e.clientX);
            }}
            onPointerUp={(e) => {
              if (!dragging.current) return;
              scrubAt(e.clientX);
              dragging.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
            onLostPointerCapture={() => {
              dragging.current = false;
            }}
            onKeyDown={(e) => {
              const delta = 1 / actualRate(project.frameRate);
              const target =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? project.duration
                    : e.key === "ArrowLeft"
                      ? time - delta
                      : e.key === "ArrowRight"
                        ? time + delta
                        : null;
              if (target !== null) {
                e.preventDefault();
                e.stopPropagation();
                onScrub(Math.max(0, Math.min(project.duration, target)));
              }
            }}
          >
            <i />
          </div>
          <div className="track-caption">
            V1 <span>RECORD TIMELINE</span>
          </div>
        </div>
      </div>
      <div className="timeline-footer">
        <div className="timeline-zoom-controls">
          <button
            type="button"
            className="zoom-btn"
            onClick={() => changeZoom(1 / 1.25)}
            aria-label="Zoom out"
            title="Zoom out (Q)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </button>
          <input
            type="range"
            className="zoom-slider"
            min="0"
            max="6"
            step="0.05"
            value={Math.log2(zoom)}
            onChange={(e) => setZoom(Math.pow(2, Number(e.target.value)))}
            aria-label="Timeline zoom slider"
            title={`Timeline Zoom: ${zoom.toFixed(1)}×`}
          />
          <button
            type="button"
            className="zoom-btn"
            onClick={() => changeZoom(1.25)}
            aria-label="Zoom in"
            title="Zoom in (W)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="11" y1="8" x2="11" y2="14"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </button>
          <span className="mono zoom-label">{zoom.toFixed(1)}×</span>
          <div className="zoom-shortcuts" title="Keyboard shortcuts: Q to zoom out, W to zoom in">
            <span className="shortcut-pill"><kbd>Q</kbd> Out</span>
            <span className="shortcut-pill"><kbd>W</kbd> In</span>
          </div>
          <button
            type="button"
            className="zoom-fit-btn"
            onClick={() => setZoom(1)}
            aria-label="Fit full timeline"
            title="Fit timeline to view full film"
          >
            Fit
          </button>
        </div>

        <div className="legend">
          <span className="legend-hint">
            Click a shot to inspect · click a boundary to read a cut · Shift-drag to read a sequence
          </span>
          {Object.entries(sizeColors)
            .filter(([name]) =>
              [
                "EWS",
                "WS",
                "MWS",
                "MS",
                "MCU",
                "CU",
                "ECU",
                "Insert",
                "OTS",
                "POV",
              ].includes(name),
            )
            .map(([name, color]) => (
              <span key={name}>
                <i style={{ background: color }} />
                {name}
              </span>
            ))}
        </div>
      </div>
    </section>
  );
});
