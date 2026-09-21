import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const pkg = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8"),
) as { exports: Record<string, unknown> };

describe("package exports", () => {
  it("makes tsfm-sdk/openai an alias of tsfm-sdk/chat", () => {
    expect(pkg.exports["./openai"]).toEqual(pkg.exports["./chat"]);
  });

  it("makes tsfm-sdk/jev an alias of tsfm-sdk/system1", () => {
    expect(pkg.exports["./jev"]).toEqual(pkg.exports["./system1"]);
  });

  it("resolves both paths to the same module in development", async () => {
    const chat = await import("tsfm-sdk/chat");
    const openai = await import("tsfm-sdk/openai");
    expect(openai.default).toBe(chat.default);
  });

  it("resolves both System One paths to the same module in development", async () => {
    const system1 = await import("tsfm-sdk/system1");
    const jev = await import("tsfm-sdk/jev");
    expect(jev.SystemOneClient).toBe(system1.SystemOneClient);
    expect(jev.TypeSafeClient).toBe(system1.SystemOneClient);
  });
});
