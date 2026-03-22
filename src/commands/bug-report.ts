/**
 * /vid-bugreport <description> — Create an anonymized GitHub issue for bug reports.
 *
 * Collects: plugin version, current settings (no secrets), last ~100 log lines
 * (anonymized), queue/stream status. Posts to GitHub via REST API if a token
 * is configured, otherwise returns a formatted report for manual submission.
 *
 * Referenced by: REQ-041
 */
import { readFileSync, existsSync } from "fs";
import path from "path";

const GITHUB_REPO = "popoboxxo/sharkord-vid-with-friends";
const GITHUB_API = "https://api.github.com";
const LOG_LINES_TO_INCLUDE = 100;

type PluginContextLike = {
  commands: {
    register: <TArgs = void>(command: {
      name: string;
      description?: string;
      args?: { name: string; description?: string; type: string; required?: boolean }[];
      executes: (invoker: { userId: number; currentVoiceChannelId?: number }, args: TArgs) => Promise<unknown>;
    }) => void;
  };
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  settings?: {
    get?: <T = unknown>(key: string) => T | undefined;
  };
};

/** Replace user IDs, IPs, and long URLs with placeholders for anonymization. */
const anonymizeLogLine = (line: string): string => {
  // Replace numeric user IDs that appear after "user " or "userId:"
  let result = line.replace(/\b(user\s+|userId[":]\s*)(\d+)/gi, "$1[USER]");
  // Truncate long URLs (CDN, manifests) — keep domain only
  result = result.replace(/https?:\/\/([^/\s]{1,60})[^\s"']*/g, (_, domain) => `https://${domain}/[...]`);
  // Replace IP addresses
  result = result.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP]");
  return result;
};

/** Read the last N lines of the Sharkord combined.log, anonymized. */
const readRecentLogs = (lineCount: number): string => {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  const logPath = path.join(homeDir, ".config", "sharkord", "logs", "combined.log");

  if (!existsSync(logPath)) {
    return "(log file not found)";
  }

  try {
    const content = readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const recent = lines.slice(-lineCount);
    return recent.map(anonymizeLogLine).join("\n");
  } catch {
    return "(could not read log file)";
  }
};

/** Read the last N lines of error.log, anonymized. */
const readErrorLogs = (): string => {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  const logPath = path.join(homeDir, ".config", "sharkord", "logs", "error.log");

  if (!existsSync(logPath)) return "(no error.log found)";

  try {
    const content = readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const recent = lines.slice(-30);
    return recent.map(anonymizeLogLine).join("\n");
  } catch {
    return "(could not read error.log)";
  }
};

/** Read plugin version from the dist package.json. */
const readPluginVersion = (): string => {
  try {
    const distPkg = path.join(process.cwd(), "package.json");
    if (existsSync(distPkg)) {
      const pkg = JSON.parse(readFileSync(distPkg, "utf-8")) as { version?: string };
      return pkg.version ?? "unknown";
    }
  } catch { /* */ }
  return "unknown";
};

/** Build the full GitHub issue body. */
const buildIssueBody = (
  description: string,
  settings: Record<string, unknown>,
  version: string,
  recentLogs: string,
  errorLogs: string
): string => {
  const settingsBlock = Object.entries(settings)
    .filter(([key]) => key !== "githubToken") // never include token
    .map(([k, v]) => `  ${k}: ${String(v)}`)
    .join("\n");

  return `## Bug Description

${description}

## Environment

- **Plugin Version:** \`${version}\`
- **Platform:** ${process.platform}
- **Reported at:** ${new Date().toISOString()}

## Active Settings

\`\`\`
${settingsBlock || "  (settings not available)"}
\`\`\`

## Recent Log (last ${LOG_LINES_TO_INCLUDE} lines, anonymized)

\`\`\`
${recentLogs}
\`\`\`

## Error Log (last 30 lines, anonymized)

\`\`\`
${errorLogs}
\`\`\`

---
*This report was generated automatically by \`/vid-bugreport\`. User IDs and IPs have been anonymized.*`;
};

/**
 * Create an anonymous public GitHub Gist with the report. Returns the Gist URL.
 * No token required — GitHub allows unauthenticated gist creation.
 */
const createAnonymousGist = async (title: string, body: string): Promise<string> => {
  const response = await fetch(`${GITHUB_API}/gists`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      description: title,
      public: true,
      files: {
        "bug-report.md": { content: `# ${title}\n\n${body}` },
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "(no body)");
    throw new Error(`GitHub Gist API error ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json() as { html_url?: string };
  return data.html_url ?? "(no URL in response)";
};

/** Post a GitHub issue via REST API. Returns the issue URL on success. */
const postGitHubIssue = async (
  token: string,
  title: string,
  body: string
): Promise<string> => {
  const response = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title,
      body,
      labels: ["bug", "user-report"],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "(no body)");
    throw new Error(`GitHub API error ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json() as { html_url?: string };
  return data.html_url ?? "(no URL in response)";
};

export const registerBugReportCommand = (ctx: PluginContextLike): void => {
  ctx.commands.register<{ description: string }>({
    name: "vid-bugreport",
    description: "Report a bug — creates an anonymized GitHub issue",
    args: [
      {
        name: "description",
        description: "Describe the problem you encountered",
        type: "string",
        required: true,
      },
    ],
    executes: async (_invoker, args) => {
      const description = args.description?.trim();
      if (!description) {
        throw new Error("Please describe the problem: /vid-bugreport <description>");
      }

      // Collect settings (exclude token)
      const settingKeys = ["videoBitrate", "audioBitrate", "defaultVolume", "syncMode", "fullDownloadMode", "debugMode"];
      const settings: Record<string, unknown> = {};
      for (const key of settingKeys) {
        settings[key] = ctx.settings?.get?.(key) ?? "(not set)";
      }

      const version = readPluginVersion();
      const recentLogs = readRecentLogs(LOG_LINES_TO_INCLUDE);
      const errorLogs = readErrorLogs();
      const issueTitle = `[User Report] ${description.substring(0, 80)}`;
      const issueBody = buildIssueBody(description, settings, version, recentLogs, errorLogs);

      const token = ctx.settings?.get?.<string>("githubToken");

      if (!token || !token.trim()) {
        // No token — create an anonymous public Gist instead
        ctx.log("[bugreport] No token configured, creating anonymous Gist...");
        try {
          const gistUrl = await createAnonymousGist(issueTitle, issueBody);
          ctx.log(`[bugreport] Gist created: ${gistUrl}`);
          const issueNewUrl = `https://github.com/${GITHUB_REPO}/issues/new`;
          return [
            `Report saved as Gist: ${gistUrl}`,
            `Open a new issue and paste the Gist link: ${issueNewUrl}`,
          ].join("\n");
        } catch (gistErr) {
          const msg = gistErr instanceof Error ? gistErr.message : String(gistErr);
          ctx.error("[bugreport] Gist creation failed:", msg);
          // Final fallback: plain text
          return [
            "Could not create Gist (no internet access?).",
            `Report manually at: https://github.com/${GITHUB_REPO}/issues/new`,
            "",
            `**Title:** ${issueTitle}`,
            "",
            issueBody,
          ].join("\n");
        }
      }

      ctx.log("[bugreport] Posting GitHub issue...");
      try {
        const issueUrl = await postGitHubIssue(token.trim(), issueTitle, issueBody);
        ctx.log(`[bugreport] Issue created: ${issueUrl}`);
        return `Bug report submitted: ${issueUrl}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.error("[bugreport] Failed to post GitHub issue:", msg);
        throw new Error(`Could not create GitHub issue: ${msg}`);
      }
    },
  });
};
