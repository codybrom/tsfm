import type { ChatCompletionChunk } from "./types.js";

const _streamRegistry = new FinalizationRegistry((cleanup: () => void) => {
  cleanup();
});

/**
 * Async iterable wrapper for streaming chat completion chunks, mirroring the standard Chat Completions `Stream`.
 *
 * Like a standard `Stream`, this can only be iterated once. A second
 * `for await` loop over the same instance will yield no chunks.
 *
 * Call `close()` when done if you do not fully consume the stream, to release
 * the underlying native session. Fully consumed streams clean up automatically.
 */
export class Stream implements AsyncIterable<ChatCompletionChunk> {
  private _iterator: AsyncIterator<ChatCompletionChunk>;
  private _cleanup?: () => void;

  constructor(source: AsyncIterable<ChatCompletionChunk>, cleanup?: () => void) {
    const inner = source[Symbol.asyncIterator]();
    this._cleanup = cleanup;
    if (cleanup) {
      _streamRegistry.register(this, cleanup, this);
    }

    // Wrap the inner iterator so that exhaustion (done) or error
    // automatically triggers close(), eagerly releasing resources
    // instead of waiting for GC via FinalizationRegistry.
    this._iterator = {
      next: async () => {
        try {
          const result = await inner.next();
          if (result.done) this.close();
          return result;
        } catch (err) {
          this.close();
          throw err;
        }
      },
      return: async (value?: ChatCompletionChunk) => {
        this.close();
        return inner.return?.(value) ?? { done: true as const, value };
      },
    };
  }

  [Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
    return this._iterator;
  }

  /** Release resources associated with this stream without consuming remaining chunks. */
  close(): void {
    if (this._cleanup) {
      _streamRegistry.unregister(this);
      this._cleanup();
      this._cleanup = undefined;
    }
  }

  toReadableStream(): ReadableStream<ChatCompletionChunk> {
    const iterator = this._iterator;
    return new ReadableStream<ChatCompletionChunk>({
      async pull(controller) {
        try {
          const { value, done } = await iterator.next();
          if (done) {
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (err) {
          controller.error(err);
        }
      },
    });
  }
}
