import { PROVIDER_TIMEOUT_MS } from "../constants.mjs";
import { buildPrompt } from "../prompts.mjs";

export async function translateWithOpenAI(client, model, promptData) {
  const completion = await client.responses.create(
    { model, input: buildPrompt(promptData) },
    { timeout: PROVIDER_TIMEOUT_MS }
  );

  return completion.output_text?.trim();
}

export async function* streamTranslateWithOpenAI(client, model, promptData, signal) {
  const stream = await client.responses.create(
    { model, input: buildPrompt(promptData), stream: true },
    { timeout: PROVIDER_TIMEOUT_MS, signal }
  );

  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && event.delta) {
      yield event.delta;
    }
  }
}
