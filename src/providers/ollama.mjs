import { PROVIDER_TIMEOUT_MS } from "../constants.mjs";
import { buildFastTranslationPrompt } from "../prompts.mjs";
import { iterNdjson } from "../streaming.mjs";

export async function translateWithOllama(baseURL, model, promptData) {
  const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: buildFastTranslationPrompt(promptData) }],
      stream: false,
      keep_alive: "30m",
      options: {
        temperature: 0,
        num_ctx: 512,
        num_predict: 192
      }
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Ollama translation failed.");
  }

  return payload.message?.content?.trim();
}

export async function* streamTranslateWithOllama(baseURL, model, promptData, signal) {
  const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: buildFastTranslationPrompt(promptData) }],
      stream: true,
      keep_alive: "30m",
      options: {
        temperature: 0,
        num_ctx: 512,
        num_predict: 192
      }
    }),
    signal: signal ?? AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Ollama stream failed (${response.status}).`);
  }

  for await (const event of iterNdjson(response)) {
    const chunk = event.message?.content;
    if (chunk) yield chunk;
    if (event.done) return;
  }
}

export async function warmOllamaModel(baseURL, model) {
  try {
    await fetch(`${baseURL.replace(/\/$/, "")}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply ok." }],
        stream: false,
        keep_alive: "30m",
        options: {
          temperature: 0,
          num_ctx: 256,
          num_predict: 2
        }
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ollama warm-up failed.";
    console.warn(`Ollama warm-up skipped: ${message}`);
  }
}
