/**
 * Token usage for one response, or accumulated across a session.
 *
 * `input.totalTokens` counts everything the model read for the request,
 * including the session's earlier turns; `input.cachedTokens` is the part of
 * that the model reused from its cache.
 */
export interface Usage {
  input: {
    totalTokens: number;
    cachedTokens: number;
  };
  output: {
    totalTokens: number;
    /** Tokens spent on reasoning. Always 0 for the on-device model. */
    reasoningTokens: number;
  };
}

/** A model response: its content plus the tokens it used. */
export interface Response<T> {
  readonly content: T;
  /** The tokens the request used, or `null` on macOS 26, which doesn't report usage. */
  readonly usage: Usage | null;
}

/** @internal A usage of all zeros. */
export function emptyUsage(): Usage {
  return {
    input: { totalTokens: 0, cachedTokens: 0 },
    output: { totalTokens: 0, reasoningTokens: 0 },
  };
}

let _warnedMalformedUsage = false;

/**
 * @internal Parses the bridge's usage JSON.
 *
 * `null` means usage isn't available (macOS 26 has no usage API, or the
 * session is disposed) and stays `null`, so callers can tell it from zero
 * tokens. Malformed or incomplete JSON can only come from a bridge bug: it reads
 * as zeros, so a response that succeeded isn't lost over its telemetry, but it
 * warns once so the bug doesn't hide behind plausible-looking numbers.
 */
export function parseUsage(json: string | null): Usage | null {
  if (json === null) return null;
  const count = (v: unknown): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
  let raw: Partial<Usage> | null = null;
  try {
    raw = JSON.parse(json) as Partial<Usage>;
  } catch {
    // Handled below as malformed.
  }
  const values = [
    count(raw?.input?.totalTokens),
    count(raw?.input?.cachedTokens),
    count(raw?.output?.totalTokens),
    count(raw?.output?.reasoningTokens),
  ];
  if (values.some((v) => v === null)) {
    if (!_warnedMalformedUsage) {
      _warnedMalformedUsage = true;
      console.warn(
        `[tsfm] Unexpected token usage from the native bridge; reporting zeros: ${json}`,
      );
    }
    return emptyUsage();
  }
  const [inputTotal, inputCached, outputTotal, outputReasoning] = values as number[];
  return {
    input: { totalTokens: inputTotal, cachedTokens: inputCached },
    output: { totalTokens: outputTotal, reasoningTokens: outputReasoning },
  };
}

/**
 * @internal The usage between two cumulative readings. A session's total is
 * the sum of its responses, so `after - before` is what one request used.
 * Clamped at zero in case the session was reset in between. `null` if either
 * reading is unavailable.
 */
export function usageBetween(before: Usage | null, after: Usage | null): Usage | null {
  if (!before || !after) return null;
  const d = (a: number, b: number) => Math.max(0, a - b);
  return {
    input: {
      totalTokens: d(after.input.totalTokens, before.input.totalTokens),
      cachedTokens: d(after.input.cachedTokens, before.input.cachedTokens),
    },
    output: {
      totalTokens: d(after.output.totalTokens, before.output.totalTokens),
      reasoningTokens: d(after.output.reasoningTokens, before.output.reasoningTokens),
    },
  };
}

/**
 * A streaming response. Iterate it with `for await` to receive text deltas;
 * `usage` is set once the stream finishes. A stream can be iterated only once.
 *
 * ```ts
 * const stream = session.streamResponse("Tell me a story");
 * for await (const delta of stream) process.stdout.write(delta);
 * stream.usage?.output.totalTokens;
 * ```
 */
export class ResponseStream implements AsyncIterable<string> {
  private _usage: Usage | null | undefined;
  private _started = false;

  /** @internal */
  constructor(
    private readonly _open: (onFinished: (usage: Usage | null) => void) => AsyncGenerator<string>,
  ) {}

  /**
   * Token usage for the whole response: `undefined` until the stream finishes,
   * then the usage, or `null` on macOS 26, which doesn't report usage.
   */
  get usage(): Usage | null | undefined {
    return this._usage;
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    if (this._started) {
      throw new Error("A ResponseStream can only be iterated once.");
    }
    this._started = true;
    return this._open((usage) => {
      this._usage = usage;
    });
  }

  /** Reads the whole stream and returns the full text with its usage. */
  async collect(): Promise<Response<string>> {
    let content = "";
    for await (const delta of this) content += delta;
    return { content, usage: this._usage ?? null };
  }
}
