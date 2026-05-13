import { TRANSLATION_CACHE_LIMIT } from "./constants.mjs";

const cache = new Map();

export function buildCacheKey(providerConfig, params) {
  return JSON.stringify([
    providerConfig.provider,
    providerConfig.endpoint,
    providerConfig.model,
    params.targetLanguage,
    params.sourceLanguage,
    params.text
  ]);
}

export function getCached(key) {
  if (!cache.has(key)) {
    return null;
  }
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

export function setCached(key, value) {
  cache.set(key, value);
  if (cache.size > TRANSLATION_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

export function clearCache() {
  cache.clear();
}
