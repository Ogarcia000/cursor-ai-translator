import { describe, it, expect } from "vitest";
import { iterNdjson, iterSse } from "../src/streaming.mjs";

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

function bodyFromChunks(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { value: undefined, done: true };
          return { value: encoder.encode(chunks[i++]), done: false };
        }
      };
    }
  };
}

describe("iterNdjson", () => {
  it("parses one JSON object per line", async () => {
    const body = bodyFromString('{"a":1}\n{"b":2}\n{"c":3}\n');
    const out = [];
    for await (const e of iterNdjson({ body })) out.push(e);
    expect(out).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("handles chunk boundaries inside a JSON object", async () => {
    const body = bodyFromChunks(['{"message":{"con', 'tent":"ho"}}\n{"message":{"content":"la"},"done":true}\n']);
    const out = [];
    for await (const e of iterNdjson({ body })) out.push(e);
    expect(out).toEqual([
      { message: { content: "ho" } },
      { message: { content: "la" }, done: true }
    ]);
  });

  it("flushes trailing JSON without newline", async () => {
    const body = bodyFromString('{"x":1}');
    const out = [];
    for await (const e of iterNdjson({ body })) out.push(e);
    expect(out).toEqual([{ x: 1 }]);
  });
});

describe("iterSse", () => {
  it("parses data: lines, stops at [DONE]", async () => {
    const body = bodyFromString('data: {"choices":[{"delta":{"content":"ho"}}]}\ndata: {"choices":[{"delta":{"content":"la"}}]}\ndata: [DONE]\n');
    const out = [];
    for await (const e of iterSse({ body })) out.push(e);
    expect(out).toEqual([
      { choices: [{ delta: { content: "ho" } }] },
      { choices: [{ delta: { content: "la" } }] }
    ]);
  });

  it("ignores non-data lines", async () => {
    const body = bodyFromString(': comment\nevent: foo\ndata: {"a":1}\n');
    const out = [];
    for await (const e of iterSse({ body })) out.push(e);
    expect(out).toEqual([{ a: 1 }]);
  });
});
