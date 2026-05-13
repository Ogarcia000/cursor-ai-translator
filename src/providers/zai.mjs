import { PROVIDER_TIMEOUT_MS } from "../constants.mjs";
import { buildPrompt } from "../prompts.mjs";

export async function translateWithZai(client, model, promptData) {
  const completion = await client.chat.completions.create(
    {
      model,
      messages: [{ role: "user", content: buildPrompt(promptData) }],
      temperature: 0.2
    },
    { timeout: PROVIDER_TIMEOUT_MS }
  );

  return completion.choices[0]?.message?.content?.trim();
}

export async function* streamTranslateWithZai(client, model, promptData, signal) {
  const stream = await client.chat.completions.create(
    {
      model,
      messages: [{ role: "user", content: buildPrompt(promptData) }],
      temperature: 0.2,
      stream: true
    },
    { timeout: PROVIDER_TIMEOUT_MS, signal }
  );

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}
