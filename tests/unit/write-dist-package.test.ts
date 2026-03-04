import { describe, expect, it } from "bun:test";
import { buildVersionWithCommit, normalizeCommitHash } from "../../scripts/write-dist-package";

describe("write-dist-package", () => {
  it("[REQ-040] should format version as base:commit", () => {
    const version = buildVersionWithCommit("0.0.1", "a1b2c3d");
    expect(version).toBe("0.0.1:a1b2c3d");
  });

  it("[REQ-040] should normalize noisy commit output", () => {
    const commit = normalizeCommitHash("\nA1B2C3D   ");
    expect(commit).toBe("a1b2c3d");
  });

  it("[REQ-040] should fallback to unknown when commit hash is invalid", () => {
    const version = buildVersionWithCommit("0.0.1", "not-a-hash");
    expect(version).toBe("0.0.1:unknown");
  });
});
