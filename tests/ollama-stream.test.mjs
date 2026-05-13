import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { streamTranslateWithOllama } from "../src/providers/ollama.mjs";

function bodyFromString(input) {
  const encoder = new TextEncoder();
  return {
    getReader() {
      let sent = false;
      return {
        async read() {
          if (sent) return { value: undefined, done: true };
          sent = true;
          return { value: encoder.encode(input), done: false };
        }
      };
    }
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamTranslateWithOllama", () => {
  it("yields each chunk and stops on done", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      body: bodyFromString(
        '{"message":{"content":"ho"}}\n' +
        '{"message":{"content":"la"}}\n' +
        '{"done":true}\n'
      )
    });

    const out = [];
    for await (const chunk of streamTranslateWithOllama(
      "http://127.0.0.1:11434/api",
      "qwen2.5:0.5b",
      { text: "hello", targetLanguage: "Spanish", sourceLanguage: "" }
    )) {
      out.push(chunk);
    }

    expect(out.join("")).toBe("hola");
    const init = fetch.mock.calls[0][1];
    expect(JSON.parse(init.body).stream).toBe(true);
  });

  it("throws when not ok", async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" })
    });

    async function consume() {
      const iter = streamTranslateWithOllama(
        "http://127.0.0.1:11434/api",
        "qwen2.5:0.5b",
        { text: "hi", targetLanguage: "Spanish", sourceLanguage: "" }
      );
      for await (const _ of iter) { /* drain */ }
    }

    await expect(consume()).rejects.toThrow(/boom/);
  });
});
