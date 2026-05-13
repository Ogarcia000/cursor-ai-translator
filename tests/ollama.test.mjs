import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { translateWithOllama } from "../src/providers/ollama.mjs";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("translateWithOllama", () => {
  it("sends the expected request and returns the trimmed message content", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: "  hola  " } })
    });

    const result = await translateWithOllama(
      "http://127.0.0.1:11434/api",
      "qwen2.5:0.5b",
      { text: "hello", targetLanguage: "Spanish", sourceLanguage: "English" }
    );

    expect(result).toBe("hola");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(init.body);
    expect(body.model).toBe("qwen2.5:0.5b");
    expect(body.stream).toBe(false);
    expect(body.messages[0].content).toMatch(/Spanish/);
  });

  it("throws when the response is not ok", async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "boom" })
    });

    await expect(
      translateWithOllama("http://127.0.0.1:11434/api", "qwen2.5:0.5b", {
        text: "hi",
        targetLanguage: "Spanish",
        sourceLanguage: ""
      })
    ).rejects.toThrow(/boom/);
  });
});
