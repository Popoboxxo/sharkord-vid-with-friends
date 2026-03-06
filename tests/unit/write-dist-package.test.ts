import { describe, expect, it } from "bun:test";
import {
  buildTraceVersionLabel,
  buildVersionWithTimestamp,
  formatTimestampPostfix,
  normalizeTimestampPostfix,
} from "../../scripts/write-dist-package";

describe("write-dist-package", () => {
  it("[REQ-040] should format semver-compatible version as base-timestamp", () => {
    const version = buildVersionWithTimestamp("0.0.1", "070326-15-04-09");
    expect(version).toBe("0.0.1-070326-15-04-09");
  });

  it("[REQ-040] should expose trace label as base:readable timestamp", () => {
    const label = buildTraceVersionLabel("0.0.1", "070326-15-04-09");
    expect(label).toBe("0.0.1:070326_15_04_09");
  });

  it("[REQ-040] should normalize noisy timestamp input", () => {
    const postfix = normalizeTimestampPostfix("\n070326-15-04-09   ");
    expect(postfix).toBe("070326-15-04-09");
  });

  it("[REQ-040] should fallback to unknown when timestamp is invalid", () => {
    const version = buildVersionWithTimestamp("0.0.1", "not-a-timestamp");
    expect(version).toBe("0.0.1-unknown");
  });

  it("[REQ-040] should format DDMMYY-HH-MM-SS postfix from Date", () => {
    const fixed = new Date(2026, 2, 7, 9, 8, 5); // local time: 07.03.2026 09:08:05
    const postfix = formatTimestampPostfix(fixed);
    expect(postfix).toBe("070326-09-08-05");
  });
});
