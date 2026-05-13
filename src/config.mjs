import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP_DIR, CONFIG_PATH } from "./constants.mjs";
import { configPayloadSchema, formatZodError } from "./schemas.mjs";

export const DEFAULT_SERVER_CONFIG = {
  provider: (process.env.AI_PROVIDER ?? "argos").toLowerCase(),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
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

export function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function loadServerConfig() {
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

export function validateConfigInput(payload) {
  const result = configPayloadSchema.safeParse(payload ?? {});
  if (!result.success) {
    throw new Error(formatZodError(result.error));
  }
  return result.data;
}

export async function saveServerConfig(payload) {
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
  return nextConfig;
}

export function getProviderConfig(serverConfig) {
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
