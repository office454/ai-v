import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import process from "node:process";

const workspace = "/Users/chekungoffice/Documents/ai v";
const nodePath = "/usr/local/bin/node";
const npxPath = "/usr/local/bin/npx";
const cloudflaredPath = "/Users/chekungoffice/.local/bin/cloudflared";
const gatewayScript = path.join(workspace, "scripts/ollama-auth-gateway.mjs");
const railwaySelectors = [
  "--service", "897427c6-2c99-4e68-b66e-39fada24e2c6",
  "--environment", "d6d02c88-c20e-4de6-a234-be842ff1ca77",
  "--project", "cc4d9027-29cc-4ff6-b101-dc9cb9c4e7e9"
];
const stateDirectory = path.join(process.env.HOME || "/Users/chekungoffice", ".config/ai-v");
const urlStatePath = path.join(stateDirectory, "ollama-tunnel-url");

function readGatewayToken() {
  const result = spawnSync("/usr/bin/security", [
    "find-generic-password", "-a", process.env.USER || "chekungoffice",
    "-s", "ai-v-ollama-gateway", "-w"
  ], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error("Unable to read ai-v-ollama-gateway token from macOS Keychain.");
  }
  return result.stdout.trim();
}

async function resolveTunnelAddress(hostname) {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) return undefined;
  const payload = await response.json();
  return payload.Answer?.find((answer) => answer.type === 1)?.data;
}

function requestTunnelHealth(url, token, address) {
  return new Promise((resolve, reject) => {
    const request = https.get(`${url}/health`, {
      headers: { Authorization: `Bearer ${token}` },
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [{ address, family: 4 }])
        : callback(null, address, 4),
      timeout: 5_000
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode === 200));
    });
    request.on("timeout", () => request.destroy(new Error("Tunnel health check timed out.")));
    request.on("error", reject);
  });
}

async function waitForTunnel(url, token) {
  const hostname = new URL(url).hostname;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const address = await resolveTunnelAddress(hostname);
      if (address && await requestTunnelHealth(url, token, address)) return;
    } catch {
      // The quick tunnel can take a few seconds to become reachable.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Cloudflare tunnel did not become healthy within five minutes.");
}

async function updateRailway(url, token) {
  const result = spawnSync(npxPath, [
    "-y", "@railway/cli@5.35.0", "variable", "set",
    `OLLAMA_BASE_URL=${url}`,
    ...railwaySelectors
  ], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, OLLAMA_API_KEY: token }
  });
  if (result.status !== 0) {
    throw new Error(`Railway variable update failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(urlStatePath, `${url}\n`, { mode: 0o600 });
  console.log(`Railway now uses ${url}`);
}

const token = readGatewayToken();
const children = [];

const gateway = spawn(nodePath, [gatewayScript], {
  cwd: workspace,
  env: { ...process.env, OLLAMA_GATEWAY_TOKEN: token },
  stdio: ["ignore", "inherit", "inherit"]
});
children.push(gateway);

const tunnel = spawn(cloudflaredPath, [
  "tunnel", "--url", "http://127.0.0.1:11435", "--no-autoupdate"
], {
  cwd: workspace,
  stdio: ["ignore", "pipe", "pipe"]
});
children.push(tunnel);

let configured = false;
let bufferedOutput = "";

async function inspectTunnelOutput(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);
  bufferedOutput = `${bufferedOutput}${text}`.slice(-16_384);
  const match = bufferedOutput.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!match || configured) return;
  configured = true;
  try {
    await waitForTunnel(match[0], token);
    await updateRailway(match[0], token);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    shutdown(1);
  }
}

tunnel.stdout.on("data", inspectTunnelOutput);
tunnel.stderr.on("data", inspectTunnelOutput);

function shutdown(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 250).unref();
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      console.error(`Remote Ollama child exited: code=${code} signal=${signal || "none"}`);
    }
    shutdown(code || 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (error) => {
  console.error(error);
  shutdown(1);
});
