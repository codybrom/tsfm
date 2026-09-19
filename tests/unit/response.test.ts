import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const REAL =
  '{"input":{"totalTokens":78,"cachedTokens":64},"output":{"totalTokens":5,"reasoningTokens":0}}';

// Fresh module per test: parseUsage warns only once per process.
async function load() {
  vi.resetModules();
  return import("../../src/response.js");
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("parseUsage", () => {
  it("parses the bridge's usage JSON", async () => {
    const { parseUsage } = await load();
    expect(parseUsage(REAL)).toEqual({
      input: { totalTokens: 78, cachedTokens: 64 },
      output: { totalTokens: 5, reasoningTokens: 0 },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps null (usage unavailable, e.g. macOS 26) as null without warning", async () => {
    const { parseUsage, usageBetween } = await load();
    expect(parseUsage(null)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    const some = parseUsage(
      '{"input":{"totalTokens":1,"cachedTokens":0},"output":{"totalTokens":1,"reasoningTokens":0}}',
    );
    expect(usageBetween(null, some)).toBeNull();
    expect(usageBetween(some, null)).toBeNull();
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a missing field", '{"input":{"totalTokens":1,"cachedTokens":0},"output":{"totalTokens":1}}'],
    [
      "a non-integer count",
      '{"input":{"totalTokens":1.5,"cachedTokens":0},"output":{"totalTokens":1,"reasoningTokens":0}}',
    ],
    [
      "a negative count",
      '{"input":{"totalTokens":-1,"cachedTokens":0},"output":{"totalTokens":1,"reasoningTokens":0}}',
    ],
  ])("reports zeros but warns for %s", async (_label, json) => {
    const { parseUsage, emptyUsage } = await load();
    expect(parseUsage(json)).toEqual(emptyUsage());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/Unexpected token usage/);
  });

  it("warns only once per process", async () => {
    const { parseUsage } = await load();
    parseUsage("{bad");
    parseUsage("{worse");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("usageBetween", () => {
  it("is the change between two cumulative readings", async () => {
    const { usageBetween, parseUsage } = await load();
    const before = parseUsage(
      '{"input":{"totalTokens":62,"cachedTokens":0},"output":{"totalTokens":5,"reasoningTokens":0}}',
    );
    const after = parseUsage(
      '{"input":{"totalTokens":140,"cachedTokens":64},"output":{"totalTokens":10,"reasoningTokens":0}}',
    );
    expect(usageBetween(before, after)).toEqual({
      input: { totalTokens: 78, cachedTokens: 64 },
      output: { totalTokens: 5, reasoningTokens: 0 },
    });
  });

  it("clamps at zero if the session was reset in between", async () => {
    const { usageBetween, parseUsage, emptyUsage } = await load();
    expect(usageBetween(parseUsage(REAL), emptyUsage())).toEqual(emptyUsage());
  });
});
