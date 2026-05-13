import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isAllowedHost,
  isAllowedOrigin,
  buildCorsHeaders,
  isAuthorized,
  loadOrCreateAuthToken
} from "../src/auth.mjs";

function req(headers = {}) {
  return { headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
}

describe("isAllowedHost", () => {
  it("accepts loopback hostports for the configured PORT", () => {
    expect(isAllowedHost(req({ Host: "127.0.0.1:8787" }))).toBe(true);
    expect(isAllowedHost(req({ Host: "localhost:8787" }))).toBe(true);
  });

  it("rejects non-loopback hosts (DNS rebinding)", () => {
    expect(isAllowedHost(req({ Host: "evil.example:8787" }))).toBe(false);
    expect(isAllowedHost(req({ Host: "1.2.3.4:8787" }))).toBe(false);
    expect(isAllowedHost(req({}))).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("accepts chrome-extension origins", () => {
    expect(isAllowedOrigin(req({ Origin: "chrome-extension://abc123" }))).toBe(true);
  });

  it("accepts missing origin (curl/same-origin)", () => {
    expect(isAllowedOrigin(req({}))).toBe(true);
  });

  it("rejects web origins", () => {
    expect(isAllowedOrigin(req({ Origin: "https://evil.example" }))).toBe(false);
    expect(isAllowedOrigin(req({ Origin: "http://localhost:3000" }))).toBe(false);
  });
});

describe("buildCorsHeaders", () => {
  it("echoes chrome-extension origin back", () => {
    const headers = buildCorsHeaders(req({ Origin: "chrome-extension://xyz" }));
    expect(headers["Access-Control-Allow-Origin"]).toBe("chrome-extension://xyz");
    expect(headers.Vary).toBe("Origin");
  });

  it("never wildcards", () => {
    const headers = buildCorsHeaders(req({ Origin: "https://anything.example" }));
    expect(headers["Access-Control-Allow-Origin"]).toBe("null");
  });
});

describe("isAuthorized", () => {
  it("rejects when no Authorization header", async () => {
    await expect(isAuthorized(req({}))).resolves.toBe(false);
  });

  it("rejects malformed bearer", async () => {
    await expect(isAuthorized(req({ Authorization: "Basic abc" }))).resolves.toBe(false);
  });

  it("accepts a matching token", async () => {
    const token = await loadOrCreateAuthToken();
    await expect(isAuthorized(req({ Authorization: `Bearer ${token}` }))).resolves.toBe(true);
  });

  it("rejects a wrong token of same length", async () => {
    const token = await loadOrCreateAuthToken();
    const wrong = "0".repeat(token.length);
    await expect(isAuthorized(req({ Authorization: `Bearer ${wrong}` }))).resolves.toBe(false);
  });
});
