import { useEffect, useState } from "react";
import ProjectHeader, { type WorkspaceMode } from "../components/ProjectHeader";
import type { Project } from "../models/project";

/**
 * The same header the host has, for a guest. It is shown above the room page in
 * every mode and mirrors the host's workspace; the tabs do not switch anything.
 * The room page tells it the mode and the film's name, and handles Projector and
 * Export .EDL, which act on the guest's own device.
 */
const noop = () => {};

export default function GuestHeader() {
  const [mode, setMode] = useState<WorkspaceMode>("screening");
  const [name, setName] = useState("");

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== "GUEST_HEADER") return;
      if (data.mode) setMode(data.mode as WorkspaceMode);
      setName(String(data.name ?? ""));
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "GUEST_HEADER_READY" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const act = (action: "projector" | "export-edl") => () => window.parent.postMessage({ type: "GUEST_HEADER_ACTION", action }, window.location.origin);

  return (
    <div className="guest-header">
      <ProjectHeader
        readOnly
        project={{ name } as Project}
        dirty={false}
        saveState=""
        workspaceMode={mode}
        onModeChange={noop}
        onNew={noop}
        onOpen={noop}
        onSave={noop}
        onImportVideo={noop}
        onImportEdl={noop}
        onImportProject={noop}
        onExportProject={noop}
        onExportPDF={noop}
        onExportEdlMarkers={act("export-edl")}
        onAnalyze={noop}
        isAnalyzing={false}
        hasVideo
        onOpenProjector={act("projector")}
      />
    </div>
  );
}
