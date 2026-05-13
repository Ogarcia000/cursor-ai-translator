import http from "node:http";
import { existsSync } from "node:fs";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(APP_DIR, "server-config.json");
const AUTH_PATH = path.join(APP_DIR, "server-auth.json");
const ALLOWED_LOOPBACK_HOSTS = new Set([
  `127.0.0.1:${PORT}`,
  `localhost:${PORT}`,
  `[::1]:${PORT}`
]);
const ALLOWED_OLLAMA_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
let cachedAuthToken = null;
const MLX_VENV_DIR = path.join(APP_DIR, ".venv-mlx");
const MLX_VENV_PYTHON = path.join(MLX_VENV_DIR, "bin", "python3");
const MLX_MODELS_DIR = path.join(APP_DIR, ".mlx-models");
const DEFAULT_SERVER_CONFIG = {
  provider: (process.env.AI_PROVIDER ?? "argos").toLowerCase(),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
  zaiApiKey: process.env.ZAI_API_KEY ?? "",
  zaiModel: process.env.ZAI_MODEL ?? "glm-4.6",
  zaiEndpoint: (process.env.ZAI_ENDPOINT ?? "general").toLowerCase(),
  zaiBaseUrl: process.env.ZAI_BASE_URL ?? "https://api.z.ai/api/paas/v4/",
  zaiCodingBaseUrl: process.env.ZAI_CODING_BASE_URL ?? "https://api.z.ai/api/coding/paas/v4/",
  argosPythonPath: process.env.ARGOS_PYTHON_PATH ?? path.join(APP_DIR, ".venv-local", "bin", "python"),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/api",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen2.5:0.5b",
  mlxModel: process.env.MLX_MODEL ?? "mlx-community/Qwen2.5-0.5B-Instruct-4bit",
  mlxPort: Number.parseInt(process.env.MLX_PORT ?? "11435", 10)
};
const MAX_TEXT_LENGTH = 4000;
const TRANSLATION_CACHE_LIMIT = 120;
const translationCache = new Map();
let argosWorker = null;
let argosWorkerBuffer = "";
const argosPendingRequests = [];
let mlxServer = null;
let mlxServerModel = "";
let mlxServerPort = 0;
let mlxStartPromise = null;
function buildCorsHeaders(request) {
  const origin = request.headers.origin ?? "";
  const allowOrigin = origin.startsWith("chrome-extension://") ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  };
}

function jsonHeaders(request) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    ...buildCorsHeaders(request)
  };
}

function sendJson(request, response, statusCode, payload) {
  response.writeHead(statusCode, jsonHeaders(request));
  response.end(JSON.stringify(payload));
}

function isAllowedHost(request) {
  const host = (request.headers.host ?? "").toLowerCase();
  return ALLOWED_LOOPBACK_HOSTS.has(host);
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  return origin.startsWith("chrome-extension://");
}

async function loadOrCreateAuthToken() {
  if (cachedAuthToken) {
    return cachedAuthToken;
  }

  if (existsSync(AUTH_PATH)) {
    try {
      const raw = await readFile(AUTH_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed.token === "string" && parsed.token.length >= 32) {
        cachedAuthToken = parsed.token;
        return cachedAuthToken;
      }
    } catch {
      // fall through to regenerate
    }
  }

  const token = randomBytes(24).toString("hex");
  await writeFile(AUTH_PATH, `${JSON.stringify({ token }, null, 2)}\n`, "utf8");

  try {
    await chmod(AUTH_PATH, 0o600);
  } catch {
    // best-effort on platforms without POSIX perms
  }

  cachedAuthToken = token;
  console.log("");
  console.log("Pairing token generated. Paste it in the extension Options page:");
  console.log(`  ${token}`);
  console.log(`Stored at ${AUTH_PATH}. Delete this file to rotate.`);
  console.log("");
  return token;
}

async function isAuthorized(request) {
  const header = request.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) {
    return false;
  }

  const provided = match[1].trim();
  const expected = await loadOrCreateAuthToken();

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

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

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function loadServerConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_SERVER_CONFIG };
  }

  try {
    const rawConfig = await readFile(CONFIG_PATH, "utf8");
    return {
      ...DEFAULT_SERVER_CONFIG,
      ...JSON.parse(rawConfig)
    };
  } catch {
    return { ...DEFAULT_SERVER_CONFIG };
  }
}

function validateConfigInput(payload) {
  const argosPythonPath = normalizeText(payload.argosPythonPath);
  if (argosPythonPath) {
    const resolved = path.resolve(APP_DIR, argosPythonPath);
    const inProject = resolved === APP_DIR || resolved.startsWith(APP_DIR + path.sep);
    if (!inProject) {
      throw new Error("argosPythonPath must resolve inside the project directory.");
    }
  }

  const ollamaBaseUrl = normalizeText(payload.ollamaBaseUrl);
  if (ollamaBaseUrl) {
    let parsed;
    try {
      parsed = new URL(ollamaBaseUrl);
    } catch {
      throw new Error("ollamaBaseUrl is not a valid URL.");
    }
    if (!ALLOWED_OLLAMA_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new Error("ollamaBaseUrl must point to a loopback host.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("ollamaBaseUrl must use http or https.");
    }
  }

  if (payload.mlxPort !== undefined && payload.mlxPort !== "") {
    const port = Number.parseInt(payload.mlxPort, 10);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error("mlxPort must be an integer between 1024 and 65535.");
    }
  }

  const provider = normalizeText(payload.provider).toLowerCase();
  if (provider && !["argos", "ollama", "mlx", "openai", "zai"].includes(provider)) {
    throw new Error("provider is not supported.");
  }
}

async function saveServerConfig(payload) {
  validateConfigInput(payload);
  const currentConfig = await loadServerConfig();
  const nextConfig = {
    ...currentConfig,
    provider: normalizeText(payload.provider).toLowerCase() || currentConfig.provider,
    openaiModel: normalizeText(payload.openaiModel) || currentConfig.openaiModel,
    zaiModel: normalizeText(payload.zaiModel) || currentConfig.zaiModel,
    zaiEndpoint: normalizeText(payload.zaiEndpoint).toLowerCase() || currentConfig.zaiEndpoint,
    argosPythonPath: normalizeText(payload.argosPythonPath) || currentConfig.argosPythonPath,
    ollamaBaseUrl: normalizeText(payload.ollamaBaseUrl) || currentConfig.ollamaBaseUrl,
    ollamaModel: normalizeText(payload.ollamaModel) || currentConfig.ollamaModel,
    mlxModel: normalizeText(payload.mlxModel) || currentConfig.mlxModel,
    mlxPort: Number.parseInt(payload.mlxPort ?? currentConfig.mlxPort, 10) || currentConfig.mlxPort
  };

  const openaiApiKey = normalizeText(payload.openaiApiKey);
  const zaiApiKey = normalizeText(payload.zaiApiKey);

  if (openaiApiKey) {
    nextConfig.openaiApiKey = openaiApiKey;
  }

  if (zaiApiKey) {
    nextConfig.zaiApiKey = zaiApiKey;
  }

  await writeFile(CONFIG_PATH, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  translationCache.clear();
  return nextConfig;
}

function buildPrompt({ text, targetLanguage, sourceLanguage }) {
  return [
    `Target language: ${targetLanguage}`,
    `Source language: ${sourceLanguage || "auto-detect"}`,
    "",
    "Translate the following text.",
    "Return only the translated text.",
    "Preserve meaning, punctuation, line breaks, and inline formatting where possible.",
    "Do not add explanations, labels, or quotation marks.",
    "",
    text
  ].join("\n");
}

function buildFastTranslationPrompt({ text, targetLanguage, sourceLanguage }) {
  const source = sourceLanguage ? ` from ${sourceLanguage}` : "";
  return `Translate${source} to ${targetLanguage}. Only the translation:\n${text}`;
}

function getProviderConfig(serverConfig) {
  if (serverConfig.provider === "argos") {
    return {
      provider: "argos",
      apiKey: "local",
      model: "argos-local",
      endpoint: "offline",
      pythonPath: serverConfig.argosPythonPath
    };
  }

  if (serverConfig.provider === "ollama") {
    return {
      provider: "ollama",
      apiKey: "local",
      model: serverConfig.ollamaModel,
      endpoint: "chat",
      baseURL: serverConfig.ollamaBaseUrl
    };
  }

  if (serverConfig.provider === "mlx") {
    return {
      provider: "mlx",
      apiKey: "local",
      model: serverConfig.mlxModel,
      endpoint: "mlx-lm",
      port: serverConfig.mlxPort
    };
  }

  if (serverConfig.provider === "zai") {
    const useCodingEndpoint = serverConfig.zaiEndpoint === "coding";

    return {
      provider: "zai",
      apiKey: serverConfig.zaiApiKey,
      model: serverConfig.zaiModel,
      endpoint: useCodingEndpoint ? "coding" : "general",
      baseURL: useCodingEndpoint ? serverConfig.zaiCodingBaseUrl : serverConfig.zaiBaseUrl
    };
  }

  return {
    provider: "openai",
    apiKey: serverConfig.openaiApiKey,
    model: serverConfig.openaiModel,
    endpoint: "responses",
    baseURL: undefined
  };
}

async function translateText(payload) {
  const text = normalizeText(payload.text);
  const targetLanguage = normalizeText(payload.targetLanguage) || "Spanish";
  const sourceLanguage = normalizeText(payload.sourceLanguage);
  const serverConfig = await loadServerConfig();
  const providerConfig = getProviderConfig(serverConfig);
  const cacheKey = JSON.stringify([
    providerConfig.provider,
    providerConfig.endpoint,
    providerConfig.model,
    targetLanguage,
    sourceLanguage,
    text
  ]);

  if (!text) {
    return { statusCode: 400, body: { error: "No text was provided." } };
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return {
      statusCode: 400,
      body: { error: `The selection is too long. Limit: ${MAX_TEXT_LENGTH} characters.` }
    };
  }

  if (!providerConfig.apiKey) {
    return {
      statusCode: 500,
      body: {
        error: providerConfig.provider === "zai"
          ? "ZAI_API_KEY is not configured on the local server."
          : "OPENAI_API_KEY is not configured on the local server."
      }
    };
  }

  if (translationCache.has(cacheKey)) {
    const cachedTranslation = translationCache.get(cacheKey);
    translationCache.delete(cacheKey);
    translationCache.set(cacheKey, cachedTranslation);

    return {
      statusCode: 200,
      body: {
        translation: cachedTranslation,
        model: providerConfig.model,
        provider: providerConfig.provider,
        cached: true
      }
    };
  }

  const translation = providerConfig.provider === "argos"
    ? await translateWithArgos(providerConfig.pythonPath, { text, targetLanguage, sourceLanguage })
    : providerConfig.provider === "ollama"
      ? await translateWithOllama(providerConfig.baseURL, providerConfig.model, { text, targetLanguage, sourceLanguage })
    : providerConfig.provider === "mlx"
      ? await translateWithMLX(providerConfig.port, providerConfig.model, { text, targetLanguage, sourceLanguage })
    : providerConfig.provider === "zai"
      ? await translateWithZai(new OpenAI({
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL
        }), providerConfig.model, { text, targetLanguage, sourceLanguage })
      : await translateWithOpenAI(new OpenAI({
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL
        }), providerConfig.model, { text, targetLanguage, sourceLanguage });

  if (!translation) {
    return {
      statusCode: 502,
      body: { error: "The active AI provider returned an empty translation." }
    };
  }

  translationCache.set(cacheKey, translation);
  if (translationCache.size > TRANSLATION_CACHE_LIMIT) {
    const oldestKey = translationCache.keys().next().value;
    translationCache.delete(oldestKey);
  }

  return {
    statusCode: 200,
    body: {
      translation,
      model: providerConfig.model,
      provider: providerConfig.provider,
      cached: false
    }
  };
}

async function translateWithOpenAI(client, model, promptData) {
  const completion = await client.responses.create({
    model,
    input: buildPrompt(promptData)
  });

  return completion.output_text?.trim();
}

async function translateWithZai(client, model, promptData) {
  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: buildPrompt(promptData)
      }
    ],
    temperature: 0.2
  });

  return completion.choices[0]?.message?.content?.trim();
}

async function translateWithOllama(baseURL, model, promptData) {
  const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: buildFastTranslationPrompt(promptData)
        }
      ],
      stream: false,
      keep_alive: "30m",
      options: {
        temperature: 0,
        num_ctx: 512,
        num_predict: 192
      }
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Ollama translation failed.");
  }

  return payload.message?.content?.trim();
}

async function warmOllamaModel(baseURL, model) {
  try {
    await fetch(`${baseURL.replace(/\/$/, "")}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: "Reply ok."
          }
        ],
        stream: false,
        keep_alive: "30m",
        options: {
          temperature: 0,
          num_ctx: 256,
          num_predict: 2
        }
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ollama warm-up failed.";
    console.warn(`Ollama warm-up skipped: ${message}`);
  }
}

async function translateWithMLX(port, model, promptData) {
  await ensureMLXServer(port, model);

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: buildFastTranslationPrompt(promptData)
        }
      ],
      stream: false,
      temperature: 0,
      max_tokens: 512
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error || "MLX translation failed.");
  }

  return payload.choices?.[0]?.message?.content?.trim();
}

async function ensureMLXServer(port, model) {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("MLX local only works on macOS with Apple Silicon.");
  }

  if (mlxServer && !mlxServer.killed && mlxServerModel === model && mlxServerPort === port) {
    return;
  }

  if (mlxStartPromise) {
    await mlxStartPromise;
    if (mlxServer && !mlxServer.killed && mlxServerModel === model && mlxServerPort === port) {
      return;
    }
  }

  mlxStartPromise = startMLXServer(port, model);

  try {
    await mlxStartPromise;
  } finally {
    mlxStartPromise = null;
  }
}

async function startMLXServer(port, model) {
  stopMLXServer();
  const python = await ensureMLXPython();
  const env = {
    ...process.env,
    HF_HOME: MLX_MODELS_DIR,
    TRANSFORMERS_CACHE: MLX_MODELS_DIR,
    HF_HUB_DISABLE_TELEMETRY: "1"
  };

  mlxServer = spawn(python, ["-m", "mlx_lm.server", "--model", model, "--port", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  mlxServerModel = model;
  mlxServerPort = port;

  mlxServer.stdout.setEncoding("utf8");
  mlxServer.stdout.on("data", (chunk) => {
    const message = chunk.trim();
    if (message) {
      console.log(`MLX: ${message}`);
    }
  });

  mlxServer.stderr.setEncoding("utf8");
  mlxServer.stderr.on("data", (chunk) => {
    const message = chunk.trim();
    if (message) {
      console.warn(`MLX: ${message}`);
    }
  });

  mlxServer.on("exit", () => {
    mlxServer = null;
    mlxServerModel = "";
    mlxServerPort = 0;
  });

  await waitForMLXHealth(port, 600_000);
}

function stopMLXServer() {
  if (mlxServer && !mlxServer.killed) {
    mlxServer.kill("SIGTERM");
  }

  mlxServer = null;
  mlxServerModel = "";
  mlxServerPort = 0;
}

async function ensureMLXPython() {
  if (existsSync(MLX_VENV_PYTHON) && pythonImportsMLX(MLX_VENV_PYTHON)) {
    return MLX_VENV_PYTHON;
  }

  const systemPython = findCompatiblePython();
  if (!systemPython) {
    throw new Error("Python 3.10-3.13 is required for MLX. On macOS, install it with: brew install python@3.13");
  }

  if (!existsSync(MLX_VENV_PYTHON)) {
    await runProcess(systemPython, ["-m", "venv", MLX_VENV_DIR]);
  }

  await runProcess(MLX_VENV_PYTHON, ["-m", "pip", "install", "--upgrade", "pip", "--index-url", "https://pypi.org/simple/"]);
  await runProcess(MLX_VENV_PYTHON, ["-m", "pip", "install", "--upgrade", "mlx-lm>=0.24.0", "--index-url", "https://pypi.org/simple/"]);

  if (!pythonImportsMLX(MLX_VENV_PYTHON)) {
    throw new Error("mlx-lm installed but could not be imported.");
  }

  return MLX_VENV_PYTHON;
}

function findCompatiblePython() {
  const candidates = [
    "/opt/homebrew/bin/python3.13",
    "/opt/homebrew/bin/python3.12",
    "/opt/homebrew/bin/python3.11",
    "/opt/homebrew/bin/python3.10",
    "/usr/local/bin/python3.13",
    "/usr/local/bin/python3.12",
    "/usr/local/bin/python3.11",
    "/usr/local/bin/python3.10",
    "python3.13",
    "python3.12",
    "python3.11",
    "python3.10"
  ];

  return candidates.find((candidate) => isCompatiblePython(candidate)) ?? null;
}

function isCompatiblePython(candidate) {
  const result = spawnSync(candidate, ["--version"], {
    encoding: "utf8",
    timeout: 5000
  });

  if (result.status !== 0) {
    return false;
  }

  const version = `${result.stdout} ${result.stderr}`;
  const match = version.match(/Python 3\.(\d+)/);
  const minor = match ? Number.parseInt(match[1], 10) : 0;
  return minor >= 10 && minor <= 13;
}

function pythonImportsMLX(python) {
  const result = spawnSync(python, ["-c", "import mlx_lm; print('ok')"], {
    encoding: "utf8",
    timeout: 15000
  });

  return result.status === 0 && result.stdout.includes("ok");
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        PIP_DISABLE_PIP_VERSION_CHECK: "1",
        PIP_INDEX_URL: "https://pypi.org/simple/"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.slice(0, 3).join(" ")} failed with exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function waitForMLXHealth(port, timeoutMs) {
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/models`);
      if (response.ok) {
        return;
      }
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`MLX server did not become ready within ${timeoutMs / 1000}s. ${lastError}`);
}

function ensureArgosWorker(pythonPath) {
  if (argosWorker) {
    return argosWorker;
  }

  argosWorker = spawn(pythonPath, [path.join(APP_DIR, "local-translator", "worker.py")], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  argosWorker.stdout.setEncoding("utf8");
  argosWorker.stdout.on("data", (chunk) => {
    argosWorkerBuffer += chunk;

    while (argosWorkerBuffer.includes("\n")) {
      const newlineIndex = argosWorkerBuffer.indexOf("\n");
      const line = argosWorkerBuffer.slice(0, newlineIndex).trim();
      argosWorkerBuffer = argosWorkerBuffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      const pendingRequest = argosPendingRequests.shift();
      if (!pendingRequest) {
        continue;
      }

      try {
        const payload = JSON.parse(line);
        if (!payload.ok) {
          pendingRequest.reject(new Error(payload.error || "Argos translation failed."));
          continue;
        }

        pendingRequest.resolve(payload.translation);
      } catch (error) {
        pendingRequest.reject(error);
      }
    }
  });

  argosWorker.stderr.setEncoding("utf8");
  argosWorker.stderr.on("data", (chunk) => {
    const warning = chunk.trim();
    if (warning) {
      console.warn(`Argos worker: ${warning}`);
    }
  });

  argosWorker.on("error", (error) => {
    while (argosPendingRequests.length) {
      argosPendingRequests.shift().reject(error);
    }
    argosWorker = null;
    argosWorkerBuffer = "";
  });

  argosWorker.on("exit", () => {
    argosWorker = null;
    argosWorkerBuffer = "";

    while (argosPendingRequests.length) {
      argosPendingRequests.shift().reject(new Error("Argos worker stopped unexpectedly."));
    }
  });

  return argosWorker;
}

async function translateWithArgos(pythonPath, promptData) {
  const worker = ensureArgosWorker(pythonPath);

  return new Promise((resolve, reject) => {
    argosPendingRequests.push({ resolve, reject });
    worker.stdin.write(`${JSON.stringify(promptData)}\n`);
  });
}

const PUBLIC_ENDPOINTS = new Set(["/health"]);

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
  if (argosWorker && !argosWorker.killed) {
    argosWorker.kill("SIGTERM");
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
