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

  it("resolves both paths to the same module in development", async () => {
    const chat = await import("tsfm-sdk/chat");
    const openai = await import("tsfm-sdk/openai");
    expect(openai.default).toBe(chat.default);
  });
});
