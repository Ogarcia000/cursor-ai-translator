import http from "node:http";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(APP_DIR, "server-config.json");
const DEFAULT_SERVER_CONFIG = {
  provider: (process.env.AI_PROVIDER ?? "openai").toLowerCase(),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
  zaiApiKey: process.env.ZAI_API_KEY ?? "",
  zaiModel: process.env.ZAI_MODEL ?? "glm-4.6",
  zaiEndpoint: (process.env.ZAI_ENDPOINT ?? "general").toLowerCase(),
  zaiBaseUrl: process.env.ZAI_BASE_URL ?? "https://api.z.ai/api/paas/v4/",
  zaiCodingBaseUrl: process.env.ZAI_CODING_BASE_URL ?? "https://api.z.ai/api/coding/paas/v4/",
  argosPythonPath: process.env.ARGOS_PYTHON_PATH ?? path.join(APP_DIR, ".venv-local", "bin", "python"),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/api",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen2.5:0.5b"
};
const MAX_TEXT_LENGTH = 4000;
const TRANSLATION_CACHE_LIMIT = 120;
const translationCache = new Map();
let argosWorker = null;
let argosWorkerBuffer = "";
const argosPendingRequests = [];
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(payload));
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

async function saveServerConfig(payload) {
  const currentConfig = await loadServerConfig();
  const nextConfig = {
    ...currentConfig,
    provider: normalizeText(payload.provider).toLowerCase() || currentConfig.provider,
    openaiModel: normalizeText(payload.openaiModel) || currentConfig.openaiModel,
    zaiModel: normalizeText(payload.zaiModel) || currentConfig.zaiModel,
    zaiEndpoint: normalizeText(payload.zaiEndpoint).toLowerCase() || currentConfig.zaiEndpoint,
    argosPythonPath: normalizeText(payload.argosPythonPath) || currentConfig.argosPythonPath,
    ollamaBaseUrl: normalizeText(payload.ollamaBaseUrl) || currentConfig.ollamaBaseUrl,
    ollamaModel: normalizeText(payload.ollamaModel) || currentConfig.ollamaModel
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
  return [
    `Translate from ${sourceLanguage || "auto"} to ${targetLanguage}.`,
    "Return only the translation. Keep line breaks.",
    text
  ].join("\n");
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
      keep_alive: "10m",
      options: {
        temperature: 0,
        num_ctx: 2048,
        num_predict: 512
      }
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Ollama translation failed.");
  }

  return payload.message?.content?.trim();
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

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, JSON_HEADERS);
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      const serverConfig = await loadServerConfig();
      const providerConfig = getProviderConfig(serverConfig);
      sendJson(response, 200, {
        ok: true,
        provider: providerConfig.provider,
        model: providerConfig.model,
        endpoint: providerConfig.endpoint,
        hasApiKey: Boolean(providerConfig.apiKey)
      });
      return;
    }

    if (request.method === "GET" && request.url === "/config") {
      const serverConfig = await loadServerConfig();
      const providerConfig = getProviderConfig(serverConfig);
      sendJson(response, 200, {
        provider: serverConfig.provider,
        openaiModel: serverConfig.openaiModel,
        zaiModel: serverConfig.zaiModel,
        zaiEndpoint: serverConfig.zaiEndpoint,
        argosPythonPath: serverConfig.argosPythonPath,
        ollamaBaseUrl: serverConfig.ollamaBaseUrl,
        ollamaModel: serverConfig.ollamaModel,
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
      sendJson(response, 200, {
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
      sendJson(response, result.statusCode, result.body);
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    sendJson(response, 500, { error: message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Cursor AI Translator server listening on http://127.0.0.1:${PORT}`);
  loadServerConfig().then((serverConfig) => {
    const providerConfig = getProviderConfig(serverConfig);
    console.log(`Provider: ${providerConfig.provider}`);
    console.log(`Model: ${providerConfig.model}`);
    console.log(`Endpoint: ${providerConfig.endpoint}`);
  });
});
