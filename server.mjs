import http from "node:http";
import { PORT } from "./src/constants.mjs";
import {
  buildCorsHeaders,
  sendJson,
  isAllowedHost,
  isAllowedOrigin,
  isAuthorized,
  loadOrCreateAuthToken
} from "./src/auth.mjs";
import {
  loadServerConfig,
  saveServerConfig,
  getProviderConfig
} from "./src/config.mjs";
import { clearCache } from "./src/cache.mjs";
import { translateText, translateTextStream } from "./src/translate.mjs";
import { warmOllamaModel } from "./src/providers/ollama.mjs";
import { stopMLXServer } from "./src/providers/mlx.mjs";
import { stopArgosWorker } from "./src/providers/argos.mjs";

const PUBLIC_ENDPOINTS = new Set(["/health"]);

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  try {
    if (!isAllowedHost(request)) {
      response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Host not allowed." }));
      return;
    }

    if (!isAllowedOrigin(request)) {
      response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Origin not allowed." }));
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, buildCorsHeaders(request));
      response.end();
      return;
    }

    const requiresAuth = !PUBLIC_ENDPOINTS.has(request.url ?? "");
    if (requiresAuth && !(await isAuthorized(request))) {
      sendJson(request, response, 401, {
        error: "Missing or invalid pairing token. Paste the token from the server console into the extension Options page."
      });
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(request, response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && request.url === "/config") {
      const serverConfig = await loadServerConfig();
      const providerConfig = getProviderConfig(serverConfig);
      sendJson(request, response, 200, {
        provider: serverConfig.provider,
        openaiModel: serverConfig.openaiModel,
        zaiModel: serverConfig.zaiModel,
        zaiEndpoint: serverConfig.zaiEndpoint,
        argosPythonPath: serverConfig.argosPythonPath,
        ollamaBaseUrl: serverConfig.ollamaBaseUrl,
        ollamaModel: serverConfig.ollamaModel,
        mlxModel: serverConfig.mlxModel,
        mlxPort: serverConfig.mlxPort,
        activeModel: providerConfig.model,
        activeEndpoint: providerConfig.endpoint,
        hasOpenAiKey: Boolean(serverConfig.openaiApiKey),
        hasZaiKey: Boolean(serverConfig.zaiApiKey)
      });
      return;
    }

    if (request.method === "POST" && request.url === "/config") {
      const payload = await readJson(request);
      const serverConfig = await saveServerConfig(payload);
      clearCache();
      const providerConfig = getProviderConfig(serverConfig);
      if (providerConfig.provider === "ollama") {
        warmOllamaModel(providerConfig.baseURL, providerConfig.model);
      }
      sendJson(request, response, 200, {
        ok: true,
        provider: serverConfig.provider,
        activeModel: providerConfig.model,
        activeEndpoint: providerConfig.endpoint,
        hasOpenAiKey: Boolean(serverConfig.openaiApiKey),
        hasZaiKey: Boolean(serverConfig.zaiApiKey)
      });
      return;
    }

    if (request.method === "POST" && request.url === "/translate") {
      const payload = await readJson(request);
      const result = await translateText(payload);
      sendJson(request, response, result.statusCode, result.body);
      return;
    }

    if (request.method === "POST" && request.url === "/translate/stream") {
      const payload = await readJson(request);
      response.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        ...buildCorsHeaders(request)
      });

      const controller = new AbortController();
      request.on("close", () => controller.abort());

      try {
        for await (const event of translateTextStream(payload, controller.signal)) {
          response.write(`${JSON.stringify(event)}\n`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stream failed.";
        try {
          response.write(`${JSON.stringify({ type: "error", error: message, statusCode: 500 })}\n`);
        } catch {
          // socket may already be closed
        }
      } finally {
        response.end();
      }
      return;
    }

    sendJson(request, response, 404, { error: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    sendJson(request, response, 500, { error: message });
  }
});

server.listen(PORT, "127.0.0.1", async () => {
  console.log(`Cursor AI Translator server listening on http://127.0.0.1:${PORT}`);
  await loadOrCreateAuthToken();
  const serverConfig = await loadServerConfig();
  const providerConfig = getProviderConfig(serverConfig);
  console.log(`Provider: ${providerConfig.provider}`);
  console.log(`Model: ${providerConfig.model}`);
  console.log(`Endpoint: ${providerConfig.endpoint}`);
  if (providerConfig.provider === "ollama") {
    warmOllamaModel(providerConfig.baseURL, providerConfig.model);
  }
});

function shutdown() {
  stopMLXServer();
  stopArgosWorker();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
