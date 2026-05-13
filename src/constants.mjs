import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
export const CONFIG_PATH = path.join(APP_DIR, "server-config.json");
export const AUTH_PATH = path.join(APP_DIR, "server-auth.json");
export const MLX_VENV_DIR = path.join(APP_DIR, ".venv-mlx");
export const MLX_VENV_PYTHON = path.join(MLX_VENV_DIR, "bin", "python3");
export const MLX_MODELS_DIR = path.join(APP_DIR, ".mlx-models");
export const MAX_TEXT_LENGTH = 4000;
export const TRANSLATION_CACHE_LIMIT = 120;
export const PROVIDER_TIMEOUT_MS = 20_000;
export const ALLOWED_LOOPBACK_HOSTS = new Set([
  `127.0.0.1:${PORT}`,
  `localhost:${PORT}`,
  `[::1]:${PORT}`
]);
export const ALLOWED_OLLAMA_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
export const SUPPORTED_PROVIDERS = ["argos", "ollama", "mlx", "openai", "zai"];
