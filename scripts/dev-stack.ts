type ComposeMode = "up" | "restart" | "down" | "ps" | "logs";

type CommandExecution = {
  exitCode: number;
  stdout: string;
  stderr: string;
  combinedOutput: string;
};

const COMPOSE_FILE = "docker-compose.dev.yml";

const decode = (value: Uint8Array): string => new TextDecoder().decode(value);

const quoteForShell = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

const executeCommand = (cmd: string[]): CommandExecution => {
  const result = Bun.spawnSync({
    cmd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const stdout = decode(result.stdout);
  const stderr = decode(result.stderr);

  return {
    exitCode: result.exitCode,
    stdout,
    stderr,
    combinedOutput: `${stdout}\n${stderr}`.trim(),
  };
};

export const isDockerPermissionError = (output: string): boolean => {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("permission denied") &&
    (
      normalized.includes("docker.sock") ||
      normalized.includes("docker api at unix://") ||
      normalized.includes("docker api")
    )
  );
};

export const requiresSgDockerFallback = (platform: NodeJS.Platform, output: string): boolean => {
  return platform === "linux" && isDockerPermissionError(output);
};

export const extractLatestUuidToken = (logs: string): string | null => {
  const matches = logs.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  if (!matches || matches.length === 0) {
    return null;
  }

  return matches[matches.length - 1].toLowerCase();
};

export const buildComposeCommands = (mode: ComposeMode): string[] => {
  const base = `-f ${COMPOSE_FILE}`;
  switch (mode) {
    case "up":
      return [
        `docker compose ${base} up -d`,
        `docker-compose ${base} up -d`,
      ];
    case "restart":
      return [
        `docker compose ${base} restart sharkord`,
        `docker-compose ${base} restart sharkord`,
      ];
    case "down":
      return [
        `docker compose ${base} down --volumes`,
        `docker-compose ${base} down --volumes`,
      ];
    case "ps":
      return [
        `docker compose ${base} ps`,
        `docker-compose ${base} ps`,
      ];
    case "logs":
      return [
        `docker compose ${base} logs --tail=200 sharkord`,
        `docker-compose ${base} logs --tail=200 sharkord`,
      ];
    default:
      return [];
  }
};

const composeArgsForMode = (mode: ComposeMode): string[] => {
  switch (mode) {
    case "up":
      return ["up", "-d"];
    case "restart":
      return ["restart", "sharkord"];
    case "down":
      return ["down", "--volumes"];
    case "ps":
      return ["ps"];
    case "logs":
      return ["logs", "--tail=200", "sharkord"];
    default:
      return [];
  }
};

const runCompose = (mode: ComposeMode): CommandExecution => {
  const modeArgs = composeArgsForMode(mode);
  const candidates: string[][] = [
    ["docker", "compose", "-f", COMPOSE_FILE, ...modeArgs],
    ["docker-compose", "-f", COMPOSE_FILE, ...modeArgs],
  ];

  let lastResult: CommandExecution | null = null;

  for (const cmd of candidates) {
    const attempt = executeCommand(cmd);
    if (attempt.exitCode === 0) {
      return attempt;
    }

    lastResult = attempt;

    if (requiresSgDockerFallback(process.platform, attempt.combinedOutput) && cmd[0] === "docker") {
      const shellCommand = cmd.map((part) => quoteForShell(part)).join(" ");
      const sgAttempt = executeCommand(["sg", "docker", "-c", shellCommand]);
      if (sgAttempt.exitCode === 0) {
        return sgAttempt;
      }

      lastResult = sgAttempt;
    }
  }

  return (
    lastResult ?? {
      exitCode: 1,
      stdout: "",
      stderr: "No compose command candidate available",
      combinedOutput: "No compose command candidate available",
    }
  );
};

const runBunBuild = (): CommandExecution => executeCommand(["bun", "run", "build"]);

const printStep = (label: string, result: CommandExecution): void => {
  if (result.stdout.trim().length > 0) {
    console.log(`[dev-stack] ${label} stdout:\n${result.stdout.trim()}`);
  }

  if (result.stderr.trim().length > 0) {
    console.error(`[dev-stack] ${label} stderr:\n${result.stderr.trim()}`);
  }
};

const printLinuxPermissionHelp = (): void => {
  console.error("[dev-stack] Docker socket permission denied.");
  console.error("[dev-stack] Run once: sudo usermod -aG docker $USER");
  console.error("[dev-stack] Then: newgrp docker  (or logout/login)");
};

export const runDevStack = (mode: "up" | "reload" | "fresh"): number => {
  const buildResult = runBunBuild();
  printStep("build", buildResult);

  if (buildResult.exitCode !== 0) {
    return buildResult.exitCode;
  }

  if (mode === "fresh") {
    const downResult = runCompose("down");
    printStep("compose down --volumes", downResult);
    if (downResult.exitCode !== 0 && isDockerPermissionError(downResult.combinedOutput)) {
      printLinuxPermissionHelp();
      return downResult.exitCode;
    }
  }

  const startMode: ComposeMode = mode === "reload" ? "restart" : "up";
  const startResult = runCompose(startMode);
  printStep(`compose ${startMode}`, startResult);
  if (startResult.exitCode !== 0) {
    if (isDockerPermissionError(startResult.combinedOutput)) {
      printLinuxPermissionHelp();
    }
    return startResult.exitCode;
  }

  const psResult = runCompose("ps");
  printStep("compose ps", psResult);

  const logsResult = runCompose("logs");
  printStep("compose logs", logsResult);

  const token = extractLatestUuidToken(logsResult.combinedOutput);
  if (token) {
    console.log(`[dev-stack] Initial access token: ${token}`);
  } else {
    console.log("[dev-stack] Initial access token not found in recent logs.");
  }

  console.log("[dev-stack] Sharkord URL: http://localhost:3000");

  return 0;
};

if (import.meta.main) {
  const arg = Bun.argv[2];
  const mode: "up" | "reload" | "fresh" =
    arg === "reload" || arg === "fresh" ? arg : "up";

  const code = runDevStack(mode);
  if (code !== 0) {
    process.exit(code);
  }
}
