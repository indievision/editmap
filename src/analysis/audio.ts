/**
 * Produces a small display-only overview of the file's mixed soundtrack.
 * It deliberately does not infer dialogue, music, or effects from a mix.
 */
export function waveformBins(samples: Float32Array, binCount: number): number[] {
  if (!samples.length || binCount < 1) return [];
  const bins: number[] = [];
  for (let bin = 0; bin < binCount; bin++) {
    const start = Math.floor((bin * samples.length) / binCount);
    const end = Math.max(start + 1, Math.floor(((bin + 1) * samples.length) / binCount));
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
    bins.push(Math.min(1, peak));
  }
  return bins;
}

export async function analyzeLocalAudio(file: File, binCount = 1400): Promise<number[]> {
  // Prevent browser heap allocation crashes on production-length media (e.g. >500MB)
  if (file.size > 500 * 1024 * 1024) {
    throw new Error("Video exceeds 500MB. Waveform decoding bypassed to preserve browser memory; playback and sound spans remain available.");
  }
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("Audio decoding is unavailable in this browser.");
  const context = new AudioContextClass();
  try {
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    const mixed = new Float32Array(audio.length);
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const data = audio.getChannelData(channel);
      for (let i = 0; i < data.length; i++) mixed[i] += data[i] / audio.numberOfChannels;
    }
    return waveformBins(mixed, binCount);
  } finally {
    await context.close();
  }
}

export function amplitudeToDb(amp: number): number {
  if (amp <= 0.0001) return -48;
  return Math.max(-48, Math.min(0, 20 * Math.log10(amp)));
}

export type AudioPoint = {
  time: number;
  db: number;
  normalized: number;
  peakDb?: number;
  peakNormalized?: number;
};

export function audioIntensityCurve(
  waveform: number[],
  duration: number,
  windowSeconds: number,
  pointsCount = 601,
): AudioPoint[] {
  if (duration <= 0 || !waveform.length) {
    return Array.from({ length: pointsCount }, (_, i) => ({
      time: duration > 0 ? (i * duration) / Math.max(1, pointsCount - 1) : 0,
      db: -48,
      normalized: 0,
      peakDb: -48,
      peakNormalized: 0,
    }));
  }

  const binDuration = duration / waveform.length;

  return Array.from({ length: pointsCount }, (_, i) => {
    const time = (i * duration) / (pointsCount - 1);
    const windowStart = Math.max(0, time - windowSeconds / 2);
    const windowEnd = Math.min(duration, time + windowSeconds / 2);

    const startBin = Math.floor(windowStart / binDuration);
    const endBin = Math.min(waveform.length - 1, Math.ceil(windowEnd / binDuration));

    let sumWeight = 0;
    let sumSq = 0;
    let maxAmp = 0;

    if (startBin <= endBin && startBin >= 0) {
      for (let b = startBin; b <= endBin; b++) {
        const binCenterTime = (b + 0.5) * binDuration;
        const normalizedDist = Math.abs(binCenterTime - time) / (windowSeconds / 2 || 1);
        const w = Math.cos(Math.min(1, normalizedDist) * (Math.PI / 2));
        const amp = waveform[b] ?? 0;
        sumSq += amp * amp * w;
        sumWeight += w;
        if (amp > maxAmp) maxAmp = amp;
      }
    }

    const rms = sumWeight > 0 ? Math.sqrt(sumSq / sumWeight) : 0;
    const effectiveAmp = Math.min(1, Math.max(rms * 1.35, maxAmp * 0.7, (rms * 2 + maxAmp) / 3));

    const db = amplitudeToDb(effectiveAmp);
    const normalized = (db + 48) / 48; // -48dB -> 0, 0dB -> 1
    const peakDb = amplitudeToDb(maxAmp);
    const peakNormalized = (peakDb + 48) / 48;

    return { time, db, normalized, peakDb, peakNormalized };
  });
}

