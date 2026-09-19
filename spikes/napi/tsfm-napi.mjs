// A minimal session API over the spike addon, shaped like tsfm's so the same
// crash scenarios can run against both.
import { createRequire } from "node:module";

const addon = createRequire(import.meta.url)("./build/tsfm_napi.node");

// process.exit() skips Node-API env cleanup hooks, so cut in-flight requests
// off from JavaScript here instead.
process.on("exit", () => addon.shutdown());

export const isAvailable = () => addon.isAvailable();

export class Session {
  #handle;

  constructor(instructions) {
    this.#handle = addon.createSession(instructions ?? null);
  }

  respond(prompt) {
    try {
      return addon.respond(this.#handle, prompt);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /** Yields text deltas. Breaking out cancels the native stream. */
  async *stream(prompt) {
    const queue = [];
    let wake = null;
    const handle = addon.stream(this.#handle, prompt, (status, text) => {
      queue.push({ status, text });
      wake?.();
    });
    let done = false;
    let previous = "";
    try {
      while (true) {
        while (queue.length === 0) await new Promise((resolve) => (wake = resolve));
        const { status, text } = queue.shift();
        if (status !== 0) {
          done = true;
          throw Object.assign(new Error(text ?? "Stream failed"), { code: String(status) });
        }
        if (text === null) {
          done = true;
          return;
        }
        const delta = text.slice(previous.length);
        previous = text;
        if (delta) yield delta;
      }
    } finally {
      // No callback bookkeeping: the addon absorbs the native side's final call.
      if (!done) addon.cancelStream(handle);
    }
  }

  dispose() {
    addon.disposeSession(this.#handle);
  }
}
