import { describe, it, expect } from "vitest";
import { configPayloadSchema, translatePayloadSchema, formatZodError } from "../src/schemas.mjs";
import path from "node:path";
import { APP_DIR } from "../src/constants.mjs";

function assertFail(result, includes) {
  expect(result.success).toBe(false);
  expect(formatZodError(result.error)).toMatch(includes);
}

describe("configPayloadSchema", () => {
  it("accepts a python path inside the project", () => {
    const result = configPayloadSchema.safeParse({
      argosPythonPath: path.join(APP_DIR, ".venv-local", "bin", "python")
    });
    expect(result.success).toBe(true);
  });

  it("rejects /bin/sh", () => {
    assertFail(configPayloadSchema.safeParse({ argosPythonPath: "/bin/sh" }), /project directory/);
  });

  it("rejects path traversal", () => {
    assertFail(configPayloadSchema.safeParse({ argosPythonPath: "../../etc/passwd" }), /project directory/);
  });

  it("rejects non-loopback ollama url", () => {
    assertFail(configPayloadSchema.safeParse({ ollamaBaseUrl: "http://attacker.example/api" }), /loopback/);
  });

  it("accepts loopback ollama url", () => {
    const r = configPayloadSchema.safeParse({ ollamaBaseUrl: "http://localhost:11434/api" });
    expect(r.success).toBe(true);
  });

  it("rejects mlxPort out of range", () => {
    assertFail(configPayloadSchema.safeParse({ mlxPort: "80" }), /1024/);
    assertFail(configPayloadSchema.safeParse({ mlxPort: 70000 }), /65535/);
  });

  it("rejects unsupported provider", () => {
    assertFail(configPayloadSchema.safeParse({ provider: "skynet" }), /provider/);
  });

  it("accepts supported providers", () => {
    for (const provider of ["argos", "ollama", "mlx", "openai", "zai"]) {
      expect(configPayloadSchema.safeParse({ provider }).success).toBe(true);
    }
  });

  it("rejects unknown keys", () => {
    const r = configPayloadSchema.safeParse({ argosPythonPath: "", malicious: true });
    expect(r.success).toBe(false);
  });
});

describe("translatePayloadSchema", () => {
  it("rejects missing text", () => {
    assertFail(translatePayloadSchema.safeParse({}), /text/);
  });

  it("rejects oversized text", () => {
    const big = "x".repeat(10_000);
    assertFail(translatePayloadSchema.safeParse({ text: big }), /too long|4000/i);
  });

  it("accepts a normal payload", () => {
    const r = translatePayloadSchema.safeParse({ text: "hello", targetLanguage: "Spanish" });
    expect(r.success).toBe(true);
    expect(r.data.sourceLanguage).toBe("");
  });
});
