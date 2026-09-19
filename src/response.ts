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
  readonly usage: Usage;
}

/** @internal A usage of all zeros. */
export function emptyUsage(): Usage {
  return {
    input: { totalTokens: 0, cachedTokens: 0 },
    output: { totalTokens: 0, reasoningTokens: 0 },
  };
}

/** @internal Parses the bridge's usage JSON, falling back to zeros. */
export function parseUsage(json: string | null): Usage {
  if (!json) return emptyUsage();
  try {
    const raw = JSON.parse(json) as Partial<Usage>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return {
      input: {
        totalTokens: n(raw.input?.totalTokens),
        cachedTokens: n(raw.input?.cachedTokens),
      },
      output: {
        totalTokens: n(raw.output?.totalTokens),
        reasoningTokens: n(raw.output?.reasoningTokens),
      },
    };
  } catch {
    return emptyUsage();
  }
}

/**
 * @internal The usage between two cumulative readings. A session's total is
 * the sum of its responses, so `after - before` is what one request used.
 * Clamped at zero in case the session was reset in between.
 */
export function usageBetween(before: Usage, after: Usage): Usage {
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
  private _usage: Usage | undefined;
  private _started = false;

  /** @internal */
  constructor(
    private readonly _open: (onFinished: (usage: Usage) => void) => AsyncGenerator<string>,
  ) {}

  /** Token usage for the whole response. `undefined` until the stream finishes. */
  get usage(): Usage | undefined {
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
    return { content, usage: this._usage ?? emptyUsage() };
  }
}
