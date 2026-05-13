import { describe, it, expect, beforeEach } from "vitest";
import { buildCacheKey, getCached, setCached, clearCache } from "../src/cache.mjs";

beforeEach(() => clearCache());

describe("translation cache", () => {
  const providerConfig = { provider: "argos", endpoint: "offline", model: "argos-local" };
  const params = { text: "hello", targetLanguage: "Spanish", sourceLanguage: "" };

  it("returns null for missing key", () => {
    const key = buildCacheKey(providerConfig, params);
    expect(getCached(key)).toBeNull();
  });

  it("returns the stored value", () => {
    const key = buildCacheKey(providerConfig, params);
    setCached(key, "hola");
    expect(getCached(key)).toBe("hola");
  });

  it("distinguishes keys by provider and inputs", () => {
    const k1 = buildCacheKey(providerConfig, params);
    const k2 = buildCacheKey({ ...providerConfig, provider: "openai", endpoint: "responses", model: "gpt-4o-mini" }, params);
    setCached(k1, "argos");
    setCached(k2, "openai");
    expect(getCached(k1)).toBe("argos");
    expect(getCached(k2)).toBe("openai");
  });

  it("clearCache empties the store", () => {
    const key = buildCacheKey(providerConfig, params);
    setCached(key, "hola");
    clearCache();
    expect(getCached(key)).toBeNull();
  });
});
