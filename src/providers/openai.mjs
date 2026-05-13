import { PROVIDER_TIMEOUT_MS } from "../constants.mjs";
import { buildPrompt } from "../prompts.mjs";

export async function translateWithOpenAI(client, model, promptData) {
  const completion = await client.responses.create(
    { model, input: buildPrompt(promptData) },
    { timeout: PROVIDER_TIMEOUT_MS }
  );

  return completion.output_text?.trim();
}
