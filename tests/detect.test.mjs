import { describe, it, expect } from "vitest";
import { detectLanguage } from "../src/detect.mjs";

describe("detectLanguage", () => {
  it("detects english", () => {
    const out = detectLanguage("The quick brown fox jumps over the lazy dog because it is very lazy.");
    expect(out?.iso1).toBe("en");
    expect(out?.name).toBe("English");
  });

  it("detects spanish", () => {
    const out = detectLanguage("El rapido zorro marron salta sobre el perro perezoso porque tiene mucha hambre hoy.");
    expect(out?.iso1).toBe("es");
    expect(out?.name).toBe("Spanish");
  });

  it("detects french", () => {
    const out = detectLanguage("Le renard brun rapide saute par-dessus le chien paresseux parce qu il a tres faim aujourd hui.");
    expect(out?.iso1).toBe("fr");
  });

  it("returns null for very short input", () => {
    expect(detectLanguage("hi")).toBeNull();
    expect(detectLanguage("")).toBeNull();
    expect(detectLanguage(null)).toBeNull();
  });
});
