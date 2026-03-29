import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

type PackageJson = {
  name?: string;
  description?: string;
  version?: string;
  sharkord?: {
    entry?: {
      server?: string;
      client?: string;
    };
    author?: string;
    homepage?: string;
    description?: string;
    logo?: string;
  };
  [key: string]: unknown;
};

type SharkordManifest = {
  id: string;
  name: string;
  version: string;
  sdkVersion: number;
  description: string;
  author: string;
  homepage: string;
  logo?: string;
  main: string;
  server: string;
  client: string;
  serverEntry: string;
  clientEntry: string;
  entry: {
    server: string;
    client: string;
  };
};

const pad2 = (value: number): string => value.toString().padStart(2, "0");

export const formatTimestampPostfix = (date: Date = new Date()): string => {
  const day = pad2(date.getDate());
  const month = pad2(date.getMonth() + 1);
  const year = pad2(date.getFullYear() % 100);
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());
  return `${day}${month}${year}-${hour}-${minute}-${second}`;
};

export const normalizeTimestampPostfix = (value: string): string => {
  const trimmed = value.trim();
  const match = trimmed.match(/\b\d{6}-\d{2}-\d{2}-\d{2}\b/);
  return match?.[0] ?? "unknown";
};

const toReadableTimestampPostfix = (postfix: string): string => postfix.replace(/-/g, "_");

export const buildVersionWithTimestamp = (baseVersion: string, timestampPostfix: string): string => {
  const safeBase = baseVersion.trim() || "0.0.0";
  const safePostfix = normalizeTimestampPostfix(timestampPostfix);
  return `${safeBase}-${safePostfix}`;
};

export const buildTraceVersionLabel = (baseVersion: string, timestampPostfix: string): string => {
  const safeBase = baseVersion.trim() || "0.0.0";
  const safePostfix = normalizeTimestampPostfix(timestampPostfix);
  return `${safeBase}:${toReadableTimestampPostfix(safePostfix)}`;
};

export const resolveBuildTimestampPostfix = (): string => formatTimestampPostfix(new Date());

export const writeDistPackageWithTimestampVersion = (workspaceRoot: string): { version: string; outputPath: string } => {
  const sourcePath = path.join(workspaceRoot, "package.json");
  const outDir = path.join(workspaceRoot, "dist", "sharkord-vid-with-friends");
  const outputPath = path.join(outDir, "package.json");

  const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as PackageJson;
  const baseVersion = typeof parsed.version === "string" ? parsed.version : "0.0.0";
  const timestampPostfix = resolveBuildTimestampPostfix();
  const versionWithTimestamp = buildVersionWithTimestamp(baseVersion, timestampPostfix);
  const traceVersionLabel = buildTraceVersionLabel(baseVersion, timestampPostfix);

  const output: PackageJson = {
    ...parsed,
    version: versionWithTimestamp,
    sharkordVersionTrace: traceVersionLabel,
  };

  const manifest: SharkordManifest = {
    id: typeof parsed.name === "string" && parsed.name.trim().length > 0
      ? parsed.name.trim()
      : "sharkord-vid-with-friends",
    name: typeof parsed.name === "string" && parsed.name.trim().length > 0
      ? parsed.name.trim()
      : "sharkord-vid-with-friends",
    version: versionWithTimestamp,
    sdkVersion: 1,
    description:
      (typeof parsed.sharkord?.description === "string" && parsed.sharkord.description.trim().length > 0
        ? parsed.sharkord.description.trim()
        : (typeof parsed.description === "string" ? parsed.description.trim() : "")) ||
      "Sharkord plugin",
    author: typeof parsed.sharkord?.author === "string" && parsed.sharkord.author.trim().length > 0
      ? parsed.sharkord.author.trim()
      : "Unknown",
    homepage: typeof parsed.sharkord?.homepage === "string" && parsed.sharkord.homepage.trim().length > 0
      ? parsed.sharkord.homepage.trim()
      : "",
    logo: typeof parsed.sharkord?.logo === "string" && parsed.sharkord.logo.trim().length > 0
      ? parsed.sharkord.logo.trim()
      : undefined,
    main: "index.js",
    server: "server.js",
    client: "client.js",
    serverEntry: "server.js",
    clientEntry: "client.js",
    entry: {
      server: "server.js",
      client: "client.js",
    },
  };

  const manifestPath = path.join(outDir, "manifest.json");
  const bundledIndexPath = path.join(outDir, "index.js");
  const serverEntryPath = path.join(outDir, "server.js");
  const clientEntryPath = path.join(outDir, "client.js");
  const serverDir = path.join(outDir, "server");
  const clientDir = path.join(outDir, "client");
  const serverIndexPath = path.join(serverDir, "index.js");
  const clientIndexPath = path.join(clientDir, "index.js");

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // Compatibility aliases for different Sharkord loader conventions.
  if (existsSync(bundledIndexPath)) {
    mkdirSync(serverDir, { recursive: true });
    mkdirSync(clientDir, { recursive: true });
    copyFileSync(bundledIndexPath, serverEntryPath);
    copyFileSync(bundledIndexPath, clientEntryPath);
    copyFileSync(bundledIndexPath, serverIndexPath);
    copyFileSync(bundledIndexPath, clientIndexPath);
  }

  return { version: versionWithTimestamp, outputPath };
};

if (import.meta.main) {
  const workspaceRoot = process.cwd();
  const result = writeDistPackageWithTimestampVersion(workspaceRoot);
  console.log(`[build] Dist package version: ${result.version}`);
  console.log(`[build] Wrote: ${result.outputPath}`);
}
