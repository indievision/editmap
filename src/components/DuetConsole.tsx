import React, { useEffect, useRef, useMemo } from "react";
import { usePlayhead } from "../playback/playhead";
import type { Project } from "../models/project";

export interface DuetMarker {
  id: string;
  time: number;
  colorKey: "1" | "2" | "3" | "4";
  hex: string;
  name: string;
  note?: string;
  solved?: boolean;
  authorName: string;
  authorAvatar: string;
  role: "host" | "student";
}

export interface DuetConsoleProps {
  project: Project | null;
  videoUrl: string;
  workspaceMode: "screening" | "review" | "studio" | "explore";
  onModeChange: (mode: "screening" | "review" | "studio" | "explore") => void;
  onSelectProject: (p: Project) => void;
  onSelectProjectId?: (id: string, name?: string) => void;
  onNewProjectFromVideo: (file: File | string, name: string) => void;
  onTimeSync?: (time: number) => void;
  onEnterScreeningRoom?: (customUrl?: string, customFile?: File) => void;
  bgScanStatus?: any;
  onMarkersUpdate?: (markers: any[]) => void;
}

function getEffectiveCutName(project: Project | null): string {
  if (project?.name && project.name !== "Untitled film" && project.name !== "Untitled Project") {
    return project.name;
  }
  if (project?.videoMetadata?.filename) {
    return project.videoMetadata.filename.replace(/\.[^/.]+$/, "");
  }
  if (typeof window !== "undefined" && (window as any).selectedFile?.name) {
    return String((window as any).selectedFile.name).replace(/\.[^/.]+$/, "");
  }
  return project?.name || "Cut";
}

export default function DuetConsole({
  project,
  videoUrl,
  workspaceMode,
  onModeChange,
  onSelectProject,
  onSelectProjectId,
  onNewProjectFromVideo,
  onTimeSync,
  onEnterScreeningRoom,
  bgScanStatus,
  onMarkersUpdate,
}: DuetConsoleProps) {
  const currentTime = usePlayhead(workspaceMode !== "studio");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastReportedTimeRef = useRef<number>(-1);
  const isIframeReadyRef = useRef<boolean>(false);
  const lastProjectIdRef = useRef<string | null>(project?.id || null);

  // Compute initial URL with parameters
  const initialIframeSrc = useMemo(() => {
    const params = new URLSearchParams();
    const effectiveName = getEffectiveCutName(project);
    if (effectiveName && effectiveName !== "Cut") {
      params.set("name", effectiveName);
    }
    if (videoUrl) {
      params.set("video", videoUrl);
    }
    if (workspaceMode === "screening" || workspaceMode === "review") {
      params.set("mode", workspaceMode);
    }
    if (typeof currentTime === "number" && currentTime > 0) {
      params.set("time", currentTime.toFixed(3));
    }
    const queryString = params.toString();
    return queryString ? `/duet.html?${queryString}` : "/duet.html";
  }, []); // Initial load only

  // Sync mode changes to iframe
  useEffect(() => {
    if (workspaceMode === "screening" || workspaceMode === "review") {
      try {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "SET_MODE", mode: workspaceMode },
          "*"
        );
      } catch (e) {}
    }
  }, [workspaceMode]);

  // Sync video source to iframe and ensure markers are aligned
  useEffect(() => {
    if (!videoUrl) return;
    const cutName = getEffectiveCutName(project);
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "SET_VIDEO", url: videoUrl, name: cutName },
        "*"
      );
      if (project?.screeningMarks && project.screeningMarks.length > 0) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "SET_MARKERS", markers: project.screeningMarks },
          "*"
        );
      }
    } catch (e) {}
  }, [videoUrl, project?.id, project?.name, project?.videoMetadata?.filename]);

  // Sync project screening markers to iframe whenever project or screeningMarks change (clean slate on new projects)
  useEffect(() => {
    try {
      const isDifferentProject = project?.id && lastProjectIdRef.current !== project.id;
      if (isDifferentProject) {
        lastProjectIdRef.current = project.id;
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "SET_MARKERS",
            markers: project?.screeningMarks || [],
            forceClear: (project?.screeningMarks || []).length === 0,
          },
          "*"
        );
      } else if (project?.screeningMarks && project.screeningMarks.length > 0) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "SET_MARKERS", markers: project.screeningMarks },
          "*"
        );
      }
    } catch (e) {}
  }, [project?.id, project?.screeningMarks]);

  // Sync currentTime to iframe (only when external change differs from last reported)
  useEffect(() => {
    if (typeof currentTime !== "number" || isNaN(currentTime)) return;
    if (Math.abs(currentTime - lastReportedTimeRef.current) > 0.15) {
      lastReportedTimeRef.current = currentTime;
      try {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "SEEK_TIME", time: currentTime },
          "*"
        );
      } catch (e) {}
    }
  }, [currentTime]);

  // Handle messages from the DUET room iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      const data = e.data;

      if (data.type === "DUET_TIME_UPDATE" && typeof data.time === "number") {
        lastReportedTimeRef.current = data.time;
        onTimeSync?.(data.time);
      } else if (data.type === "DUET_MODE_CHANGE" && data.mode) {
        if (Array.isArray(data.markers)) {
          onMarkersUpdate?.(data.markers);
        }
        if (data.mode !== workspaceMode) {
          onModeChange(data.mode);
        }
      } else if (data.type === "DUET_INSPECT_IN_STUDIO") {
        if (typeof data.time === "number") {
          lastReportedTimeRef.current = data.time;
          onTimeSync?.(data.time);
        }
        if (Array.isArray(data.markers)) {
          onMarkersUpdate?.(data.markers);
        }
        onModeChange("studio");
      } else if (data.type === "DUET_MARKERS_UPDATE") {
        if (Array.isArray(data.markers)) {
          onMarkersUpdate?.(data.markers);
        }
      } else if (data.type === "DUET_FILE_LOADED") {
        try {
          const win = iframeRef.current?.contentWindow as any;
          const loadedFile = data.file || win?.selectedFile;
          if (loadedFile) {
            onNewProjectFromVideo(loadedFile, loadedFile.name);
            return;
          }
        } catch (err) {}
        if (data.name) {
          onNewProjectFromVideo(data.name, data.name);
        }
      } else if (data.type === "DUET_ENTER_SCREENING_ROOM") {
        let loadedFile: File | undefined = data.file;
        try {
          const win = iframeRef.current?.contentWindow as any;
          if (!loadedFile) loadedFile = win?.selectedFile;
          if (loadedFile && !videoUrl) {
            onNewProjectFromVideo(loadedFile, loadedFile.name);
          }
        } catch (err) {}
        if (Array.isArray(data.markers)) {
          onMarkersUpdate?.(data.markers);
        }
        onEnterScreeningRoom?.(data.url, loadedFile);
      } else if (data.type === "DUET_SELECT_PROJECT" && data.id) {
        onSelectProjectId?.(data.id, data.name);
      } else if (data.type === "DUET_CANCEL_CHANGE_FILM") {
        onEnterScreeningRoom?.();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [workspaceMode, onModeChange, onTimeSync, onNewProjectFromVideo, onEnterScreeningRoom, onSelectProjectId, videoUrl, onMarkersUpdate]);

  // Sync background scan status to iframe
  useEffect(() => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "BG_SCAN_UPDATE",
          status: bgScanStatus
            ? {
                active: bgScanStatus.active,
                stage: bgScanStatus.stage,
                stageLabel: bgScanStatus.stageLabel,
                progress: bgScanStatus.progress,
                statusText: bgScanStatus.statusText,
                motionActive: bgScanStatus.motionActive,
                motionProgress: bgScanStatus.motionProgress,
                stemsActive: bgScanStatus.stemsActive,
                stemsStatusText: bgScanStatus.stemsStatusText,
              }
            : null,
        },
        "*"
      );
    } catch (e) {}
  }, [bgScanStatus]);

  const handleIframeLoad = () => {
    isIframeReadyRef.current = true;
    if (videoUrl) {
      const cutName = getEffectiveCutName(project);
      iframeRef.current?.contentWindow?.postMessage(
        { type: "SET_VIDEO", url: videoUrl, name: cutName },
        "*"
      );
    }
    if (workspaceMode === "screening" || workspaceMode === "review") {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "SET_MODE", mode: workspaceMode },
        "*"
      );
    }
    if (typeof currentTime === "number" && currentTime > 0) {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "SEEK_TIME", time: currentTime },
        "*"
      );
    }
    if (bgScanStatus) {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "BG_SCAN_UPDATE",
          status: {
            active: bgScanStatus.active,
            stage: bgScanStatus.stage,
            stageLabel: bgScanStatus.stageLabel,
            progress: bgScanStatus.progress,
            statusText: bgScanStatus.statusText,
            motionActive: bgScanStatus.motionActive,
            motionProgress: bgScanStatus.motionProgress,
            stemsActive: bgScanStatus.stemsActive,
            stemsStatusText: bgScanStatus.stemsStatusText,
          },
        },
        "*"
      );
    }
  };

  return (
    <div
      className="duet-console-wrapper"
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        position: "relative",
        backgroundColor: "#0b0c10",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        flex: "1 1 0%",
      }}
    >
      <iframe
        ref={iframeRef}
        src={initialIframeSrc}
        title="DUET Screening and Review Console"
        onLoad={handleIframeLoad}
        className="duet-console-iframe"
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          flex: "1 1 0%",
          minHeight: 0,
          display: "block",
        }}
        allow="autoplay; camera; microphone; display-capture"
      />
    </div>
  );
}
