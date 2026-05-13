import { z } from "zod";
import path from "node:path";
import {
  APP_DIR,
  ALLOWED_OLLAMA_HOSTS,
  SUPPORTED_PROVIDERS,
  MAX_TEXT_LENGTH
} from "./constants.mjs";

const argosPythonPathSchema = z.string().trim().refine((value) => {
  if (!value) return true;
  const resolved = path.resolve(APP_DIR, value);
  return resolved === APP_DIR || resolved.startsWith(APP_DIR + path.sep);
}, { message: "argosPythonPath must resolve inside the project directory." });

const ollamaBaseUrlSchema = z.string().trim().refine((value) => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return ALLOWED_OLLAMA_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}, { message: "ollamaBaseUrl must be a valid http(s) URL pointing to a loopback host." });

const mlxPortSchema = z.union([z.string(), z.number()]).optional()
  .transform((value) => {
    if (value === undefined || value === "") return undefined;
    return Number.parseInt(String(value), 10);
  })
  .refine((value) => value === undefined || (Number.isInteger(value) && value >= 1024 && value <= 65535), {
    message: "mlxPort must be an integer between 1024 and 65535."
  });

export const configPayloadSchema = z.object({
  provider: z.string().trim().toLowerCase().refine(
    (v) => v === "" || SUPPORTED_PROVIDERS.includes(v),
    { message: `provider must be one of ${SUPPORTED_PROVIDERS.join(", ")}.` }
  ).optional(),
  openaiApiKey: z.string().optional(),
  openaiModel: z.string().optional(),
  zaiApiKey: z.string().optional(),
  zaiModel: z.string().optional(),
  zaiEndpoint: z.string().optional(),
  argosPythonPath: argosPythonPathSchema.optional(),
  ollamaBaseUrl: ollamaBaseUrlSchema.optional(),
  ollamaModel: z.string().optional(),
  mlxModel: z.string().optional(),
  mlxPort: mlxPortSchema
}).strict();

export const translatePayloadSchema = z.object({
  text: z.string().min(1, "No text was provided.")
    .max(MAX_TEXT_LENGTH, `The selection is too long. Limit: ${MAX_TEXT_LENGTH} characters.`),
  targetLanguage: z.string().optional().default(""),
  sourceLanguage: z.string().optional().default("")
}).strict();

export function formatZodError(error) {
  const first = error.issues?.[0];
  if (!first) return "Invalid payload.";
  const path = first.path?.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}
