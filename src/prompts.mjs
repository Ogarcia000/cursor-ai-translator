export function buildPrompt({ text, targetLanguage, sourceLanguage }) {
  return [
    `Target language: ${targetLanguage}`,
    `Source language: ${sourceLanguage || "auto-detect"}`,
    "",
    "Translate the following text.",
    "Return only the translated text.",
    "Preserve meaning, punctuation, line breaks, and inline formatting where possible.",
    "Do not add explanations, labels, or quotation marks.",
    "",
    text
  ].join("\n");
}

export function buildFastTranslationPrompt({ text, targetLanguage, sourceLanguage }) {
  const source = sourceLanguage ? ` from ${sourceLanguage}` : "";
  return `Translate${source} to ${targetLanguage}. Only the translation:\n${text}`;
}
