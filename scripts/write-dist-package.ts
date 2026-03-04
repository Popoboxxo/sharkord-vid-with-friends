import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

type PackageJson = {
  version?: string;
  [key: string]: unknown;
};

export const normalizeCommitHash = (value: string): string => {
  const trimmed = value.trim();
  const match = trimmed.match(/[0-9a-f]{7,40}/i);
  return (match?.[0] ?? "unknown").toLowerCase();
};

export const buildVersionWithCommit = (baseVersion: string, commitHash: string): string => {
  const safeBase = baseVersion.trim() || "0.0.0";
  const safeCommit = normalizeCommitHash(commitHash);
  return `${safeBase}:${safeCommit}`;
};

export const resolveGitCommitHash = (): string => {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--short", "HEAD"],
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  if (result.exitCode !== 0) {
    return "unknown";
  }

  return normalizeCommitHash(Buffer.from(result.stdout).toString("utf8"));
};

export const writeDistPackageWithCommitVersion = (workspaceRoot: string): { version: string; outputPath: string } => {
  const sourcePath = path.join(workspaceRoot, "package.json");
  const outDir = path.join(workspaceRoot, "dist", "sharkord-vid-with-friends");
  const outputPath = path.join(outDir, "package.json");

  const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as PackageJson;
  const baseVersion = typeof parsed.version === "string" ? parsed.version : "0.0.0";
  const commitHash = resolveGitCommitHash();
  const versionWithCommit = buildVersionWithCommit(baseVersion, commitHash);

  const output: PackageJson = {
    ...parsed,
    version: versionWithCommit,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  return { version: versionWithCommit, outputPath };
};

if (import.meta.main) {
  const workspaceRoot = process.cwd();
  const result = writeDistPackageWithCommitVersion(workspaceRoot);
  console.log(`[build] Dist package version: ${result.version}`);
  console.log(`[build] Wrote: ${result.outputPath}`);
}
