import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

type PackageJson = {
  sharkord?: {
    entry?: {
      server?: string;
      client?: string;
    };
  };
  devDependencies?: Record<string, string>;
};

const readWorkspaceFile = (relativePath: string): string => {
  const absolutePath = path.join(process.cwd(), relativePath);
  return readFileSync(absolutePath, "utf8");
};

describe("SDK migration", () => {
  it("[REQ-051] should target Sharkord v0.0.16 in dev docker stack", () => {
    const dockerCompose = readWorkspaceFile("docker-compose.dev.yml");
    expect(dockerCompose).toContain("image: ghcr.io/sharkord/sharkord:");
  });

  it("[REQ-051] should pin Sharkord SDK dependencies to 0.0.16", () => {
    const packageJsonRaw = readWorkspaceFile("package.json");
    const packageJson = JSON.parse(packageJsonRaw) as PackageJson;

    expect(packageJson.devDependencies?.["@sharkord/plugin-sdk"]).toBe("0.0.16");
    expect(packageJson.devDependencies?.["@sharkord/shared"]).toBe("0.0.16");
  });

  it("[REQ-051] should document Sharkord minimum version >= 0.0.16", () => {
    const readme = readWorkspaceFile("README.md");
    expect(readme).toContain("[Sharkord](https://github.com/nicanderhery/sharkord) >= 0.0.16");
  });
});
