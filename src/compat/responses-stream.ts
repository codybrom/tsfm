import type { ResponseStreamEvent } from "./responses-types.js";

const _streamRegistry = new FinalizationRegistry((cleanup: () => void) => {
  cleanup();
});

/**
 * Async iterable wrapper for Responses API streaming events, mirroring
 * the standard Responses API stream.
 *
 * Can only be iterated once. Call `close()` to release resources early.
 */
export class ResponseStream implements AsyncIterable<ResponseStreamEvent> {
  private _iterator: AsyncIterator<ResponseStreamEvent>;
  private _cleanup?: () => void;

  constructor(source: AsyncIterable<ResponseStreamEvent>, cleanup?: () => void) {
    const inner = source[Symbol.asyncIterator]();
    this._cleanup = cleanup;
    if (cleanup) {
      _streamRegistry.register(this, cleanup, this);
    }

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
      return: async (value?: ResponseStreamEvent) => {
        this.close();
        return inner.return?.(value) ?? { done: true as const, value };
      },
    };
  }

  [Symbol.asyncIterator](): AsyncIterator<ResponseStreamEvent> {
    return this._iterator;
  }

  /** Release resources without consuming remaining events. */
  close(): void {
    if (this._cleanup) {
      _streamRegistry.unregister(this);
      this._cleanup();
      this._cleanup = undefined;
    }
  }

  toReadableStream(): ReadableStream<ResponseStreamEvent> {
    const iterator = this._iterator;
    return new ReadableStream<ResponseStreamEvent>({
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
