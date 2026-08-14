import { describe, it, expect, vi } from "vitest";

type RegistryCallback = (cleanup: () => void) => void;

const { getRegistryCallback } = vi.hoisted(() => {
  let captured: RegistryCallback | null = null;

  globalThis.FinalizationRegistry = class MockFinalizationRegistry {
    constructor(callback: RegistryCallback) {
      captured = callback;
    }
    register() {}
    unregister() {}
  } as unknown as typeof FinalizationRegistry;

  return {
    getRegistryCallback: () => captured,
  };
});

import { Stream } from "../../../src/compat/stream.js";
import type { ChatCompletionChunk } from "../../../src/compat/types.js";

function makeChunk(
  content: string | null,
  finishReason: string | null = null,
): ChatCompletionChunk {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1234567890,
    model: "SystemLanguageModel",
    choices: [
      {
        index: 0,
        delta: content != null ? { content } : {},
        finish_reason: finishReason as ChatCompletionChunk["choices"][0]["finish_reason"],
      },
    ],
    usage: null,
    system_fingerprint: null,
  };
}

async function* makeSource(chunks: ChatCompletionChunk[]): AsyncIterable<ChatCompletionChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("Stream", () => {
  it("is async iterable (for await works)", async () => {
    const chunks = [makeChunk("hello")];
    const stream = new Stream(makeSource(chunks));

    const results: ChatCompletionChunk[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(chunks[0]);
  });

  it("yields multiple chunks in order", async () => {
    const chunks = [makeChunk("hello"), makeChunk(" world"), makeChunk(null, "stop")];
    const stream = new Stream(makeSource(chunks));

    const results: ChatCompletionChunk[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results).toHaveLength(3);
    expect(results[0].choices[0].delta).toEqual({ content: "hello" });
    expect(results[1].choices[0].delta).toEqual({ content: " world" });
    expect(results[2].choices[0].finish_reason).toBe("stop");
  });

  it("toReadableStream() returns a ReadableStream", () => {
    const stream = new Stream(makeSource([]));
    const readable = stream.toReadableStream();
    expect(readable).toBeInstanceOf(ReadableStream);
  });

  it("ReadableStream provides chunks correctly", async () => {
    const chunks = [makeChunk("foo"), makeChunk("bar"), makeChunk(null, "stop")];
    const stream = new Stream(makeSource(chunks));
    const readable = stream.toReadableStream();

    const reader = readable.getReader();
    const results: ChatCompletionChunk[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      results.push(value);
    }

    expect(results).toHaveLength(3);
    expect(results[0].choices[0].delta).toEqual({ content: "foo" });
    expect(results[1].choices[0].delta).toEqual({ content: "bar" });
    expect(results[2].choices[0].finish_reason).toBe("stop");
  });

  it("close() invokes the cleanup callback", () => {
    const cleanup = vi.fn();
    const stream = new Stream(makeSource([]), cleanup);
    stream.close();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("close() is idempotent", () => {
    const cleanup = vi.fn();
    const stream = new Stream(makeSource([]), cleanup);
    stream.close();
    stream.close();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("break during iteration calls cleanup via return()", async () => {
    const cleanup = vi.fn();
    const chunks = [makeChunk("a"), makeChunk("b"), makeChunk("c")];
    const stream = new Stream(makeSource(chunks), cleanup);

    for await (const _chunk of stream) {
      break;
    }

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("error during iteration calls cleanup", async () => {
    const cleanup = vi.fn();
    async function* errorSource(): AsyncIterable<ChatCompletionChunk> {
      yield makeChunk("a");
      throw new Error("boom");
    }
    const stream = new Stream(errorSource(), cleanup);

    await expect(async () => {
      for await (const _chunk of stream) {
        // consume
      }
    }).rejects.toThrow("boom");

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("break works when inner iterator has no return() method", async () => {
    const cleanup = vi.fn();
    // Create an async iterable whose iterator lacks a return() method
    const source: AsyncIterable<ChatCompletionChunk> = {
      [Symbol.asyncIterator]() {
        let i = 0;
        const chunks = [makeChunk("a"), makeChunk("b"), makeChunk("c")];
        return {
          async next() {
            if (i < chunks.length) {
              return { done: false as const, value: chunks[i++] };
            }
            return { done: true as const, value: undefined as unknown as ChatCompletionChunk };
          },
          // Intentionally no return() method
        };
      },
    };
    const stream = new Stream(source, cleanup);

    for await (const _chunk of stream) {
      break;
    }

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("toReadableStream() propagates errors from the iterator", async () => {
    async function* errorSource(): AsyncIterable<ChatCompletionChunk> {
      yield makeChunk("ok");
      throw new Error("stream error");
    }
    const stream = new Stream(errorSource());
    const readable = stream.toReadableStream();
    const reader = readable.getReader();

    // First read succeeds
    const first = await reader.read();
    expect(first.done).toBe(false);

    // Second read should reject with the error
    await expect(reader.read()).rejects.toThrow("stream error");
  });

  it("FinalizationRegistry callback invokes the cleanup function", () => {
    const registryCallback = getRegistryCallback();
    expect(registryCallback).toBeTypeOf("function");
    const cleanup = vi.fn();
    registryCallback!(cleanup);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("FinalizationRegistry callback swallows errors from cleanup", () => {
    const registryCallback = getRegistryCallback();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cleanup = vi.fn(() => {
      throw new Error("native cleanup failed");
    });
    expect(() => registryCallback!(cleanup)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      "[tsfm] Stream cleanup via FinalizationRegistry failed:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
