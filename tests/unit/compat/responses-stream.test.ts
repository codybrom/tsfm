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

import { ResponseStream } from "../../../src/compat/responses-stream.js";
import type { ResponseStreamEvent } from "../../../src/compat/responses-types.js";

function makeEvent(type: string, seq: number): ResponseStreamEvent {
  return {
    type: "response.output_text.delta",
    delta: "test",
    item_id: "msg_1",
    output_index: 0,
    content_index: 0,
    sequence_number: seq,
  } as ResponseStreamEvent;
}

async function* makeSource(events: ResponseStreamEvent[]): AsyncIterable<ResponseStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

describe("ResponseStream", () => {
  it("is async iterable", async () => {
    const events = [makeEvent("delta", 0)];
    const stream = new ResponseStream(makeSource(events));

    const results: ResponseStreamEvent[] = [];
    for await (const event of stream) {
      results.push(event);
    }

    expect(results).toHaveLength(1);
  });

  it("yields multiple events in order", async () => {
    const events = [makeEvent("delta", 0), makeEvent("delta", 1), makeEvent("delta", 2)];
    const stream = new ResponseStream(makeSource(events));

    const results: ResponseStreamEvent[] = [];
    for await (const event of stream) {
      results.push(event);
    }

    expect(results).toHaveLength(3);
    expect(results[0].sequence_number).toBe(0);
    expect(results[2].sequence_number).toBe(2);
  });

  it("close() invokes the cleanup callback", () => {
    const cleanup = vi.fn();
    const stream = new ResponseStream(makeSource([]), cleanup);
    stream.close();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("close() is idempotent", () => {
    const cleanup = vi.fn();
    const stream = new ResponseStream(makeSource([]), cleanup);
    stream.close();
    stream.close();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("break during iteration calls cleanup via return()", async () => {
    const cleanup = vi.fn();
    const events = [makeEvent("delta", 0), makeEvent("delta", 1), makeEvent("delta", 2)];
    const stream = new ResponseStream(makeSource(events), cleanup);

    for await (const _event of stream) {
      break;
    }

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("error during iteration calls cleanup", async () => {
    const cleanup = vi.fn();
    async function* errorSource(): AsyncIterable<ResponseStreamEvent> {
      yield makeEvent("delta", 0);
      throw new Error("boom");
    }
    const stream = new ResponseStream(errorSource(), cleanup);

    await expect(async () => {
      for await (const _event of stream) {
        // consume
      }
    }).rejects.toThrow("boom");

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("toReadableStream() returns a ReadableStream", () => {
    const stream = new ResponseStream(makeSource([]));
    const readable = stream.toReadableStream();
    expect(readable).toBeInstanceOf(ReadableStream);
  });

  it("ReadableStream provides events correctly", async () => {
    const events = [makeEvent("delta", 0), makeEvent("delta", 1)];
    const stream = new ResponseStream(makeSource(events));
    const readable = stream.toReadableStream();

    const reader = readable.getReader();
    const results: ResponseStreamEvent[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      results.push(value);
    }

    expect(results).toHaveLength(2);
  });

  it("break works when inner iterator has no return() method", async () => {
    const cleanup = vi.fn();
    const source: AsyncIterable<ResponseStreamEvent> = {
      [Symbol.asyncIterator]() {
        let i = 0;
        const events = [makeEvent("delta", 0), makeEvent("delta", 1)];
        return {
          async next() {
            if (i < events.length) {
              return { done: false as const, value: events[i++] };
            }
            return { done: true as const, value: undefined as unknown as ResponseStreamEvent };
          },
          // Intentionally no return() method
        };
      },
    };
    const stream = new ResponseStream(source, cleanup);

    for await (const _event of stream) {
      break;
    }

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("toReadableStream() propagates errors from the iterator", async () => {
    async function* errorSource(): AsyncIterable<ResponseStreamEvent> {
      yield makeEvent("delta", 0);
      throw new Error("stream error");
    }
    const stream = new ResponseStream(errorSource());
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
      "[tsfm] ResponseStream cleanup via FinalizationRegistry failed:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
