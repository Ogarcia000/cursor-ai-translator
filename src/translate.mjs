import OpenAI from "openai";
import { MAX_TEXT_LENGTH } from "./constants.mjs";
import { loadServerConfig, getProviderConfig, normalizeText } from "./config.mjs";
import { buildCacheKey, getCached, setCached } from "./cache.mjs";
import { translateWithArgos } from "./providers/argos.mjs";
import { translateWithOllama } from "./providers/ollama.mjs";
import { translateWithMLX } from "./providers/mlx.mjs";
import { translateWithOpenAI } from "./providers/openai.mjs";
import { translateWithZai } from "./providers/zai.mjs";

async function dispatch(providerConfig, params) {
  switch (providerConfig.provider) {
    case "argos":
      return translateWithArgos(providerConfig.pythonPath, params);
    case "ollama":
      return translateWithOllama(providerConfig.baseURL, providerConfig.model, params);
    case "mlx":
      return translateWithMLX(providerConfig.port, providerConfig.model, params);
    case "zai":
      return translateWithZai(
        new OpenAI({ apiKey: providerConfig.apiKey, baseURL: providerConfig.baseURL }),
        providerConfig.model,
        params
      );
    default:
      return translateWithOpenAI(
        new OpenAI({ apiKey: providerConfig.apiKey, baseURL: providerConfig.baseURL }),
        providerConfig.model,
        params
      );
  }
}

export async function translateText(payload) {
  const text = normalizeText(payload.text);
  const targetLanguage = normalizeText(payload.targetLanguage) || "Spanish";
  const sourceLanguage = normalizeText(payload.sourceLanguage);

  if (!text) {
    return { statusCode: 400, body: { error: "No text was provided." } };
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return {
      statusCode: 400,
      body: { error: `The selection is too long. Limit: ${MAX_TEXT_LENGTH} characters.` }
    };
  }

  const serverConfig = await loadServerConfig();
  const providerConfig = getProviderConfig(serverConfig);

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

  const params = { text, targetLanguage, sourceLanguage };
  const cacheKey = buildCacheKey(providerConfig, params);
  const cachedTranslation = getCached(cacheKey);

  if (cachedTranslation) {
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

  const translation = await dispatch(providerConfig, params);

  if (!translation) {
    return {
      statusCode: 502,
      body: { error: "The active AI provider returned an empty translation." }
    };
  }

  setCached(cacheKey, translation);

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
