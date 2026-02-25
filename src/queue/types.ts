/**
 * Queue types for sharkord-vid-with-friends.
 *
 * Referenced by: REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009
 */

/** Represents a single video in the queue */
export type QueueItem = {
  /** Unique identifier for this queue entry */
  id: string;
  /** The original URL or search query provided by the user */
  query: string;
  /** Resolved video title (from yt-dlp) */
  title: string;
  /** Original YouTube URL (for piping to yt-dlp), may differ from query if search was used */
  youtubeUrl: string;
  /** H.264 profile-level-id (e.g., "640028") derived from avc1 codec string */
  videoProfileLevelId: string;
  /** Resolved direct stream URL (from yt-dlp) - video or combined */
  streamUrl: string;
  /** Resolved audio-only stream URL (from yt-dlp) - may be same as streamUrl */
  audioUrl: string;
  /** Video duration in seconds (0 if unknown) */
  duration: number;
  /** Thumbnail URL */
  thumbnail: string;
  /** User ID of who added this video */
  addedBy: number;
  /** Timestamp when the item was added */
  addedAt: number;
};

/** Input to add a video before resolution (pre-yt-dlp) */
export type QueueAddInput = {
  query: string;
  addedBy: number;
};

/** Resolved video info from yt-dlp */
export type ResolvedVideo = {
  title: string;
  youtubeUrl: string;  // Original YouTube URL for piping to yt-dlp
  videoProfileLevelId: string;  // H.264 profile-level-id (e.g., "640028")
  streamUrl: string;
  audioUrl: string;
  duration: number;
  thumbnail: string;
  videoFormatId: string;  // yt-dlp format_id for video (e.g., "137")
  audioFormatId: string;  // yt-dlp format_id for audio (e.g., "251")
};

/** Current state of a channel's queue */
export type QueueState = {
  /** Currently playing item (null if nothing is playing) */
  current: QueueItem | null;
  /** Upcoming items in order */
  upcoming: QueueItem[];
  /** Total number of items (current + upcoming) */
  size: number;
};

/** Callback invoked when the queue advances to the next item */
export type QueueAdvanceCallback = (next: QueueItem | null, channelId: number) => void;
