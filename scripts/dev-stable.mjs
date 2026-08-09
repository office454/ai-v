import { execSync, spawn } from "node:child_process";

const PORTS = [8787, 5180];
const API_HEALTH_URL = "http://localhost:8787/api/health";
const WEB_HEALTH_URL = "http://localhost:5180/";
const HEALTHCHECK_TIMEOUT_MS = 60000;
const HEALTHCHECK_INTERVAL_MS = 1200;

function listPidsByPort(port) {
  try {
    const output = execSync(`lsof -ti tcp:${port}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();

    if (!output) return [];

    return [...new Set(output.split(/\s+/).map((value) => Number(value)).filter(Number.isFinite))];
  } catch {
    return [];
  }
}

function cleanupPorts() {
  const pids = new Set(PORTS.flatMap((port) => listPidsByPort(port)));
  if (pids.size === 0) {
    console.log("[dev:stable] No stale processes on ports 8787/5180.");
    return;
  }

  console.log(`[dev:stable] Stopping stale processes: ${[...pids].join(", ")}`);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore processes that already exited.
    }
  }
}

cleanupPorts();

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const child = spawn(npmCommand, ["run", "dev:raw"], {
  stdio: "inherit",
  env: process.env
});

async function isApiHealthy() {
  try {
    const response = await fetch(API_HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function isWebHealthy() {
  try {
    const response = await fetch(WEB_HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function runStartupHealthcheck() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < HEALTHCHECK_TIMEOUT_MS) {
    const [apiOk, webOk] = await Promise.all([isApiHealthy(), isWebHealthy()]);
    if (apiOk && webOk) {
      console.log("[dev:stable] Healthcheck passed: API(8787) + Web(5180) are ready.");
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, HEALTHCHECK_INTERVAL_MS));
  }

  console.warn(
    `[dev:stable] Healthcheck timeout after ${HEALTHCHECK_TIMEOUT_MS / 1000}s. ` +
      "Check API logs, Web logs, and /api/model/data-source for readiness details."
  );
}

void runStartupHealthcheck();

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
