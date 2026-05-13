import { existsSync } from "node:fs";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { AUTH_PATH, ALLOWED_LOOPBACK_HOSTS } from "./constants.mjs";

let cachedAuthToken = null;

export function buildCorsHeaders(request) {
  const origin = request.headers.origin ?? "";
  const allowOrigin = origin.startsWith("chrome-extension://") ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  };
}

export function jsonHeaders(request) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    ...buildCorsHeaders(request)
  };
}

export function sendJson(request, response, statusCode, payload) {
  response.writeHead(statusCode, jsonHeaders(request));
  response.end(JSON.stringify(payload));
}

export function isAllowedHost(request) {
  const host = (request.headers.host ?? "").toLowerCase();
  return ALLOWED_LOOPBACK_HOSTS.has(host);
}

export function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  return origin.startsWith("chrome-extension://");
}

export async function loadOrCreateAuthToken() {
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
      // regenerate
    }
  }

  const token = randomBytes(24).toString("hex");
  await writeFile(AUTH_PATH, `${JSON.stringify({ token }, null, 2)}\n`, "utf8");

  try {
    await chmod(AUTH_PATH, 0o600);
  } catch {
    // best-effort
  }

  cachedAuthToken = token;
  console.log("");
  console.log("Pairing token generated. Paste it in the extension Options page:");
  console.log(`  ${token}`);
  console.log(`Stored at ${AUTH_PATH}. Delete this file to rotate.`);
  console.log("");
  return token;
}

export async function isAuthorized(request) {
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
