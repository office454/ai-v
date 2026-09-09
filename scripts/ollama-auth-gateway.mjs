import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const host = process.env.OLLAMA_GATEWAY_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.OLLAMA_GATEWAY_PORT || 11435);
const upstream = (process.env.OLLAMA_GATEWAY_UPSTREAM?.trim() || "http://127.0.0.1:11434").replace(/\/$/, "");
const token = process.env.OLLAMA_GATEWAY_TOKEN?.trim() || "";
const maxBodyBytes = Number(process.env.OLLAMA_GATEWAY_MAX_BODY_BYTES || 5 * 1024 * 1024);
const timeoutMs = Number(process.env.OLLAMA_GATEWAY_TIMEOUT_MS || 180_000);

if (!token) {
  console.error("OLLAMA_GATEWAY_TOKEN is required.");
  process.exit(1);
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("OLLAMA_GATEWAY_PORT must be a valid TCP port.");
  process.exit(1);
}

function authorized(value) {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(value || "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new Error("REQUEST_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  if (!authorized(request.headers.authorization)) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }

  const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
  const isCompletion = request.method === "POST" && requestUrl.pathname === "/v1/chat/completions";
  const isHealth = request.method === "GET" && requestUrl.pathname === "/health";
  if (!isCompletion && !isHealth) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    const body = isCompletion ? await readBody(request) : undefined;
    const upstreamResponse = await fetch(`${upstream}${isHealth ? "/api/tags" : requestUrl.pathname}`, {
      method: isHealth ? "GET" : "POST",
      headers: isCompletion ? { "Content-Type": "application/json" } : undefined,
      body,
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (isHealth) {
      sendJson(response, upstreamResponse.ok ? 200 : 502, {
        ok: upstreamResponse.ok,
        upstreamStatus: upstreamResponse.status
      });
      return;
    }

    const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
    response.writeHead(upstreamResponse.status, {
      "Content-Type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8"
    });
    response.end(responseBody);
  } catch (error) {
    const requestTooLarge = error instanceof Error && error.message === "REQUEST_TOO_LARGE";
    sendJson(response, requestTooLarge ? 413 : 502, {
      error: requestTooLarge ? "Request body too large" : "Ollama upstream unavailable"
    });
  }
});

server.listen(port, host, () => {
  console.log(`Authenticated Ollama gateway listening on http://${host}:${port}`);
});
