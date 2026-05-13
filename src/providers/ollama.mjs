import { PROVIDER_TIMEOUT_MS } from "../constants.mjs";
import { buildFastTranslationPrompt } from "../prompts.mjs";

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
