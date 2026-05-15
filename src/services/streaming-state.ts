/**
 * Per-channel streaming state for adaptive delay and mode tracking.
 */

export const DEFAULT_PROGRESSIVE_AUDIO_DELAY_MS = 650;

// REQ-043-B: libx264 re-encode initialization takes ~600ms.
export const DEFAULT_FULL_DOWNLOAD_AUDIO_DELAY_MS = 600;

export const MIN_AUDIO_DELAY_MS = 0;
export const MAX_AUDIO_DELAY_MS = 1800;

// Drift adaptation constants
export const DRIFT_ADAPT_WINDOW_SECONDS = 25;
export const DRIFT_SAMPLE_MIN_COUNT = 8;
export const DRIFT_ADAPT_GAIN = 0.5;
export const DRIFT_PAIR_MAX_AGE_MS = 1200;
export const MAX_DELAY_STEP_PER_STREAM_MS = 220;

// REQ-050: Track last mode per channel to reset adaptive delay on mode switch
export const adaptiveAudioDelayMsByChannel = new Map<number, number>();
export const lastStreamModeMsByChannel = new Map<number, boolean>();

import { clampNumber } from "../utils/settings";

export const getAdaptiveAudioDelayMs = (channelId: number, fullDownloadMode: boolean): number => {
  if (fullDownloadMode) return DEFAULT_FULL_DOWNLOAD_AUDIO_DELAY_MS;
  const storedDelay = adaptiveAudioDelayMsByChannel.get(channelId);
  if (typeof storedDelay === "number" && Number.isFinite(storedDelay)) {
    return clampNumber(Math.round(storedDelay), MIN_AUDIO_DELAY_MS, MAX_AUDIO_DELAY_MS);
  }
  return DEFAULT_PROGRESSIVE_AUDIO_DELAY_MS;
};

export const computeTrimmedAverageMs = (samples: number[]): number => {
  if (samples.length === 0) return 0;
  if (samples.length < 5) {
    return samples.reduce((sum, value) => sum + value, 0) / samples.length;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * 0.2);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  if (trimmed.length === 0) {
    return sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  }
  return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
};
