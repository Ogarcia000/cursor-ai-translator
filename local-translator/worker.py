import json
import sys

import argostranslate.translate


LANGUAGE_ALIASES = {
    "auto": "",
    "auto-detect": "",
    "english": "en",
    "ingles": "en",
    "spanish": "es",
    "espanol": "es",
    "español": "es",
    "french": "fr",
    "frances": "fr",
    "portuguese": "pt",
    "portugues": "pt",
    "german": "de",
    "aleman": "de",
    "italian": "it",
    "italiano": "it",
    "japanese": "ja",
    "japones": "ja",
    "korean": "ko",
    "coreano": "ko",
}


def normalize_language(value: str, fallback: str) -> str:
    normalized = (value or "").strip().lower()

    if not normalized:
        return fallback

    return LANGUAGE_ALIASES.get(normalized, normalized)


def translate(payload: dict) -> dict:
    text = (payload.get("text") or "").strip()
    source_language = normalize_language(payload.get("sourceLanguage", ""), "en")
    target_language = normalize_language(payload.get("targetLanguage", ""), "es")

    if not text:
        raise ValueError("No text was provided.")

    translated_text = argostranslate.translate.translate(
        text,
        source_language,
        target_language,
    )

    return {
        "translation": translated_text.strip(),
        "sourceLanguage": source_language,
        "targetLanguage": target_language,
    }


def main() -> None:
    for raw_line in sys.stdin:
        try:
            payload = json.loads(raw_line)
            result = translate(payload)
            print(json.dumps({"ok": True, **result}), flush=True)
        except Exception as error:
            print(json.dumps({"ok": False, "error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
