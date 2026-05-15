/**
 * Temp file cleanup utility.
 */
import { existsSync, readdirSync, unlinkSync } from "fs";
import path from "path";

export const sweepOrphanedTempFiles = (): void => {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  const cacheDir = path.join(homeDir, ".config", "sharkord", "vid-with-friends-cache");

  if (!existsSync(cacheDir)) return;

  let files: string[];
  try {
    files = readdirSync(cacheDir);
  } catch {
    return;
  }

  for (const file of files) {
    if (!file.startsWith("temp-")) continue;
    const filePath = path.join(cacheDir, file);
    try {
      unlinkSync(filePath);
    } catch {
      // Ignore — file may be locked by a still-running process
    }
  }
};
