export interface ScanOptions {
  cuts: boolean;
  framing: boolean;
  cast: boolean;
  dialogue: boolean;
  loudness: boolean;
  motion: boolean;
  stems: boolean;
}

export const QUICK_ANALYSIS_PRESET: ScanOptions = {
  cuts: true,
  framing: true,
  cast: true,
  dialogue: true,
  loudness: true,
  motion: false,
  stems: false,
};

export const FULL_ANALYSIS_PRESET: ScanOptions = {
  cuts: true,
  framing: true,
  cast: true,
  dialogue: true,
  loudness: true,
  motion: true,
  stems: true,
};
