import React, { useState, useEffect, useCallback } from "react";
import { fetchLocalModel } from "../analysis/localModel";

export interface ScannerEngine {
  id: string;
  name: string;
  model: string;
  version?: string;
  status: "ready" | "not_loaded" | "unavailable";
  description: string;
  error?: string | null;
}

export interface ScannerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdateCompleted?: () => void;
}

export default function ScannerSettingsModal({
  isOpen,
  onClose,
  onUpdateCompleted,
}: ScannerSettingsModalProps) {
  const [engines, setEngines] = useState<ScannerEngine[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [version, setVersion] = useState("1.1.0");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetchLocalModel("/api/scanners/status", { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEngines(data.engines || []);
      if (data.version) setVersion(data.version);
    } catch (err: any) {
      setErrorMessage("Could not connect to the local CV service. Is the backend running on 127.0.0.1:8000?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadStatus();
    }
  }, [isOpen, loadStatus]);

  const handleUpdate = async () => {
    setUpdating(true);
    setStatusMessage("Verifying local models and checking for updates…");
    setErrorMessage(null);
    try {
      const res = await fetchLocalModel("/api/scanners/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkOnly: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.engines) {
        setEngines(data.engines);
      }
      setStatusMessage(data.message || "All local scanner models are verified and up to date.");
      onUpdateCompleted?.();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to update scanners. Check local service connection.");
      setStatusMessage(null);
    } finally {
      setUpdating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop scene-detect-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanner-settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !updating) onClose();
      }}
    >
      <div className="modal panel scanner-settings-panel" style={{ width: 640, maxWidth: "94vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div className="section-head" style={{ borderBottom: "1px solid var(--border, #333)", paddingBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18, color: "var(--accent, #e5a93c)" }}>⚙</span>
            <div>
              <b id="scanner-settings-title" style={{ fontSize: 15, display: "block" }}>Scanner Engines & AI Models</b>
              <span className="muted" style={{ fontSize: 12 }}>
                Local CV Version {version} · Runs 100% on this Mac
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={updating} aria-label="Close settings">
            ✕
          </button>
        </div>

        <div style={{ padding: "16px 0", flex: 1, overflowY: "auto" }}>
          {/* Top Banner & Update Action */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary, #fff)" }}>
                Installed AI Engines
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted, #888)", marginTop: 2 }}>
                Check model integrity or download updated scanner weights
              </div>
            </div>

            <button
              type="button"
              className="primary"
              disabled={loading || updating}
              onClick={() => void handleUpdate()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              {updating ? (
                <>
                  <span className="spinner-dot" />
                  <span>Updating…</span>
                </>
              ) : (
                <>
                  <span>⟳</span>
                  <span>Update Scanners</span>
                </>
              )}
            </button>
          </div>

          {statusMessage && (
            <div
              style={{
                background: "rgba(74, 222, 128, 0.1)",
                border: "1px solid rgba(74, 222, 128, 0.25)",
                color: "#4ade80",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 12,
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>✓</span>
              <span>{statusMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div
              style={{
                background: "rgba(248, 113, 113, 0.1)",
                border: "1px solid rgba(248, 113, 113, 0.25)",
                color: "#f87171",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 12,
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>⚠</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Engine Cards List */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {engines.map((engine) => {
              const isReady = engine.status === "ready";
              const isUnavailable = engine.status === "unavailable";
              const statusColor = isReady ? "#4ade80" : isUnavailable ? "#f87171" : "#eab308";
              const statusLabel = isReady ? "Ready" : isUnavailable ? "Unavailable" : "Standby / Lazy";

              return (
                <div
                  key={engine.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "10px 14px",
                    background: "rgba(0, 0, 0, 0.2)",
                    border: "1px solid rgba(255, 255, 255, 0.06)",
                    borderRadius: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{engine.name}</span>
                      <span
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "rgba(255, 255, 255, 0.08)",
                          color: "#aaa",
                        }}
                      >
                        {engine.model}
                      </span>
                    </div>

                    <span
                      style={{
                        fontSize: 11,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        color: statusColor,
                        fontWeight: 500,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: statusColor,
                          display: "inline-block",
                        }}
                      />
                      {statusLabel}
                    </span>
                  </div>

                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted, #888)", lineHeight: 1.4 }}>
                    {engine.description}
                  </p>

                  {engine.error && (
                    <div style={{ fontSize: 11, color: "#f87171", marginTop: 2 }}>
                      Error: {engine.error}
                    </div>
                  )}
                </div>
              );
            })}

            {!engines.length && loading && (
              <div style={{ padding: 24, textAlign: "center", color: "#888", fontSize: 13 }}>
                <span className="spinner-dot" style={{ marginRight: 8 }} />
                Loading scanner status…
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions" style={{ borderTop: "1px solid var(--border, #333)", paddingTop: 12, marginTop: 4 }}>
          <button type="button" onClick={onClose} disabled={updating}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
