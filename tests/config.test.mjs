import { describe, it, expect } from "vitest";
import path from "node:path";
import { validateConfigInput } from "../src/config.mjs";
import { APP_DIR } from "../src/constants.mjs";

describe("validateConfigInput", () => {
  it("accepts a python path inside the project", () => {
    expect(() => validateConfigInput({
      argosPythonPath: path.join(APP_DIR, ".venv-local", "bin", "python")
    })).not.toThrow();
  });

  it("rejects /bin/sh as python path", () => {
    expect(() => validateConfigInput({ argosPythonPath: "/bin/sh" }))
      .toThrow(/inside the project directory/);
  });

  it("rejects path traversal attempts", () => {
    expect(() => validateConfigInput({ argosPythonPath: "../../../etc/passwd" }))
      .toThrow(/inside the project directory/);
  });

  it("accepts ollama url on loopback", () => {
    expect(() => validateConfigInput({ ollamaBaseUrl: "http://127.0.0.1:11434/api" })).not.toThrow();
    expect(() => validateConfigInput({ ollamaBaseUrl: "http://localhost:11434/api" })).not.toThrow();
  });

  it("rejects ollama url pointing elsewhere", () => {
    expect(() => validateConfigInput({ ollamaBaseUrl: "http://attacker.example/api" }))
      .toThrow(/loopback/);
  });

  it("rejects malformed ollama url", () => {
    expect(() => validateConfigInput({ ollamaBaseUrl: "not a url" }))
      .toThrow(/valid http\(s\) URL/);
  });

  it("rejects mlxPort out of range", () => {
    expect(() => validateConfigInput({ mlxPort: "80" })).toThrow(/1024/);
    expect(() => validateConfigInput({ mlxPort: "70000" })).toThrow(/65535/);
  });

  it("accepts mlxPort in range", () => {
    expect(() => validateConfigInput({ mlxPort: "11435" })).not.toThrow();
  });

  it("rejects unsupported provider", () => {
    expect(() => validateConfigInput({ provider: "skynet" })).toThrow(/provider must be one of/);
  });

  it("accepts supported providers", () => {
    for (const provider of ["argos", "ollama", "mlx", "openai", "zai"]) {
      expect(() => validateConfigInput({ provider })).not.toThrow();
    }
  });
});
