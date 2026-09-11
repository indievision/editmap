import type { DmeWaveforms } from "../models/project";
import { fetchLocalModel } from "./localModel";

export async function checkDmeService(): Promise<{
  available: boolean;
  status: string;
  device?: string;
}> {
  try {
    const res = await fetchLocalModel("/api/dme-status", { method: "GET" });
    if (!res.ok) return { available: false, status: "offline" };
    const data = await res.json();
    return {
      available: true,
      status: data.status,
      device: data.device,
    };
  } catch {
    return { available: false, status: "offline" };
  }
}

export async function separateDmeAudio(
  file: File,
  binCount = 1400,
  onProgress?: (statusText: string) => void,
): Promise<DmeWaveforms> {
  onProgress?.("Uploading audio to local Demucs engine...");

  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("binCount", String(binCount));

  onProgress?.("Separating Dialogue, Music, and Effects on local machine...");

  const response = await fetchLocalModel("/api/separate-dme", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let errorDetail = "DME separation failed";
    try {
      const errJson = await response.json();
      if (errJson.detail) errorDetail = errJson.detail;
    } catch {
      // Non-JSON error
    }
    throw new Error(errorDetail);
  }

  const data = await response.json();

  return {
    dialogue: data.dialogue,
    music: data.music,
    effects: data.effects,
    binCount: data.binCount || binCount,
    duration: data.duration || 0,
    separatedAt: new Date().toISOString(),
  };
}
