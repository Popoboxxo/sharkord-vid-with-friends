/**
 * ffmpeg wrapper — re-exports all ffmpeg modules for backward compatibility.
 *
 * Provides pure functions for building command arguments (testable)
 * and runtime functions for spawning processes.
 *
 * Referenced by: REQ-002, REQ-003, REQ-012, REQ-043, REQ-044
 */

export * from "./ffmpeg-types";
export * from "./ffmpeg-utils";
export * from "./ffmpeg-config";
export * from "./ffmpeg-process";
export * from "./ffmpeg-hls";
