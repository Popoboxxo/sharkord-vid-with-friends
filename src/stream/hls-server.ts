/**
 * HLS HTTP Server for streaming video playlists.
 *
 * Provides a lightweight HTTP server to serve HLS playlists (.m3u8) and video segments (.ts)
 * to Sharkord voice channels. Uses Bun's native HTTP server for minimal overhead.
 *
 * Referenced by: REQ-002, REQ-028-B
 */

import { readFile, exists } from "fs/promises";
import { join, extname } from "path";

export interface HLSServerConfig {
  /** Port to listen on (e.g., 3001) */
  port: number;
  /** Directory containing .m3u8 and .ts files */
  contentDir: string;
  /** Announced hostname (e.g., localhost, 127.0.0.1, or external IP) */
  hostname: string;
}

export interface HLSServerHandle {
  /** Base URL for HLS playlist (e.g., http://localhost:3001) */
  baseUrl: string;
  /** Stop the server and cleanup resources */
  close: () => Promise<void>;
}

/**
 * Start an HTTP server for serving HLS streams.
 *
 * Serves:
 * - *.m3u8 (HLS playlist manifest, Content-Type: application/vnd.apple.mpegurl)
 * - *.ts (MPEG-TS video segments, Content-Type: video/mp2t)
 *
 * Includes CORS headers for Sharkord web client.
 *
 * @param config Server configuration
 * @returns Handle with baseUrl and close() method
 * @throws Error if port is in use or directory doesn't exist
 *
 * @example
 * const hls = await startHLSServer({
 *   port: 3001,
 *   contentDir: "/tmp/hls-stream-3",
 *   hostname: "127.0.0.1",
 * });
 * console.log(hls.baseUrl); // "http://127.0.0.1:3001"
 * // ... stream HLS files to contentDir ...
 * await hls.close(); // Stop server and cleanup
 */
export const startHLSServer = async (
  config: HLSServerConfig
): Promise<HLSServerHandle> => {
  const { port, contentDir, hostname } = config;

  // Verify content directory exists
  const dirExists = await exists(contentDir);
  if (!dirExists) {
    throw new Error(`HLS content directory does not exist: ${contentDir}`);
  }

  const baseUrl = `http://${hostname}:${port}`;

  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      port,
      hostname,
      async fetch(req) {
        const url = new URL(req.url);
        const pathname = url.pathname;

        // Only serve .m3u8 and .ts files
        const ext = extname(pathname);
        if (ext !== ".m3u8" && ext !== ".ts") {
          return new Response("Not Found", { status: 404 });
        }

        // Prevent directory traversal
        if (pathname.includes("..")) {
          return new Response("Forbidden", { status: 403 });
        }

        // Construct safe file path
        const filePath = join(contentDir, pathname);

        // Double-check that filePath is still within contentDir
        if (!filePath.startsWith(contentDir)) {
          return new Response("Forbidden", { status: 403 });
        }

        try {
          // Check if file exists
          const fileExists = await exists(filePath);
          if (!fileExists) {
            return new Response("Not Found", { status: 404 });
          }

          // Read file
          const fileBuffer = await readFile(filePath);

          // Determine content type
          let contentType = "application/octet-stream";
          if (ext === ".m3u8") {
            contentType = "application/vnd.apple.mpegurl";
          } else if (ext === ".ts") {
            contentType = "video/mp2t";
          }

          // Return file with CORS headers
          return new Response(fileBuffer, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(fileBuffer.length),
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
              "Cache-Control": "no-cache",
            },
          });
        } catch (err) {
          console.error(`[HLS-Server] Error serving ${filePath}:`, err);
          return new Response("Internal Server Error", { status: 500 });
        }
      },
    });

    // Resolve immediately with handle
    resolve({
      baseUrl,
      close: async () => {
        server.stop();
      },
    });
  });
};
