import { spawn } from "node:child_process";
import path from "node:path";
import { APP_DIR } from "../constants.mjs";

let argosWorker = null;
let argosWorkerBuffer = "";
const argosPendingRequests = [];

function ensureArgosWorker(pythonPath) {
  if (argosWorker) {
    return argosWorker;
  }

  argosWorker = spawn(pythonPath, [path.join(APP_DIR, "local-translator", "worker.py")], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  argosWorker.stdout.setEncoding("utf8");
  argosWorker.stdout.on("data", (chunk) => {
    argosWorkerBuffer += chunk;

    while (argosWorkerBuffer.includes("\n")) {
      const newlineIndex = argosWorkerBuffer.indexOf("\n");
      const line = argosWorkerBuffer.slice(0, newlineIndex).trim();
      argosWorkerBuffer = argosWorkerBuffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      const pendingRequest = argosPendingRequests.shift();
      if (!pendingRequest) {
        continue;
      }

      try {
        const payload = JSON.parse(line);
        if (!payload.ok) {
          pendingRequest.reject(new Error(payload.error || "Argos translation failed."));
          continue;
        }

        pendingRequest.resolve(payload.translation);
      } catch (error) {
        pendingRequest.reject(error);
      }
    }
  });

  argosWorker.stderr.setEncoding("utf8");
  argosWorker.stderr.on("data", (chunk) => {
    const warning = chunk.trim();
    if (warning) {
      console.warn(`Argos worker: ${warning}`);
    }
  });

  argosWorker.on("error", (error) => {
    while (argosPendingRequests.length) {
      argosPendingRequests.shift().reject(error);
    }
    argosWorker = null;
    argosWorkerBuffer = "";
  });

  argosWorker.on("exit", () => {
    argosWorker = null;
    argosWorkerBuffer = "";

    while (argosPendingRequests.length) {
      argosPendingRequests.shift().reject(new Error("Argos worker stopped unexpectedly."));
    }
  });

  return argosWorker;
}

export async function translateWithArgos(pythonPath, promptData) {
  const worker = ensureArgosWorker(pythonPath);

  return new Promise((resolve, reject) => {
    argosPendingRequests.push({ resolve, reject });
    worker.stdin.write(`${JSON.stringify(promptData)}\n`);
  });
}

export function stopArgosWorker() {
  if (argosWorker && !argosWorker.killed) {
    argosWorker.kill("SIGTERM");
  }
}
