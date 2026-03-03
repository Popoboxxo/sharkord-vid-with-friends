/**
 * Plugin-wide constants for sharkord-watch-party.
 *
 * Referenced by: REQ-002, REQ-003, REQ-018
 */

/** Unique key used to register the stream with Sharkord voice system */
export const STREAM_KEY = "vid-with-friends";

/** Default plugin settings */
export const DEFAULT_SETTINGS = {
  BITRATE_VIDEO: "2000k",
  BITRATE_AUDIO: "256k",  // REQ-011: Erhöht auf 256k für bessere Soundqualität (von 128k)
  DEFAULT_VOLUME: 50,
  SYNC_MODE: "server" as const, // "server" | "client"
} as const;

/** Audio codec configuration for Mediasoup (Opus) */
export const AUDIO_CODEC = {
  mimeType: "audio/opus" as const,
  payloadType: 111,
  clockRate: 48000,
  channels: 2,
} as const;

/** Video codec configuration for Mediasoup (VP8) */
export const VIDEO_CODEC = {
  mimeType: "video/VP8" as const,
  payloadType: 96,
  clockRate: 90000,
} as const;

/** Avatar URL shown in the Sharkord stream panel */
export const PLUGIN_AVATAR_URL = "https://i.imgur.com/placeholder.png";

/** Maximum queue size per channel to prevent abuse */
export const MAX_QUEUE_SIZE = 50;

/** Plugin display name */
export const PLUGIN_NAME = "Vid With Friends";
