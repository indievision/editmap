import { useEffect, useRef, useState } from "react";
import type { Shot } from "../models/project";
import { analyzeFrame, sampleFrame, MODEL } from "../analysis/localModel";
export default function ShotAnalysis({
  shot,
  url,
  onUpdate,
  onNext,
  disabled,
  onBusyChange,
  onPreview,
  onFailure,
}: {
  shot: Shot;
  url: string;
  onUpdate: (patch: Partial<Shot>) => void;
  onNext: () => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onPreview: (shot: Shot, time: number, image?: string) => void;
  onFailure?: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [url, shot.id]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const run = async () => {
    if (disabled || busy || !url) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError("");
    const timeout = setTimeout(() => c.abort(), 120000);
    try {
      const time = (shot.startSeconds + shot.endSeconds) / 2;
      onPreview(shot, time);
      const image = await sampleFrame(url, time, c.signal);
      if (c.signal.aborted) return;
      onPreview(shot, time, image);
      const tags = await analyzeFrame(image, c.signal);
      if (!c.signal.aborted)
        onUpdate({
          ...tags,
          reviewStatus: "Needs review",
          suggestion: {
            ...tags,
            model: MODEL,
            createdAt: new Date().toISOString(),
            frame: { image, time },
          },
        });
    } catch (e) {
      if (!c.signal.aborted) {
        const message = e instanceof Error ? e.message : "Local analysis failed.";
        setError(message);
        onFailure?.(message);
      }
      else setError("Analysis cancelled or timed out.");
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  };
  return (
    <section className="shot-analysis">
      <div className="analysis-header">
        <span className="analysis-model-tag">
          Local CV · <b>{shot.reviewStatus ?? "Unreviewed"}</b>
        </span>
        <button
          disabled={!url || busy || disabled}
          onClick={() => void run()}
          className="reanalyze-btn"
        >
          {busy
            ? "Analyzing…"
            : shot.reviewStatus
              ? "Reanalyze frame ⚡"
              : "Analyze frame ⚡"}
        </button>
        {busy && (
          <button
            className="cancel-analysis-btn"
            onClick={() => controller.current?.abort()}
          >
            Cancel
          </button>
        )}
      </div>
      {!url && (
        <p className="tag-help">
          Connect video to run local computer vision analysis.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
