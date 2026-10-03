import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";

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
  const allowedRoutes = new Set([
    "/health",
    "/api/tags",
    "/api/version",
    "/api/chat",
    "/api/generate",
    "/v1/chat/completions"
  ]);
  const isAllowed = allowedRoutes.has(requestUrl.pathname);
  const isCompletion = request.method === "POST" && requestUrl.pathname === "/v1/chat/completions";
  const isOllamaApiRequest = request.method === "POST" && requestUrl.pathname === "/api/chat";
  const isOllamaGenerateRequest = request.method === "POST" && requestUrl.pathname === "/api/generate";
  const isHealth = request.method === "GET" && requestUrl.pathname === "/health";
  const isTags = request.method === "GET" && requestUrl.pathname === "/api/tags";
  const isVersion = request.method === "GET" && requestUrl.pathname === "/api/version";

  if (!isAllowed) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    const body = isCompletion || isOllamaApiRequest || isOllamaGenerateRequest ? await readBody(request) : undefined;
    const upstreamPath = isHealth ? "/api/tags" : requestUrl.pathname;
    const clientAbort = new AbortController();
    request.once("aborted", () => clientAbort.abort());
    response.once("close", () => {
      if (!response.writableEnded) {
        clientAbort.abort();
      }
    });
    const upstreamResponse = await fetch(`${upstream}${upstreamPath}`, {
      method: isHealth || isTags || isVersion ? "GET" : "POST",
      headers: isCompletion || isOllamaApiRequest || isOllamaGenerateRequest ? { "Content-Type": "application/json" } : undefined,
      body,
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), clientAbort.signal])
    });

    if (isHealth || isTags || isVersion) {
      const payload = await upstreamResponse.text();
      if (!upstreamResponse.ok) {
        response.writeHead(upstreamResponse.status, { "Content-Type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8" });
        response.end(payload || JSON.stringify({ error: "Ollama upstream unavailable" }));
        return;
      }
      response.writeHead(upstreamResponse.status, {
        "Content-Type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8"
      });
      response.end(payload);
      return;
    }

    response.writeHead(upstreamResponse.status, {
      "Content-Type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8"
    });
    if (upstreamResponse.body) {
      Readable.fromWeb(upstreamResponse.body).pipe(response);
    } else {
      response.end();
    }
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
