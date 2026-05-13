import OpenAI from "openai";
import { MAX_TEXT_LENGTH } from "./constants.mjs";
import { loadServerConfig, getProviderConfig, normalizeText } from "./config.mjs";
import { buildCacheKey, getCached, setCached } from "./cache.mjs";
import { translateWithArgos, streamTranslateWithArgos } from "./providers/argos.mjs";
import { translateWithOllama, streamTranslateWithOllama } from "./providers/ollama.mjs";
import { translateWithMLX, streamTranslateWithMLX } from "./providers/mlx.mjs";
import { translateWithOpenAI, streamTranslateWithOpenAI } from "./providers/openai.mjs";
import { translateWithZai, streamTranslateWithZai } from "./providers/zai.mjs";

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

function dispatchStream(providerConfig, params, signal) {
  switch (providerConfig.provider) {
    case "argos":
      return streamTranslateWithArgos(providerConfig.pythonPath, params);
    case "ollama":
      return streamTranslateWithOllama(providerConfig.baseURL, providerConfig.model, params, signal);
    case "mlx":
      return streamTranslateWithMLX(providerConfig.port, providerConfig.model, params, signal);
    case "zai":
      return streamTranslateWithZai(
        new OpenAI({ apiKey: providerConfig.apiKey, baseURL: providerConfig.baseURL }),
        providerConfig.model,
        params,
        signal
      );
    default:
      return streamTranslateWithOpenAI(
        new OpenAI({ apiKey: providerConfig.apiKey, baseURL: providerConfig.baseURL }),
        providerConfig.model,
        params,
        signal
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

function prepareStreamRequest(payload) {
  const text = normalizeText(payload.text);
  const targetLanguage = normalizeText(payload.targetLanguage) || "Spanish";
  const sourceLanguage = normalizeText(payload.sourceLanguage);

  if (!text) {
    return { error: { statusCode: 400, message: "No text was provided." } };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return {
      error: { statusCode: 400, message: `The selection is too long. Limit: ${MAX_TEXT_LENGTH} characters.` }
    };
  }

  return { params: { text, targetLanguage, sourceLanguage } };
}

export async function* translateTextStream(payload, signal) {
  const prepared = prepareStreamRequest(payload);
  if (prepared.error) {
    yield { type: "error", error: prepared.error.message, statusCode: prepared.error.statusCode };
    return;
  }

  const serverConfig = await loadServerConfig();
  const providerConfig = getProviderConfig(serverConfig);

  if (!providerConfig.apiKey) {
    yield {
      type: "error",
      error: providerConfig.provider === "zai"
        ? "ZAI_API_KEY is not configured on the local server."
        : "OPENAI_API_KEY is not configured on the local server.",
      statusCode: 500
    };
    return;
  }

  const cacheKey = buildCacheKey(providerConfig, prepared.params);
  const cachedTranslation = getCached(cacheKey);

  if (cachedTranslation) {
    yield { type: "chunk", text: cachedTranslation };
    yield {
      type: "done",
      provider: providerConfig.provider,
      model: providerConfig.model,
      cached: true
    };
    return;
  }

  let assembled = "";
  try {
    for await (const chunk of dispatchStream(providerConfig, prepared.params, signal)) {
      if (typeof chunk !== "string" || !chunk) continue;
      assembled += chunk;
      yield { type: "chunk", text: chunk };
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      yield { type: "aborted" };
      return;
    }
    const message = error instanceof Error ? error.message : "Provider stream failed.";
    yield { type: "error", error: message, statusCode: 502 };
    return;
  }

  if (!assembled.trim()) {
    yield {
      type: "error",
      error: "The active AI provider returned an empty translation.",
      statusCode: 502
    };
    return;
  }

  setCached(cacheKey, assembled.trim());
  yield {
    type: "done",
    provider: providerConfig.provider,
    model: providerConfig.model,
    cached: false
  };
}
