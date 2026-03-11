import type { ChatCompletionChunk } from "./types.js";

/** Async iterable wrapper for streaming chat completion chunks, mirroring the `openai` SDK's `Stream`. */
export class Stream implements AsyncIterable<ChatCompletionChunk> {
  private _iterator: AsyncIterator<ChatCompletionChunk>;

  constructor(source: AsyncIterable<ChatCompletionChunk>) {
    this._iterator = source[Symbol.asyncIterator]();
  }

  [Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
    return this._iterator;
  }

  toReadableStream(): ReadableStream<ChatCompletionChunk> {
    const iterator = this._iterator;
    return new ReadableStream<ChatCompletionChunk>({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      },
    });
  }
}
