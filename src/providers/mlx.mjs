import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import {
  MLX_VENV_DIR,
  MLX_VENV_PYTHON,
  MLX_MODELS_DIR,
  PROVIDER_TIMEOUT_MS
} from "../constants.mjs";
import { buildFastTranslationPrompt } from "../prompts.mjs";
import { iterSse } from "../streaming.mjs";

let mlxServer = null;
let mlxServerModel = "";
let mlxServerPort = 0;
let mlxStartPromise = null;

export async function translateWithMLX(port, model, promptData) {
  await ensureMLXServer(port, model);

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: buildFastTranslationPrompt(promptData) }],
      stream: false,
      temperature: 0,
      max_tokens: 512
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error || "MLX translation failed.");
  }

  return payload.choices?.[0]?.message?.content?.trim();
}

export async function* streamTranslateWithMLX(port, model, promptData, signal) {
  await ensureMLXServer(port, model);

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: buildFastTranslationPrompt(promptData) }],
      stream: true,
      temperature: 0,
      max_tokens: 512
    }),
    signal: signal ?? AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message || payload.error || `MLX stream failed (${response.status}).`);
  }

  for await (const event of iterSse(response)) {
    const chunk = event.choices?.[0]?.delta?.content;
    if (chunk) yield chunk;
  }
}

async function ensureMLXServer(port, model) {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("MLX local only works on macOS with Apple Silicon.");
  }

  if (mlxServer && !mlxServer.killed && mlxServerModel === model && mlxServerPort === port) {
    return;
  }

  if (mlxStartPromise) {
    await mlxStartPromise;
    if (mlxServer && !mlxServer.killed && mlxServerModel === model && mlxServerPort === port) {
      return;
    }
  }

  mlxStartPromise = startMLXServer(port, model);

  try {
    await mlxStartPromise;
  } finally {
    mlxStartPromise = null;
  }
}

async function startMLXServer(port, model) {
  stopMLXServer();
  const python = await ensureMLXPython();
  const env = {
    ...process.env,
    HF_HOME: MLX_MODELS_DIR,
    TRANSFORMERS_CACHE: MLX_MODELS_DIR,
    HF_HUB_DISABLE_TELEMETRY: "1"
  };

  mlxServer = spawn(python, ["-m", "mlx_lm.server", "--model", model, "--port", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  mlxServerModel = model;
  mlxServerPort = port;

  mlxServer.stdout.setEncoding("utf8");
  mlxServer.stdout.on("data", (chunk) => {
    const message = chunk.trim();
    if (message) {
      console.log(`MLX: ${message}`);
    }
  });

  mlxServer.stderr.setEncoding("utf8");
  mlxServer.stderr.on("data", (chunk) => {
    const message = chunk.trim();
    if (message) {
      console.warn(`MLX: ${message}`);
    }
  });

  mlxServer.on("exit", () => {
    mlxServer = null;
    mlxServerModel = "";
    mlxServerPort = 0;
  });

  await waitForMLXHealth(port, 600_000);
}

export function stopMLXServer() {
  if (mlxServer && !mlxServer.killed) {
    mlxServer.kill("SIGTERM");
  }
  mlxServer = null;
  mlxServerModel = "";
  mlxServerPort = 0;
}

async function ensureMLXPython() {
  if (existsSync(MLX_VENV_PYTHON) && pythonImportsMLX(MLX_VENV_PYTHON)) {
    return MLX_VENV_PYTHON;
  }

  const systemPython = findCompatiblePython();
  if (!systemPython) {
    throw new Error("Python 3.10-3.13 is required for MLX. On macOS, install it with: brew install python@3.13");
  }

  if (!existsSync(MLX_VENV_PYTHON)) {
    await runProcess(systemPython, ["-m", "venv", MLX_VENV_DIR]);
  }

  await runProcess(MLX_VENV_PYTHON, ["-m", "pip", "install", "--upgrade", "pip", "--index-url", "https://pypi.org/simple/"]);
  await runProcess(MLX_VENV_PYTHON, ["-m", "pip", "install", "--upgrade", "mlx-lm>=0.24.0", "--index-url", "https://pypi.org/simple/"]);

  if (!pythonImportsMLX(MLX_VENV_PYTHON)) {
    throw new Error("mlx-lm installed but could not be imported.");
  }

  return MLX_VENV_PYTHON;
}

function findCompatiblePython() {
  const candidates = [
    "/opt/homebrew/bin/python3.13",
    "/opt/homebrew/bin/python3.12",
    "/opt/homebrew/bin/python3.11",
    "/opt/homebrew/bin/python3.10",
    "/usr/local/bin/python3.13",
    "/usr/local/bin/python3.12",
    "/usr/local/bin/python3.11",
    "/usr/local/bin/python3.10",
    "python3.13",
    "python3.12",
    "python3.11",
    "python3.10"
  ];

  return candidates.find((candidate) => isCompatiblePython(candidate)) ?? null;
}

function isCompatiblePython(candidate) {
  const result = spawnSync(candidate, ["--version"], {
    encoding: "utf8",
    timeout: 5000
  });

  if (result.status !== 0) {
    return false;
  }

  const version = `${result.stdout} ${result.stderr}`;
  const match = version.match(/Python 3\.(\d+)/);
  const minor = match ? Number.parseInt(match[1], 10) : 0;
  return minor >= 10 && minor <= 13;
}

function pythonImportsMLX(python) {
  const result = spawnSync(python, ["-c", "import mlx_lm; print('ok')"], {
    encoding: "utf8",
    timeout: 15000
  });

  return result.status === 0 && result.stdout.includes("ok");
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        PIP_DISABLE_PIP_VERSION_CHECK: "1",
        PIP_INDEX_URL: "https://pypi.org/simple/"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.slice(0, 3).join(" ")} failed with exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function waitForMLXHealth(port, timeoutMs) {
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/models`);
      if (response.ok) {
        return;
      }
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`MLX server did not become ready within ${timeoutMs / 1000}s. ${lastError}`);
}
