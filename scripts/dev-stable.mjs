import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import "dotenv/config";

const PORTS = [8787, 5180];
const API_HEALTH_URL = "http://localhost:8787/api/health";
const WEB_HEALTH_URL = "http://localhost:5180/";
const OLLAMA_HEALTH_URL = `${(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "")}/api/tags`;
const HEALTHCHECK_TIMEOUT_MS = 60000;
const HEALTHCHECK_INTERVAL_MS = 1200;
let ollamaChild = null;

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

function processParent(pid) {
  try {
    return Number(execSync(`ps -o ppid= -p ${pid}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim());
  } catch {
    return 0;
  }
}

function processCommand(pid) {
  try {
    return execSync(`ps -o command= -p ${pid}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

function processCwd(pid) {
  try {
    const output = execSync(`lsof -a -p ${pid} -d cwd -Fn`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .split("\n")
      .find((line) => line.startsWith("n"));
    return output?.slice(1) ?? "";
  } catch {
    return "";
  }
}

function workspaceStableLaunchers() {
  try {
    const output = execSync("pgrep -f 'node scripts/dev-stable.mjs'", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (!output) return [];
    return output
      .split(/\s+/)
      .map(Number)
      .filter((pid) => pid !== process.pid && processCwd(pid) === process.cwd());
  } catch {
    return [];
  }
}

function owningStableLauncher(pid) {
  let currentPid = pid;
  while (currentPid > 1) {
    if (processCommand(currentPid).includes("node scripts/dev-stable.mjs")) {
      return currentPid;
    }
    currentPid = processParent(currentPid);
  }
  return 0;
}

async function cleanupPorts() {
  const pids = new Set(PORTS.flatMap((port) => listPidsByPort(port)));
  const stableLaunchers = new Set([
    ...workspaceStableLaunchers(),
    ...[...pids].map(owningStableLauncher).filter((pid) => pid > 0)
  ]);
  if (pids.size === 0 && stableLaunchers.size === 0) {
    console.log("[dev:stable] No stale processes on ports 8787/5180.");
    return;
  }

  const targets = stableLaunchers.size > 0 ? stableLaunchers : pids;
  console.log(`[dev:stable] Stopping stale processes: ${[...targets].join(", ")}`);
  for (const pid of targets) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore processes that already exited.
    }
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    const portsAreFree = PORTS.every((port) => listPidsByPort(port).length === 0);
    const launchersExited = [...stableLaunchers].every((pid) => processCommand(pid).length === 0);
    if (portsAreFree && launchersExited) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  for (const pid of stableLaunchers) {
    if (processCommand(pid).length > 0) {
      process.kill(pid, "SIGKILL");
    }
  }

  if (PORTS.some((port) => listPidsByPort(port).length > 0)) {
    throw new Error("Ports 8787/5180 did not stop within 5 seconds.");
  }
}

await cleanupPorts();

async function isOllamaHealthy() {
  try {
    const response = await fetch(OLLAMA_HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureOllama() {
  if (["0", "false", "no", "off"].includes((process.env.OLLAMA_ENABLED || "true").trim().toLowerCase())) {
    return;
  }

  if (await isOllamaHealthy()) {
    console.log("[dev:stable] Ollama is ready.");
    return;
  }

  const candidates = [
    path.join(os.homedir(), ".local/bin/ollama"),
    "/Applications/Ollama.app/Contents/Resources/ollama",
    "/usr/local/bin/ollama",
    "/opt/homebrew/bin/ollama"
  ];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    console.warn("[dev:stable] Ollama is enabled but not installed; assistant review will use its fallback chain.");
    return;
  }

  ollamaChild = spawn(executable, ["serve"], {
    stdio: "ignore",
    env: process.env
  });
  ollamaChild.on("error", (error) => {
    console.warn(`[dev:stable] Could not start Ollama: ${error.message}`);
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    if (await isOllamaHealthy()) {
      console.log("[dev:stable] Ollama started automatically.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  console.warn("[dev:stable] Ollama startup timed out; assistant review will use its fallback chain.");
}

await ensureOllama();

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
  if (ollamaChild && !ollamaChild.killed) {
    ollamaChild.kill(signal);
  }
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
