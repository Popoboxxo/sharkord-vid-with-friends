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
  BITRATE_AUDIO: "128k",
  DEFAULT_VOLUME: 50,
  HLS_SEGMENT_DURATION: 2,
  HLS_LIST_SIZE: 15,
  SYNC_MODE: "server" as const, // "server" | "client"
} as const;

/** Audio codec configuration for Mediasoup (Opus) */
export const AUDIO_CODEC = {
  mimeType: "audio/opus" as const,
  payloadType: 111,
  clockRate: 48000,
  channels: 2,
} as const;

/** Video codec configuration for Mediasoup (H264) */
export const VIDEO_CODEC = {
  mimeType: "video/H264" as const,
  payloadType: 96,
  clockRate: 90000,
} as const;

/** Avatar URL shown in the Sharkord stream panel */
export const PLUGIN_AVATAR_URL = "https://i.imgur.com/placeholder.png";

/** Maximum queue size per channel to prevent abuse */
export const MAX_QUEUE_SIZE = 50;

/** Plugin display name */
export const PLUGIN_NAME = "Vid With Friends";
