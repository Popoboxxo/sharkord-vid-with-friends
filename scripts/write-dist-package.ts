import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

type PackageJson = {
  version?: string;
  [key: string]: unknown;
};

const pad2 = (value: number): string => value.toString().padStart(2, "0");

export const formatTimestampPostfix = (date: Date = new Date()): string => {
  const day = pad2(date.getDate());
  const month = pad2(date.getMonth() + 1);
  const year = pad2(date.getFullYear() % 100);
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());
  return `${day}${month}${year}_${hour}_${minute}_${second}`;
};

export const normalizeTimestampPostfix = (value: string): string => {
  const trimmed = value.trim();
  const match = trimmed.match(/\b\d{6}_\d{2}_\d{2}_\d{2}\b/);
  return match?.[0] ?? "unknown";
};

export const buildVersionWithTimestamp = (baseVersion: string, timestampPostfix: string): string => {
  const safeBase = baseVersion.trim() || "0.0.0";
  const safePostfix = normalizeTimestampPostfix(timestampPostfix);
  return `${safeBase}-${safePostfix}`;
};

export const buildTraceVersionLabel = (baseVersion: string, timestampPostfix: string): string => {
  const safeBase = baseVersion.trim() || "0.0.0";
  const safePostfix = normalizeTimestampPostfix(timestampPostfix);
  return `${safeBase}:${safePostfix}`;
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

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  return { version: versionWithTimestamp, outputPath };
};

if (import.meta.main) {
  const workspaceRoot = process.cwd();
  const result = writeDistPackageWithTimestampVersion(workspaceRoot);
  console.log(`[build] Dist package version: ${result.version}`);
  console.log(`[build] Wrote: ${result.outputPath}`);
}
