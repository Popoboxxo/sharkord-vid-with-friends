import { describe, expect, it } from "bun:test";
import {
  buildComposeCommands,
  extractLatestUuidToken,
  isDockerPermissionError,
  requiresSgDockerFallback,
} from "../../scripts/dev-stack";

describe("dev-stack", () => {
  it("[REQ-041] should build compose up command candidates", () => {
    const commands = buildComposeCommands("up");
    expect(commands[0]).toContain("docker compose -f docker-compose.dev.yml up -d");
    expect(commands[1]).toContain("docker-compose -f docker-compose.dev.yml up -d");
  });

  it("[REQ-041] should detect docker socket permission errors", () => {
    const output = "permission denied while trying to connect to the docker API at unix:///var/run/docker.sock";
    expect(isDockerPermissionError(output)).toBe(true);
  });

  it("[REQ-041] should require sg fallback on linux permission errors", () => {
    expect(requiresSgDockerFallback("linux", "permission denied while trying to connect to the docker API")).toBe(true);
    expect(requiresSgDockerFallback("win32", "permission denied while trying to connect to the docker API")).toBe(false);
  });

  it("[REQ-041] should extract latest UUID token from logs", () => {
    const logs = [
      "initial access token: 11111111-1111-1111-1111-111111111111",
      "initial access token: 22222222-2222-2222-2222-222222222222",
    ].join("\n");

    expect(extractLatestUuidToken(logs)).toBe("22222222-2222-2222-2222-222222222222");
  });
});
